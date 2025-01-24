import { useEffect, useState } from "react";

export const useArrowKey = (maxSize: number) => {
    const [currentlySelected, setCurrentlySelected] = useState(0);

    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setCurrentlySelected((prev) => {
                if (prev + 1 >= maxSize) {
                    return maxSize;
                }
                return prev + 1;
            });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCurrentlySelected((prev) => {
                if (prev - 1 < 0) {
                    return 0;
                } 
                return prev - 1;
            })
        }
    }

    useEffect(() => {
        setCurrentlySelected(0);
    }, [maxSize]);

    return { currentlySelected, setCurrentlySelected, handleKeyDown };
}