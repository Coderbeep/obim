import { history } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { isShortcut } from "@renderer/shared/keyboardShortcuts";
import { dispatchPdfReferenceHover } from "@renderer/shared/pdfReferenceHover";
import { resolveTaskNoteSubtask } from "@renderer/shared/taskNoteSubtasks";
import { editorSubtaskRequestAtom } from "@renderer/store/editorPaneStore";
import { canLinkToSections, SECTION_LINK_FILENAME_MESSAGE } from "@shared/section-links";
import CodeMirror from "@uiw/react-codemirror";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { memo, useCallback, useEffect, useId, useMemo, useRef } from "react";
import { focusEditorLine } from "./editorNavigation";
import { navigateToHeading } from "./headingNavigation";

import { Compartment } from "@renderer/features/editor/codemirror-state";
import { EditorView } from "@renderer/features/editor/codemirror-view";
import { addNotificationAtom, NotificationLevel } from "@renderer/store/NotificationsStore";
import {
  closeEditorOverlayAtom,
  openEditorOverlayAtom,
  routeEditorOverlayHotkeyAtom,
  type EditorOverlayPort,
} from "@renderer/store/editorOverlayStore";
import { editorFocusRequestAtom, editorHeadingRequestAtom } from "@renderer/store/editorPaneStore";
import { createEditorTextAtom, fileBuffersByPathAtom } from "@renderer/store/fileBufferStore";
import {
  fileTreeAtom,
  reloadRevisionAtom,
  renamingRequestAtom,
  type RenamingRequest,
} from "@renderer/store/fileExplorerStore";
import { fileSaveStatesByPathAtom } from "@renderer/store/fileSaveStore";
import { activateWorkspacePaneAtom } from "@renderer/store/workspaceActionStore";
import { getFilenameNoExtFromPath } from "@shared/pathUtils";
import { useFileRename } from "../files/fileActions";
import {
  canonicalWikiNoteTarget,
  resolveWikiNoteWorkspacePath,
  resolveWorkspaceLinkStatus,
} from "../files/workspaceFileResolver";
import type { LinkStatusPort } from "./extensions/shared/linkStatus";
import { createNoteHeaderExtension, requestNoteTitleEditEffect } from "./extensions/NoteHeaderExtension";
import { createEditorExtensions, resetEditorHistory } from "./setup";
import { useEditorImages } from "./useEditorImages";
import { useObimEditor } from "./useObimEditor";

const editorBasicSetup = {
  highlightSelectionMatches: false,
  history: false,
  defaultKeymap: false,
  searchKeymap: false,
};

export interface ObimEditorProps {
  fileId: string;
  filePath: string;
  paneId: string;
  isMarkdown: boolean;
  openResource(path: string): void | Promise<void>;
}

