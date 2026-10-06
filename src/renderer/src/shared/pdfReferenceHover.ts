export const PDF_REFERENCE_HOVER_EVENT = "obim:pdf-reference-hover";

export interface PdfReferenceHover {
  owner: string;
  notePath: string;
  destination: string | null;
}

export const dispatchPdfReferenceHover = (detail: PdfReferenceHover) => {
  window.dispatchEvent(new CustomEvent<PdfReferenceHover>(PDF_REFERENCE_HOVER_EVENT, { detail }));
};
