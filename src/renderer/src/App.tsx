import "./app/MainWorkspaceExperiment.css";
import { scheduleEditorPreload } from "./features/editor/editorLoader";
import { WorkspaceTransitionStatus } from "./app/WorkspaceTransitionStatus";
import { StatusBar } from "./app/StatusBar";
import { InspectorSidebar, InspectorSidebarProvider, LeftSidebar } from "./app/AppSidebars";
import { InitializationCard } from "./app/InitializationCard";
import { useGlobalShortcuts } from "./app/useGlobalShortcuts";
import { WorkspaceContainer } from "./app/WorkspaceContainer";
import { ContextMenuHost } from "./features/context-menu/ContextMenuHost";
import { DocumentInspector } from "./features/editor/inspector/DocumentInspector";
import { FileExplorer } from "./features/files/explorer/FileExplorer";
import { FileConflictDialog } from "./features/files/FileConflictDialog";
import { NotificationHost } from "./features/notifications/NotificationHost";
import { useAppCloseGuard } from "./features/workspace/usePaneWorkspace";
import { EditorSearchOverlay } from "./features/search/EditorSearchOverlay";
import SearchWindow from "./features/search/SearchWindow";
import { useSearchWindow } from "./features/search/useSearchWindow";
import { useEffect } from "react";
import { useAtom } from "jotai";
import { isAppInitializedAtom } from "@renderer/store/appSessionStore";
import { AppDndProvider } from "@renderer/shared/dnd/AppDndProvider";
import { WindowTitleBar } from "./app/WindowTitleBar";
import { useWorkspaceSession } from "./app/useWorkspaceSession";
import { useWorkspaceFileChanges } from "./app/useWorkspaceFileChanges";
import { ShortcutHelpCard } from "./app/ShortcutHelpCard";
import ActionRunner from "./features/actions/ActionRunner";
import { NoteFileTypeSync } from "./features/files/NoteFileTypeSync";
import { NotePdfExportDialog } from "./features/files/NotePdfExportDialog";

const WorkspaceSessionCoordinator = () => {
  useWorkspaceSession();
  return null;
};

function App() {
  useEffect(scheduleEditorPreload, []);
  useAppCloseGuard();
  const [isInitialized, setIsInitialized] = useAtom(isAppInitializedAtom);
  const { openSearchWindow } = useSearchWindow();
  useGlobalShortcuts({ enabled: isInitialized });
  useWorkspaceFileChanges(isInitialized);

  useEffect(() => {
    setIsInitialized(window.config.getWorkspaceStatusSync().status === "ready");
  }, [setIsInitialized]);

  const content = isInitialized ? (
    <AppDndProvider>
      <main className="root-layout">
        <NotificationHost />
        <ShortcutHelpCard />
        <WorkspaceSessionCoordinator />
        <NoteFileTypeSync />
        <FileConflictDialog />
        <NotePdfExportDialog />
        <SearchWindow />
        <ActionRunner />
        <LeftSidebar>
          <FileExplorer onSearch={openSearchWindow} />
        </LeftSidebar>
        <InspectorSidebarProvider>
          <div className="content">
            <div className="content-body">
              <WorkspaceContainer />
            </div>
          </div>
          <InspectorSidebar>
            <DocumentInspector />
          </InspectorSidebar>
        </InspectorSidebarProvider>
        <EditorSearchOverlay />
        <ContextMenuHost />
      </main>
    </AppDndProvider>
  ) : (
    <InitializationCard />
  );

  return (
    <div className="app-shell workspace-soft-experiment">
      <WorkspaceTransitionStatus />
      <WindowTitleBar />
      <div className="app-content">{content}</div>
      {isInitialized && <StatusBar />}
    </div>
  );
}

export default App;