const ObimEditor = memo(({ fileId, filePath, paneId, isMarkdown, openResource }: ObimEditorProps) => {
  const { imageActions, imageViewer } = useEditorImages(filePath);
  const store = useStore();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const historyCompartment = useMemo(() => new Compartment(), []);
  const historyExtension = useMemo(() => historyCompartment.of(history()), [historyCompartment]);
  const instanceId = useId();
  const setFileBuffers = useSetAtom(fileBuffersByPathAtom);
  const setFileSaveStates = useSetAtom(fileSaveStatesByPathAtom);
  const activateWorkspacePane = useSetAtom(activateWorkspacePaneAtom);
  const notify = useSetAtom(addNotificationAtom);
  const requestFileTreeReload = useSetAtom(reloadRevisionAtom);
  const { saveRename, stopRenaming } = useFileRename();
  const saveRenameRef = useRef(saveRename);
  const stopRenamingRef = useRef(stopRenaming);
  saveRenameRef.current = saveRename;
  stopRenamingRef.current = stopRenaming;
  const openOverlay = useSetAtom(openEditorOverlayAtom);
  const closeOverlay = useSetAtom(closeEditorOverlayAtom);
  const routeOverlayHotkey = useSetAtom(routeEditorOverlayHotkeyAtom);
  const { queueAutoSave } = useObimEditor();
  const editorTextAtom = useMemo(() => createEditorTextAtom(filePath), [filePath]);
  const text = useAtomValue(editorTextAtom);
  const focusRequest = useAtomValue(editorFocusRequestAtom);
  const subtaskRequest = useAtomValue(editorSubtaskRequestAtom);
  const setSubtaskRequest = useSetAtom(editorSubtaskRequestAtom);
  const handledSubtaskRequestRef = useRef<typeof subtaskRequest>(null);
  const headingRequest = useAtomValue(editorHeadingRequestAtom);
  const setHeadingRequest = useSetAtom(editorHeadingRequestAtom);
  const handledHeadingRequestRef = useRef<typeof headingRequest>(null);
  const renamingRequest = useAtomValue(renamingRequestAtom);
  const handledTitleEditRequestRef = useRef<RenamingRequest | null>(null);
  const titleEditRequestRevisionRef = useRef(0);
  const owner = `${instanceId}:${paneId}:${filePath}`;
  const renameTitle = useCallback(
    async (title: string) => (await saveRenameRef.current(filePath, title)).success,
    [filePath],
  );
  const consumeTitleEditRequest = useCallback(() => stopRenamingRef.current(filePath), [filePath]);
  const noteHeader = useMemo(
    () => createNoteHeaderExtension(getFilenameNoExtFromPath(filePath), renameTitle, consumeTitleEditRequest),
    [consumeTitleEditRequest, filePath, renameTitle],
  );
  const overlay = useMemo<EditorOverlayPort>(
    () => ({
      open: (request) => openOverlay({ ...request, notePath: filePath }),
      close: closeOverlay,
      hotkey: (overlayOwner, key) => routeOverlayHotkey({ owner: overlayOwner, key }),
    }),
    [closeOverlay, filePath, openOverlay, routeOverlayHotkey],
  );
  const openExternal = useCallback((url: string) => {
    void window.api.openExternalLink(url);
  }, []);

  const activatePane = useCallback(() => {
    activateWorkspacePane(paneId);
  }, [activateWorkspacePane, paneId]);
  const onFilesCreated = useCallback(() => {
    requestFileTreeReload((revision) => revision + 1);
  }, [requestFileTreeReload]);

  const openEditorResource = useCallback(
    (destination: string) => {
      if (!destination.startsWith("#")) return openResource(destination);
      if (!canLinkToSections(filePath)) {
        notify({
          id: crypto.randomUUID(),
          level: NotificationLevel.INFO,
          title: "Section links unavailable",
          message: SECTION_LINK_FILENAME_MESSAGE,
          timestamp: Date.now(),
        });
        return;
      }
      const view = editorViewRef.current;
      if (view && !navigateToHeading(view, destination)) {
        notify({
          id: crypto.randomUUID(),
          level: NotificationLevel.INFO,
          title: "Section not found",
          message: `No heading matches ${destination} in this note.`,
          timestamp: Date.now(),
        });
      }
    },
    [filePath, notify, openResource],
  );
  const openWikiResource = useCallback(
    (destination: string) =>
      openEditorResource(resolveWikiNoteWorkspacePath(destination, store.get(fileTreeAtom)) ?? destination),
    [openEditorResource, store],
  );
  const hoverPdfReference = useCallback(
    (destination: string | null) => dispatchPdfReferenceHover({ owner, notePath: filePath, destination }),
    [filePath, owner],
  );
  const canonicalizeWikiResource = useCallback(
    (destination: string) => canonicalWikiNoteTarget(destination, store.get(fileTreeAtom)),
    [store],
  );

  const linkStatus = useMemo<LinkStatusPort>(
    () => ({
      resolve: (destination, syntax) =>
        resolveWorkspaceLinkStatus(destination, syntax, store.get(fileTreeAtom), filePath),
      subscribe: (listener) => store.sub(fileTreeAtom, listener),
    }),
    [filePath, store],
  );

  const extensions = useMemo(
    () =>
      createEditorExtensions({
        isMarkdown,
        owner,
        overlay,
        notify,
        openResource: openEditorResource,
        onHoverPdfReference: hoverPdfReference,
        openWikiResource,
        canonicalizeWikiResource,
        linkStatus,
        openExternal,
        noteHeader,
        onFilesCreated,
        imageActions,
      }),
    [
      imageActions,
      filePath,
      isMarkdown,
      noteHeader,
      notify,
      onFilesCreated,
      openExternal,
      openEditorResource,
      hoverPdfReference,
      openWikiResource,
      canonicalizeWikiResource,
      linkStatus,
      overlay,
      owner,
    ],
  );
  const configuredExtensions = useMemo(() => [historyExtension, ...extensions], [extensions, historyExtension]);

  const dispatchPendingTitleEditRequest = useCallback(
    (view: EditorView) => {
      if (
        renamingRequest?.target !== "note-header" ||
        renamingRequest.filePath !== filePath ||
        handledTitleEditRequestRef.current === renamingRequest
      ) {
        return;
      }

      handledTitleEditRequestRef.current = renamingRequest;
      titleEditRequestRevisionRef.current += 1;
      view.dispatch({ effects: requestNoteTitleEditEffect.of(titleEditRequestRevisionRef.current) });
    },
    [filePath, renamingRequest],
  );

  const dispatchPendingHeadingRequest = useCallback(
    (view: EditorView) => {
      if (
        !headingRequest ||
        headingRequest.filePath !== filePath ||
        headingRequest.paneId !== paneId ||
        handledHeadingRequestRef.current === headingRequest
      )
        return;
      handledHeadingRequestRef.current = headingRequest;
      if (!navigateToHeading(view, headingRequest.fragment)) {
        notify({
          id: crypto.randomUUID(),
          level: NotificationLevel.INFO,
          title: "Section not found",
          message: `No heading matches ${headingRequest.fragment} in this note.`,
          timestamp: Date.now(),
        });
      }
      setHeadingRequest((current) => (current === headingRequest ? null : current));
    },
    [filePath, headingRequest, notify, paneId, setHeadingRequest],
  );

  useEffect(() => {
    const view = editorViewRef.current;
    if (view) dispatchPendingHeadingRequest(view);
  }, [dispatchPendingHeadingRequest]);

  const dispatchPendingSubtaskRequest = useCallback(
    (view: EditorView) => {
      if (
        !subtaskRequest ||
        subtaskRequest.filePath !== filePath ||
        subtaskRequest.paneId !== paneId ||
        handledSubtaskRequestRef.current === subtaskRequest
      )
        return;
      handledSubtaskRequestRef.current = subtaskRequest;
      const from = resolveTaskNoteSubtask(view.state.doc.toString(), subtaskRequest.target);
      if (from !== null) focusEditorLine(view, view.state.doc.lineAt(from).number);
      else
        notify({
          id: crypto.randomUUID(),
          level: NotificationLevel.INFO,
          title: "Subtask not found",
          message: "This checkbox changed since the board was loaded. Refresh the board and try again.",
          timestamp: Date.now(),
        });
      setSubtaskRequest((current) => (current === subtaskRequest ? null : current));
    },
    [subtaskRequest, filePath, paneId, notify, setSubtaskRequest],
  );
  useEffect(() => {
    if (editorViewRef.current) dispatchPendingSubtaskRequest(editorViewRef.current);
  }, [dispatchPendingSubtaskRequest]);

  const handleCreateEditor = useCallback(
    (view: EditorView) => {
      editorViewRef.current = view;
      dispatchPendingTitleEditRequest(view);
      dispatchPendingHeadingRequest(view);
      dispatchPendingSubtaskRequest(view);
    },
    [dispatchPendingHeadingRequest, dispatchPendingTitleEditRequest, dispatchPendingSubtaskRequest],
  );

  useEffect(() => {
    const view = editorViewRef.current;
    if (view) dispatchPendingTitleEditRequest(view);
  }, [dispatchPendingTitleEditRequest]);

  const handleChange = useCallback(
    (value: string) => {
      setFileBuffers((current) => {
        const previous = current[filePath] ?? { savedText: value, editorText: value };
        return {
          ...current,
          [filePath]: { ...previous, editorText: value },
        };
      });
      setFileSaveStates((current) => ({
        ...current,
        [filePath]: current[filePath]?.phase === "conflict" ? current[filePath] : { phase: "dirty" },
      }));
      queueAutoSave(filePath, value);
    },
    [filePath, queueAutoSave, setFileBuffers, setFileSaveStates],
  );

  useEffect(() => {
    const view = editorViewRef.current;
    if (view) resetEditorHistory(view, historyCompartment);
  }, [fileId, historyCompartment]);

  useEffect(() => {
    if (focusRequest?.filePath !== filePath || focusRequest.paneId !== paneId) return;

    const editorElement = containerRef.current?.querySelector<HTMLElement>(".cm-editor");
    if (editorElement) {
      const view = EditorView.findFromDOM(editorElement);
      if (view && focusRequest.position !== undefined)
        view.dispatch({
          selection: { anchor: Math.min(focusRequest.position, view.state.doc.length) },
          scrollIntoView: true,
        });
      view?.focus();
    }
  }, [filePath, focusRequest, paneId]);

  useEffect(() => {
    const handleFindShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isShortcut("find-note", event)) {
        return;
      }

      const pane = containerRef.current?.closest(".pane-column");
      const target = event.target;
      if (!pane || !(target instanceof Node) || !pane.contains(target)) return;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']")) return;

      const editorElement = containerRef.current?.querySelector<HTMLElement>(".cm-editor");
      const view = editorElement ? EditorView.findFromDOM(editorElement) : null;
      if (!view) return;

      event.preventDefault();
      openSearchPanel(view);
    };

    window.addEventListener("keydown", handleFindShortcut);
    return () => window.removeEventListener("keydown", handleFindShortcut);
  }, []);

  return (
    <div ref={containerRef} className="flex h-full" onMouseDownCapture={activatePane}>
      {imageViewer}
      <div className="cm-window" style={{ width: "100%", height: "100%" }}>
        <CodeMirror
          value={text}
          onChange={handleChange}
          onCreateEditor={handleCreateEditor}
          basicSetup={editorBasicSetup}
          extensions={configuredExtensions}
          theme="none"
          className="editor-comp"
        />
      </div>
    </div>
  );
});

export default ObimEditor;
