import { fileHistoryBackwardStackAtom, fileHistoryForwardStackAtom } from "@renderer/store/FileNavigationStore"
import { useStore } from "jotai"
import { useFileOpen } from "./useFileActions"
import { useCallback } from "react"

export const useNavigation = () => {
    const store = useStore()
    const { open } = useFileOpen()

    const goBackward = useCallback(() => {
        const backStack = store.get(fileHistoryBackwardStackAtom);
        const forwardStack = store.get(fileHistoryForwardStackAtom);
      
        if (backStack.length <= 1) return;
    
        const previousFile = backStack[backStack.length - 1];
      
        store.set(fileHistoryForwardStackAtom, [...forwardStack, previousFile]);
        store.set(fileHistoryBackwardStackAtom, backStack.slice(0, -1));

        open(backStack[backStack.length - 2], {skipSave: false, skipForwardHistoryClear: true});
      }, [store, open]);

    const goForward = useCallback(() => {
        const backStack = store.get(fileHistoryBackwardStackAtom);
        const forwardStack = store.get(fileHistoryForwardStackAtom);
        if (forwardStack.length === 0) return;

        const nextFile = forwardStack[forwardStack.length - 1];

        store.set(fileHistoryBackwardStackAtom, [...backStack, nextFile]);
        store.set(fileHistoryForwardStackAtom, forwardStack.slice(0, -1));
        open(nextFile, {skipSave: false, skipForwardHistoryClear: true});
    }, [store, open]);

    return {
        goBackward,
        goForward
    }
}