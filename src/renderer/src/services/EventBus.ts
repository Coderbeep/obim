export enum EventTypes {
    IMAGE_SRC_CHANGED = 'IMAGE_SRC_CHANGED',
    OVERLAY_CLOSE = 'OVERLAY_CLOSE',
    IMAGE_SELECTED = 'IMAGE_SELECTED',
    OVERLAY_HOTKEY = 'OVERLAY_HOTKEY',
}

export interface EventPayloads {
    [EventTypes.IMAGE_SRC_CHANGED]: { src: string }
    [EventTypes.OVERLAY_CLOSE]: {},
    [EventTypes.IMAGE_SELECTED]: { path: string }
    [EventTypes.OVERLAY_HOTKEY]: { key: string }
}

class _EventBus {
    private static instance: _EventBus;
    private readonly events: Map<string, Function[]>;

    private constructor() {
        this.events = new Map();
    }

    static getInstance() {
        if (!_EventBus.instance) {
            _EventBus.instance = new _EventBus();
        }

        return _EventBus.instance;
    }

    on<E extends EventTypes>(event: E, callback: (payload: EventPayloads[E]) => void) {
        if (!this.events.has(event)) {
            this.events.set(event, []);
        }

        this.events.get(event)?.push(callback);
    }

    emit<E extends EventTypes>(event: E, payload: EventPayloads[E], updateCallback?: () => void) {
        this.events.get(event)?.forEach((callback) => {
            callback(payload);
        });

        if (updateCallback) {
            updateCallback();
        }
    }

    off<E extends EventTypes>(event: E, callback: (payload: EventPayloads[E]) => void) {
        const callbacks = this.events.get(event);
        if (!callbacks) {
            return;
        }

        const index = callbacks.indexOf(callback);
        if (index !== -1) {
            callbacks.splice(index, 1);
        }
    }
}

export const EventBus = _EventBus.getInstance(); 