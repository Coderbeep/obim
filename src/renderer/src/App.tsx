import { Content, RootLayout, Sidebar } from "./components";
import ObimEditor from "./components/obimEditor";
import { FileExplorer } from "./components/FileExplorer/FileExplorer";
import { useEffect, useState } from "react";
import SearchWindow from "./components/SearchWindow";
import "./assets/index.css";
import "./assets/Editor.scss";
import "./assets/globals.css";
import { Breadcrumbs } from "./components/Breadcrumbs";
import ImageSearchOverlay from "./components/ImageSearchOverlay";
import { ContextMenu } from "./components/ContextMenu";
import { InitializationCard } from "./components/InitializationCard";
import { useAtom, useStore } from "jotai";
import { currentFilePathAtom, fileHistoryAtom, isInitializedAtom } from "./store/NotesStore";
import { getNotesDirectoryPath } from "@shared/constants";
import { fileRepository } from "@renderer/services/FileRepository";
import { dbService } from "./services/DatabaseService";
import { GlobalDrag } from "./components/GlobalDrag";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { HeaderButton } from "./components/FileExplorer/FileExplorerHeader";
import { useFileOpen } from "./hooks/file-actions-hooks/useFileActions";


function App() {
  const [isInitialized, setIsInitialized] = useAtom(isInitializedAtom);
  const [, setDbReady] = useState(false);
  const store = useStore();
  const getCurrentFilePath = () => store.get(currentFilePathAtom);
  const setCurrentFilePath = (value: string) => store.set(currentFilePathAtom, value);
  const fileHistory = () => store.get(fileHistoryAtom); 
  const { open } = useFileOpen();

  useEffect(() => {
    const initializeDB = async () => {
      try {
        await dbService.init();
        setDbReady(true);
        console.log("Database initialized");
      } catch (error) {
        console.error("Database init failed:", error);
      }
    };

    initializeDB();
  }, []);

  useEffect(() => {
    const checkAndLoad = async () => {
      const isDefined = window["config"].isMainDirectoryPathDefinedSync();
      setIsInitialized(isDefined);

      if (isDefined) {
        try {
          const files = await window["api"].getFilesRecursiveAsList(
            getNotesDirectoryPath()
          );

          await fileRepository.clear();
          await fileRepository.createMany(files);
          console.log("Files loaded into IndexedDB using repository");
        } catch (error) {
          console.error("Failed to load and store files:", error);
        }
      }
    };

    checkAndLoad();
  }, [setIsInitialized]);

  if (isInitialized) {
    return (
      <RootLayout>
        <Sidebar>
          <SearchWindow />
          <FileExplorer directoryPath={getNotesDirectoryPath()} />
        </Sidebar>
        <Content>
          <div className="flex items-center">
            <div className="flex items-center gap-2 shrink-0">
              <HeaderButton
                icon={ChevronLeft}
                action={() => {
                  console.log("Left clicked.")
                  const currentFilePath = getCurrentFilePath();
                  const history = fileHistory();
                  const currentIndex = history.findIndex(f => f.path === currentFilePath);
                  if (currentIndex > 0) {
                    const previousFile = history[currentIndex - 1];
                    open(previousFile);
                  }
                }}
              />
              <HeaderButton
                icon={ChevronRight}
                action={() => {
                  console.log("Right clicked.")
                  const currentFilePath = getCurrentFilePath();
                  const history = fileHistory();
                  const currentIndex = history.findIndex(f => f.path === currentFilePath);
                  if (currentIndex > -1 && currentIndex < history.length - 1) {
                    const nextFile = history[currentIndex + 1];
                    open(nextFile);
                  }
                }}
              />
            </div>

            <div className="flex-grow flex justify-center">
              <Breadcrumbs />
            </div>
          </div>
          <ObimEditor />
        </Content>
        <ImageSearchOverlay id="image-overlay" />
        <ContextMenu id="context-menu" />
        <GlobalDrag />
      </RootLayout>
    );
  } else {
    return <InitializationCard />;
  }
}

export default App;
