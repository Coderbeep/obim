interface InputFieldProps {
    onQueryChange: (newQuery: string) => void;
}

export const InputField = ({onQueryChange} : InputFieldProps) => {
    return (
        <input 
            type="search"
            placeholder="Find your note..." 
            className="w-full px-4 py-2 focus:outline-none border-b" 
            onChange={(e) => onQueryChange(e.target.value)}
        />
    );
};
