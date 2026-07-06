"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useModalActions } from "./ModalContext";
import { renderMarkdownLite } from "./markdownLite";
import ModeToggle from "./ModeToggle";
import { useTaskbook } from "./store";
import type { CapturedKind, VoiceCaptureVM } from "./types";

const KIND_LABEL: Record<CapturedKind, string> = {
  task: "Task",
  project: "Project",
  routine: "Routine",
  habit: "Habit",
};

type ChatMessage = { role: "user" | "assistant"; content: string };

type BarMode = "search" | "chat" | "mic";

// Material Symbols glyphs (24dp, outlined), inlined so fill color can react to selection —
// same convention as ModeToggle's ICON_PATH.
const ADD_ICON_PATH = "M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z";
const BAR_ICON_PATH: Record<BarMode, string> = {
  search:
    "M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z",
  chat: "M240-400h320v-80H240v80Zm0-120h480v-80H240v80Zm0-120h480v-80H240v80ZM80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Zm126-240h594v-480H160v525l46-45Zm-46 0v-480 480Z",
  mic: "M395-435q-35-35-35-85v-240q0-50 35-85t85-35q50 0 85 35t35 85v240q0 50-35 85t-85 35q-50 0-85-35Zm85-205Zm-40 520v-123q-104-14-172-93t-68-184h80q0 83 58.5 141.5T480-320q83 0 141.5-58.5T680-520h80q0 105-68 184t-172 93v123h-80Zm68.5-371.5Q520-503 520-520v-240q0-17-11.5-28.5T480-800q-17 0-28.5 11.5T440-760v240q0 17 11.5 28.5T480-480q17 0 28.5-11.5Z",
};

