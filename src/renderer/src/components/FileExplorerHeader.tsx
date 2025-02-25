import { useState } from "react";
import { FilePlus, FolderPlus, Search, ArrowUpAZ, ArrowDownAZ } from "lucide-react";
import { useSearchWindow } from "@renderer/hooks/useSearchWindow";

interface HeaderButtonProps {
    icon: any;
    altIcon?: any;
    action?: () => void;
}

const HeaderButton = ({ icon: Icon, altIcon: AltIcon, action }: HeaderButtonProps) => {
    const [whichIcon, setWhichIcon] = useState(false);

    const handleClick = () => {
        if (AltIcon) {
            setWhichIcon(prev => !prev);
        }
        if (action) {
            action();
        }
    };

    return (
        <div
            className="hover:bg-gray-200 p-1 rounded-md cursor-pointer"
            onClick={handleClick}
        >
            {whichIcon ? <AltIcon size={16}/> : <Icon size={16}/>}
        </div>
    );
};

export const FileExplorerHeader = () => {
    const { toggleSearchWindow } = useSearchWindow();
    
    return (
        <div className="flex justify-center items-center gap-2 p-2">
            <HeaderButton icon={Search} action={toggleSearchWindow}/>
            <HeaderButton icon={FilePlus} />
            <HeaderButton icon={FolderPlus} />
            <HeaderButton icon={ArrowUpAZ} altIcon={ArrowDownAZ} />
        </div>
    );
};
