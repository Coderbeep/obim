import { notifyFileSaveFailure, saveFileTracked } from "@renderer/features/files/dirtyFileBuffers";
import { fileBuffersByPathAtom } from "@renderer/store/fileBufferStore";
import { fileSaveStatesByPathAtom } from "@renderer/store/fileSaveStore";
import { useSetAtom, useStore } from "jotai";
import debounce from "lodash/debounce";
import { useCallback, useEffect, useMemo, useRef } from "react";

const AUTOSAVE_DELAY_MS = 2000;
const AUTOSAVE_MAX_WAIT_MS = 10000;

export const useObimEditor = () => {
  const store = useStore();
  const setFileBuffers = useSetAtom(fileBuffersByPathAtom);
  const lastReportedSaveError = useRef<string | null>(null);

  const debouncedSave = useMemo(
    () =>
      debounce(
        async (path: string, content: string) => {
          const currentBuffer = store.get(fileBuffersByPathAtom)[path];
          if (!currentBuffer || currentBuffer.editorText !== content || currentBuffer.savedText === content) return;

          store.set(fileSaveStatesByPathAtom, (states) => ({ ...states, [path]: { phase: "saving" } }));

          const result = await saveFileTracked(path, content, currentBuffer.version);
          if (!result.success) {
            store.set(fileSaveStatesByPathAtom, (states) => ({
              ...states,
              [path]: {
                phase: result.errorCode === "conflict" ? "conflict" : "error",
                message: result.error,
              },
            }));
            const errorKey = `${path}\n${result.error}`;
            if (lastReportedSaveError.current !== errorKey) {
              lastReportedSaveError.current = errorKey;
              notifyFileSaveFailure(store, path, result);
            }
            return;
          }

          lastReportedSaveError.current = null;

          setFileBuffers((prev) => {
            const previousBuffer = prev[path];
            if (!previousBuffer) return prev;

            return {
              ...prev,
              [path]: {
                ...previousBuffer,
                savedText: content,
                ...(result.version ? { version: result.version } : {}),
              },
            };
          });
          const latest = store.get(fileBuffersByPathAtom)[path];
          store.set(fileSaveStatesByPathAtom, (states) => ({
            ...states,
            [path]:
              latest && latest.editorText !== content ? { phase: "dirty" } : { phase: "saved", savedAt: Date.now() },
          }));
        },
        AUTOSAVE_DELAY_MS,
        { maxWait: AUTOSAVE_MAX_WAIT_MS },
      ),
    [setFileBuffers, store],
  );

  useEffect(
    () => () => {
      debouncedSave.flush();
      debouncedSave.cancel();
    },
    [debouncedSave],
  );

  const queueAutoSave = useCallback(
    (path: string, content: string) => {
      debouncedSave(path, content);
    },
    [debouncedSave],
  );

  return { queueAutoSave };
};
