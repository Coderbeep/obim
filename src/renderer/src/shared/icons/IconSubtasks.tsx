import type { CustomIconProps } from "./types";

/** A parent above one indented child, distinct from the Git branch glyph. */
export const IconSubtasks = ({ size = 16, ...props }: CustomIconProps) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M3.5 5.25v4.25a2.5 2.5 0 0 0 2.5 2.5h3.75" />
    <circle cx={3.5} cy={3.5} r={1.75} />
    <circle cx={11.5} cy={12} r={1.75} />
  </svg>
);
