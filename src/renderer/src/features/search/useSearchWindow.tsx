import { isVisibleAtom } from "@renderer/store/SearchWindowStore";
import { useSetAtom } from "jotai";

export const useSearchWindow = () => {
  const setIsVisible = useSetAtom(isVisibleAtom);

  const openSearchWindow = () => {
    setIsVisible(true);
  };

  return { openSearchWindow };
};
