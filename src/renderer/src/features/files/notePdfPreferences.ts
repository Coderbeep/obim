import {
  DEFAULT_NOTE_PDF_EXPORT_OPTIONS,
  normalizeNotePdfExportOptions,
  type NotePdfExportOptions,
} from "@shared/note-pdf-export";

const NOTE_PDF_PREFERENCES_KEY = "obim.note-pdf-export-options.v1";

export const readNotePdfExportOptions = (): NotePdfExportOptions => {
  try {
    const stored = window.localStorage.getItem(NOTE_PDF_PREFERENCES_KEY);
    return stored ? normalizeNotePdfExportOptions(JSON.parse(stored)) : DEFAULT_NOTE_PDF_EXPORT_OPTIONS;
  } catch {
    return DEFAULT_NOTE_PDF_EXPORT_OPTIONS;
  }
};

export const writeNotePdfExportOptions = (options: NotePdfExportOptions) => {
  try {
    window.localStorage.setItem(NOTE_PDF_PREFERENCES_KEY, JSON.stringify(normalizeNotePdfExportOptions(options)));
  } catch {
    // Export remains available when private storage is unavailable.
  }
};
