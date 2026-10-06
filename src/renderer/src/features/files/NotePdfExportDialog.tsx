import { IconDesktop, IconFileExport, IconMoon, IconSun } from "@pierre/icons";
import { useAtom, useSetAtom, useStore } from "jotai";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { Button } from "@renderer/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/shared/ui/dialog";
import { Switch } from "@renderer/shared/ui/switch";
import { fileBuffersByPathAtom } from "@renderer/store/fileBufferStore";
import { addNotificationAtom, NotificationLevel } from "@renderer/store/NotificationsStore";
import { notePdfExportRequestAtom } from "@renderer/store/notePdfExportStore";
import { getFilenameNoExtFromPath } from "@shared/pathUtils";
import type { NotePdfColumnCount, NotePdfExportOptions } from "@shared/note-pdf-export";

import { readNotePdfExportOptions, writeNotePdfExportOptions } from "./notePdfPreferences";
import { renderNotePdfMarkdown } from "./notePdfMarkdown";
import { readFile } from "./workspaceFileService";
import "./NotePdfExportDialog.css";

const numberValue = (value: string, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const ExportChoice = ({
  children,
  disabled,
  selected,
  onSelect,
}: {
  children: ReactNode;
  disabled?: boolean;
  selected: boolean;
  onSelect(): void;
}) => (
  <button
    type="button"
    role="radio"
    aria-checked={selected}
    tabIndex={selected ? 0 : -1}
    data-selected={selected ? "true" : undefined}
    disabled={disabled}
    onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      const choices = Array.from(
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button[role="radio"]:not(:disabled)') ??
          [],
      );
      if (!choices.length) return;
      const index = choices.indexOf(event.currentTarget);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? choices.length - 1
            : (index + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) + choices.length) % choices.length;
      event.preventDefault();
      choices[next].focus();
      choices[next].click();
    }}
    onClick={onSelect}
  >
    {children}
  </button>
);

const ExportGroup = ({ children, title }: { children: ReactNode; title: string }) => (
  <section className="note-pdf-export-group">
    <h3>{title}</h3>
    <div>{children}</div>
  </section>
);

const ExportRow = ({
  children,
  description,
  label,
}: {
  children: ReactNode;
  description: string;
  label: string;
}) => (
  <div className="note-pdf-export-row">
    <div className="note-pdf-export-row-copy">
      <strong>{label}</strong>
      <span>{description}</span>
    </div>
    <div className="note-pdf-export-row-control">{children}</div>
  </div>
);

