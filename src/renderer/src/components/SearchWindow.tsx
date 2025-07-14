import { useEffect, useRef, useState } from "react";
import { File, Image } from "lucide-react";
import { useKeyboardHotkey } from "@hooks/useKeyboardHotkey";
import { useAtom, useAtomValue } from "jotai";
import { isVisibleAtom, resultsAtom } from "@store/SearchWindowStore";
import useSearchField from "@hooks/useSearchField";
import { useFileOpen } from "@hooks/file-actions-hooks/useFileActions";
import { FileItem } from "@shared/models";
import { cn } from "@lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@components/ui/command";
import { Dialog, DialogContent, DialogHeader } from "@components/ui/dialog";
import { Badge } from "@components/ui/badge";

const SearchWindow = () => {
  const results = useAtomValue(resultsAtom);
  const [isVisible, setIsVisible] = useAtom(isVisibleAtom);
  const {
    currentlySelected,
    setCurrentlySelected,
    handleKeyDown,
    setMaxIndex,
  } = useKeyboardHotkey();
  const { open } = useFileOpen();
  const [navMode, setNavMode] = useState(0); // 0: keyboard, 1: mouse
  const { onQueryChange } = useSearchField();
  const [query, setQuery] = useState("");

  const listRefs = useRef<(HTMLDivElement | null)[]>([]);

  const handleQueryChange = (newQuery: string) => {
    setQuery(newQuery);
    onQueryChange(newQuery);
    setCurrentlySelected(0);
  };

  const onResultClick = (file: FileItem) => {
    open(file);
    console.log("Opening file:", file.path);
    onQueryChange("");
    setQuery("");
    setIsVisible(false);
  };

  const handleKeyboardNavigation = (e: React.KeyboardEvent) => {
    setNavMode(0);
    handleKeyDown(e.nativeEvent);
    if (e.key === "Enter") {
      onResultClick(results[currentlySelected]);
    }
  };

  const handleMouseNavigation = (index: number) => {
    setNavMode(1);
    setCurrentlySelected(index);
  };

  const getFileIcon = (path: string) => {
    const extension = path.split(".").pop()?.toLowerCase();
    if (["jpg", "jpeg", "png", "gif"].includes(extension || ""))
      return <Image className="h-[14px]! w-[14px]! text-muted-foreground" />;
    else return <File className="h-[14px]! w-[14px]! text-muted-foreground" />;
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

  useEffect(() => {
    setMaxIndex(results.length - 1);
  }, [results]);

  useEffect(() => {
    if (listRefs.current[currentlySelected] && !navMode) {
      listRefs.current[currentlySelected].scrollIntoView({
        behavior: "instant",
        block: "nearest",
      });
    }
  }, [currentlySelected]);

  if (!isVisible) return null;

  return (
    <Dialog open={isVisible} onOpenChange={setIsVisible}>
      <DialogContent className="sm:max-w-[600px] p-0 gap-0">
        <DialogHeader className="sr-only">
          <title>Search Files</title>
        </DialogHeader>

        <Command className="rounded-lg border-none shadow-none ">
          <CommandInput
            placeholder="Search files..."
            value={query}
            onValueChange={handleQueryChange}
            onKeyDown={handleKeyboardNavigation}
            className="w-full bg-transparent text-sm placeholder:text-muted-foreground focus:ring-0 focus:outline-none"
          />

          <CommandList className="max-h-96">
            <CommandEmpty className="text-center text-sm text-muted-foreground">
              No files found.
            </CommandEmpty>

            {results.length > 0 && (
              <CommandGroup>
                {results.map((result, index) => {
                  const { fileName, directory } = formatPath(
                    result.relativePath
                  );
                  const fileType = getFileType(result.relativePath);

                  return (
                    <CommandItem
                      key={result.relativePath}
                      value={result.relativePath}
                      onSelect={() => onResultClick(result)}
                      onMouseEnter={() => handleMouseNavigation(index)}
                      ref={(listElement) =>
                        (listRefs.current[index] = listElement)
                      }
                      className={cn(
                        "flex items-center gap-3 cursor-pointer rounded-md",
                        "hover:bg-accent hover:text-accent-foreground",
                        currentlySelected === index &&
                          "bg-accent text-accent-foreground"
                      )}
                    >
                      <div className="flex items-start gap-2 flex-1 min-w-0 ">
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
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-muted-foreground truncate">
                                {directory}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>

        <div className="border-t px-3 py-2 text-xs text-muted-foreground flex items-center justify-center gap-2">
          <Badge variant="secondary" className="cursor-default">
            <span className="text-xs"> ESC </span>
          </Badge>
          <span>to close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SearchWindow;
