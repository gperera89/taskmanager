"use client";

// The note body editor: CodeMirror 6 in Markdown mode — the same engine Obsidian is built on, so
// what's typed here round-trips to the vault byte-for-byte (a rich-text editor would re-serialise
// the Markdown on every save and churn the files). Styled as a quiet writing surface rather than
// a code editor: no gutter, wrapped lines, headings at heading sizes, Markdown markers faded, and
// `- [ ]` checkboxes rendered as real, tappable boxes.
//
// Loaded with next/dynamic (ssr: false) from NotePage, so none of this ships until a note opens.

import { useEffect, useRef } from "react";
import { Annotation, EditorState, Transaction } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  placeholder as placeholderExt,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { tags } from "@lezer/highlight";
import { diffChanges } from "@/lib/noteTasks";

const highlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.6em", fontWeight: "600", lineHeight: "1.3" },
  { tag: tags.heading2, fontSize: "1.35em", fontWeight: "600", lineHeight: "1.3" },
  { tag: tags.heading3, fontSize: "1.15em", fontWeight: "600" },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: "600" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through", color: "var(--ink-strike)" },
  { tag: tags.link, color: "var(--accent-text)" },
  { tag: tags.url, color: "var(--info)" },
  { tag: tags.quote, color: "var(--ink-quote)", fontStyle: "italic" },
  { tag: tags.monospace, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.9em" },
  // Markdown punctuation (#, **, >, list bullets) recedes so the prose reads first.
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator], color: "var(--ink-faint)" },
]);

const theme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--ink)", fontSize: "17px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.65", overflow: "visible" },
  ".cm-content": { padding: "0 0 40vh", caretColor: "var(--accent-text)" },
  ".cm-line": { padding: "0" },
  ".cm-cursor": { borderLeftColor: "var(--accent-text)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--accent-wash-strong) !important",
  },
  ".cm-placeholder": { color: "var(--ink-ghost)", fontStyle: "italic" },
  ".cm-note-checkbox": {
    width: "15px",
    height: "15px",
    margin: "0 3px 0 0",
    verticalAlign: "-2px",
    cursor: "pointer",
    accentColor: "var(--accent)",
  },
  ".cm-note-done": { color: "var(--ink-strike)", textDecoration: "line-through" },
});

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-note-checkbox";
    box.checked = this.checked;
    box.setAttribute("aria-label", this.checked ? "Mark not done" : "Mark done");
    // mousedown, not click: stop CodeMirror moving the caret onto the hidden "[ ]" first.
    box.addEventListener("mousedown", (e) => e.preventDefault());
    box.addEventListener("click", (e) => {
      e.preventDefault();
      // The marker's text is "[ ]" or "[x]" — the state character sits one in from `pos`.
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? " " : "x" } });
    });
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

// Marks a doc replacement that came from outside (another device's edit), so the update listener
// doesn't echo it straight back as a local change to save.
const remoteChange = Annotation.define<boolean>();

const doneLine = Decoration.mark({ class: "cm-note-done" });
// The " ^cura-k3x9q2" block id that links a checkbox line to its task — bookkeeping, not
// writing, so it's hidden here (Obsidian shows it faintly).
const hiddenBlockId = Decoration.replace({});
const BLOCK_ID_IN_LINE = /\s?\^cura-[a-z0-9]+(?=\s|$)/g;

// GFM task markers ("[ ]" / "[x]" inside a list item) become checkbox widgets, and a ticked
// item's text is struck through — Obsidian's live-preview look for the one construct that
// matters most here, since these lines become Cura tasks.
function checkboxDecorations(view: EditorView): DecorationSet {
  const ranges: ReturnType<Decoration["range"]>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== "TaskMarker") return;
        const text = view.state.doc.sliceString(node.from, node.to);
        const checked = /\[[xX]\]/.test(text);
        ranges.push(Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }).range(node.from, node.to));
        const line = view.state.doc.lineAt(node.to);
        const ids: { from: number; to: number }[] = [];
        for (const m of line.text.matchAll(BLOCK_ID_IN_LINE)) {
          ids.push({ from: line.from + m.index!, to: line.from + m.index! + m[0].length });
        }
        // Strike through the text up to the (hidden) block id, not across it.
        const textEnd = ids.length ? ids[0].from : line.to;
        if (checked && textEnd > node.to + 1) ranges.push(doneLine.range(node.to + 1, textEnd));
        for (const id of ids) ranges.push(hiddenBlockId.range(id.from, id.to));
      },
    });
  }
  return Decoration.set(ranges, true);
}

const checkboxes = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = checkboxDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = checkboxDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    // The caret steps over a hidden block id as one unit instead of wandering inside it.
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
  }
);

// What NotePage can do to a live editor. `apply` runs a transform over the current text and
// dispatches only the lines that changed (so the caret stays put), returning the new text. It's
// marked as a remote change: not the user's typing, so it's kept out of undo history and not
// reported back through onDocChange.
export type MarkdownEditorHandle = {
  apply: (transform: (doc: string) => string) => string;
  focus: () => void;
};

export default function MarkdownEditor({
  initialDoc,
  onReady,
  onDocChange,
  placeholder = "Start writing…",
  autoFocus = false,
}: {
  initialDoc: string;
  onReady: (handle: MarkdownEditorHandle | null) => void;
  onDocChange: (text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onDocChange);
  useEffect(() => {
    onChangeRef.current = onDocChange;
  }, [onDocChange]);

  // Built once per mount; NotePage keys this component by note id, so switching notes remounts.
  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(highlight),
          checkboxes,
          EditorView.lineWrapping,
          placeholderExt(placeholder),
          theme,
          EditorView.contentAttributes.of({ autocapitalize: "sentences", spellcheck: "true", "aria-label": "Note" }),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged || u.transactions.some((tr) => tr.annotation(remoteChange))) return;
            onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    if (autoFocus) view.focus();
    onReady({
      apply: (transform) => {
        const current = view.state.doc.toString();
        const next = transform(current);
        const changes = diffChanges(current, next);
        if (changes.length) {
          view.dispatch({ changes, annotations: [remoteChange.of(true), Transaction.addToHistory.of(false)] });
        }
        return next;
      },
      focus: () => view.focus(),
    });
    return () => {
      onReady(null);
      view.destroy();
      viewRef.current = null;
    };
    // initialDoc/placeholder/autoFocus are mount-time only by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} className="min-h-[50vh] font-serif" />;
}
