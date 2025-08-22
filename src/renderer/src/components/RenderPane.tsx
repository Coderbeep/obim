import { currentFileAtom } from "@renderer/store/NotesStore";
import { useAtom } from "jotai";
import {
  SUPPORTED_IMAGE_MIME_TYPES,
} from "@shared/mime-types";
import { Dialog, DialogContent, DialogTrigger } from "./ui/dialog";
import ObimEditor from "./obimEditor";
import { useMemo } from "react";

export const RenderPane = () => {
  const [currentFile] = useAtom(currentFileAtom);

  const isImageFile = SUPPORTED_IMAGE_MIME_TYPES.includes(currentFile?.mimeType);

  const encodedMediaPath = useMemo(() => {
    if (!currentFile) return "";
    return `media:///${currentFile!.relativePath}`;
  }, [currentFile]);

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
  ) : currentFile?.mimeType === "text/markdown" ? (
    <ObimEditor />
  ) : null;
};