export const NotePdfExportDialog = () => {
  const store = useStore();
  const [request, setRequest] = useAtom(notePdfExportRequestAtom);
  const notify = useSetAtom(addNotificationAtom);
  const [options, setOptions] = useState<NotePdfExportOptions>(readNotePdfExportOptions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewSource, setPreviewSource] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => writeNotePdfExportOptions(options), [options]);

  useEffect(() => {
    let cancelled = false;
    if (!request) {
      setPreviewSource("");
      setPreviewLoading(false);
      return;
    }
    const buffered = store.get(fileBuffersByPathAtom)[request.path]?.editorText;
    if (buffered !== undefined) {
      setPreviewSource(buffered);
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    void readFile(request.path).then((result) => {
      if (cancelled) return;
      setPreviewSource(result.success ? result.content : "");
      setPreviewLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [request, store]);

  const close = () => {
    if (busy) return;
    setRequest(null);
    setError(null);
  };

  const update = <K extends keyof NotePdfExportOptions>(key: K, value: NotePdfExportOptions[K]) =>
    setOptions((current) => ({ ...current, [key]: value }));
  const previewTheme =
    options.theme === "current"
      ? document.documentElement.classList.contains("dark")
        ? "dark"
        : "light"
      : options.theme;
  const previewHtml = useMemo(() => renderNotePdfMarkdown(previewSource), [previewSource]);
  const previewTitle = request ? getFilenameNoExtFromPath(request.path) : "Note";
  const portraitPage = options.pageSize === "letter" ? { width: 215.9, height: 279.4 } : { width: 210, height: 297 };
  const pageWidthMm = options.orientation === "landscape" ? portraitPage.height : portraitPage.width;
  const pageHeightMm = options.orientation === "landscape" ? portraitPage.width : portraitPage.height;
  const pageWidthPx = (pageWidthMm * 96) / 25.4;
  const pageHeightPx = (pageHeightMm * 96) / 25.4;
  const previewFitScale = Math.min(330 / pageWidthPx, 430 / pageHeightPx);
  const contentScale = options.scalePercent / 100;
  const previewFrameStyle = {
    width: `${pageWidthPx * previewFitScale}px`,
    height: `${pageHeightPx * previewFitScale}px`,
  } as CSSProperties;
  const previewDocumentStyle = {
    width: `${pageWidthMm}mm`,
    height: `${pageHeightMm}mm`,
    padding: `${options.marginMm}mm`,
    transform: `scale(${previewFitScale})`,
    "--note-pdf-column-count": options.columns,
    "--note-pdf-column-gap": `${options.columnGapMm}mm`,
    "--note-pdf-font-size": `${14 * contentScale}px`,
    "--note-pdf-preview-content-height": `${pageHeightMm - options.marginMm * 2}mm`,
  } as CSSProperties;

  const exportPdf = async () => {
    if (!request || busy) return;
    setBusy(true);
    setError(null);
    try {
      const buffered = store.get(fileBuffersByPathAtom)[request.path]?.editorText;
      const disk = buffered === undefined ? await readFile(request.path) : null;
      if (disk && !disk.success) throw new Error(disk.error);
      const title = getFilenameNoExtFromPath(request.path);
      const result = await window.api.exportNoteToPdf({
        title,
        source: buffered ?? (disk?.success ? disk.content : ""),
        options,
      });
      if (result.status === "cancelled") return;
      if (result.status === "error") throw new Error(result.error);
      notify({
        action: {
          label: "Open",
          onClick: async () => {
            try {
              const opened = await window.api.openExportedNotePdf(result.openToken);
              if (opened.success) return;
              notify({
                id: crypto.randomUUID(),
                level: NotificationLevel.ERROR,
                title: "Could not open PDF",
                message: opened.error,
                path: result.path,
                timestamp: Date.now(),
              });
            } catch (cause) {
              notify({
                id: crypto.randomUUID(),
                level: NotificationLevel.ERROR,
                title: "Could not open PDF",
                message: cause instanceof Error ? cause.message : String(cause),
                path: result.path,
                timestamp: Date.now(),
              });
            }
          },
        },
        id: crypto.randomUUID(),
        level: NotificationLevel.INFO,
        title: "PDF exported",
        path: result.path,
        timestamp: Date.now(),
        timeout: 0,
      });
      setRequest(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export the note.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => !open && close()}>
      <DialogContent className="note-pdf-export-dialog">
        <DialogHeader>
          <DialogTitle>Export note to PDF</DialogTitle>
          <DialogDescription>
            Preserve Obim’s note styling and choose how the content flows across each page.
          </DialogDescription>
        </DialogHeader>

        <div className="note-pdf-export-layout">
          <div className="note-pdf-export-controls">
            <ExportGroup title="Page layout">
              <ExportRow label="Page size" description="Choose the paper format used by the generated document.">
                <div className="note-pdf-choice-group" role="radiogroup" aria-label="PDF page size">
                  <ExportChoice disabled={busy} selected={options.pageSize === "a4"} onSelect={() => update("pageSize", "a4")}>
                    A4
                  </ExportChoice>
                  <ExportChoice disabled={busy} selected={options.pageSize === "letter"} onSelect={() => update("pageSize", "letter")}>
                    Letter
                  </ExportChoice>
                </div>
              </ExportRow>
              <ExportRow label="Orientation" description="Set the reading direction of each page.">
                <div className="note-pdf-choice-group" role="radiogroup" aria-label="PDF orientation">
                  <ExportChoice disabled={busy} selected={options.orientation === "portrait"} onSelect={() => update("orientation", "portrait")}>
                    Portrait
                  </ExportChoice>
                  <ExportChoice disabled={busy} selected={options.orientation === "landscape"} onSelect={() => update("orientation", "landscape")}>
                    Landscape
                  </ExportChoice>
                </div>
              </ExportRow>
              <ExportRow label="Columns" description="Flow the note through one, two, or three reading columns.">
                <div className="note-pdf-choice-group" role="radiogroup" aria-label="PDF columns">
                  {([1, 2, 3] as NotePdfColumnCount[]).map((columns) => (
                    <ExportChoice
                      key={columns}
                      disabled={busy}
                      selected={options.columns === columns}
                      onSelect={() => update("columns", columns)}
                    >
                      {columns}
                    </ExportChoice>
                  ))}
                </div>
              </ExportRow>
            </ExportGroup>

            <ExportGroup title="Appearance">
              <ExportRow label="Theme" description="Use the editor appearance or force a light or dark PDF.">
                <div className="note-pdf-choice-group" role="radiogroup" aria-label="PDF theme">
                  <ExportChoice disabled={busy} selected={options.theme === "current"} onSelect={() => update("theme", "current")}>
                    <IconDesktop size={14} aria-hidden="true" />
                    Editor
                  </ExportChoice>
                  <ExportChoice disabled={busy} selected={options.theme === "light"} onSelect={() => update("theme", "light")}>
                    <IconSun size={14} aria-hidden="true" />
                    Light
                  </ExportChoice>
                  <ExportChoice disabled={busy} selected={options.theme === "dark"} onSelect={() => update("theme", "dark")}>
                    <IconMoon size={14} aria-hidden="true" />
                    Dark
                  </ExportChoice>
                </div>
              </ExportRow>
              <ExportRow label="Scale" description="Fit more or less of the note on every page.">
                <div className="note-pdf-scale-control">
                  <input
                    id="note-pdf-scale"
                    aria-label="PDF content scale"
                    type="range"
                    min={50}
                    max={150}
                    step={5}
                    value={options.scalePercent}
                    disabled={busy}
                    onChange={(event) =>
                      update("scalePercent", numberValue(event.currentTarget.value, options.scalePercent))
                    }
                  />
                  <output htmlFor="note-pdf-scale">{Math.round(options.scalePercent)}%</output>
                  <button
                    type="button"
                    disabled={busy || options.scalePercent === 100}
                    onClick={() => update("scalePercent", 100)}
                  >
                    Reset
                  </button>
                </div>
              </ExportRow>
            </ExportGroup>

            <ExportGroup title="Spacing and content">
              <ExportRow label="Page margins" description="Keep content away from the outer edge of each page.">
                <span className="note-pdf-number-input">
                  <input
                    aria-label="PDF page margins"
                    type="number"
                    min={5}
                    max={35}
                    step={1}
                    value={options.marginMm}
                    disabled={busy}
                    onChange={(event) => update("marginMm", numberValue(event.currentTarget.value, options.marginMm))}
                  />
                  <small>mm</small>
                </span>
              </ExportRow>
              <ExportRow label="Column gap" description="Set the space between reading columns.">
                <span className="note-pdf-number-input">
                  <input
                    aria-label="PDF column gap"
                    type="number"
                    min={4}
                    max={30}
                    step={1}
                    value={options.columnGapMm}
                    disabled={busy || options.columns === 1}
                    onChange={(event) => update("columnGapMm", numberValue(event.currentTarget.value, options.columnGapMm))}
                  />
                  <small>mm</small>
                </span>
              </ExportRow>
              <ExportRow label="Note title" description="Add the filename as a title above the note body.">
                <div className="note-pdf-switch-control" data-checked={options.includeTitle}>
                  <strong aria-hidden="true">{options.includeTitle ? "On" : "Off"}</strong>
                  <Switch
                    aria-checked={options.includeTitle}
                    aria-label="Include note title"
                    disabled={busy}
                    onClick={() => update("includeTitle", !options.includeTitle)}
                  />
                </div>
              </ExportRow>
            </ExportGroup>
          </div>

          <section className="note-pdf-export-preview" aria-label="Interactive first page preview">
            <header>
              <strong>First page</strong>
              <span>Live preview</span>
            </header>
            <div
              className={`note-pdf-preview-theme note-pdf-preview-theme-${previewTheme}${previewTheme === "dark" ? " dark" : ""}`}
            >
              <div className="note-pdf-preview-frame" style={previewFrameStyle} aria-busy={previewLoading}>
                {previewLoading ? <span className="note-pdf-preview-loading">Preparing preview…</span> : null}
                <article className="note-pdf-document note-pdf-preview-document" style={previewDocumentStyle}>
                  <div className="note-pdf-scaled-content">
                    {options.includeTitle ? <h1 className="note-pdf-title">{previewTitle}</h1> : null}
                    <div className="note-pdf-columns" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                  </div>
                </article>
              </div>
            </div>
            <p>
              {Math.round(options.scalePercent)}% · {previewTheme === "dark" ? "Dark" : "Light"} · {options.columns}{" "}
              {options.columns === 1 ? "column" : "columns"}
            </p>
          </section>
        </div>

        {error ? (
          <p role="alert" className="note-pdf-export-error">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button type="button" disabled={!request || busy} onClick={() => void exportPdf()}>
            <IconFileExport size={14} aria-hidden="true" />
            {busy ? "Exporting…" : "Export PDF"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
