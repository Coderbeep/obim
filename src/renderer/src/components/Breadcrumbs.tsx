import { useAtom, useSetAtom } from "jotai";
import { Fragment, useRef } from "react";
import {
  currentRelativeFilePathAtom,
  selectedBreadcrumbAtom,
} from "@store/NotesStore";

const BreadcrumbItem = ({ children, className, onClick }) => {
  return (
    <div
      className={`px-1 rounded-md select-none ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
};

const BreadcrumbSeparator = () => {
  return <div className="px-1 select-none text-[#5C5C5C]">/</div>;
};

export const Breadcrumbs = () => {
  const [path] = useAtom(currentRelativeFilePathAtom);
  const parts = path.split("/").filter((part) => part !== "");
  const setSelectedBreadcrumb = useSetAtom(selectedBreadcrumbAtom);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = (index: number) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    setSelectedBreadcrumb("/" + parts.slice(0, index + 1).join("/"));

    timeoutRef.current = setTimeout(() => {
      setSelectedBreadcrumb("");
      timeoutRef.current = null;
    }, 300);
  };

  return (
    <div className="flex justify-center text-[#222222] text-sm text-nowrap">
      {parts.map((part, index) => (
        <Fragment key={`${part}-${index}`}>
          <BreadcrumbItem
            className={
              index === parts.length - 1
                ? "text-[#222222]"
                : "text-[#5C5C5C] hover:bg-gray-200 hover:text-[#222222]"
            }
            onClick={() => index < parts.length - 1 && handleClick(index)}
          >
            {part}
          </BreadcrumbItem>
          {index < parts.length - 1 && <BreadcrumbSeparator />}
        </Fragment>
      ))}
    </div>
  );
};
