import { StrictMode, useEffect } from "react";
import type { AppDragEntity } from "../src/shared/drag-data";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppDndProvider, useAppDndActions } from "../src/renderer/src/shared/dnd/AppDndProvider";
import { useAppDraggable } from "../src/renderer/src/shared/dnd/useAppDraggable";
import { useAppDropZone } from "../src/renderer/src/shared/dnd/useAppDropZone";

const entity = { kind: "task", id: "/task.md" } as const;
const target = { key: "task:review:1", valid: true, label: "Review, position 2", operation: 1 } as const;

const transfer = (effectAllowed = "move") => ({ effectAllowed, dropEffect: "none", setDragImage: vi.fn() });
const pointerDown = (target: Element, clientX: number, clientY: number) => {
  const event = new Event("pointerdown", { bubbles: true });
  Object.defineProperties(event, { clientX: { value: clientX }, clientY: { value: clientY } });
  fireEvent(target, event);
};

class TestDragEvent extends Event {
  clientX: number;
  clientY: number;
  dataTransfer: unknown;

  constructor(type: string, init: EventInit & { clientX?: number; clientY?: number; dataTransfer?: unknown } = {}) {
    super(type, init);
    this.clientX = init.clientX ?? 0;
    this.clientY = init.clientY ?? 0;
    this.dataTransfer = init.dataTransfer ?? null;
  }
}

const Harness = ({
  commit,
  start,
  cancel,
  dragEntity = entity,
}: {
  commit: () => void;
  start: () => void;
  cancel?: () => void;
  dragEntity?: AppDragEntity;
}) => {
  const draggable = useAppDraggable<HTMLDivElement>({
    entity: dragEntity,
    preview: { text: "Task" },
    onDragStart: start,
    onCancel: cancel,
  });
  const validTarget = useAppDropZone<HTMLDivElement, number>({
    accepts: () => true,
    resolve: () => target,
    onDrop: commit,
  });
  const invalidTarget = useAppDropZone<HTMLDivElement, number>({
    accepts: () => true,
    resolve: () => ({ ...target, valid: false, key: "task:review:2", operation: 2, label: "Invalid position" }),
    onDrop: commit,
  });
  return (
    <>
      <div data-testid="source" role="button" {...draggable}>
        <button type="button">Child control</button>
      </div>
      <div data-testid="valid" {...validTarget.handlers} />
      <div data-testid="invalid" {...invalidTarget.handlers} />
    </>
  );
};

const HandledDropHarness = ({ cancel }: { cancel: () => void }) => {
  const draggable = useAppDraggable<HTMLDivElement>({ entity, onCancel: cancel, preview: { text: "Task" } });
  return (
    <>
      <div data-testid="handled-source" {...draggable} />
      <div data-testid="handled-target" onDrop={(event) => event.preventDefault()} />
    </>
  );
};

const setupActions = () => {
  let actions!: ReturnType<typeof useAppDndActions>;
  const Probe = () => {
    const current = useAppDndActions();
    useEffect(() => {
      actions = current;
    }, [current]);
    return null;
  };
  const view = render(
    <AppDndProvider>
      <Probe />
    </AppDndProvider>,
  );
  return {
    ...view,
    get actions() {
      return actions;
    },
  };
};

