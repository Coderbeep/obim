import { atom } from "jotai";

export enum NotificationLevel {
  INFO = "info",
  WARNING = "warning",
  ERROR = "error",
}

export interface Notification {
  action?: {
    label: string;
    onClick: () => void | Promise<void>;
  };
  busy?: boolean;
  id: string;
  level: NotificationLevel;
  title: string;
  message?: string;
  path?: string;
  timestamp: number;
  timeout?: number;
}

export type UiNotification = Notification & {
  entering?: boolean;
  closing?: boolean;
};

export const notificationsAtom = atom<UiNotification[]>([]);

export const addNotificationAtom = atom(null, (get, set, notification: Notification) => {
  set(notificationsAtom, [...get(notificationsAtom), { ...notification, entering: true }]);
});

export const updateNotificationAtom = atom(null, (_, set, updater: (n: UiNotification[]) => UiNotification[]) => {
  set(notificationsAtom, updater);
});
