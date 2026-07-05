"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useModalActions } from "./ModalContext";
import ModeToggle from "./ModeToggle";
import { useTaskbook } from "./store";
import type { CapturedKind, VoiceCaptureVM } from "./types";

const KIND_LABEL: Record<CapturedKind, string> = {
  task: "Task",
  project: "Project",
  routine: "Routine",
  habit: "Habit",
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
}: {
  todayLabel: string;
  query: string;
  onQueryChange: (v: string) => void;
  pendingCaptures: VoiceCaptureVM[];
  onEditCapture: (kind: CapturedKind, entityId: string) => void;
  onOpenSettings: () => void;
}) {
  const router = useRouter();
  const { openAdd } = useModalActions();
  const { actions, mode, setMode } = useTaskbook();
  const [showNotif, setShowNotif] = useState(false);
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const notifRef = useRef<HTMLDivElement>(null);

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

  async function uploadRecording(blob: Blob) {
    setProcessing(true);
    try {
      const fd = new FormData();
      fd.set("audio", blob, `recording.${extensionFor(blob.type)}`);
      const res = await fetch("/api/voice-capture", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Voice capture failed");
      setShowNotif(true);
      router.refresh();
    } catch (err) {
      console.error("[voice] capture failed:", err);
      setCaptureError(err instanceof Error ? err.message : "Voice capture failed");
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

  function handleEditCapture(capture: VoiceCaptureVM) {
    onEditCapture(capture.kind, capture.entityId);
    setShowNotif(false);
    actions.dismissCapture(capture.id);
  }

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
          <svg width="16" height="16" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="text-sm">Add</span>
        </button>

        <button
          type="button"
          title="Speak to add"
          disabled={processing}
          onClick={toggleListening}
          className="flex h-9.5 w-9.5 cursor-pointer items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            border: listening ? "1.5px solid #17399b" : "1px solid #d3c9b3",
            background: listening ? "rgba(23,57,155,.08)" : "transparent",
          }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
            <rect x="9" y="3" width="6" height="11" rx="3" stroke="#557694" strokeWidth="1.6" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="#557694" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>

        {listening && (
          <span className="text-[12.5px] italic text-[#17399b]">
            Listening… <span className="text-[#a49a82]">tap to stop</span>
          </span>
        )}
        {processing && <span className="text-[12.5px] italic text-[#17399b]">Transcribing…</span>}
        {captureError && !listening && !processing && (
          <span className="text-[12.5px] italic text-[#8a4040]">{captureError}</span>
        )}

      </div>

      <div className="flex items-center gap-4">
        <div className="flex w-65 items-center gap-2 rounded-full border border-[#d3c9b3] px-3.5 py-1.5 text-[#a49a82]">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="flex-none">
            <circle cx="11" cy="11" r="7" stroke="#b3a988" strokeWidth="1.6" />
            <path d="M20 20l-4-4" stroke="#b3a988" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search tasks…"
            className="w-full min-w-0 bg-transparent text-[13.5px] text-[#2a2622] outline-none placeholder:text-[#a49a82]"
          />
        </div>

        <span className="text-[13px] text-[#8a8069]">{todayLabel}</span>

        <ModeToggle mode={mode} onChange={setMode} />

        <button
          type="button"
          title="Settings"
          onClick={onOpenSettings}
          className="flex h-9 w-9 cursor-pointer items-center justify-center"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
              stroke="#557694"
              strokeWidth="1.6"
            />
            <path
              d="M19.4 13.5c.1-.5.1-1 0-1.5l1.6-1.4-1.5-2.6-2 .6a7.6 7.6 0 0 0-1.3-.75L15.8 6h-3l-.4 2c-.47.19-.9.44-1.3.75l-2-.6-1.5 2.6 1.6 1.4c-.1.5-.1 1 0 1.5l-1.6 1.4 1.5 2.6 2-.6c.4.3.83.55 1.3.75l.4 2h3l.4-2c.47-.2.9-.45 1.3-.75l2 .6 1.5-2.6-1.6-1.4Z"
              stroke="#557694"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={() => setShowNotif((v) => !v)}
            className="relative flex h-9 w-9 cursor-pointer items-center justify-center"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5 2 6H4c.5-1 2-2 2-6Z"
                stroke="#557694"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path d="M10 20a2 2 0 0 0 4 0" stroke="#557694" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            {pendingCaptures.length > 0 && (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#17399b]" />
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
      </div>
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
