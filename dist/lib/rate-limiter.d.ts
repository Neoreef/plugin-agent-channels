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
export declare function availableSlots(): number;
export declare function recordSlotUsage(): void;
export declare function acquireSlot(maxWaitMs?: number): Promise<boolean>;
export declare function recordLockout(lockMs?: number): void;
export declare function isLockedOut(): boolean;
export declare function curveWaitMs(): number;
export declare function stats(): {
    used: number;
    available: number;
    lockedUntil: number;
    slotIndex: number;
    curveWait: number;
};
//# sourceMappingURL=rate-limiter.d.ts.map