"use client";

import { createContext, useContext } from "react";
import type { ModalState } from "./types";

type ModalContextValue = {
  openAdd: () => void;
  openEdit: (state: Extract<ModalState, { mode: "edit" }>) => void;
};

export const ModalContext = createContext<ModalContextValue | null>(null);

export function useModalActions(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModalActions must be used within TaskbookApp");
  return ctx;
}
