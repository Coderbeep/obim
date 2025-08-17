import { Breadcrumbs } from "./Breadcrumbs";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigation } from "@hooks/file-actions-hooks/useNavigation";
import { useAtomValue } from "jotai";
import { fileHistoryBackwardStackAtom, fileHistoryForwardStackAtom } from "@renderer/store/FileNavigationStore";
import { HeaderButton } from "./FileExplorer/FileExplorerHeader";

export const FileNavigationButtons = () => {
  const { goBackward, goForward } = useNavigation();
  const backwardStack = useAtomValue(fileHistoryBackwardStackAtom);
  const forwardStack = useAtomValue(fileHistoryForwardStackAtom);

  const canGoBackward = backwardStack.length > 1;
  const canGoForward = forwardStack.length > 0;

  return (
    <div className="flex items-center gap-2 shrink-0">
      <HeaderButton
        icon={ChevronLeft}
        action={goBackward}
        disabled={!canGoBackward}
      />
      <HeaderButton
        icon={ChevronRight}
        action={goForward}
        disabled={!canGoForward}
      />
    </div>
  );
};

export const EditorHeader = () => {
    return (
      <div className="flex items-center">
        <FileNavigationButtons />
        <div className="flex-grow flex justify-center">
          <Breadcrumbs />
        </div>
      </div>
    );
  };
  