import { useEffect, useRef } from 'react';
import { InputField } from './InputField';
import { FileItem } from '@shared/models';

interface SearchWindowProps {
    isVisible: boolean;
    setIsVisible: (isVisible: boolean) => void;
    onQueryChange: (newQuery: string) => void;
    results: FileItem[];
    onFileSelect: (filePath: string) => void;
}

const SearchWindow = ({ isVisible, setIsVisible, onQueryChange, results, onFileSelect }: SearchWindowProps) => {
    if (!isVisible) return null;

    const onResultClick = (path: string) => {
        onFileSelect(path);
        onQueryChange('');
        setIsVisible(false);
    }

    return (
        <div className='absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white border border-gray-300 rounded-lg shadow-md w-96 z-50 overflow-hidden'>
            <div className='sticky top-0 p-2'>
                <InputField onQueryChange={onQueryChange} />
            </div>
            <div className='max-h-80 overflow-y-auto'>
                <div className='p-2'>
                    {results.map((result) => (
                        <div key={result.path} 
                        className='p-2 hover:bg-gray-100 cursor-pointer rounded-md truncate'
                        onClick={() => onResultClick(result.path)}>
                            {result.filename}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default SearchWindow;