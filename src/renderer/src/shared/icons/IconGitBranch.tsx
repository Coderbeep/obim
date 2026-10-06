import { IconBranch } from "@pierre/icons";
import type { ComponentProps } from "react";

/** The existing branch glyph, rotated into the conventional vertical orientation. */
export const IconGitBranch = ({ style, ...props }: ComponentProps<typeof IconBranch>) => (
  <IconBranch
    {...props}
    style={{
      ...style,
      transform: "rotate(-90deg)",
      transformOrigin: "center",
    }}
  />
);
