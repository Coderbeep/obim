import { useCallback, useEffect, useRef, useState } from "react";

export const useListKeyboardNavigation = () => {
  const [currentlySelected, setCurrentlySelected] = useState(0);
  const [maxIndex, setMaxIndex] = useState(0);
  const maxIndexRef = useRef(maxIndex);

  useEffect(() => {
    maxIndexRef.current = maxIndex;
  }, [maxIndex]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCurrentlySelected((prev) => Math.min(prev + 1, Math.max(0, maxIndexRef.current)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCurrentlySelected((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setCurrentlySelected(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setCurrentlySelected(Math.max(0, maxIndexRef.current));
    } else if (e.key === "PageDown") {
      e.preventDefault();
      setCurrentlySelected((prev) => Math.min(prev + 5, Math.max(0, maxIndexRef.current)));
    } else if (e.key === "PageUp") {
      e.preventDefault();
      setCurrentlySelected((prev) => Math.max(prev - 5, 0));
    }
  }, []);

  const setMaxIndexSafely = useCallback((nextMaxIndex: number) => setMaxIndex(Math.max(0, nextMaxIndex)), []);

  useEffect(() => {
    setCurrentlySelected(0);
  }, [maxIndex]);

  return {
    currentlySelected,
    setCurrentlySelected,
    handleKeyDown,
    setMaxIndex: setMaxIndexSafely,
  };
};
