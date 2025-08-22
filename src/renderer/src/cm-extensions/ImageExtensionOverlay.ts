import { Compartment, Prec } from "@codemirror/state";
import { EventBus, EventTypes } from "@renderer/services/EventBus";
import { EditorView, keymap } from "@codemirror/view";
import {
  imageOverlayEffect,
  imageOverlayField,
  setViewportEffect
} from "./ImageExtensionState";

export const updateImageOverlayKeymap = (view: EditorView, isActive: boolean) => {
  view.dispatch({
    effects: imageKeymapCompartment.reconfigure(
      isActive ? conditionalKeymap : keymap.of([])
    ),
  });
};


export function closeOverlay(view: EditorView) {
  EventBus.emit(EventTypes.OVERLAY_CLOSE, {});
  updateImageOverlayKeymap(view, false);

  view.dispatch({
    effects: imageOverlayEffect.of({
      caretInside: false,
      activePos: null
    }),
  });
}

export class OverlayManager {
  static handleImageSelected: null | ((payload: { path: string }) => void);

  static updatePosition(widgetNode: HTMLElement, src: string) {
    const overlay = document.getElementById("image-overlay");
    if (!overlay) return;

    const rect = widgetNode.getBoundingClientRect();
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;

    EventBus.emit(EventTypes.IMAGE_SRC_CHANGED, { src });
  }

  static registerSelectionHandler(view: EditorView) {
    if (this.handleImageSelected) return;

    this.handleImageSelected = (payload) => {
      const { activePos: position } = view.state.field(imageOverlayField);
      if (!position) return;

      const { from, to } = view.viewport;
      view.dispatch({
        changes: { from: position[0], to: position[1], insert: payload.path },
        effects: [setViewportEffect.of({ from, to })],
      });

      view.dispatch({
        selection: {
          anchor: position[0] + 2 + payload.path.length,
          head: position[0] + 2 + payload.path.length,
        },
      });

      closeOverlay(view);
    };

    EventBus.on(EventTypes.IMAGE_SELECTED, this.handleImageSelected);
  }

  static unregisterSelectionHandler() {
    if (!this.handleImageSelected) return;
    EventBus.off(EventTypes.IMAGE_SELECTED, this.handleImageSelected);
    this.handleImageSelected = null;
  }
}


const conditionalKeymap = Prec.highest(
  keymap.of([
    {
      key: "ArrowUp",
      run: () => {
        EventBus.emit(EventTypes.OVERLAY_HOTKEY, { key: "ArrowUp" });
        return true;
      },
    },
    {
      key: "ArrowDown",
      run: () => {
        EventBus.emit(EventTypes.OVERLAY_HOTKEY, { key: "ArrowDown" });
        return true;
      },
    },
    {
      key: "Enter",
      run: () => {
        EventBus.emit(EventTypes.OVERLAY_HOTKEY, { key: "Enter" });
        return true;
      },
    },
    {
      key: "Escape",
      run: (view) => {
        closeOverlay(view);
        return true;
      },
    },
  ])
);

const imageKeymapCompartment = new Compartment();


export const ImageExtensionOverlay = [
  imageOverlayField,
  imageKeymapCompartment.of(keymap.of([])),
];
