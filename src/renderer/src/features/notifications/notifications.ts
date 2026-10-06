import { NotificationLevel } from "@renderer/store/NotificationsStore";

export { NotificationLevel } from "@renderer/store/NotificationsStore";
export type { Notification } from "@renderer/store/NotificationsStore";

export const Notifications = {
  FILE_NOT_FOUND: (path: string) => ({
    level: NotificationLevel.WARNING,
    title: "File not found",
    message: `No note exists at "${path}"`,
  }),
  FILE_ALREADY_EXISTS: (path: string) => ({
    level: NotificationLevel.WARNING,
    title: "File already exists",
    message: `A note already exists at "${path}"`,
  }),
  FILES_IMPORTED: (count: number) => ({
    level: NotificationLevel.INFO,
    title: count === 1 ? "Imported 1 item" : `Imported ${count} items`,
  }),
  FILES_IMPORTING: (count: number, destination: string) => ({
    busy: true,
    level: NotificationLevel.INFO,
    title: count === 1 ? "Importing 1 item…" : `Importing ${count} items…`,
    message: `Destination: ${destination}`,
    timeout: 0,
  }),
  FILE_IMPORT_FAILED: (message: string) => ({
    level: NotificationLevel.ERROR,
    title: "File import failed",
    message,
  }),
  FILES_COPIED: (count: number) => ({
    level: NotificationLevel.INFO,
    title: count === 1 ? "Copied 1 item" : `Copied ${count} items`,
  }),
  FILES_PASTING: (count: number, destination: string) => ({
    busy: true,
    level: NotificationLevel.INFO,
    title: count === 1 ? "Pasting 1 item…" : `Pasting ${count} items…`,
    message: `Destination: ${destination}`,
    timeout: 0,
  }),
  FILE_COPY_FAILED: (message: string) => ({
    level: NotificationLevel.ERROR,
    title: "File copy failed",
    message,
  }),
  CLIPBOARD_WRITE_FAILED: {
    level: NotificationLevel.ERROR,
    title: "Clipboard unavailable",
    message: "The selected paths could not be written to the system clipboard.",
  },
  CLIPBOARD_READ_FAILED: {
    level: NotificationLevel.ERROR,
    title: "Clipboard unavailable",
    message: "The clipboard contents could not be read.",
  },
  NOTHING_TO_PASTE: {
    level: NotificationLevel.WARNING,
    title: "Nothing to paste",
    message: "The clipboard does not contain files or a supported image.",
  },
  FILE_MOVE_FAILED: (moved: number, failed: number, message?: string) => ({
    level: NotificationLevel.ERROR,
    title: failed === 1 ? "Could not move 1 item" : `Could not move ${failed} items`,
    message: `${moved ? `${moved} moved successfully. ` : ""}${message ?? "The workspace was refreshed."}`,
  }),
} as const;
