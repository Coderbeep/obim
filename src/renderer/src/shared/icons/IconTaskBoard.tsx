import type { CustomIconProps } from "./types";

export const IconTaskBoard = ({ size = 16, ...props }: CustomIconProps) => (
  <svg
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
    <rect x="1.5" y="2" width="3" height="12" rx="1.25" />
    <rect x="6.5" y="2" width="3" height="8.5" rx="1.25" />
    <rect x="11.5" y="2" width="3" height="5" rx="1.25" />
  </svg>
);
