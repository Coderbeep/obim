import { describe, expect, it } from "vitest";
import {
  fitTaskNoteWindowBounds,
  initialTaskNoteWindowBounds,
  moveTaskNoteWindowBounds,
  resizeTaskNoteWindowBounds,
} from "../src/renderer/src/features/task-board/TaskNoteHoverWindow";

describe("task note floating window geometry", () => {
  const viewport = { width: 1200, height: 800 };

  it("opens centered with room around it", () => {
    expect(initialTaskNoteWindowBounds(viewport)).toEqual({ x: 216, y: 60, width: 768, height: 680 });
  });

  it("keeps the full window reachable while moving and resizing", () => {
    const initial = initialTaskNoteWindowBounds(viewport);
    expect(moveTaskNoteWindowBounds(initial, viewport, 2000, -2000)).toEqual({
      ...initial,
      x: 416,
      y: 16,
    });
    expect(resizeTaskNoteWindowBounds(initial, viewport, 2000, 2000)).toEqual({
      ...initial,
      width: 968,
      height: 724,
    });
    expect(resizeTaskNoteWindowBounds(initial, viewport, -2000, -2000)).toEqual({
      ...initial,
      width: 360,
      height: 280,
    });
  });

  it("fits an existing window after a viewport change, including a small viewport", () => {
    expect(fitTaskNoteWindowBounds({ x: 900, y: 700, width: 768, height: 680 }, { width: 500, height: 400 })).toEqual({
      x: 16,
      y: 16,
      width: 468,
      height: 368,
    });
    expect(fitTaskNoteWindowBounds({ x: 100, y: 100, width: 600, height: 500 }, { width: 320, height: 240 })).toEqual({
      x: 16,
      y: 16,
      width: 288,
      height: 208,
    });
  });
});
