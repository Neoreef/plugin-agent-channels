/**
 * Global Cliq API rate limiter.
 *
 * 40 slots per 60-second sliding window. Every API call costs 1 slot.
 * If no slot is available, the caller waits until one frees up.
 *
 * If a 429 is received despite our tracking, hard-pause all calls
 * for the lock period.
 *
 * Ported from ~/.claude-agent/src/rate-limiter.ts.
 */

const WINDOW_MS = 60_000;
const MAX_SLOTS = 40;
const POLL_INTERVAL_MS = 100;

const callLog: number[] = [];
let lockedUntil = 0;

function prune(): void {
  const cutoff = Date.now() - WINDOW_MS;
  while (callLog.length > 0 && callLog[0]! < cutoff) {
    callLog.shift();
  }
}

export function availableSlots(): number {
  prune();
  return Math.max(0, MAX_SLOTS - callLog.length);
}

function msUntilNextSlot(): number {
  prune();
  if (callLog.length < MAX_SLOTS) return 0;
  const oldest = callLog[0]!;
  return Math.max(0, oldest + WINDOW_MS - Date.now());
}

export function recordSlotUsage(): void {
  callLog.push(Date.now());
  slotCounter = (slotCounter % MAX_SLOTS) + 1;
}

export async function acquireSlot(maxWaitMs = 0): Promise<boolean> {
  const deadline = maxWaitMs > 0 ? Date.now() + maxWaitMs : Infinity;

  while (true) {
    if (lockedUntil > Date.now()) {
      const lockRemaining = lockedUntil - Date.now();
      if (Date.now() + lockRemaining > deadline) return false;
      await sleep(Math.min(lockRemaining, POLL_INTERVAL_MS));
      continue;
    }

    const wait = msUntilNextSlot();
    if (wait === 0) {
      callLog.push(Date.now());
      slotCounter = (slotCounter % MAX_SLOTS) + 1;
      return true;
    }

    if (Date.now() + wait > deadline) return false;
    await sleep(Math.min(wait + 10, POLL_INTERVAL_MS));
  }
}

export function recordLockout(lockMs = 10 * 60_000): void {
  lockedUntil = Date.now() + lockMs;
}

export function isLockedOut(): boolean {
  return lockedUntil > Date.now();
}

// ─── Pacing curve (damped cosine) ────────────────────────────────────────────

interface PacingConfig {
  T: number;
  N: number;
  M?: number;
  W?: number;
  B?: number;
}

function createPacingCalculator(config: PacingConfig) {
  const { T, N, M = -0.5, W = 6, B = 1 } = config;

  const getRawValue = (i: number): number => {
    const x = (W * i) / N;
    return B - Math.exp(M * x) * Math.cos(x);
  };

  let S = 0;
  for (let k = 1; k <= N; k++) {
    S += getRawValue(k);
  }

  return function getSlotDuration(slotNumber: number): number {
    if (slotNumber <= N) {
      return T * (getRawValue(slotNumber) / S);
    }
    return T / N;
  };
}

const pacingCalc = createPacingCalculator({
  T: WINDOW_MS / 1000,
  N: MAX_SLOTS,
});

export function curveWaitMs(): number {
  prune();
  const used = callLog.length;
  if (used === 0) return 0;
  if (used >= MAX_SLOTS) return msUntilNextSlot();
  const nextSlot = used + 1;
  return Math.max(0, Math.round(pacingCalc(nextSlot) * 1000));
}

let slotCounter = 0;

export function stats(): {
  used: number;
  available: number;
  lockedUntil: number;
  slotIndex: number;
  curveWait: number;
} {
  prune();
  return {
    used: callLog.length,
    available: MAX_SLOTS - callLog.length,
    lockedUntil,
    slotIndex: slotCounter,
    curveWait: curveWaitMs(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
