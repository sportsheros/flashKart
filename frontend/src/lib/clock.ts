// countdowns use server time, not device time. offset taken from fastest response
let offsetMs = 0;
let bestRttMs = Number.POSITIVE_INFINITY;

export function recordServerTime(serverTimeIso: string, sentAt: number, receivedAt: number): void {
  const rtt = receivedAt - sentAt;
  if (rtt >= bestRttMs) return;
  bestRttMs = rtt;
  // Server stamped the response roughly half a round trip before we received it
  offsetMs = Date.parse(serverTimeIso) + rtt / 2 - receivedAt;
}

export const serverNow = (): number => Date.now() + offsetMs;
