import { useEffect, useRef, useState } from "react";

export const useKeyboardHotkey = () => {
    const [ currentlySelected, setCurrentlySelected ] = useState(0);
    const [ maxIndex, setMaxIndex ] = useState(0);
    const maxIndexRef = useRef(maxIndex);

    useEffect(() => {
        maxIndexRef.current = maxIndex;
    }, [maxIndex]);

    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setCurrentlySelected((prev) => Math.min(prev + 1, maxIndexRef.current));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCurrentlySelected((prev) => Math.max(prev - 1, 0));
        }
    };

    useEffect(() => {
        setCurrentlySelected(0);
    }, [maxIndex]);

    return { currentlySelected, setCurrentlySelected, handleKeyDown, setMaxIndex };
};