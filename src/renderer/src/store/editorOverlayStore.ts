import { atom } from "jotai";

export type EditorOverlayScope = "images" | "links";
export type EditorOverlayHotkey = "ArrowUp" | "ArrowDown" | "Enter";

export interface EditorOverlayRequest {
  owner: string;
  scope: EditorOverlayScope;
  source: string;
  notePath?: string;
  anchor: { left: number; top: number };
  select(path: string): void;
  close(): void;
}

export interface EditorOverlayState extends EditorOverlayRequest {
  hotkey: { key: EditorOverlayHotkey; revision: number } | null;
}

export interface EditorOverlayPort {
  open(request: EditorOverlayRequest): void;
  close(owner: string): void;
  hotkey(owner: string, key: EditorOverlayHotkey): void;
}

export const editorOverlayRequestAtom = atom<EditorOverlayState | null>(null);

export const openEditorOverlayAtom = atom(null, (get, set, request: EditorOverlayRequest) => {
  const current = get(editorOverlayRequestAtom);
  if (current && (current.owner !== request.owner || current.scope !== request.scope)) current.close();
  set(editorOverlayRequestAtom, { ...request, hotkey: null });
});

export const closeEditorOverlayAtom = atom(null, (get, set, owner: string) => {
  if (get(editorOverlayRequestAtom)?.owner === owner) set(editorOverlayRequestAtom, null);
});

export const routeEditorOverlayHotkeyAtom = atom(
  null,
  (get, set, { owner, key }: { owner: string; key: EditorOverlayHotkey }) => {
    const current = get(editorOverlayRequestAtom);
    if (!current || current.owner !== owner) return;
    set(editorOverlayRequestAtom, {
      ...current,
      hotkey: { key, revision: (current.hotkey?.revision ?? 0) + 1 },
    });
  },
);
