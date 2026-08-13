/**
 * Types for raidrules.js.
 *
 * Same arrangement as logic.d.ts: the rules stay plain JS so they can be run
 * and tested directly with no build step between the test and the code, and
 * this file is what the TypeScript side type-checks against.
 */

export const MIN_RAID_MS: number;
export const MAX_RAID_MS: number;
export const RAID_TTL_MS: number;
export const SHIELD_MS: number;
export const RAID_COOLDOWN_MS: number;
export const REVENGE_LOCK_MS: number;
export const MAX_LOOT_SHARE: number;
export const MAX_LOOT_ABS: number;
export const MAX_LOG_CHARS: number;
export const MAX_DAMAGE_PER_SEC: number;

/** Stars from damage: 30% earns one, 60% two, a full clear three. */
export function starsFor(damagePct: number): number;

/** Loot from damage against what the defender actually holds, share- and abs-capped. */
export function lootFor(damagePct: number, vaultPearls: number): number;

export interface OpenRaidOpts {
  attacker: string;
  defender: string;
  defenderShieldUntil?: number;
  lastRaidAt?: number;
  openRaid?: unknown;
  lastHitDefenderAt?: number;
  defenderItems?: number;
}

export type Verdict = { ok: true } | { ok: false; reason: string };

/** Whether this attacker may open a raid on this defender at `now`. */
export function canOpenRaid(now: number, opts: OpenRaidOpts): Verdict;

export interface RaidRow {
  id: string;
  attacker: string;
  defender: string;
  seed: number;
  started: number;
  status: string;
}

export interface RaidReport {
  pid: string;
  durationMs: unknown;
  damagePct: unknown;
}

export type Settlement =
  | { ok: false; reason: string }
  | {
      ok: true;
      stars: number;
      damagePct: number;
      loot: number;
      shieldUntil: number;
      elapsed: number;
    };

/** Decide what a reported raid was worth, from server-side facts only. */
export function settleRaid(
  now: number,
  raid: RaidRow | null,
  report: RaidReport,
  facts: { vaultPearls: number },
): Settlement;

/** Trim a client-supplied log to a size safe to store. */
export function boundLog(log: unknown): string;
