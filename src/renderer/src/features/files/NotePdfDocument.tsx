import { useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from "react";

import type { NotePdfExportPayload } from "@shared/note-pdf-export";
import { renderNotePdfMarkdown } from "./notePdfMarkdown";
import "./NotePdfDocument.css";

const waitForImages = async () => {
  const images = Array.from(document.images);
  await Promise.all(
    images.map(
      (image) =>
        image.complete ||
        new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );
};

export const NotePdfDocument = ({ token }: { token: string }) => {
  const [payload, setPayload] = useState<NotePdfExportPayload | null>(null);
  const html = useMemo(() => (payload ? renderNotePdfMarkdown(payload.source) : ""), [payload]);

  useLayoutEffect(() => {
    if (!payload || payload.options.theme === "current") return;
    document.documentElement.classList.toggle("dark", payload.options.theme === "dark");
  }, [payload]);

  useEffect(() => {
    let cancelled = false;
    void window.api
      .getNotePdfExportPayload(token)
      .then((value) => {
        if (!cancelled) setPayload(value);
      })
      .catch((error) => {
        document.documentElement.dataset.notePdfExportError =
          error instanceof Error ? error.message : "Could not load the note for export.";
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!payload) return;
    document.title = payload.title;
    let cancelled = false;
    const markReady = async () => {
      await document.fonts.ready;
      await waitForImages();
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      if (!cancelled) document.documentElement.dataset.notePdfExportReady = "true";
    };
    void markReady();
    return () => {
      cancelled = true;
    };
  }, [html, payload]);

  if (!payload) return <p className="note-pdf-loading">Preparing note…</p>;

  const { options } = payload;
  const pageSize = options.pageSize === "letter" ? "Letter" : "A4";
  const pageRule = `@page { size: ${pageSize} ${options.orientation}; margin: ${options.marginMm}mm; background: var(--surface-1); }`;
  const style = {
    "--note-pdf-column-count": options.columns,
    "--note-pdf-column-gap": `${options.columnGapMm}mm`,
    "--note-pdf-font-size": `${14 * (options.scalePercent / 100)}px`,
    "--note-pdf-page-margin": `${options.marginMm}mm`,
  } as CSSProperties;

  return (
    <>
      <style>{pageRule}</style>
      <article className="note-pdf-document" style={style}>
        <span className="note-pdf-page-background" aria-hidden="true" />
        <div className="note-pdf-scaled-content">
          {options.includeTitle ? <h1 className="note-pdf-title">{payload.title}</h1> : null}
          <div className="note-pdf-columns" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </article>
    </>
  );
};
