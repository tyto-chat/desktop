import { Notification } from "electron";
import type { BridgeNotification } from "../shared/bridge";

const live = new Map<string, Notification>();

export function showNativeNotification(
  notification: BridgeNotification,
  onClick: (payload: string) => void,
): void {
  if (!Notification.isSupported()) return;

  live.get(notification.tag)?.close();

  const native = new Notification({ title: notification.title, body: notification.body });
  const forget = () => {
    if (live.get(notification.tag) === native) live.delete(notification.tag);
  };
  native.on("click", () => {
    forget();
    onClick(notification.payload);
  });
  native.on("close", forget);

  live.set(notification.tag, native);
  native.show();
}
