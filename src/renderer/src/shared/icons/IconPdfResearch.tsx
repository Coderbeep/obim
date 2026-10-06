import type { CustomIconProps } from "./types";

export const IconPdfResearch = ({ size = 16, ...props }: CustomIconProps) => (
  <svg
    data-icon="pdf-research"
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.25}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M13.5 12H4a1.5 1.5 0 0 0 0 3h9.5M2.5 13.5V3A1.5 1.5 0 0 1 4 1.5h9.5V12" />
    <path d="M8 1.5v6l1.5-1 1.5 1v-6" />
  </svg>
);
