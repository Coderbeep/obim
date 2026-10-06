import * as React from "react";
import { DayPicker } from "react-day-picker";
import { IconChevronSm } from "@pierre/icons";
import "react-day-picker/style.css";
import "./calendar.css";
import { cn } from "../classNames";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  components,
  showOutsideDays = true,
  weekStartsOn = 1,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      weekStartsOn={weekStartsOn}
      className={cn("task-calendar", className)}
      classNames={classNames}
      {...props}
      components={{
        Chevron: ({ ...props }) =>
          props.orientation === "left" ? (
            <IconChevronSm {...props} className="h-4 w-4 -rotate-270" />
          ) : (
            <IconChevronSm {...props} className="h-4 w-4 -rotate-90" />
          ),
        ...components,
      }}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
