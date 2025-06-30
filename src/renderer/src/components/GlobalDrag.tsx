import { useEffect, useRef } from "react";
import { useAtom, useSetAtom } from "jotai";
import { dragContentAtom, dragRefAtom } from "@store/DragStore";

export const GlobalDrag = () => {
  const [content] = useAtom(dragContentAtom);
  const setRef = useSetAtom(dragRefAtom);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRef(ref.current);
  }, [setRef]);

  return (
    <div
      ref={ref}
      className="fixed top-[-200px] left-[-200px] pointer-events-none z-[9999]
                 px-2 py-1 rounded-[var(--radius)]
                 flex items-center gap-2 border bg-card"
    >
      <span className="text-xs">🗎</span>
      <span className="text-xs px-1 truncate rounded-[var(--radius)]">
        {content}
      </span>
    </div>
  );
};

export default GlobalDrag;
