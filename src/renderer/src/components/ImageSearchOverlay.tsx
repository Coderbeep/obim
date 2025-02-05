import { useEffect, useRef, useState } from 'react';
import { InputField } from './InputField';
import { useArrowKey } from '@renderer/hooks/useArrowKey';
import { useAtom, useAtomValue } from 'jotai';
import { isVisibleAtom, resultsAtom } from '@renderer/store/SearchWindowStore';
import useSearchField from '@renderer/hooks/useSearchField';

const SearchWindow = ({ id } : { id: string}) => {
    const results = useAtomValue(resultsAtom);
    const { currentlySelected, setCurrentlySelected, handleKeyDown } = useArrowKey(results.length - 1);
    const [ navMode, setNavMode ] = useState(0); // 0: keyboard, 1: mouse
    const { onQueryChange }  = useSearchField();

    const listRefs = useRef<(HTMLDivElement | null)[]>([]);

    const handleQueryChange = (newQuery: string) => {
        onQueryChange(newQuery);
        setCurrentlySelected(0);
    }

    const handleKeyboardNavigation = (e: React.KeyboardEvent) => {
        setNavMode(0);
        handleKeyDown(e.nativeEvent);
        if (e.key === 'Enter') {
            console.log('Enter key pressed');
            const event = new CustomEvent('image-selected', { detail: { path: results[currentlySelected].relativePath } });
            document.getElementById('image-overlay')?.dispatchEvent(event);
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

    return (
        <div id={id} className='absolute bg-white border border-gray-300 rounded-lg shadow-md w-1/3 min-w-96 min-h-52 z-50 overflow-hidden'>
            <div className='sticky top-0 p-2'>
                <InputField onQueryChange={handleQueryChange}
                    onKeyDown={handleKeyboardNavigation}/>
            </div>
            <div className='max-h-80 overflow-y-auto'>
                <div className='p-2'>
                    {results.map((result, index) => (
                        <div key={result.relativePath}
                            className={`p-1 text-sm cursor-pointer rounded-md truncate ${currentlySelected === index ? 'bg-gray-100' : ''}`}
                            onMouseMove={() => handleMouseNavigation(index)}
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