// MediaRecorder's default mimeType varies by browser; pick a file extension Whisper recognizes.
function extensionFor(mimeType: string): string {
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

export default function Header({
  todayLabel,
  query,
  onQueryChange,
  pendingCaptures,
  onEditCapture,
  onOpenSettings,
  isMobile,
}: {
  todayLabel: string;
  query: string;
  onQueryChange: (v: string) => void;
  pendingCaptures: VoiceCaptureVM[];
  onEditCapture: (kind: CapturedKind, entityId: string) => void;
  onOpenSettings: () => void;
  isMobile: boolean;
}) {
  const router = useRouter();
  const { openAdd } = useModalActions();
  const { actions, mode, setMode } = useTaskbook();
  const [showNotif, setShowNotif] = useState(false);
  // On mobile, settings/notifications/mode toggle are portaled into the sign-out bar in
  // layout.tsx (top-right) instead of rendered here, since they'd otherwise overflow off-screen
  // alongside the search bar below the lg breakpoint.
  const [mobileActionsEl, setMobileActionsEl] = useState<HTMLElement | null>(null);
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const notifRef = useRef<HTMLDivElement>(null);

  // Search/chat/mic toggle for the search bar — "barMode" to avoid confusion with the unrelated
  // home/all/work `mode` from useTaskbook() above.
  const [barMode, setBarMode] = useState<BarMode>("search");
  const [chatDraft, setChatDraft] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // One-time DOM query for the portal target rendered by layout.tsx, which exists before
    // this component mounts — not syncing to changing external state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobileActionsEl(document.getElementById("mobile-top-actions"));
  }, []);

  useEffect(() => {
    if (!showNotif) return;
    function handlePointerDown(e: PointerEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotif(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showNotif]);

  useEffect(() => {
    if (!chatPanelOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (chatRef.current && !chatRef.current.contains(e.target as Node)) {
        setChatPanelOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [chatPanelOpen]);

  async function sendChatMessage() {
    const content = chatDraft.trim();
    if (!content || chatLoading) return;
    const nextMessages = [...chatMessages, { role: "user" as const, content }];
    setChatMessages(nextMessages);
    setChatDraft("");
    setChatError(null);
    setChatLoading(true);
    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Chat failed");
      setChatMessages([...nextMessages, { role: "assistant", content: data.reply }]);
      if (data.mutated) router.refresh();
    } catch (err) {
      console.error("[assistant] chat failed:", err);
      setChatError(err instanceof Error ? err.message : "Chat failed");
    } finally {
      setChatLoading(false);
    }
  }

  async function uploadRecording(blob: Blob) {
    setProcessing(true);
    try {
      const fd = new FormData();
      fd.set("audio", blob, `recording.${extensionFor(blob.type)}`);
      const res = await fetch("/api/voice-capture", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Voice capture failed");
      setShowNotif(true);
      setBarMode("search");
      router.refresh();
    } catch (err) {
      console.error("[voice] capture failed:", err);
      setCaptureError(err instanceof Error ? err.message : "Voice capture failed");
      setBarMode("mic");
    } finally {
      setProcessing(false);
    }
  }

  async function toggleListening() {
    if (listening) {
      mediaRecorderRef.current?.stop();
      mediaRecorderRef.current = null;
      setListening(false);
      return;
    }

    setCaptureError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void uploadRecording(new Blob(chunksRef.current, { type: recorder.mimeType }));
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setListening(true);
    } catch (err) {
      console.error("[voice] microphone access failed:", err);
      setCaptureError("Couldn't access the microphone.");
    }
  }

  // Selecting search/chat while a recording is in flight stops it (still processes/uploads
  // whatever was captured) rather than leaving it running silently in the background.
  function selectSearchMode() {
    if (listening) void toggleListening();
    setBarMode("search");
  }
  function selectChatMode() {
    if (listening) void toggleListening();
    setBarMode("chat");
    setChatPanelOpen(true);
  }
  function selectMicMode() {
    if (barMode === "mic") {
      if (listening) void toggleListening();
      return;
    }
    setChatPanelOpen(false);
    setBarMode("mic");
    void toggleListening();
  }

  function handleEditCapture(capture: VoiceCaptureVM) {
    onEditCapture(capture.kind, capture.entityId);
    setShowNotif(false);
    actions.dismissCapture(capture.id);
  }

  // Shared between the desktop layout (rendered inline, after the search bar) and mobile
  // (portaled into the sign-out bar in layout.tsx) — only one of those spots renders it at a time.
  const actionsCluster = (
    <>
      <ModeToggle mode={mode} onChange={setMode} />

      <button
        type="button"
        title="Settings"
        onClick={onOpenSettings}
        className="flex h-9 w-9 cursor-pointer items-center justify-center"
      >
        <svg width="18" height="18" viewBox="0 -960 960 960" fill="#557694">
          <path d="m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm70-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z" />
        </svg>
      </button>

      <div className="relative" ref={notifRef}>
        <button
          type="button"
          onClick={() => setShowNotif((v) => !v)}
          className="relative flex h-9 w-9 cursor-pointer items-center justify-center"
        >
          {pendingCaptures.length > 0 ? (
            <svg width="19" height="19" viewBox="0 -960 960 960" fill="#557694">
              <path d="M480-80q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80Zm0-420ZM160-200v-80h80v-280q0-83 50-147.5T420-792v-28q0-25 17.5-42.5T480-880q25 0 42.5 17.5T540-820v13q-11 22-16 45t-4 47q-10-2-19.5-3.5T480-720q-66 0-113 47t-47 113v280h320v-257q18 8 38.5 12.5T720-520v240h80v80H160Zm475-435q-35-35-35-85t35-85q35-35 85-35t85 35q35 35 35 85t-35 85q-35 35-85 35t-85-35Z" />
            </svg>
          ) : (
            <svg width="19" height="19" viewBox="0 -960 960 960" fill="#557694">
              <path d="M160-200v-80h80v-280q0-83 50-147.5T420-792v-28q0-25 17.5-42.5T480-880q25 0 42.5 17.5T540-820v28q80 20 130 84.5T720-560v280h80v80H160Zm320-300Zm0 420q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80ZM320-280h320v-280q0-66-47-113t-113-47q-66 0-113 47t-47 113v280Z" />
            </svg>
          )}
        </button>
        {showNotif && (
          <div className="absolute right-0 top-[46px] z-30 w-[330px] rounded-xl border border-[#ddd4c1] bg-[#faf7ef] p-4 shadow-[0_16px_40px_rgba(70,55,30,.22)]">
            <div className="mb-1 text-[11px] uppercase tracking-[0.16em] text-[#a49a82]">Added by voice</div>
            <div className="mb-2.5 text-xs italic text-[#a49a82]">Filed automatically — check it landed right.</div>
            {pendingCaptures.length === 0 ? (
              <div className="py-3.5 text-sm italic text-[#a49a82]">All caught up.</div>
            ) : (
              <div className="flex max-h-80 flex-col gap-2.5 overflow-y-auto">
                {pendingCaptures.map((c) => (
                  <CapturedItem key={c.id} capture={c} onEdit={handleEditCapture} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="flex flex-none items-center justify-between border-b border-[#ddd4c1] px-8 py-4">
      <div className="relative flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            openAdd();
            setShowNotif(false);
          }}
          className="flex items-center gap-2 rounded-full bg-[#17399b] py-2 pl-3 pr-3.5 text-white cursor-pointer"
        >
          <svg width="16" height="16" viewBox="0 -960 960 960">
            <path d={ADD_ICON_PATH} fill="#fff" />
          </svg>
          <span className="text-sm">Add</span>
        </button>
      </div>

      <div className="hidden items-center gap-4 lg:flex">
        <div className="relative" ref={chatRef}>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-0.5 rounded-full border border-[#d3c9b3] p-1">
              <button
                type="button"
                title="Search"
                aria-pressed={barMode === "search"}
                onClick={selectSearchMode}
                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full"
                style={{ background: barMode === "search" ? "rgba(23,57,155,.12)" : "transparent" }}
              >
                <svg width="13" height="13" viewBox="0 -960 960 960">
                  <path d={BAR_ICON_PATH.search} fill={barMode === "search" ? "#17399b" : "#a49a82"} />
                </svg>
              </button>
              <button
                type="button"
                title="Chat"
                aria-pressed={barMode === "chat"}
                onClick={selectChatMode}
                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full"
                style={{ background: barMode === "chat" ? "rgba(23,57,155,.12)" : "transparent" }}
              >
                <svg width="13" height="13" viewBox="0 -960 960 960">
                  <path d={BAR_ICON_PATH.chat} fill={barMode === "chat" ? "#17399b" : "#a49a82"} />
                </svg>
              </button>
              <button
                type="button"
                title="Speak to add"
                disabled={processing && barMode !== "mic"}
                aria-pressed={barMode === "mic"}
                onClick={selectMicMode}
                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-60"
                style={{ background: barMode === "mic" ? "rgba(23,57,155,.12)" : "transparent" }}
              >
                <svg width="13" height="13" viewBox="0 -960 960 960">
                  <path
                    d={BAR_ICON_PATH.mic}
                    fill={barMode === "mic" ? "#17399b" : "#a49a82"}
                  />
                </svg>
              </button>
            </div>

            <div
              className="flex w-65 items-center gap-2 rounded-full border border-[#d3c9b3] px-3.5 py-1.5 text-[#a49a82]"
              style={{ animation: barMode === "mic" && listening ? "mic-pulse 1.6s ease-in-out infinite" : undefined }}
            >
              <svg width="15" height="15" viewBox="0 -960 960 960" className="flex-none">
                <path d={BAR_ICON_PATH[barMode === "chat" ? "chat" : barMode === "mic" ? "mic" : "search"]} fill="#b3a988" />
              </svg>
              {barMode === "search" && (
                <input
                  value={query}
                  onChange={(e) => onQueryChange(e.target.value)}
                  placeholder="Search tasks…"
                  className="w-full min-w-0 bg-transparent text-[13.5px] text-[#2a2622] outline-none placeholder:text-[#a49a82]"
                />
              )}
              {barMode === "chat" && (
                <input
                  value={chatDraft}
                  onChange={(e) => setChatDraft(e.target.value)}
                  onFocus={() => setChatPanelOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void sendChatMessage();
                    }
                  }}
                  placeholder="Ask about your tasks, or tell me to add one…"
                  disabled={chatLoading}
                  className="w-full min-w-0 bg-transparent text-[13.5px] text-[#2a2622] outline-none placeholder:text-[#a49a82] disabled:opacity-60"
                />
              )}
              {barMode === "mic" && (
                <div className="flex w-full min-w-0 items-center gap-2">
                  <div className="flex flex-none items-center gap-0.75" aria-hidden>
                    {[0, 1, 2, 3].map((i) => (
                      <span
                        key={i}
                        className="block h-3 w-0.75 rounded-full"
                        style={{
                          background: captureError ? "#8a4040" : "#17399b",
                          animation:
                            listening || processing ? `mic-bar 0.9s ${i * 0.12}s ease-in-out infinite` : undefined,
                          opacity: listening || processing ? 1 : 0.4,
                        }}
                      />
                    ))}
                  </div>
                  <span
                    className="truncate text-[13.5px] italic"
                    style={{ color: captureError ? "#8a4040" : "#17399b" }}
                  >
                    {captureError ?? (processing ? "Transcribing…" : listening ? "Listening… tap to stop" : "Tap the mic to start")}
                  </span>
                </div>
              )}
            </div>
          </div>

          {barMode === "chat" && chatPanelOpen && (
            <div className="absolute left-0 top-[46px] z-30 w-95 rounded-xl border border-[#ddd4c1] bg-[#faf7ef] p-4 shadow-[0_16px_40px_rgba(70,55,30,.22)]">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-[0.16em] text-[#a49a82]">Ask about your tasks</div>
                {chatMessages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setChatMessages([])}
                    className="cursor-pointer text-xs text-[#b3a988] hover:text-[#8a4040]"
                  >
                    Clear
                  </button>
                )}
              </div>
              {chatMessages.length === 0 && !chatLoading ? (
                <div className="py-3.5 text-sm italic text-[#a49a82]">
                  Try &ldquo;what&apos;s due today?&rdquo; or &ldquo;add a task to call the vet tomorrow&rdquo;.
                </div>
              ) : (
                <div className="flex max-h-80 flex-col gap-2.5 overflow-y-auto">
                  {chatMessages.map((m, i) => (
                    <div
                      key={i}
                      className={
                        m.role === "user"
                          ? "self-end rounded-lg bg-[#17399b] px-3 py-1.5 text-sm text-white"
                          : "self-start rounded-lg border border-[#ddd4c1] bg-white px-3 py-1.5 text-sm text-[#2a2622]"
                      }
                      style={{ maxWidth: "85%" }}
                    >
                      {m.role === "assistant" ? renderMarkdownLite(m.content) : m.content}
                    </div>
                  ))}
                  {chatLoading && <div className="self-start text-sm italic text-[#a49a82]">Thinking…</div>}
                </div>
              )}
              {chatError && <div className="mt-2 text-[11px] italic text-[#8a4040]">{chatError}</div>}
            </div>
          )}
        </div>

        <span className="text-[13px] text-[#8a8069]">{todayLabel}</span>

        {!isMobile && actionsCluster}
      </div>

      {isMobile && mobileActionsEl && createPortal(actionsCluster, mobileActionsEl)}
    </div>
  );
}

function CapturedItem({ capture, onEdit }: { capture: VoiceCaptureVM; onEdit: (capture: VoiceCaptureVM) => void }) {
  const { actions } = useTaskbook();
  return (
    <div className="rounded-lg border border-[#ddd4c1] bg-[#faf7ef] p-2.5">
      <div className="mb-0.5 text-[11px] uppercase tracking-[0.14em] text-[#a49a82]">{KIND_LABEL[capture.kind]}</div>
      <div className="text-sm text-[#2a2622]">{capture.summary}</div>
      {capture.parseError && (
        <div className="mt-0.5 text-[11px] italic text-[#8a4040]">
          Couldn&apos;t fully understand this one — worth a check.
        </div>
      )}
      <div className="mt-1.5 text-[11px] italic text-[#a49a82]">&ldquo;{capture.transcript}&rdquo;</div>
      <div className="mt-2 flex justify-end gap-3">
        <button
          type="button"
          onClick={() => actions.dismissCapture(capture.id)}
          className="cursor-pointer text-xs text-[#b3a988] hover:text-[#8a4040]"
        >
          Mark as read
        </button>
        <button type="button" onClick={() => onEdit(capture)} className="cursor-pointer text-xs text-[#17399b]">
          Edit
        </button>
      </div>
    </div>
  );
}
