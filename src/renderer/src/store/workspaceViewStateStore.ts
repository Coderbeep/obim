import { atom } from "jotai";
import type { EditorSelection, StateEffect, Text } from "@codemirror/state";

export interface EditorViewPosition {
  kind: "editor";
  doc: Text;
  selection: EditorSelection;
  scroll: StateEffect<unknown>;
}

export interface PdfViewportAnchor {
  pageNumber: number;
  pageX: number;
  pageY: number;
  localX: number;
  localY: number;
}

export interface PdfViewPosition {
  kind: "pdf";
  scale: number;
  zoomMode: "width" | "page" | "custom";
  spreadMode: "none" | "odd" | "even";
  page: number;
  anchor: PdfViewportAnchor;
}

export type WorkspaceViewPosition = EditorViewPosition | PdfViewPosition;

/** Runtime positions belong to tabs, independently of shared file buffers and persisted sessions. */
export const workspaceViewPositionsAtom = atom<Record<string, Record<string, WorkspaceViewPosition>>>({});
