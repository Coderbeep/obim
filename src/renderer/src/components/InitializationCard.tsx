import { isInitializedAtom } from "@renderer/store/NotesStore";
import { useSetAtom } from "jotai";

export const InitializationCard = () => {
  const setIsInitialized = useSetAtom(isInitializedAtom);

  const handleOnClick = async () => {
    const result = await window["config"].initializeConfig();
    console.log("Initialization Result:", result);
    if (result) {
      setIsInitialized(true);
    }
  };

  return (
    <div className="flex h-screen justify-center items-center select-none">
      <div
        className="flex flex-col w-[32em] h-[38em] rounded-xl bg-white 
                            border border-gray-300 shadow-md p-4"
      >
        <span className="flex text-4xl justify-center">OBIM</span>
        <div className="flex justify-between items-end w-full">
          <div className="flex flex-col">
            <span className="text-lg font-bold">Select Directory</span>
            <span className="text-sm text-gray-500">
              Select directory for your markdown notes
            </span>
          </div>
          <button
            onClick={handleOnClick}
            className="bg-blue-500 text-white font-normal text-sm px-4 py-1 rounded-md"
          >
            Select
          </button>
        </div>
      </div>
    </div>
  );
};
