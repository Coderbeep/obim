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
import { useAtom } from "jotai";
import { isInitializedAtom } from "./store/NotesStore";
import { getNotesDirectoryPath } from "@shared/constants";
import { fileRepository } from "@renderer/services/FileRepository";
import { dbService } from "./services/DatabaseService";

function App() {
  const [isInitialized, setIsInitialized] = useAtom(isInitializedAtom);
  const [, setDbReady] = useState(false);

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
            getNotesDirectoryPath(),
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
        <SearchWindow />
        <Sidebar>
          <FileExplorer directoryPath={getNotesDirectoryPath()} />
        </Sidebar>
        <Content>
          <Breadcrumbs />
          <ObimEditor />
        </Content>
        <ImageSearchOverlay id="image-overlay" />
        <ContextMenu id="context-menu" />
      </RootLayout>
    );
  } else {
    return <InitializationCard />;
  }
}

export default App;
