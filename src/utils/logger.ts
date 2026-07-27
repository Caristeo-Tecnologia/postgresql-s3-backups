import { getEnvironment } from './environment';

interface PendingEntry {
  timer: NodeJS.Timeout;
  count: number;
  lastMessage: string;
}

const THROTTLE_DELAY_MS = 1000;
const pendingLogs = new Map<string, PendingEntry>();

const emit = (key: string, entry: PendingEntry) => {
  pendingLogs.delete(key);
  console.log(entry.count > 1 ? `${entry.lastMessage} (x${entry.count})` : entry.lastMessage);
};

/**
 * Logs repetitive messages (e.g. "Skipped ..." / "Starting download ...") without
 * flooding the console/cloud logs. When MINIMIZE_LOGS=true, calls sharing the same
 * `key` are collapsed and only printed once `THROTTLE_DELAY_MS` passes without a
 * new call for that key, showing how many were suppressed.
 */
export const throttledLog = (key: string, message: string): void => {
  if (!getEnvironment().minimizeLogs) {
    console.log(message);
    return;
  }

  const existing = pendingLogs.get(key);
  const entry: PendingEntry = existing ?? { timer: null as unknown as NodeJS.Timeout, count: 0, lastMessage: message };

  if (existing) {
    clearTimeout(existing.timer);
  }

  entry.count += 1;
  entry.lastMessage = message;
  entry.timer = setTimeout(() => emit(key, entry), THROTTLE_DELAY_MS);
  pendingLogs.set(key, entry);
};

/** Immediately flushes any pending throttled logs, preserving log ordering around other output. */
export const flushThrottledLogs = (): void => {
  for (const [key, entry] of pendingLogs) {
    clearTimeout(entry.timer);
    emit(key, entry);
  }
};
