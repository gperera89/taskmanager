"use client";

import { createContext, useContext } from "react";
import type { ModalState } from "./types";

type ModalContextValue = {
  openAdd: () => void;
  openEdit: (state: Extract<ModalState, { mode: "edit" }>) => void;
  // Opens the completion heatmap for a habit (clicking the habit's title/row).
  openHeatmap: (habitId: string) => void;
  // Opens a note full-screen in the editor (from a note list on a card or under a task).
  openNote: (noteId: string) => void;
};

export const ModalContext = createContext<ModalContextValue | null>(null);

export function useModalActions(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModalActions must be used within TaskbookApp");
  return ctx;
}
