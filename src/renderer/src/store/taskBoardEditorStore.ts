import { atom } from "jotai";
import { selectAtom } from "jotai/utils";
import type { DraftTaskState } from "@renderer/shared/taskBoard";

type EditorSession = { token: symbol; draft: DraftTaskState };
type EditorState = { active: string | null; sessions: Map<string, EditorSession> };

export const taskEditorAtom = atom<EditorState>({ active: null, sessions: new Map() });

// Editing a draft must not rerender every other task on each keystroke.
export const createTaskEditorSessionAtom = (owner: string) =>
  selectAtom(
    taskEditorAtom,
    (state) => ({ active: state.active === owner, session: state.sessions.get(owner) }),
    (previous, next) => previous.active === next.active && previous.session === next.session,
  );
