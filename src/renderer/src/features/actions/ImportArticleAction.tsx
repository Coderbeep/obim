import { IconPdfResearch } from "@renderer/shared/icons/IconPdfResearch";
import { IconFolder, IconSearch } from "@pierre/icons";
import { useSetAtom } from "jotai";
import { useRef, useState, type FormEvent } from "react";

import { getWorkspacePath } from "@renderer/config";
import { importExternalFiles } from "@renderer/features/files/workspaceFileService";
import { Button } from "@renderer/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@renderer/shared/ui/dialog";
import { Input } from "@renderer/shared/ui/input";
import { reloadRevisionAtom } from "@renderer/store/fileExplorerStore";
import { addNotificationAtom, NotificationLevel } from "@renderer/store/NotificationsStore";
import { normalizePdfArticleReference } from "@shared/pdf-article-import";

const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export const ImportArticleAction = ({ onClose }: { onClose: () => void }) => {
  const requestReload = useSetAtom(reloadRevisionAtom);
  const notify = useSetAtom(addNotificationAtom);
  const localPdfInputRef = useRef<HTMLInputElement>(null);
  const [referenceInput, setReferenceInput] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = importing;

  const importLocalPdfs = async (files: File[]) => {
    if (!files.length || busy) return;
    if (files.some((file) => !/\.pdf$/iu.test(file.name))) {
      setError("Choose PDF files to import.");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const result = await importExternalFiles(files, getWorkspacePath());
      if (result.importedPaths.length) {
        requestReload((revision) => revision + 1);
        notify({
          id: crypto.randomUUID(),
          level: NotificationLevel.INFO,
          title: "PDFs imported",
          message: `${result.importedPaths.length} PDF${result.importedPaths.length === 1 ? "" : "s"} added to this workspace.`,
          timestamp: Date.now(),
        });
      }
      if (result.errors.length) setError(result.errors.join("\n"));
      else onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setImporting(false);
    }
  };

  const downloadArticle = async () => {
    if (busy) return;
    const reference = normalizePdfArticleReference(referenceInput);
    if (!reference) {
      setError("Enter a valid DOI or arXiv link, such as https://arxiv.org/abs/1706.03762.");
      return;
    }
    if (typeof window.api.importPdfArticle !== "function") {
      setError("Article download is unavailable until Obim is restarted.");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const result = await window.api.importPdfArticle(reference.doi);
      if (!result.success) {
        if (result.landingPage) {
          const landingPage = result.landingPage;
          onClose();
          notify({
            id: crypto.randomUUID(),
            level: NotificationLevel.WARNING,
            title: "PDF unavailable",
            message: "Open the article page, download the PDF manually, then add it through Files.",
            timestamp: Date.now(),
            timeout: 0,
            action: {
              label: "Open article page",
              onClick: async () => {
                const opened = await window.api.openExternalLink(landingPage);
                if (!opened.success) {
                  notify({
                    id: crypto.randomUUID(),
                    level: NotificationLevel.ERROR,
                    title: "Could not open article page",
                    message: opened.error ?? "The article link could not be opened.",
                    timestamp: Date.now(),
                  });
                }
              },
            },
          });
          return;
        }
        setError(result.error);
        return;
      }
      requestReload((revision) => revision + 1);
      notify({
        id: crypto.randomUUID(),
        level: NotificationLevel.INFO,
        title: "PDF downloaded",
        message: `${result.file.filename} was added to this workspace.`,
        path: result.file.path,
        timestamp: Date.now(),
      });
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setImporting(false);
    }
  };

  const submitDownload = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void downloadArticle();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="w-[min(30rem,calc(100vw-2rem))] gap-3 p-4" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Import article</DialogTitle>
          <DialogDescription>Copy PDFs from your computer, or download one by DOI or arXiv link.</DialogDescription>
        </DialogHeader>

        <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
          <div className="flex items-start gap-2">
            <IconPdfResearch size={18} aria-hidden="true" className="mt-0.5 text-ui-control" />
            <div>
              <strong>From your computer</strong>
              <p className="text-ui-control">Choose PDF files to copy into this workspace.</p>
            </div>
          </div>
          <input
            ref={localPdfInputRef}
            type="file"
            accept=".pdf,application/pdf"
            multiple
            hidden
            aria-label="Choose PDF files"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              void importLocalPdfs(files);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => localPdfInputRef.current?.click()}
          >
            <IconFolder size={15} aria-hidden="true" /> Choose
          </Button>
        </div>

        <form className="space-y-2" onSubmit={submitDownload}>
          <label htmlFor="action-import-article-input" className="text-sm font-medium">
            DOI or arXiv
          </label>
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-md border border-border px-2 py-1.5">
              <IconSearch size={15} aria-hidden="true" className="text-ui-control" />
              <Input
                id="action-import-article-input"
                value={referenceInput}
                onChange={(event) => {
                  setReferenceInput(event.target.value);
                  setError(null);
                }}
                placeholder="10.1234/article-id or https://arxiv.org/abs/1706.03762"
                aria-label="DOI or arXiv article to download"
                disabled={busy}
                autoFocus
                className="border-0 p-0 shadow-none focus-visible:ring-0"
              />
            </div>
            <Button type="submit" size="sm" disabled={busy || !referenceInput.trim()}>
              {importing ? "Downloading…" : "Download PDF"}
            </Button>
          </div>
        </form>

        {error ? (
          <div role="alert" className="text-destructive text-sm">
            {error}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
