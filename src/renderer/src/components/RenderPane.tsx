import { currentFilePathAtom } from "@renderer/store/NotesStore";
import { useAtom } from "jotai";
import {
  getNotesDirectoryPath,
} from "@shared/constants";
import { Dialog, DialogContent, DialogTrigger } from "./ui/dialog";
import ObimEditor from "./obimEditor";
import { useMemo } from "react";

export const RenderPane = () => {
  const [currentFilePath] = useAtom(currentFilePathAtom);

  const isImageFile = currentFilePath.endsWith(".png")

  const encodedMediaPath = useMemo(() => {
    const relativePath = currentFilePath
      .replace(getNotesDirectoryPath(), "")
      .slice(1);

    const mediaPath = `media:///${relativePath}`;

    return mediaPath;
  }, [currentFilePath]);

  return isImageFile ? (
    <Dialog>
      <DialogTrigger asChild>
        <div className="mx-auto max-w-[55em]">
          <img src={encodedMediaPath} />
        </div>
      </DialogTrigger>
      <DialogContent className="max-w-[55em]">
        <div>
          <img src={encodedMediaPath} />
        </div>
      </DialogContent>
    </Dialog>
  ) : (
    <ObimEditor />
  );
};
