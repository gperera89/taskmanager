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
  onOpenLogbook,
  onOpenReview,
  isMobile,
}: {
  todayLabel: string;
  query: string;
  onQueryChange: (v: string) => void;
  pendingCaptures: VoiceCaptureVM[];
  onEditCapture: (kind: CapturedKind, entityId: string) => void;
  onOpenSettings: () => void;
  onOpenLogbook: () => void;
  onOpenReview: () => void;
  isMobile: boolean;
}) {
  const router = useRouter();
  const { openAdd } = useModalActions();
  const { actions, mode, setMode, offline } = useTaskbook();
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
  // Set true when the user cancels — read inside the recorder's onstop so a cancelled recording
  // is thrown away instead of being uploaded (which would send background noise to the API).
  const canceledRef = useRef(false);
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

  // Mobile only: the Add button opens a dropdown (Add item / Search / Chat / Voice); picking a
  // tool opens a full-screen modal hosting it. `mobileTool` is which tool the modal shows —
  // kept separate from the desktop `barMode` so the two surfaces don't fight over one piece of
  // state. Desktop keeps its inline search/chat/mic bar and never touches these.
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [mobileTool, setMobileTool] = useState<BarMode | null>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!addMenuOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [addMenuOpen]);

  // Open a tool in the mobile modal. Voice starts recording straight away, matching the desktop
  // mic tab's behavior.
  function openMobileTool(tool: BarMode) {
    setAddMenuOpen(false);
    setMobileTool(tool);
    if (tool === "mic" && !listening && !processing) void toggleListening();
  }

  // Close the mobile tool modal, discarding an in-flight recording so it isn't uploaded.
  function closeMobileTool() {
    if (listening) cancelListening();
    setMobileTool(null);
  }

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
      // On mobile the mic lives in the tools modal — close it once the capture lands so the user
      // isn't stranded on an idle mic screen (harmless on desktop, where mobileTool is null).
      setMobileTool(null);
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
      canceledRef.current = false;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (canceledRef.current) {
          chunksRef.current = [];
          return;
        }
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

  // Discard an in-flight recording without uploading — for when the mic was tapped by accident
  // and would otherwise send background noise to the API.
  function cancelListening() {
    if (!listening) return;
    canceledRef.current = true;
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setListening(false);
    setCaptureError(null);
    setBarMode("search");
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

  // Switch tools inside the mobile modal. Leaving the mic tab while recording stops and uploads
  // (same as desktop's selectSearch/selectChat); entering it starts a fresh recording.
  function switchMobileTool(tool: BarMode) {
    if (mobileTool === "mic" && tool !== "mic" && listening) void toggleListening();
    setMobileTool(tool);
    if (tool === "mic" && !listening && !processing) void toggleListening();
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
        title="Logbook"
        aria-label="Logbook — completion history"
        onClick={onOpenLogbook}
        className="flex h-9 w-9 cursor-pointer items-center justify-center"
      >
        {/* Material Symbols "history" */}
        <svg width="18" height="18" viewBox="0 -960 960 960" style={{ fill: "var(--info)" }}>
          <path d="M480-120q-138 0-240.5-91.5T122-440h82q14 104 92.5 172T480-200q117 0 198.5-81.5T760-480q0-117-81.5-198.5T480-760q-69 0-129 32t-101 88h110v80H120v-240h80v94q51-64 124.5-99T480-840q75 0 140.5 28.5t114 77q48.5 48.5 77 114T840-480q0 75-28.5 140.5t-77 114q-48.5 48.5-114 77T480-120Zm112-192L440-464v-216h80v184l128 128-56 56Z" />
        </svg>
      </button>

      <button
        type="button"
        title="Weekly review"
        aria-label="Weekly review"
        onClick={onOpenReview}
        className="flex h-9 w-9 cursor-pointer items-center justify-center"
      >
        {/* Material Symbols "checklist" */}
        <svg width="18" height="18" viewBox="0 -960 960 960" style={{ fill: "var(--info)" }}>
          <path d="M222-200 80-342l56-56 85 85 170-170 56 57-225 226Zm0-320L80-662l56-56 85 85 170-170 56 57-225 226Zm298 240v-80h360v80H520Zm0-320v-80h360v80H520Z" />
        </svg>
      </button>

      <button
        type="button"
        title="Settings"
        aria-label="Settings"
        onClick={onOpenSettings}
        className="flex h-9 w-9 cursor-pointer items-center justify-center"
      >
        <svg width="18" height="18" viewBox="0 -960 960 960" style={{ fill: "var(--info)" }}>
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
            <svg width="19" height="19" viewBox="0 -960 960 960" style={{ fill: "var(--info)" }}>
              <path d="M480-80q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80Zm0-420ZM160-200v-80h80v-280q0-83 50-147.5T420-792v-28q0-25 17.5-42.5T480-880q25 0 42.5 17.5T540-820v13q-11 22-16 45t-4 47q-10-2-19.5-3.5T480-720q-66 0-113 47t-47 113v280h320v-257q18 8 38.5 12.5T720-520v240h80v80H160Zm475-435q-35-35-35-85t35-85q35-35 85-35t85 35q35 35 35 85t-35 85q-35 35-85 35t-85-35Z" />
            </svg>
          ) : (
            <svg width="19" height="19" viewBox="0 -960 960 960" style={{ fill: "var(--info)" }}>
              <path d="M160-200v-80h80v-280q0-83 50-147.5T420-792v-28q0-25 17.5-42.5T480-880q25 0 42.5 17.5T540-820v28q80 20 130 84.5T720-560v280h80v80H160Zm320-300Zm0 420q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80ZM320-280h320v-280q0-66-47-113t-113-47q-66 0-113 47t-47 113v280Z" />
            </svg>
          )}
        </button>
        {showNotif && (
          <div className="absolute right-0 top-[46px] z-30 w-[330px] rounded-xl border border-(--border) bg-(--card) p-4 shadow-[0_16px_40px_rgba(70,55,30,.22)]">
            <div className="mb-1 text-[11px] uppercase tracking-[0.16em] text-(--ink-soft)">Added automatically</div>
            <div className="mb-2.5 text-xs italic text-(--ink-soft)">Captured by voice or email — check it landed right.</div>
            {pendingCaptures.length === 0 ? (
              <div className="py-3.5 text-sm italic text-(--ink-soft)">All caught up.</div>
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
    <div className="flex flex-none items-center justify-between border-b border-(--border) px-8 py-4">
      <div className="relative flex items-center gap-3" ref={addMenuRef}>
        <button
          type="button"
          onClick={() => {
            setShowNotif(false);
            // Desktop keeps the direct "open Add form" behavior; mobile opens the tool menu,
            // since search/chat/voice have no inline bar to live in below the lg breakpoint.
            if (isMobile) {
              setAddMenuOpen((v) => !v);
            } else {
              openAdd();
            }
          }}
          aria-haspopup={isMobile ? "menu" : undefined}
          aria-expanded={isMobile ? addMenuOpen : undefined}
          className="flex items-center gap-2 rounded-full bg-(--accent) py-2 pl-3 pr-3.5 text-(--on-accent) cursor-pointer"
        >
          <svg width="16" height="16" viewBox="0 -960 960 960">
            <path d={ADD_ICON_PATH} style={{ fill: "var(--on-accent)" }} />
          </svg>
          <span className="text-sm">Add</span>
        </button>

        {isMobile && addMenuOpen && (
          <div
            role="menu"
            className="absolute left-0 top-[46px] z-30 w-52 overflow-hidden rounded-xl border border-(--border) bg-(--card) py-1 shadow-[0_16px_40px_rgba(70,55,30,.22)]"
          >
            <MobileMenuItem
              iconPath={ADD_ICON_PATH}
              label="Add item"
              onClick={() => {
                setAddMenuOpen(false);
                openAdd();
              }}
            />
            <MobileMenuItem
              iconPath={BAR_ICON_PATH.search}
              label="Search"
              onClick={() => openMobileTool("search")}
            />
            <MobileMenuItem
              iconPath={BAR_ICON_PATH.chat}
              label="Chat"
              disabled={offline}
              hint={offline ? "Needs a connection" : undefined}
              onClick={() => openMobileTool("chat")}
            />
            <MobileMenuItem
              iconPath={BAR_ICON_PATH.mic}
              label="Voice"
              disabled={offline}
              hint={offline ? "Needs a connection" : undefined}
              onClick={() => openMobileTool("mic")}
            />
          </div>
        )}
      </div>

      <div className="hidden items-center gap-4 lg:flex">
        <div className="relative" ref={chatRef}>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-0.5 rounded-full border border-(--border-strong) p-1">
              <button
                type="button"
                title="Search"
                aria-pressed={barMode === "search"}
                onClick={selectSearchMode}
                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full"
                style={{ background: barMode === "search" ? "var(--accent-wash-strong)" : "transparent" }}
              >
                <svg width="13" height="13" viewBox="0 -960 960 960">
                  <path d={BAR_ICON_PATH.search} style={{ fill: barMode === "search" ? "var(--accent-text)" : "var(--ink-soft)" }} />
                </svg>
              </button>
              <button
                type="button"
                title={offline ? "Chat needs a connection" : "Chat"}
                disabled={offline}
                aria-pressed={barMode === "chat"}
                onClick={selectChatMode}
                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: barMode === "chat" ? "var(--accent-wash-strong)" : "transparent" }}
              >
                <svg width="13" height="13" viewBox="0 -960 960 960">
                  <path d={BAR_ICON_PATH.chat} style={{ fill: barMode === "chat" ? "var(--accent-text)" : "var(--ink-soft)" }} />
                </svg>
              </button>
              <button
                type="button"
                title={offline ? "Voice capture needs a connection" : "Speak to add"}
                disabled={offline || (processing && barMode !== "mic")}
                aria-pressed={barMode === "mic"}
                onClick={selectMicMode}
                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-60"
                style={{ background: barMode === "mic" ? "var(--accent-wash-strong)" : "transparent" }}
              >
                <svg width="13" height="13" viewBox="0 -960 960 960">
                  <path
                    d={BAR_ICON_PATH.mic}
                    style={{ fill: barMode === "mic" ? "var(--accent-text)" : "var(--ink-soft)" }}
                  />
                </svg>
              </button>
            </div>

            <div
              className="flex w-65 items-center gap-2 rounded-full border border-(--border-strong) px-3.5 py-1.5 text-(--ink-soft)"
              style={{ animation: barMode === "mic" && listening ? "mic-pulse 1.6s ease-in-out infinite" : undefined }}
            >
              <svg width="15" height="15" viewBox="0 -960 960 960" className="flex-none">
                <path d={BAR_ICON_PATH[barMode === "chat" ? "chat" : barMode === "mic" ? "mic" : "search"]} style={{ fill: "var(--ink-faint)" }} />
              </svg>
              {barMode === "search" && (
                <input
                  id="taskbook-search"
                  value={query}
                  onChange={(e) => onQueryChange(e.target.value)}
                  placeholder="Search tasks…"
                  aria-label="Search tasks"
                  className="w-full min-w-0 bg-transparent text-[13.5px] text-(--ink) outline-none placeholder:text-(--ink-soft)"
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
                  className="w-full min-w-0 bg-transparent text-[13.5px] text-(--ink) outline-none placeholder:text-(--ink-soft) disabled:opacity-60"
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
                          background: captureError ? "var(--danger)" : "var(--accent)",
                          animation:
                            listening || processing ? `mic-bar 0.9s ${i * 0.12}s ease-in-out infinite` : undefined,
                          opacity: listening || processing ? 1 : 0.4,
                        }}
                      />
                    ))}
                  </div>
                  <span
                    className="truncate text-[13.5px] italic"
                    style={{ color: captureError ? "var(--danger)" : "var(--accent-text)" }}
                  >
                    {captureError ?? (processing ? "Transcribing…" : listening ? "Listening… tap to stop" : "Tap the mic to start")}
                  </span>
                  {listening && (
                    <button
                      type="button"
                      title="Cancel — discard this recording"
                      aria-label="Cancel recording"
                      onClick={cancelListening}
                      className="ml-auto flex h-5 w-5 flex-none cursor-pointer items-center justify-center rounded-full hover:bg-(--danger-surface)"
                    >
                      <svg width="12" height="12" viewBox="0 -960 960 960">
                        <path
                          d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"
                          style={{ fill: "var(--danger)" }}
                        />
                      </svg>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {barMode === "chat" && chatPanelOpen && (
            <div className="absolute left-0 top-[46px] z-30 w-95 rounded-xl border border-(--border) bg-(--card) p-4 shadow-[0_16px_40px_rgba(70,55,30,.22)]">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-[0.16em] text-(--ink-soft)">Ask about your tasks</div>
                {chatMessages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setChatMessages([])}
                    className="cursor-pointer text-xs text-(--ink-faint) hover:text-(--danger)"
                  >
                    Clear
                  </button>
                )}
              </div>
              {chatMessages.length === 0 && !chatLoading ? (
                <div className="py-3.5 text-sm italic text-(--ink-soft)">
                  Try &ldquo;what&apos;s due today?&rdquo; or &ldquo;add a task to call the vet tomorrow&rdquo;.
                </div>
              ) : (
                <div className="flex max-h-80 flex-col gap-2.5 overflow-y-auto">
                  {chatMessages.map((m, i) => (
                    <div
                      key={i}
                      className={
                        m.role === "user"
                          ? "self-end rounded-lg bg-(--accent) px-3 py-1.5 text-sm text-(--on-accent)"
                          : "self-start rounded-lg border border-(--border) bg-white px-3 py-1.5 text-sm text-(--ink)"
                      }
                      style={{ maxWidth: "85%" }}
                    >
                      {m.role === "assistant" ? renderMarkdownLite(m.content) : m.content}
                    </div>
                  ))}
                  {chatLoading && <div className="self-start text-sm italic text-(--ink-soft)">Thinking…</div>}
                </div>
              )}
              {chatError && <div className="mt-2 text-[11px] italic text-(--danger)">{chatError}</div>}
            </div>
          )}
        </div>

        <span className="text-[13px] text-(--ink-muted)">{todayLabel}</span>

        {!isMobile && actionsCluster}
      </div>

      {isMobile && mobileActionsEl && createPortal(actionsCluster, mobileActionsEl)}

      {isMobile &&
        mobileTool &&
        createPortal(
          <div
            className="fixed inset-0 z-40 flex items-end justify-center bg-(--overlay) p-3 sm:items-center"
            onClick={closeMobileTool}
          >
            <div
              className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-(--border) bg-(--card) shadow-[0_16px_40px_rgba(70,55,30,.22)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-(--border) px-4 py-3">
                <div className="flex items-center gap-0.5 rounded-full border border-(--border-strong) p-1">
                  {(["search", "chat", "mic"] as BarMode[]).map((tool) => {
                    const disabled = offline && tool !== "search";
                    return (
                      <button
                        key={tool}
                        type="button"
                        aria-pressed={mobileTool === tool}
                        disabled={disabled}
                        onClick={() => switchMobileTool(tool)}
                        title={tool === "search" ? "Search" : tool === "chat" ? "Chat" : "Voice"}
                        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ background: mobileTool === tool ? "var(--accent-wash-strong)" : "transparent" }}
                      >
                        <svg width="14" height="14" viewBox="0 -960 960 960">
                          <path
                            d={BAR_ICON_PATH[tool]}
                            style={{ fill: mobileTool === tool ? "var(--accent-text)" : "var(--ink-soft)" }}
                          />
                        </svg>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={closeMobileTool}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full hover:bg-(--accent-wash)"
                >
                  <svg width="16" height="16" viewBox="0 -960 960 960">
                    <path
                      d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"
                      style={{ fill: "var(--ink-soft)" }}
                    />
                  </svg>
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {mobileTool === "search" && (
                  <div>
                    <div className="flex items-center gap-2 rounded-full border border-(--border-strong) px-3.5 py-2 text-(--ink-soft)">
                      <svg width="15" height="15" viewBox="0 -960 960 960" className="flex-none">
                        <path d={BAR_ICON_PATH.search} style={{ fill: "var(--ink-faint)" }} />
                      </svg>
                      <input
                        autoFocus
                        value={query}
                        onChange={(e) => onQueryChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") closeMobileTool();
                        }}
                        placeholder="Search tasks…"
                        aria-label="Search tasks"
                        className="w-full min-w-0 bg-transparent text-sm text-(--ink) outline-none placeholder:text-(--ink-soft)"
                      />
                      {query && (
                        <button
                          type="button"
                          aria-label="Clear search"
                          onClick={() => onQueryChange("")}
                          className="flex h-5 w-5 flex-none cursor-pointer items-center justify-center rounded-full"
                        >
                          <svg width="12" height="12" viewBox="0 -960 960 960">
                            <path
                              d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"
                              style={{ fill: "var(--ink-soft)" }}
                            />
                          </svg>
                        </button>
                      )}
                    </div>
                    <div className="mt-2 text-xs italic text-(--ink-soft)">
                      Close to see the filtered lists behind.
                    </div>
                  </div>
                )}

                {mobileTool === "chat" && (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 rounded-full border border-(--border-strong) px-3.5 py-2 text-(--ink-soft)">
                      <svg width="15" height="15" viewBox="0 -960 960 960" className="flex-none">
                        <path d={BAR_ICON_PATH.chat} style={{ fill: "var(--ink-faint)" }} />
                      </svg>
                      <input
                        autoFocus
                        value={chatDraft}
                        onChange={(e) => setChatDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void sendChatMessage();
                          }
                        }}
                        placeholder="Ask about your tasks, or tell me to add one…"
                        disabled={chatLoading}
                        className="w-full min-w-0 bg-transparent text-sm text-(--ink) outline-none placeholder:text-(--ink-soft) disabled:opacity-60"
                      />
                    </div>
                    {chatMessages.length === 0 && !chatLoading ? (
                      <div className="py-2 text-sm italic text-(--ink-soft)">
                        Try &ldquo;what&apos;s due today?&rdquo; or &ldquo;add a task to call the vet tomorrow&rdquo;.
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2.5">
                        {chatMessages.map((m, i) => (
                          <div
                            key={i}
                            className={
                              m.role === "user"
                                ? "self-end rounded-lg bg-(--accent) px-3 py-1.5 text-sm text-(--on-accent)"
                                : "self-start rounded-lg border border-(--border) bg-white px-3 py-1.5 text-sm text-(--ink)"
                            }
                            style={{ maxWidth: "85%" }}
                          >
                            {m.role === "assistant" ? renderMarkdownLite(m.content) : m.content}
                          </div>
                        ))}
                        {chatLoading && <div className="self-start text-sm italic text-(--ink-soft)">Thinking…</div>}
                      </div>
                    )}
                    {chatError && <div className="text-[11px] italic text-(--danger)">{chatError}</div>}
                    {chatMessages.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setChatMessages([])}
                        className="self-end cursor-pointer text-xs text-(--ink-faint) hover:text-(--danger)"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                )}

                {mobileTool === "mic" && (
                  <div
                    className="flex flex-col items-center gap-4 py-6"
                    style={{ animation: listening ? "mic-pulse 1.6s ease-in-out infinite" : undefined }}
                  >
                    <div className="flex items-center gap-1" aria-hidden>
                      {[0, 1, 2, 3, 4].map((i) => (
                        <span
                          key={i}
                          className="block w-1 rounded-full"
                          style={{
                            height: 28,
                            background: captureError ? "var(--danger)" : "var(--accent)",
                            animation: listening || processing ? `mic-bar 0.9s ${i * 0.12}s ease-in-out infinite` : undefined,
                            opacity: listening || processing ? 1 : 0.4,
                          }}
                        />
                      ))}
                    </div>
                    <span
                      className="text-center text-sm italic"
                      style={{ color: captureError ? "var(--danger)" : "var(--accent-text)" }}
                    >
                      {captureError ?? (processing ? "Transcribing…" : listening ? "Listening…" : "Tap the mic to start")}
                    </span>
                    <div className="flex items-center gap-3">
                      {listening ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void toggleListening()}
                            className="rounded-full bg-(--accent) px-5 py-2 text-sm text-(--on-accent) cursor-pointer"
                          >
                            Stop &amp; file
                          </button>
                          <button
                            type="button"
                            onClick={cancelListening}
                            className="rounded-full border border-(--border-strong) px-5 py-2 text-sm text-(--ink-soft) cursor-pointer"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        !processing && (
                          <button
                            type="button"
                            onClick={() => void toggleListening()}
                            className="rounded-full bg-(--accent) px-5 py-2 text-sm text-(--on-accent) cursor-pointer"
                          >
                            Start recording
                          </button>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

function MobileMenuItem({
  iconPath,
  label,
  hint,
  disabled,
  onClick,
}: {
  iconPath: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-50"
    >
      <svg width="16" height="16" viewBox="0 -960 960 960" className="flex-none">
        <path d={iconPath} style={{ fill: "var(--ink-soft)" }} />
      </svg>
      <span className="flex-1 text-sm text-(--ink)">{label}</span>
      {hint && <span className="text-[11px] italic text-(--ink-faint)">{hint}</span>}
    </button>
  );
}

function CapturedItem({ capture, onEdit }: { capture: VoiceCaptureVM; onEdit: (capture: VoiceCaptureVM) => void }) {
  const { actions } = useTaskbook();
  return (
    <div className="rounded-lg border border-(--border) bg-(--card) p-2.5">
      <div className="mb-0.5 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-(--ink-soft)">
        <span>{KIND_LABEL[capture.kind]}</span>
        <span aria-hidden>·</span>
        <span>{capture.source === "email" ? "Email" : "Voice"}</span>
      </div>
      <div className="text-sm text-(--ink)">{capture.summary}</div>
      {capture.parseError && (
        <div className="mt-0.5 text-[11px] italic text-(--danger)">
          Couldn&apos;t fully understand this one — worth a check.
        </div>
      )}
      <div className="mt-1.5 text-[11px] italic text-(--ink-soft)">&ldquo;{capture.transcript}&rdquo;</div>
      <div className="mt-2 flex justify-end gap-3">
        <button
          type="button"
          onClick={() => actions.dismissCapture(capture.id)}
          className="cursor-pointer text-xs text-(--ink-faint) hover:text-(--danger)"
        >
          Mark as read
        </button>
        <button type="button" onClick={() => onEdit(capture)} className="cursor-pointer text-xs text-(--accent-text)">
          Edit
        </button>
      </div>
    </div>
  );
}
