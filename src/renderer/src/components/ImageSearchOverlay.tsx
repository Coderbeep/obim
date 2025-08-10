import { useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue } from "jotai";

import useSearchField from "@hooks/useSearchField";
import { useKeyboardHotkey } from "@hooks/useKeyboardHotkey";
import { File, Image } from "lucide-react";

import { resultsAtom } from "@store/SearchWindowStore";
import { overlayVisibleAtom } from "@store/NotesStore";
import { EventBus, EventTypes } from "@services/EventBus";
import { Badge } from "./ui/badge";
import cn from "./lib/utils";

const ImageSearchOverlay = ({ id }: { id: string }) => {
  const results = useAtomValue(resultsAtom);
  const [overlayVisible, setOverlayVisible] = useAtom(overlayVisibleAtom);
  const [navMode, setNavMode] = useState(0); // 0: keyboard, 1: mouse

  const {
    currentlySelected,
    setCurrentlySelected,
    handleKeyDown,
    setMaxIndex,
  } = useKeyboardHotkey();
  const { onQueryChange } = useSearchField();

  const resultsRef = useRef(results);
  const wasClosedManually = useRef(false);
  const currentlySelectedRef = useRef(currentlySelected);
  const overlayVisibleRef = useRef(overlayVisible);
  const listRefs = useRef<(HTMLDivElement | null)[]>([]);

  const handleQueryChange = (newQuery: string) => {
    onQueryChange(newQuery, { onlyImages: true });
    setCurrentlySelected(0);
  };

  const handleImageSelected = () => {
    wasClosedManually.current = true;
    EventBus.emit(EventTypes.IMAGE_SELECTED, {
      path: resultsRef.current[currentlySelectedRef.current].relativePath,
    });
    setOverlayVisible(false);
  };

  const handleKeyboardNavigation = (key: string) => {
    if (!overlayVisibleRef.current) return;

    setNavMode(0);
    handleKeyDown(new KeyboardEvent("keydown", { key: key }));
    if (key === "Enter") {
      handleImageSelected();
    }
  };

  const handleMouseNavigation = (index: number) => {
    setNavMode(1);
    setCurrentlySelected(index);
  };

  useEffect(() => {
    const handleOverlayClose = () => {
      setOverlayVisible(false);
      const editor = document.getElementsByClassName(
        "cm-content",
      )[0] as HTMLElement;
      editor?.focus();
    };

    const handleImageSourceChange = (payload: { src: string }) => {
      if (wasClosedManually.current) {
        wasClosedManually.current = false;
        return;
      }
      handleQueryChange(payload.src);
      setOverlayVisible(true);
      if (payload.src === "") setOverlayVisible(false);
    };

    EventBus.on(EventTypes.OVERLAY_CLOSE, handleOverlayClose);
    EventBus.on(EventTypes.IMAGE_SRC_CHANGED, handleImageSourceChange);
    EventBus.on(EventTypes.OVERLAY_HOTKEY, (payload) => {
      handleKeyboardNavigation(payload.key);
    });
    return () => {
      EventBus.off(EventTypes.OVERLAY_CLOSE, handleOverlayClose);
      EventBus.off(EventTypes.IMAGE_SRC_CHANGED, handleImageSourceChange);
      EventBus.off(EventTypes.OVERLAY_HOTKEY, (payload) => {
        handleKeyboardNavigation(payload.key);
      });
    };
  }, []);

  useEffect(() => {
    resultsRef.current = results;
    setMaxIndex(results.length - 1);
  }, [results]);

  useEffect(() => {
    if (listRefs.current[currentlySelected] && !navMode) {
      listRefs.current[currentlySelected].scrollIntoView({
        behavior: "instant",
        block: "nearest",
      });
    }
    currentlySelectedRef.current = currentlySelected;
  }, [currentlySelected, navMode]);

  useEffect(() => {
    overlayVisibleRef.current = overlayVisible;
  }, [overlayVisible]);

  const getFileIcon = (path: string) => {
    const extension = path.split(".").pop()?.toLowerCase();
    if (["jpg", "jpeg", "png", "gif"].includes(extension || ""))
      return <Image className="h-[14px] w-[14px] text-muted-foreground" />;
    else return <File className="h-[14px] w-[14px] text-muted-foreground" />;
  };

  const getFileType = (path: string) => {
    const extension = path.split(".").pop()?.toLowerCase();
    return extension || "file";
  };

  const formatPath = (path: string) => {
    const parts = path.split("/");
    const fileName = parts.pop() || "";
    const fileNameWithoutExtension = fileName.split(".")[0];
    return {
      fileName: fileNameWithoutExtension,
      directory: parts.join("/").slice(1),
    };
  };


  return (
    <div
      id={id}
      tabIndex={0}
      className={`absolute bg-white border border-gray-300 rounded-lg shadow-md w-1/3 min-w-96 min-h-52 z-50 overflow-hidden ${overlayVisible ? "block" : "hidden"}`}
    >
      <div className="max-h-80 overflow-y-auto">
        <div className="p-2 space-y-1">
          {results.map((result, index) => {
            const { fileName, directory } = formatPath(result.relativePath);
            const fileType = getFileType(result.relativePath);
            const isSelected = currentlySelected === index;

            return (
              <div
                key={result.relativePath}
                className={cn(
                  "flex items-center gap-3 cursor-pointer rounded-md pl-2 pr-2 py-1",
                  isSelected && "bg-accent text-accent-foreground"
                )}
                onMouseMove={() => handleMouseNavigation(index)}
                onClick={handleImageSelected}
                ref={(el) => (listRefs.current[index] = el)}
              >
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-2 font-medium text-sm truncate">
                        {getFileIcon(result.relativePath)}
                        {fileName}
                      </span>
                      <Badge variant="secondary" className="text-xs">
                        {fileType}
                      </Badge>
                    </div>
                    {directory && (
                      <div className="text-xs text-muted-foreground truncate">
                        {directory}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ImageSearchOverlay;
