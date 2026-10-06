/**
 * Let Chromium deliver a drop that the app will consume as cancellation.
 * A native `none` effect delays dragend during the OS rejection animation,
 * leaving our custom preview visible after the mouse has been released.
 */

const PERMITTED_DROP_EFFECT: Partial<Record<DataTransfer["effectAllowed"], DataTransfer["dropEffect"]>> = {
  copy: "copy",
  copyLink: "copy",
  link: "link",
  none: "none",
}; // Everything not listed permits move

export const allowNativeDropCancellation = (transfer: DataTransfer | null) => {
  if (!transfer) return;
  transfer.dropEffect = PERMITTED_DROP_EFFECT[transfer.effectAllowed] ?? "move";
};