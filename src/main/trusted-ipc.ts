import { ipcMain, type IpcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from "electron";

const renderers = new WeakMap<WebContents, string>();

/** Only the registered application document may navigate or invoke privileged IPC. */
export const matchesRendererDocument = (candidate: string, expected: string) => {
  try {
    const url = new URL(candidate);
    const trusted = new URL(expected);
    url.hash = "";
    trusted.hash = "";
    return url.href === trusted.href;
  } catch {
    return false;
  }
};

export const registerTrustedRenderer = (contents: WebContents, documentUrl: string) => {
  renderers.set(contents, documentUrl);
  contents.once("destroyed", () => renderers.delete(contents));
  contents.on("will-navigate", (event) => {
    if (!matchesRendererDocument(event.url, documentUrl)) event.preventDefault();
  });
  contents.on("will-redirect", (event) => {
    if (!event.isMainFrame || !matchesRendererDocument(event.url, documentUrl)) event.preventDefault();
  });
  contents.on("will-frame-navigate", (event) => {
    if (!event.isMainFrame || !matchesRendererDocument(event.url, documentUrl)) event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
};

export const isTrustedIpcSender = (event: IpcMainEvent | IpcMainInvokeEvent) => {
  const expected = renderers.get(event.sender);
  return (
    !!expected &&
    !event.sender.isDestroyed() &&
    !!event.senderFrame &&
    event.senderFrame === event.sender.mainFrame &&
    matchesRendererDocument(event.senderFrame.url, expected)
  );
};

type Listener = Parameters<IpcMain["on"]>[1];
const wrappedListeners = new WeakMap<Listener, Map<string, Listener>>();

// Registration is centralized so newly added privileged channels inherit the boundary.
export const trustedIpcMain: Pick<IpcMain, "handle" | "on" | "removeListener"> = {
  handle(channel, listener) {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedIpcSender(event)) throw new Error("Untrusted renderer request.");
      return listener(event, ...args);
    });
  },
  on(channel, listener) {
    const wrapped: Listener = (event, ...args) => {
      if (!isTrustedIpcSender(event)) {
        event.returnValue = null;
        return;
      }
      listener(event, ...args);
    };
    const byChannel = wrappedListeners.get(listener) ?? new Map();
    byChannel.set(channel, wrapped);
    wrappedListeners.set(listener, byChannel);
    return ipcMain.on(channel, wrapped);
  },
  removeListener(channel, listener) {
    const byChannel = wrappedListeners.get(listener);
    const wrapped = byChannel?.get(channel);
    if (wrapped) {
      byChannel?.delete(channel);
      return ipcMain.removeListener(channel, wrapped);
    }
    return ipcMain;
  },
};
