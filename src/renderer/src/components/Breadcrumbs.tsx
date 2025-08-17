import { useAtom, useSetAtom } from "jotai";
import {
  currentRelativeFilePathAtom,
  expandedDirectoriesAtom,
  selectedBreadcrumbAtom,
} from "@store/NotesStore";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@components/ui/breadcrumb";
import { useRef } from "react";


export const Breadcrumbs = () => {
  const [path] = useAtom(currentRelativeFilePathAtom);
  const parts = path.split("/").filter((part) => part !== "");
  const setSelectedBreadcrumb = useSetAtom(selectedBreadcrumbAtom);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setExpandedDirectories = useSetAtom(expandedDirectoriesAtom);

  const expandDirectoryPath = (fullPath: string) => {
    const pathParts = fullPath.split("/").filter(Boolean);
    let current = "";
    const newDirs = new Set<string>();
  
    for (const part of pathParts) {
      current += "/" + part;
      newDirs.add(current);
    }
  
    setExpandedDirectories(prev => {
      const updated = new Set(prev);
      newDirs.forEach(dir => updated.add(dir));
      return updated;
    });
  };

  const handleClick = (index: number) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    const clickedPath = "/" + parts.slice(0, index + 1).join("/");
    setSelectedBreadcrumb(clickedPath);
    expandDirectoryPath(clickedPath)

    timeoutRef.current = setTimeout(() => {
      setSelectedBreadcrumb("");
      timeoutRef.current = null;
    }, 300);
  };

  return (
    <Breadcrumb className="select-none list-none flex justify-center text-sm text-nowrap">
      <BreadcrumbList>
        {parts.map((part, index) => {
          const isLast = index === parts.length - 1;

          return (
            <div key={index} className="flex items-center">
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbLink className="text-[var(--foreground)]" aria-current="page">
                    {part}
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbLink
                    onClick={() => handleClick(index)}
                    className="cursor-pointer px-1 text-[var(--muted-foreground)] hover:rounded-[var(--radius)] hover:bg-[var(--accent)]"
                  >
                    {part}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </div>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
};
