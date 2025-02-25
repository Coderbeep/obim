import { isVisibleAtom } from "@renderer/store/SearchWindowStore";
import { useAtom } from "jotai"

export const useSearchWindow = () => {
    const [isVisible, setIsVisible] = useAtom(isVisibleAtom);

    const toggleSearchWindow = () => {
        setIsVisible((prev) => !prev);
    }

    return { toggleSearchWindow }
}