beforeEach(() => {
  vi.stubGlobal("DragEvent", TestDragEvent);
  Object.defineProperty(window, "scrollBy", { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("application drag-and-drop infrastructure", () => {
  it("uses native movement activation and excludes interactive children", () => {
    const start = vi.fn();
    render(
      <AppDndProvider>
        <Harness commit={vi.fn()} start={start} />
      </AppDndProvider>,
    );
    const source = screen.getByTestId("source");
    const dataTransfer = transfer();

    pointerDown(source.querySelector("button")!, 10, 10);
    fireEvent.dragStart(source, { clientX: 30, clientY: 30, dataTransfer });
    expect(start).not.toHaveBeenCalled();

    pointerDown(source, 10, 10);
    fireEvent.dragStart(source, { clientX: 12, clientY: 12, dataTransfer });
    expect(start).toHaveBeenCalledOnce();
    expect(document.querySelector(".app-dnd-overlay")).not.toBeNull();
    expect(document.documentElement.dataset.appDragKind).toBe("task");
  });

  it("tracks valid and invalid targets, commits once, and cleans up", () => {
    const commit = vi.fn();
    render(
      <AppDndProvider>
        <Harness commit={commit} start={vi.fn()} />
      </AppDndProvider>,
    );
    const source = screen.getByTestId("source");
    const dataTransfer = transfer();
    fireEvent.dragStart(source, { clientX: 20, clientY: 20, dataTransfer });

    fireEvent.dragOver(screen.getByTestId("invalid"), { dataTransfer });
    expect(screen.getByTestId("invalid").getAttribute("data-drop-active")).toBe("invalid");
    fireEvent.drop(screen.getByTestId("invalid"), { dataTransfer });
    expect(commit).not.toHaveBeenCalled();
    expect(document.querySelector(".app-dnd-overlay")).toBeNull();
    expect(document.documentElement.dataset.appDragKind).toBeUndefined();

    fireEvent.dragStart(source, { clientX: 20, clientY: 20, dataTransfer });
    fireEvent.dragOver(screen.getByTestId("valid"), { dataTransfer });
    expect(screen.getByTestId("valid").getAttribute("data-drop-active")).toBe("valid");
    fireEvent.drop(screen.getByTestId("valid"), { dataTransfer });
    expect(commit).toHaveBeenCalledOnce();
    expect(document.querySelector(".app-dnd-overlay")).toBeNull();
    expect(document.documentElement.dataset.appDragKind).toBeUndefined();
    expect(source.hasAttribute("data-dragging")).toBe(false);
    expect(document.documentElement.dataset.appDragJustEnded).toBe("true");
    fireEvent(document.body, new MouseEvent("pointermove", { bubbles: true, clientX: 20, clientY: 20 }));
    expect(document.documentElement.dataset.appDragJustEnded).toBe("true");
    fireEvent(document.body, new MouseEvent("pointermove", { bubbles: true, clientX: 100, clientY: 100 }));
    expect(document.documentElement.dataset.appDragJustEnded).toBeUndefined();
  });

  it.each([false, true])("updates validity on the same target key (domMarker=%s)", (domMarker) => {
    const MarkerHarness = () => {
      const source = useAppDraggable<HTMLDivElement>({ entity, preview: { text: "Task" } });
      const zone = useAppDropZone<HTMLDivElement, number>({
        domMarker,
        accepts: () => true,
        resolve: (event) => ({
          key: "same-key",
          valid: event.clientX < 50,
          label: "Boundary",
          operation: event.clientX,
        }),
        onDrop: () => undefined,
      });
      return (
        <>
          <div data-testid="marker-source" {...source} />
          <div data-testid="marker" {...zone.handlers} />
        </>
      );
    };
    render(
      <AppDndProvider>
        <MarkerHarness />
      </AppDndProvider>,
    );
    const dataTransfer = transfer();
    const source = screen.getByTestId("marker-source");
    const marker = screen.getByTestId("marker");
    fireEvent.dragStart(source, { dataTransfer });
    for (const [clientX, expected] of [
      [10, "valid"],
      [90, "invalid"],
      [10, "valid"],
    ] as const) {
      fireEvent(marker, new TestDragEvent("dragover", { bubbles: true, cancelable: true, clientX, dataTransfer }));
      expect(marker.getAttribute("data-drop-active")).toBe(expected);
      expect(marker.hasAttribute("data-drop-valid")).toBe(false);
      expect(marker.hasAttribute("data-drop-invalid")).toBe(false);
    }
    fireEvent.dragEnd(source, { dataTransfer });
    expect(marker.hasAttribute("data-drop-active")).toBe(false);
  });

  it("recomputes a drop at the current pointer even before its marker repaints", () => {
    const commit = vi.fn();
    const BoundaryHarness = () => {
      const source = useAppDraggable<HTMLDivElement>({ entity, preview: { text: "Task" } });
      const zone = useAppDropZone<HTMLDivElement, number>({
        accepts: (active) => active.kind === "task",
        resolve: (event) => {
          const index = event.clientX < 50 ? 0 : 1;
          return { key: `boundary:${index}`, valid: true, label: `Position ${index + 1}`, operation: index };
        },
        onDrop: (_event, index) => commit(index),
      });
      return (
        <>
          <div data-testid="boundary-source" {...source} />
          <div data-testid="boundary" {...zone.handlers}>
            {zone.intent}
          </div>
        </>
      );
    };
    render(
      <AppDndProvider>
        <BoundaryHarness />
      </AppDndProvider>,
    );
    const dataTransfer = transfer();
    fireEvent.dragStart(screen.getByTestId("boundary-source"), { dataTransfer });
    fireEvent(
      screen.getByTestId("boundary"),
      new TestDragEvent("dragover", { bubbles: true, cancelable: true, clientX: 10, dataTransfer }),
    );
    expect(screen.getByTestId("boundary").textContent).toBe("0");
    fireEvent(
      screen.getByTestId("boundary"),
      new TestDragEvent("drop", { bubbles: true, cancelable: true, clientX: 90, dataTransfer }),
    );
    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith(1);
    expect(screen.getByTestId("boundary").textContent).toBe("");
  });

  it.each([
    ["task", { kind: "task", id: "/task.md" }, "move"],
    ["Explorer PDF", { kind: "explorer-item", id: "/paper.pdf" }, "copy"],
  ] as const)("cancels a %s dropped on unused space without waiting for dragend", (_name, dragEntity, effect) => {
    const commit = vi.fn();
    const cancel = vi.fn();
    render(
      <AppDndProvider>
        <Harness commit={commit} start={vi.fn()} cancel={cancel} dragEntity={dragEntity} />
        <div data-testid="unused-space" />
      </AppDndProvider>,
    );
    const source = screen.getByTestId("source");
    const dataTransfer = transfer(effect);
    fireEvent.dragStart(source, { clientX: 20, clientY: 20, dataTransfer });
    fireEvent.dragOver(screen.getByTestId("valid"), { dataTransfer });
    expect(document.querySelector(".app-dnd-overlay")).not.toBeNull();

    const unused = screen.getByTestId("unused-space");
    expect(fireEvent.dragOver(unused, { dataTransfer })).toBe(false);
    expect(dataTransfer.dropEffect).toBe(effect);
    expect(screen.getByTestId("valid").hasAttribute("data-drop-active")).toBe(false);
    expect(fireEvent.drop(unused, { dataTransfer })).toBe(false);

    expect(cancel).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
    expect(document.querySelector(".app-dnd-overlay")).toBeNull();
    expect(source.hasAttribute("data-dragging")).toBe(false);
    expect(document.documentElement.dataset.appDragKind).toBeUndefined();
    fireEvent.dragEnd(source, { dataTransfer });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("consumes a rejected internal target without permitting its mutation", () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    render(
      <AppDndProvider>
        <Harness commit={commit} start={vi.fn()} cancel={cancel} />
      </AppDndProvider>,
    );
    const dataTransfer = transfer("copy");
    fireEvent.dragStart(screen.getByTestId("source"), { clientX: 20, clientY: 20, dataTransfer });
    const invalid = screen.getByTestId("invalid");
    expect(fireEvent.dragOver(invalid, { dataTransfer })).toBe(false);
    expect(dataTransfer.dropEffect).toBe("copy");
    expect(invalid.getAttribute("data-drop-active")).toBe("invalid");
    expect(fireEvent.drop(invalid, { dataTransfer })).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
    expect(document.querySelector(".app-dnd-overlay")).toBeNull();
  });

  it("does not turn external files or unrelated native drags into cancellation destinations", () => {
    render(
      <AppDndProvider>
        <div data-testid="unused-space" />
      </AppDndProvider>,
    );
    const unused = screen.getByTestId("unused-space");
    const unrelated = { ...transfer("copy"), types: ["text/plain"] };
    expect(fireEvent.dragOver(unused, { dataTransfer: unrelated })).toBe(true);
    const external = { ...transfer("copy"), types: ["Files"] };
    fireEvent.dragEnter(unused, { dataTransfer: external });
    expect(fireEvent.dragOver(unused, { dataTransfer: external })).toBe(true);
    expect(external.dropEffect).toBe("none");
    expect(fireEvent.drop(unused, { dataTransfer: external })).toBe(true);
  });

  it("cancels a native drag with Escape without committing", () => {
    const pointerCommit = vi.fn();
    render(
      <AppDndProvider>
        <Harness commit={pointerCommit} start={vi.fn()} />
      </AppDndProvider>,
    );
    const dataTransfer = transfer();
    fireEvent.dragStart(screen.getByTestId("source"), { clientX: 20, clientY: 20, dataTransfer });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.drop(screen.getByTestId("valid"), { dataTransfer });
    expect(pointerCommit).not.toHaveBeenCalled();
    expect(document.querySelector(".app-dnd-overlay")).toBeNull();
    expect(document.documentElement.dataset.appDragKind).toBeUndefined();
  });

  it("does not cancel a drop already handled by a feature", () => {
    const cancel = vi.fn();
    render(
      <AppDndProvider>
        <HandledDropHarness cancel={cancel} />
      </AppDndProvider>,
    );
    const source = screen.getByTestId("handled-source");
    const dataTransfer = transfer();
    fireEvent.dragStart(source, { clientX: 20, clientY: 20, dataTransfer });
    fireEvent.drop(screen.getByTestId("handled-target"), { dataTransfer });

    expect(cancel).not.toHaveBeenCalled();
    expect(document.querySelector(".app-dnd-overlay")).not.toBeNull();

    fireEvent.dragEnd(source, { dataTransfer });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each(["cancel", "finish", "listener"] as const)(
    "cleans the whole session despite a throwing %s callback",
    (failure) => {
      const { actions } = setupActions();
      const error = new Error("cleanup failed");
      const cancel = vi.fn(() => {
        if (failure === "cancel") throw error;
      });
      const finish = vi.fn(() => {
        if (failure === "finish") throw error;
      });
      const firstListener = vi.fn(() => {
        if (failure === "listener") throw error;
      });
      const lastListener = vi.fn();
      actions.subscribeEnd(firstListener);
      actions.subscribeEnd(lastListener);
      act(() => {
        actions.startDrag({
          entity,
          event: { clientX: 10, clientY: 20 },
          preview: { text: "Task" },
          onCancel: cancel,
          onFinish: finish,
        });
        actions.updateTarget({ key: "cleanup", valid: true, label: "Target" });
      });
      act(() => {
        expect(() => actions.cancel()).toThrow(error);
      });
      expect(actions.getActiveEntity()).toBeNull();
      expect(actions.getTarget()).toBeNull();
      expect(document.querySelector(".app-dnd-overlay")).toBeNull();
      expect(document.documentElement.dataset.appDragKind).toBeUndefined();
      expect(cancel).toHaveBeenCalledOnce();
      expect(finish).toHaveBeenCalledOnce();
      expect(lastListener).toHaveBeenCalledOnce();
    },
  );

  it("detaches before recursive cancellation and completes only once", () => {
    const { actions } = setupActions();
    const cancel = vi.fn(() => {
      expect(actions.getActiveEntity()).toBeNull();
      actions.cancel();
    });
    const finish = vi.fn();
    const ended = vi.fn();
    actions.subscribeEnd(ended);
    act(() => {
      actions.startDrag({
        entity,
        event: { clientX: 10, clientY: 20 },
        preview: { text: "Task" },
        onCancel: cancel,
        onFinish: finish,
      });
      actions.cancel();
      actions.cancel();
      actions.complete();
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();
    expect(ended).toHaveBeenCalledOnce();
    expect(actions.canCommit(entity.kind)).toBe(false);
    act(() => {
      actions.startDrag({ entity, event: { clientX: 10, clientY: 20 }, preview: { text: "Task" }, onFinish: finish });
      actions.complete();
      actions.complete();
      actions.endDrag();
    });
    expect(finish).toHaveBeenCalledTimes(2);
    expect(ended).toHaveBeenCalledTimes(2);
  });

  it("finishes the old source and markers before replacing its session", () => {
    const { actions } = setupActions();
    const cancel = vi.fn();
    const finish = vi.fn();
    const ended = vi.fn();
    actions.subscribeEnd(ended);
    act(() => {
      actions.startDrag({
        entity,
        event: { clientX: 10, clientY: 20 },
        preview: { text: "Old" },
        onCancel: cancel,
        onFinish: finish,
      });
      actions.updateTarget({ key: "old-target", valid: true, label: "Old target" });
      actions.startDrag({
        entity: { ...entity, id: "/new.md" },
        event: { clientX: 30, clientY: 40 },
        preview: { text: "New" },
      });
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();
    expect(ended).toHaveBeenCalledOnce();
    expect(actions.getTarget()).toBeNull();
    expect(actions.getActiveEntity()?.id).toBe("/new.md");
    expect(screen.getByText("New")).toBeTruthy();
  });

  it("clears external markers on document exit and starts fresh on re-entry", () => {
    render(
      <AppDndProvider>
        <Harness commit={vi.fn()} start={vi.fn()} />
      </AppDndProvider>,
    );
    const dataTransfer = { ...transfer("copy"), types: ["Files"] };
    const valid = screen.getByTestId("valid");
    fireEvent.dragEnter(valid, { dataTransfer });
    fireEvent.dragOver(valid, { dataTransfer });
    expect(valid.getAttribute("data-drop-active")).toBe("valid");
    fireEvent.dragEnter(screen.getByTestId("source"), { dataTransfer });
    fireEvent.dragLeave(valid, { dataTransfer });
    expect(document.documentElement.dataset.appDragKind).toBe("external-files");
    fireEvent.dragLeave(screen.getByTestId("source"), { dataTransfer });
    expect(document.documentElement.dataset.appDragKind).toBeUndefined();
    expect(valid.hasAttribute("data-drop-active")).toBe(false);
    fireEvent.dragEnter(valid, { dataTransfer });
    fireEvent.dragOver(valid, { dataTransfer });
    expect(valid.getAttribute("data-drop-active")).toBe("valid");
  });

  it("keeps an external session across descendant leave events while the pointer remains in the document", () => {
    render(
      <AppDndProvider>
        <Harness commit={vi.fn()} start={vi.fn()} />
      </AppDndProvider>,
    );
    const dataTransfer = { ...transfer("copy"), types: ["Files"] };
    const valid = screen.getByTestId("valid");
    fireEvent.dragEnter(valid, { dataTransfer });
    fireEvent.dragOver(valid, { dataTransfer });
    fireEvent(valid, new MouseEvent("dragleave", { bubbles: true, clientX: 50, clientY: 50 }));
    expect(document.documentElement.dataset.appDragKind).toBe("external-files");
    expect(valid.getAttribute("data-drop-active")).toBe("valid");
    fireEvent.dragLeave(document.documentElement, { dataTransfer });
    expect(document.documentElement.dataset.appDragKind).toBeUndefined();
    expect(valid.hasAttribute("data-drop-active")).toBe(false);
  });

  it("ends an external drop consumed without completion", async () => {
    vi.useFakeTimers();
    render(
      <AppDndProvider>
        <div
          data-testid="rejected-external"
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        />
      </AppDndProvider>,
    );
    const destination = screen.getByTestId("rejected-external");
    const dataTransfer = { ...transfer("copy"), types: ["Files"] };
    fireEvent.dragEnter(destination, { dataTransfer });
    expect(document.documentElement.dataset.appDragKind).toBe("external-files");
    await act(async () => {
      fireEvent.drop(destination, { dataTransfer });
      vi.runOnlyPendingTimers();
    });
    expect(document.documentElement.dataset.appDragKind).toBeUndefined();
  });

  it("imports an external PDF after a native microtask checkpoint between capture and bubble", async () => {
    vi.useFakeTimers();
    const addListener = vi.spyOn(document, "addEventListener");
    const commit = vi.fn();
    render(
      <AppDndProvider>
        <Harness commit={commit} start={vi.fn()} />
      </AppDndProvider>,
    );
    const captureDrop = addListener.mock.calls.find(
      ([type, , capture]) => type === "drop" && capture === true,
    )![1] as EventListener;
    addListener.mockRestore();
    const destination = screen.getByTestId("valid");
    const dataTransfer = {
      ...transfer("copy"),
      types: ["Files"],
      files: [new File(["%PDF-1.4"], "report.pdf", { type: "application/pdf" })],
    };
    fireEvent.dragEnter(destination, { dataTransfer });
    fireEvent.dragOver(destination, { dataTransfer });

    // Native dispatch can empty the JS stack after capture; fireEvent alone cannot model that checkpoint.
    await act(async () => {
      captureDrop(new TestDragEvent("drop", { dataTransfer }));
      await Promise.resolve();
    });
    fireEvent.drop(destination, { dataTransfer });
    expect(commit).toHaveBeenCalledOnce();
    act(() => vi.runOnlyPendingTimers());
    expect(commit).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.appDragKind).toBeUndefined();
  });

  it("disposes pending external drop cleanup on provider unmount", () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <AppDndProvider>
        <div
          data-testid="consumed-drop"
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        />
      </AppDndProvider>,
    );
    const destination = screen.getByTestId("consumed-drop");
    const dataTransfer = { ...transfer("copy"), types: ["Files"] };
    fireEvent.dragEnter(destination, { dataTransfer });
    fireEvent.drop(destination, { dataTransfer });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves native adapter guard timing after a session ends", () => {
    const { actions } = setupActions();
    expect(actions.canCommit("explorer-item")).toBe(true);
    act(() =>
      actions.startDrag({
        entity: { kind: "explorer-item", id: "/file.md" },
        event: { clientX: 10, clientY: 20 },
        preview: { text: "File" },
      }),
    );
    expect(actions.canCommit("task")).toBe(false);
    act(() => actions.complete());
    expect(actions.canCommit("explorer-item")).toBe(true);
    act(() => {
      actions.startDrag({ entity, event: { clientX: 10, clientY: 20 }, preview: { text: "Task" } });
      actions.cancel();
    });
    expect(actions.canCommit("explorer-item")).toBe(false);
    act(() => actions.endDrag());
    expect(actions.canCommit("explorer-item")).toBe(true);
  });

  it("keeps the overlay at live pointer coordinates when target feedback repaints", () => {
    const { actions } = setupActions();
    act(() => actions.startDrag({ entity, event: { clientX: 10, clientY: 20 }, preview: { text: "Moving" } }));
    const overlay = document.querySelector<HTMLElement>(".app-dnd-overlay")!;
    const initialTransform = overlay.style.transform;
    fireEvent(document.body, new TestDragEvent("drag", { bubbles: true, clientX: 90, clientY: 80 }));
    const movedTransform = overlay.style.transform;
    expect(movedTransform).not.toBe(initialTransform);
    act(() => actions.updateTarget({ key: "feedback", valid: false, label: "Unavailable" }));
    expect(overlay.style.transform).toBe(movedTransform);
    expect(overlay.textContent).toContain("Not allowed: Unavailable");
    // Native zero coordinates at drag termination must not reset the last known pointer.
    fireEvent(document.body, new TestDragEvent("drag", { bubbles: true }));
    expect(overlay.style.transform).toBe(movedTransform);
  });

  it("treats unchanged native target publications as fresh responses", () => {
    const { actions, container } = setupActions();
    const destination = document.createElement("div");
    container.append(destination);
    const feedback = { key: "native-target", valid: false, label: "Unavailable" };
    destination.addEventListener("dragover", () => actions.updateTarget(feedback));
    const changed = vi.fn();
    actions.subscribeTarget(changed);
    act(() => actions.startDrag({ entity, event: { clientX: 10, clientY: 20 }, preview: { text: "Task" } }));
    const dataTransfer = transfer();
    fireEvent.dragOver(destination, { dataTransfer });
    fireEvent.dragOver(destination, { dataTransfer });
    expect(actions.getTarget()).toEqual(feedback);
    expect(changed).toHaveBeenCalledOnce();
    expect(dataTransfer.dropEffect).toBe("move");
    fireEvent.dragOver(document.body, { dataTransfer });
    expect(actions.getTarget()).toBeNull();
  });

  it("preserves successful external completion and a replacement session after drop dispatch", async () => {
    vi.useFakeTimers();
    const { actions, container } = setupActions();
    const destination = document.createElement("div");
    container.append(destination);
    const ended = vi.fn();
    actions.subscribeEnd(ended);
    let replace = false;
    destination.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      actions.complete();
      if (replace) actions.startDrag({ entity, event: { clientX: 10, clientY: 20 }, preview: { text: "Replacement" } });
    });
    const dataTransfer = { ...transfer("copy"), types: ["Files"] };
    fireEvent.dragEnter(destination, { dataTransfer });
    await act(async () => {
      fireEvent.drop(destination, { dataTransfer });
      vi.runOnlyPendingTimers();
    });
    expect(ended).toHaveBeenCalledOnce();
    expect(actions.canCommit("external-files")).toBe(true);
    expect(actions.getActiveEntity()).toBeNull();
    replace = true;
    fireEvent.dragEnter(destination, { dataTransfer });
    await act(async () => {
      fireEvent.drop(destination, { dataTransfer });
      vi.runOnlyPendingTimers();
    });
    expect(ended).toHaveBeenCalledTimes(2);
    expect(actions.getActiveEntity()).toEqual(entity);
    expect(document.documentElement.dataset.appDragKind).toBe("task");
  });

  it("releases source styling and subscriptions on provider unmount under StrictMode", () => {
    const cancelled = vi.fn();
    const view = render(
      <StrictMode>
        <AppDndProvider>
          <Harness commit={vi.fn()} start={vi.fn()} cancel={cancelled} />
        </AppDndProvider>
      </StrictMode>,
    );
    const source = screen.getByTestId("source");
    const dataTransfer = transfer();
    fireEvent.dragStart(source, { clientX: 10, clientY: 20, dataTransfer });
    fireEvent.dragOver(screen.getByTestId("valid"), { dataTransfer });
    expect(source.getAttribute("data-dragging")).toBe("true");
    view.unmount();
    expect(source.hasAttribute("data-dragging")).toBe(false);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.appDragKind).toBeUndefined();
    expect(document.documentElement.dataset.appDragJustEnded).toBeUndefined();
    fireEvent.dragEnter(document.body, { dataTransfer: { ...transfer("copy"), types: ["Files"] } });
    expect(document.documentElement.dataset.appDragKind).toBeUndefined();
  });
  it("preserves a newer session started by a replacement cancellation callback", () => {
    const { actions } = setupActions();
    const callbackSourceFinish = vi.fn();
    const skippedCancel = vi.fn();
    const skippedFinish = vi.fn();
    act(() => {
      actions.startDrag({
        entity,
        event: { clientX: 10, clientY: 20 },
        preview: { text: "Original" },
        onCancel: () =>
          actions.startDrag({
            entity: { ...entity, id: "/callback.md" },
            event: { clientX: 30, clientY: 40 },
            preview: { text: "Callback" },
            onFinish: callbackSourceFinish,
          }),
      });
      actions.startDrag({
        entity: { ...entity, id: "/outer.md" },
        event: { clientX: 50, clientY: 60 },
        preview: { text: "Outer" },
        onCancel: skippedCancel,
        onFinish: skippedFinish,
      });
    });
    expect(actions.getActiveEntity()?.id).toBe("/callback.md");
    expect(skippedCancel).toHaveBeenCalledOnce();
    expect(skippedFinish).toHaveBeenCalledOnce();
    expect(callbackSourceFinish).not.toHaveBeenCalled();
    act(() => actions.complete());
    expect(callbackSourceFinish).toHaveBeenCalledOnce();
  });
});
