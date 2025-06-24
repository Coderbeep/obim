interface InputFieldProps {
  onQueryChange: (newQuery: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export const InputField = ({ onQueryChange, onKeyDown }: InputFieldProps) => {
  return (
    <input
      autoFocus
      type="search"
      placeholder="Find your note..."
      className="w-full text-sm px-4 py-2 focus:outline-none border-b"
      onChange={(e) => onQueryChange(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
};
