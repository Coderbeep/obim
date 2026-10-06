import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useExplorerTreeDnd } from "../../src/renderer/src/features/files/explorer/tree/useExplorerTreeDnd";
import { getTransparentDragImage } from "../../src/renderer/src/shared/dnd/getTransparentDragImage";

const dnd = vi.hoisted(() => ({ startDrag: vi.fn(), updateTarget: vi.fn() }));
vi.mock("../../src/renderer/src/shared/dnd/AppDndProvider", () => ({
  useAppDndActions: () => dnd,
}));

class TestDragEvent extends Event {
  clientX: number;
  clientY: number;
  dataTransfer: DataTransfer | null;
  constructor(
    type: string,
    init: EventInit & { clientX?: number; clientY?: number; dataTransfer?: DataTransfer | null } = {},
  ) {
    super(type, init);
    this.clientX = init.clientX ?? 0;
    this.clientY = init.clientY ?? 0;
    this.dataTransfer = init.dataTransfer ?? null;
  }
}

const makeTree = () => {
  const host = document.createElement("div");
  const shadowRoot = host.attachShadow({ mode: "open" });
  const row = document.createElement("div");
  row.dataset.type = "item";
  row.dataset.itemPath = "Folder/note.md";
  shadowRoot.append(row);
  document.body.append(host);
  return { host, row };
};
const transfer = () => ({ setDragImage: vi.fn() }) as unknown as DataTransfer;
const dispatchDrag = (target: EventTarget, type: string, dataTransfer: DataTransfer | null = null) => {
  const event = new TestDragEvent(type, {
    bubbles: true,
    composed: true,
    cancelable: true,
    clientX: 10,
    clientY: 20,
    dataTransfer,
  });
  target.dispatchEvent(event);
  return event;
};
const options = (host: HTMLElement) => ({
  enabled: true,
  model: { getFileTreeContainer: () => host } as never,
  getDraggedItemPreviewData: () => ({ label: "note" }),
  getAppDragEntity: () => ({ kind: "explorer-item" as const, id: "Folder/note.md" }),
  getAppDragPreview: () => ({ text: "note" }),
  onTreeDragOver: vi.fn(),
});

describe("useExplorerTreeDnd", () => {
  beforeEach(() => Object.defineProperty(globalThis, "DragEvent", { configurable: true, value: TestDragEvent }));
  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  it("reuses one transparent native drag image", () => {
    const first = getTransparentDragImage();
    expect(getTransparentDragImage()).toBe(first);
    expect(first).toBeInstanceOf(HTMLCanvasElement);
    expect((first as HTMLCanvasElement).width).toBe(1);
  });

  it("starts an app drag and publishes tree hover through the native shadow root", () => {
    const { host, row } = makeTree();
    const input = options(host);
    const { result } = renderHook(() => useExplorerTreeDnd(input));
    const dataTransfer = transfer();
    act(() => dispatchDrag(row, "dragstart", dataTransfer));
    expect(dataTransfer.setDragImage).toHaveBeenCalledOnce();
    expect(dnd.startDrag).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: { kind: "explorer-item", id: "Folder/note.md" },
        preview: { text: "note" },
      }),
    );
    expect(result.current.dragSourceTreePathRef.current).toBe("Folder/note.md");
    act(() => dispatchDrag(row, "dragover", dataTransfer));
    expect(input.onTreeDragOver).toHaveBeenCalledWith(
      expect.any(TestDragEvent),
      expect.objectContaining({ rowPath: "Folder/note.md" }),
    );
    act(() => dispatchDrag(document, "dragend"));
    expect(result.current.dragSourceTreePathRef.current).toBeNull();
    expect(dnd.updateTarget).toHaveBeenCalledWith(null);
  });

  it("does not attach while disabled", () => {
    const { host, row } = makeTree();
    const input = { ...options(host), enabled: false };
    renderHook(() => useExplorerTreeDnd(input));
    act(() => dispatchDrag(row, "dragstart", transfer()));
    expect(dnd.startDrag).not.toHaveBeenCalled();
  });
});
