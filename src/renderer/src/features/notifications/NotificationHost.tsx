import { IconCiFailedOctagon, IconCiWarning, IconInfo, IconX } from "@pierre/icons";
import { useCallback, useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";

import { NotificationLevel, type Notification } from "./notifications";
import { motionDurationMs } from "@renderer/shared/motion";
import { cn } from "@renderer/shared/classNames";
import { notificationsAtom, updateNotificationAtom } from "@renderer/store/NotificationsStore";

const notificationTimeout = (level: NotificationLevel) =>
  level === NotificationLevel.INFO ? 3000 : level === NotificationLevel.WARNING ? 6000 : 0;

export function NotificationCard({
  action,
  busy,
  className,
  level,
  message,
  onDismiss,
  onPause,
  onResume,
  path,
  title,
}: Pick<Notification, "action" | "busy" | "level" | "message" | "path" | "title"> & {
  className?: string;
  onDismiss: () => void;
  onPause?: () => void;
  onResume?: () => void;
}) {
  const StatusIcon =
    level === NotificationLevel.ERROR
      ? IconCiFailedOctagon
      : level === NotificationLevel.WARNING
        ? IconCiWarning
        : IconInfo;

  return (
    <div
      className={cn("notification", `notification-${level}`, className)}
      role={level === NotificationLevel.ERROR ? "alert" : "status"}
      aria-atomic="true"
      onMouseEnter={onPause}
      onMouseLeave={onResume}
      onFocusCapture={onPause}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onResume?.();
      }}
    >
      <div className="notification-status-icon" aria-hidden="true">
        {busy ? <span className="notification-spinner" /> : <StatusIcon />}
      </div>
      <div className="notification-copy">
        <div className="notification-title">{title}</div>
        {path ? (
          <div className="notification-path">
            <span className="notification-path-label">File</span>
            <code>{path}</code>
          </div>
        ) : null}
        {message ? <div className="notification-body">{message}</div> : null}
        {action ? (
          <button
            type="button"
            className="notification-action"
            onClick={() => void Promise.resolve(action.onClick()).finally(onDismiss)}
          >
            {action.label}
          </button>
        ) : null}
      </div>
      <button type="button" className="notification-close" aria-label={`Dismiss ${title}`} onClick={onDismiss}>
        <IconX />
      </button>
    </div>
  );
}

export function NotificationHost() {
  const notifications = useAtomValue(notificationsAtom);
  const updateNotifications = useSetAtom(updateNotificationAtom);
  const initialized = useRef(new Set<string>());
  const timers = useRef(new Map<string, number>());
  const frames = useRef(new Map<string, number>());

  const startClose = useCallback(
    (id: string) => {
      updateNotifications((current) => current.map((item) => (item.id === id ? { ...item, closing: true } : item)));
      window.setTimeout(() => {
        updateNotifications((current) => current.filter((item) => item.id !== id));
      }, motionDurationMs("fade-out"));
    },
    [updateNotifications],
  );

  useEffect(() => {
    const activeIds = new Set(notifications.map(({ id }) => id));
    initialized.current.forEach((id) => {
      if (!activeIds.has(id)) initialized.current.delete(id);
    });

    notifications.forEach((notification) => {
      if (initialized.current.has(notification.id)) return;
      initialized.current.add(notification.id);

      frames.current.set(
        notification.id,
        requestAnimationFrame(() => {
          frames.current.delete(notification.id);
          updateNotifications((current) =>
            current.map((item) => (item.id === notification.id ? { ...item, entering: false } : item)),
          );
        }),
      );

      const timeout = notification.timeout ?? notificationTimeout(notification.level);
      if (timeout > 0) {
        timers.current.set(
          notification.id,
          window.setTimeout(() => {
            timers.current.delete(notification.id);
            startClose(notification.id);
          }, timeout),
        );
      }
    });
  }, [notifications, startClose, updateNotifications]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      frames.current.forEach(cancelAnimationFrame);
      timers.current.clear();
      frames.current.clear();
    },
    [],
  );

  const closeNow = (id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.current.delete(id);
    updateNotifications((current) => current.filter((notification) => notification.id !== id));
  };

  const pauseTimer = (id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.current.delete(id);
  };

  const resumeTimer = (notification: Notification) => {
    if (timers.current.has(notification.id)) return;
    const timeout = notification.timeout ?? notificationTimeout(notification.level);
    if (timeout <= 0) return;
    timers.current.set(
      notification.id,
      window.setTimeout(() => {
        timers.current.delete(notification.id);
        startClose(notification.id);
      }, timeout),
    );
  };

  return (
    <div className="notification-container">
      {notifications.map((notification) => (
        <NotificationCard
          key={notification.id}
          {...notification}
          className={cn(notification.entering && "notification-enter", notification.closing && "notification-closing")}
          onDismiss={() => closeNow(notification.id)}
          onPause={() => pauseTimer(notification.id)}
          onResume={() => resumeTimer(notification)}
        />
      ))}
    </div>
  );
}
