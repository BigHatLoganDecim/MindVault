/**
 * Запланированные уведомления: на нативной сборке — Capacitor
 * LocalNotifications, в браузере — fallback (проверка при открытии +
 * Notification API, как в v0.1). PoC из Этапа 1 плана.
 */
import { Capacitor } from '@capacitor/core';

export async function scheduleNotification(
  at: number,
  title: string,
  body: string,
): Promise<number | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') return null;
    const id = Math.floor(Math.random() * 2 ** 31);
    await LocalNotifications.schedule({
      notifications: [{ id, title, body, schedule: { at: new Date(at) } }],
    });
    return id;
  } catch {
    return null;
  }
}

export async function cancelNotification(id: number): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.cancel({ notifications: [{ id }] });
  } catch {
    /* не критично */
  }
}

/** Браузерный fallback: показать системное уведомление сейчас, если можно. */
export function notifyNow(title: string, body: string): void {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon: 'icon-192.png' });
    } catch {
      /* WebView без Notification — баннер в UI остаётся основным каналом */
    }
  }
}
