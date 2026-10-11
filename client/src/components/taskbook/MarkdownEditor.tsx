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
        if (checked) {
          const line = view.state.doc.lineAt(node.to);
          if (line.to > node.to + 1) ranges.push(doneLine.range(node.to + 1, line.to));
        }
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
  { decorations: (v) => v.decorations }
);

export default function MarkdownEditor({
  initialDoc,
  externalDoc,
  onDocChange,
  placeholder = "Start writing…",
  autoFocus = false,
}: {
  initialDoc: string;
  // A doc pushed in from outside (another device's edit). Replaces the editor's content when it
  // differs — the caller decides when that's safe (see NotePage), this just applies it.
  externalDoc?: { text: string; seq: number };
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
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // initialDoc/placeholder/autoFocus are mount-time only by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !externalDoc) return;
    const current = view.state.doc.toString();
    if (current === externalDoc.text) return;
    const head = Math.min(view.state.selection.main.head, externalDoc.text.length);
    view.dispatch({
      changes: { from: 0, to: current.length, insert: externalDoc.text },
      selection: { anchor: head },
      // Not the user's typing — keep it out of their undo history.
      annotations: [remoteChange.of(true), Transaction.addToHistory.of(false)],
    });
  }, [externalDoc]);

  return <div ref={hostRef} className="min-h-[50vh] font-serif" />;
}
