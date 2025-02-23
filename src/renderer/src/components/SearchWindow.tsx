import { useEffect, useRef, useState } from 'react';
import { InputField } from './InputField';
import { useKeyboardHotkey } from '../hooks/useKeyboardHotkey';
import { useFileExplorer } from '@renderer/hooks/useFileExplorer';
import { useAtom, useAtomValue } from 'jotai';
import { isVisibleAtom, resultsAtom } from '../store/SearchWindowStore';
import useSearchField from '@renderer/hooks/useSearchField';

const SearchWindow = () => {
    const results = useAtomValue(resultsAtom);
    const [isVisible, setIsVisible] = useAtom(isVisibleAtom);
    const { currentlySelected, setCurrentlySelected, handleKeyDown } = useKeyboardHotkey(results.length - 1);
    const { openFile } = useFileExplorer();
    const [navMode, setNavMode] = useState(0); // 0: keyboard, 1: mouse
    const { onQueryChange } = useSearchField();

    const listRefs = useRef<(HTMLDivElement | null)[]>([]);

    const handleQueryChange = (newQuery: string) => {
        onQueryChange(newQuery);
        setCurrentlySelected(0);
    }

    const onResultClick = (path: string) => {
        openFile(path);
        onQueryChange('');
        setIsVisible(false);
    }

    const handleKeyboardNavigation = (e: React.KeyboardEvent) => {
        setNavMode(0);
        handleKeyDown(e.nativeEvent);
        if (e.key === 'Enter') {
            onResultClick(results[currentlySelected].path);
        }
    }

    const handleMouseNavigation = (index: number) => {
        setNavMode(1);
        setCurrentlySelected(index);
    }

    useEffect(() => {
        if (listRefs.current[currentlySelected] && !navMode) {
            listRefs.current[currentlySelected].scrollIntoView({ behavior: 'instant', block: 'nearest' });
        }
    }, [currentlySelected]);

    if (!isVisible) return null;

    return (
        <div className='absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white border border-gray-300 rounded-lg shadow-md w-1/3 min-w-96 min-h-96 z-50 overflow-hidden'>
            <div className='sticky top-0 p-2'>
                <InputField onQueryChange={handleQueryChange}
                    onKeyDown={handleKeyboardNavigation} />
            </div>
            <div className='max-h-80 overflow-y-auto'>
                <div className='p-2'>
                    {results.map((result, index) => (
                        <div key={result.relativePath}
                            className={`p-1 text-sm cursor-pointer rounded-md truncate ${currentlySelected === index ? 'bg-gray-100' : ''}`}
                            onMouseMove={() => handleMouseNavigation(index)}
                            onClick={() => onResultClick(result.path)}
                            ref={(listElement) => (listRefs.current[index] = listElement)}>
                            {result.relativePath}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default SearchWindow;