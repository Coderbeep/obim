import { useEffect, useState } from "react";

import {
  openInDefaultApp,
  readLargeTextPreview,
  revealInSystemFileManager,
} from "@renderer/features/files/workspaceFileService";
import { Button } from "@renderer/shared/ui/button";
import type { LargeTextPreview as LargeTextPreviewResult } from "@shared/large-files";
import type { FileItem } from "@shared/file-item";

type PreviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; preview: LargeTextPreviewResult };

const numberFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${numberFormatter.format(bytes / 1024)} KiB`;
  return `${numberFormatter.format(bytes / (1024 * 1024))} MiB`;
};

export const LargeFilePreview = ({ file }: { file: FileItem }) => {
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<PreviewState>({ status: "loading" });

  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    void readLargeTextPreview(file.path).then((result) => {
      if (!current) return;
      setState(
        result.success ? { status: "ready", preview: result.preview } : { status: "error", message: result.error },
      );
    });
    return () => {
      current = false;
    };
  }, [file.path, retry]);

  if (state.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-ui-body text-muted-foreground" role="status">
        <span className="notification-spinner" aria-hidden="true" />
        Loading preview…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
        <div>
          <div className="text-ui-body font-bold text-foreground">Preview unavailable</div>
          <div className="mt-1 text-ui-meta">{state.message}</div>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setRetry((value) => value + 1)}>
            Retry
          </Button>
          <Button type="button" onClick={() => void openInDefaultApp(file.path)}>
            Open in default app
          </Button>
        </div>
      </div>
    );
  }

  const { preview } = state;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-[var(--selection-track)] px-4 py-2.5">
        <div>
          <div className="text-ui-body font-bold text-foreground">Large-file preview</div>
          <div className="text-ui-meta text-muted-foreground">
            {preview.truncated
              ? `Showing the beginning of the file (${formatBytes(preview.previewBytes)} of ${formatBytes(
                  preview.sizeBytes,
                )}).`
              : `Showing the complete file (${formatBytes(preview.sizeBytes)}).`}
            {preview.truncated ? " Content is truncated and read-only." : " Preview is read-only."}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void revealInSystemFileManager(file.path)}>
            Show in file manager
          </Button>
          <Button type="button" onClick={() => void openInDefaultApp(file.path)}>
            Open in default app
          </Button>
        </div>
      </div>
      <textarea
        aria-label={`Read-only preview of ${file.filename}`}
        className="min-h-0 flex-1 resize-none overflow-auto whitespace-pre bg-background p-4 font-mono text-sm text-foreground outline-none"
        readOnly
        spellCheck={false}
        value={preview.content}
        wrap="off"
      />
    </div>
  );
};
