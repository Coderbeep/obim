import type { ComponentType, SVGProps } from "react";

export type IconComponent = ComponentType<{ size?: number; className?: string }>;
export type CustomIconProps = SVGProps<SVGSVGElement> & { size?: number | string };
