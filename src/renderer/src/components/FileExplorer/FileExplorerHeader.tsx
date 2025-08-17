import { useState } from "react";
import {
  FilePlus,
  FolderPlus,
  Search,
  ArrowUpAZ,
  ArrowDownAZ,
  LucideIcon,
} from "lucide-react";
import { useSearchWindow } from "@renderer/hooks/useSearchWindow";
import {
  useDirectoryCreate,
  useFileCreate,
} from "@renderer/hooks/file-actions-hooks/useFileActions";

interface HeaderButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  altIcon?: LucideIcon;
  action?: () => void;
}

export const HeaderButton = ({
  icon: Icon,
  altIcon: AltIcon,
  action,
  disabled,
  className,
  ...buttonProps
}: HeaderButtonProps) => {
  const [whichIcon, setWhichIcon] = useState<boolean>(false);

  const handleClick = (): void => {
    if (AltIcon) {
      setWhichIcon((prev: boolean) => !prev);
    }
    if (action) {
      action();
    }
  };

  return (
    <button
      className={`hover:bg-gray-200 p-1 rounded-[var(--radius)] ${
        disabled ? 'opacity-50 cursor-default hover:bg-transparent' : 'cursor-pointer hover:bg-gray-200'
      } ${className || ''}`}
      onClick={handleClick}
      disabled={disabled}
      {...buttonProps}
    >
      {whichIcon && AltIcon ? (
        <AltIcon size={16} className={disabled ? 'text-gray-400' : ''} />
      ) : (
        <Icon size={16} className={disabled ? 'text-gray-400' : ''} />
      )}
    </button>
  );
};

export const FileExplorerHeader = (): JSX.Element => {
  const { toggleSearchWindow } = useSearchWindow();
  const { createNewFile } = useFileCreate();
  const { createDirectory } = useDirectoryCreate();

  return (
    <div className="flex justify-center items-center gap-2 p-2">
      <HeaderButton icon={Search} action={toggleSearchWindow} />
      <HeaderButton icon={FilePlus} action={createNewFile} />
      <HeaderButton icon={FolderPlus} action={createDirectory} />
      <HeaderButton icon={ArrowUpAZ} altIcon={ArrowDownAZ} />
    </div>
  );
};
