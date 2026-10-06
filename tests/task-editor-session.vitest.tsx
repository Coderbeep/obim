import { act, cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { afterEach, expect, it } from "vitest";
import { useTaskEditorDraft } from "@renderer/features/task-board/TaskBoardTaskEditor";
import { createDraftTaskState } from "@renderer/features/task-board/taskBoardModel";
import { taskEditorAtom } from "@renderer/store/taskBoardEditorStore";

afterEach(cleanup);

function fixture() {
  const store = createStore();
  const wrapper = ({ children }: PropsWithChildren) => <Provider store={store}>{children}</Provider>;
  return {
    store,
    ...renderHook(() => ({ first: useTaskEditorDraft(), second: useTaskEditorDraft() }), { wrapper }),
  };
}

it("shows only one editor and resumes its unfinished values on return", () => {
  const { result, unmount, store } = fixture();
  const first = { ...createDraftTaskState(), taskName: "Unfinished task" };
  act(() => result.current.first[1](first));
  act(() => result.current.second[1](createDraftTaskState("Research")));
  expect(result.current.first[0]).toBeNull();
  expect(result.current.second[0]?.project).toBe("Research");
  act(() => result.current.first[1]((current) => current ?? createDraftTaskState()));
  expect(result.current.first[0]?.taskName).toBe("Unfinished task");
  expect(result.current.second[0]).toBeNull();
  unmount();
  expect(store.get(taskEditorAtom).sessions.size).toBe(0);
  expect(store.get(taskEditorAtom).active).toBeNull();
});

it("does not let an old save close another editor or a reopened session", () => {
  const { result } = fixture();
  act(() => result.current.first[1](createDraftTaskState()));
  const finishOldSave = result.current.first[1];
  act(() => result.current.second[1](createDraftTaskState("Research")));
  act(() => finishOldSave(null));
  expect(result.current.second[0]?.project).toBe("Research");
  act(() => result.current.first[1](createDraftTaskState()));
  act(() => finishOldSave(null));
  expect(result.current.first[0]).not.toBeNull();
});
