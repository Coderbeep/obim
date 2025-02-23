import useSearchField from '@renderer/hooks/useSearchField';
import { useKeyboardHotkey } from '@renderer/hooks/useKeyboardHotkey';
import { useEffect, useRef, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { resultsAtom } from '../store/SearchWindowStore';
import { overlayVisibleAtom } from '../store/NotesStore';
import { EventBus, EventTypes } from '@renderer/services/EventBus';

const ImageSearchOverlay = ({ id }: { id: string }) => {
    const results = useAtomValue(resultsAtom);
    const [overlayVisible, setOverlayVisible] = useAtom(overlayVisibleAtom);
    const [navMode, setNavMode] = useState(0); // 0: keyboard, 1: mouse

    const { currentlySelected, setCurrentlySelected, handleKeyDown, setMaxIndex } = useKeyboardHotkey();
    const { onQueryChange } = useSearchField();

    const resultsRef = useRef(results);
    const wasClosedManually = useRef(false);
    const currentlySelectedRef = useRef(currentlySelected);
    const overlayVisibleRef = useRef(overlayVisible);
    const listRefs = useRef<(HTMLDivElement | null)[]>([]);

    const handleQueryChange = (newQuery: string) => {
        onQueryChange(newQuery);
        setCurrentlySelected(0);
    }

    const handleImageSelected = () => {
        wasClosedManually.current = true
        EventBus.emit(EventTypes.IMAGE_SELECTED, { path: resultsRef.current[currentlySelectedRef.current].relativePath });
        setOverlayVisible(false)
    }

    const handleKeyboardNavigation = (key: string) => {
        if (!overlayVisibleRef.current) return

        setNavMode(0);
        handleKeyDown(new KeyboardEvent('keydown', { key: key }));
        if (key === 'Enter') { handleImageSelected() }
    };

    const handleMouseNavigation = (index: number) => {
        setNavMode(1);
        setCurrentlySelected(index);
    }


    useEffect(() => {
        const handleOverlayClose = () => {
            setOverlayVisible(false);
            const editor = document.getElementsByClassName('cm-content')[0] as HTMLElement;
            editor?.focus()
        }

        const handleImageSourceChange = (payload: { src: string }) => {
            if (wasClosedManually.current) {
                wasClosedManually.current = false
                return
            }
            handleQueryChange(payload.src)
            setOverlayVisible(true);
            if (payload.src === '')
                setOverlayVisible(false);
        }

        EventBus.on(EventTypes.OVERLAY_CLOSE, handleOverlayClose);
        EventBus.on(EventTypes.IMAGE_SRC_CHANGED, handleImageSourceChange);
        EventBus.on(EventTypes.OVERLAY_HOTKEY, (payload) => { handleKeyboardNavigation(payload.key) });
        return () => {
            EventBus.off(EventTypes.OVERLAY_CLOSE, handleOverlayClose);
            EventBus.off(EventTypes.IMAGE_SRC_CHANGED, handleImageSourceChange);
            EventBus.off(EventTypes.OVERLAY_HOTKEY, (payload) => { handleKeyboardNavigation(payload.key) });
        }
    }, [])

    useEffect(() => {
        resultsRef.current = results;
        setMaxIndex(results.length - 1);
    }, [results]);

    useEffect(() => {
        if (listRefs.current[currentlySelected] && !navMode) {
            listRefs.current[currentlySelected].scrollIntoView({ behavior: 'instant', block: 'nearest' });
        }
        currentlySelectedRef.current = currentlySelected;
    }, [currentlySelected, navMode]);

    useEffect(() => {
        overlayVisibleRef.current = overlayVisible;
    }, [overlayVisible]);

    return (
        <div id={id} tabIndex={0} className={`absolute bg-white border border-gray-300 rounded-lg shadow-md w-1/3 min-w-96 min-h-52 z-50 overflow-hidden ${overlayVisible ? 'block' : 'hidden'}`}>
            <div className='max-h-80 overflow-y-auto'>
                <div className='p-2'>
                    {results.map((result, index) => (
                        <div key={result.relativePath}
                            className={`p-1 text-sm cursor-pointer rounded-md truncate ${currentlySelected === index ? 'bg-gray-100' : ''}`}
                            onMouseMove={() => handleMouseNavigation(index)}
                            onClick={() => handleImageSelected()}
                            ref={(listElement) => (listRefs.current[index] = listElement)}>
                            {result.relativePath}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default ImageSearchOverlay;