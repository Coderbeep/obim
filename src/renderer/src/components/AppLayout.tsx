import { ComponentProps, forwardRef, useState } from "react";
import { Resizer } from "./Resizer";

export const RootLayout = ({
  children,
  className,
  ...props
}: ComponentProps<"main">) => {
  return (
    <main className={`root-layout ${className}`} {...props}>
      {children}
    </main>
  );
};

export const Sidebar = ({
  className,
  children,
  ...props
}: ComponentProps<"div">) => {
  const [width, setWidth] = useState(300);

  return (
    <div
      className={`sidebar ${className}`}
      style={{ width: `${width}px` }}
      {...props}
    >
      <div style={{ width: "100%", overflow: "hidden" }}>{children}</div>
      <Resizer width={width} setWidth={setWidth} />
    </div>
  );
};

export const Content = forwardRef<HTMLDivElement, ComponentProps<"div">>(
  ({ children, className, ...props }, ref) => (
    <div
      ref={ref}
      className={`content ${className}`}
      style={{ overflow: "auto" }}
      {...props}
    >
      {children}
    </div>
  ),
);

Content.displayName = "Content";
