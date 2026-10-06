export type NotePdfPageSize = "a4" | "letter";
export type NotePdfOrientation = "portrait" | "landscape";
export type NotePdfColumnCount = 1 | 2 | 3;
export type NotePdfTheme = "current" | "light" | "dark";

export interface NotePdfExportOptions {
  pageSize: NotePdfPageSize;
  orientation: NotePdfOrientation;
  columns: NotePdfColumnCount;
  columnGapMm: number;
  marginMm: number;
  scalePercent: number;
  theme: NotePdfTheme;
  includeTitle: boolean;
}

export interface NotePdfExportRequest {
  title: string;
  source: string;
  options: NotePdfExportOptions;
}

export interface NotePdfExportPayload extends NotePdfExportRequest {
  token: string;
}

export const DEFAULT_NOTE_PDF_EXPORT_OPTIONS: NotePdfExportOptions = {
  pageSize: "a4",
  orientation: "portrait",
  columns: 1,
  columnGapMm: 10,
  marginMm: 15,
  scalePercent: 100,
  theme: "current",
  includeTitle: true,
};

const finiteNumber = (value: unknown, minimum: number, maximum: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;

export const normalizeNotePdfExportOptions = (value: unknown): NotePdfExportOptions => {
  const options = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const candidate = options as Partial<Record<keyof NotePdfExportOptions, unknown>>;
  const legacyFontSizePx = (options as Record<string, unknown>).fontSizePx;
  const scalePercent =
    typeof candidate.scalePercent === "number"
      ? candidate.scalePercent
      : typeof legacyFontSizePx === "number"
        ? (legacyFontSizePx / 14) * 100
        : DEFAULT_NOTE_PDF_EXPORT_OPTIONS.scalePercent;
  return {
    pageSize: candidate.pageSize === "letter" ? "letter" : "a4",
    orientation: candidate.orientation === "landscape" ? "landscape" : "portrait",
    columns: candidate.columns === 2 || candidate.columns === 3 ? candidate.columns : 1,
    columnGapMm: finiteNumber(candidate.columnGapMm, 4, 30, DEFAULT_NOTE_PDF_EXPORT_OPTIONS.columnGapMm),
    marginMm: finiteNumber(candidate.marginMm, 5, 35, DEFAULT_NOTE_PDF_EXPORT_OPTIONS.marginMm),
    scalePercent: finiteNumber(scalePercent, 50, 150, DEFAULT_NOTE_PDF_EXPORT_OPTIONS.scalePercent),
    theme: candidate.theme === "light" || candidate.theme === "dark" ? candidate.theme : "current",
    includeTitle:
      typeof candidate.includeTitle === "boolean"
        ? candidate.includeTitle
        : DEFAULT_NOTE_PDF_EXPORT_OPTIONS.includeTitle,
  };
};
