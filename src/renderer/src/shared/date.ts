const parseDateOnly = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const [year, month, day] = [yearText, monthText, dayText].map(Number);
  if (!year) return null;

  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
};

export const toDateInputValue = (date: Date) => {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const parseDueDate = (value?: string) => {
  if (!value) return undefined;
  return parseDateOnly(value) ?? undefined;
};

export const formatDueDate = (value?: string) => {
  if (!value) return "";
  const date = parseDueDate(value);
  if (!date) return value;

  const [year, month, day] = toDateInputValue(date).split("-");
  return `${day}-${month}-${year}`;
};

export const formatDueDateRange = (start?: string, end?: string) => {
  const startLabel = formatDueDate(start);
  const endLabel = formatDueDate(end);
  if (!startLabel) return endLabel;
  if (!endLabel || start === end) return startLabel;
  return `${startLabel} – ${endLabel}`;
};

/** Translate a complete display date while preserving incomplete/invalid input for editing. */
export const dateInputToStorage = (value: string) => {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (!match) return value;
  const [, day, month, year] = match;
  const canonical = `${year}-${month}-${day}`;
  return parseDueDate(canonical) ? canonical : value;
};

/** Add day/month separators while keeping the caret next to the digit being edited. */
export const assistDateInput = (value: string, caret = value.length, deleting = false) => {
  if (deleting) return { value, caret };
  if (parseDueDate(value)) {
    const displayed = formatDueDate(value);
    return { value: displayed, caret: displayed.length };
  }
  const digits = value.replace(/\D/g, "").slice(0, 8);
  const beforeCaret = Math.min(value.slice(0, caret).replace(/\D/g, "").length, digits.length);
  let displayed = "";
  let nextCaret = 0;
  for (let index = 0; index < digits.length; index++) {
    displayed += digits[index];
    if (index === 1 || index === 3) displayed += "-";
    if (index < beforeCaret) nextCaret = displayed.length;
  }
  return { value: displayed, caret: nextCaret };
};
