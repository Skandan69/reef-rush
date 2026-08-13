/**
 * Raid rules — the part that must not live in the browser.
 *
 * Every number a raid produces is decided here, on the server, from facts the
 * server already holds: how long the raid actually ran on our clock, what the
 * defender's tank was worth when we handed it out, and what is in their vault
 * at the moment we settle. The client reports what it did; it never reports
 * what it earned.
 *
 * Plain JS on purpose, like logic.js: these are the rules worth testing
 * directly, without a build step between the test and the thing being tested.
 *
 * On trust. This does not yet re-simulate a raid. It bounds one: a report that
 * is physically impossible is refused, and everything that survives is settled
 * from server-side numbers. That closes the "claim any loot you like" hole,
 * which is the one that actually moves currency between accounts. It does not
 * close "play unrealistically well" — for that the input log is captured from
 * the first raid onward, so a replay checker can be added later and run over
 * raids that have already happened.
 */

/** A raid may not be reported as shorter than this: nothing can be done faster. */
export const MIN_RAID_MS = 4_000;
/** Or longer. The client is given a countdown well inside this. */
export const MAX_RAID_MS = 4 * 60 * 1000;
/** How long a handed-out target stays claimable before it goes stale. */
export const RAID_TTL_MS = 6 * 60 * 1000;
/** A defender is safe for this long after being beaten. */
export const SHIELD_MS = 8 * 60 * 60 * 1000;
/** An attacker waits this long between raids. */
export const RAID_COOLDOWN_MS = 60 * 1000;
/** And may not return to the same tank inside this. */
export const REVENGE_LOCK_MS = 12 * 60 * 60 * 1000;
/** No raid may take more than this share of a vault, however total the win. */
export const MAX_LOOT_SHARE = 0.2;
/** Nor more than this in absolute pearls, so a whale is not a jackpot. */
export const MAX_LOOT_ABS = 5_000;
/** Bound on the stored input log, in characters. */
export const MAX_LOG_CHARS = 64_000;

/**
 * Stars, from how much of the tank was actually taken down.
 * Three stars means the tank was cleared, not nearly cleared.
 */
export function starsFor(damagePct) {
  if (!Number.isFinite(damagePct)) return 0;
  if (damagePct >= 100) return 3;
  if (damagePct >= 60) return 2;
  if (damagePct >= 30) return 1;
  return 0;
}

/**
 * Loot, from damage done against what the defender actually holds.
 *
 * Linear in damage rather than stepped, so a raid that fails at 58% is worth
 * nearly what one that scrapes 60% is worth: the cliff at a star boundary is
 * what pushes people to farm easy targets over and over.
 */
export function lootFor(damagePct, vaultPearls) {
  const d = clamp(Number(damagePct) || 0, 0, 100) / 100;
  const vault = Math.max(0, Math.floor(Number(vaultPearls) || 0));
  if (vault <= 0 || d <= 0) return 0;
  const share = Math.floor(vault * MAX_LOOT_SHARE * d);
  return Math.max(0, Math.min(share, MAX_LOOT_ABS, vault));
}

/**
 * Is this attacker allowed to open a raid on this defender right now?
 * `now` is the server's clock, never the client's.
 */
export function canOpenRaid(now, opts) {
  const { attacker, defender, defenderShieldUntil = 0, lastRaidAt = 0, openRaid = null, lastHitDefenderAt = 0, defenderItems = 0 } = opts || {};
  if (!attacker || !defender) return deny("missing player");
  if (attacker === defender) return deny("cannot raid your own tank");
  if (openRaid) return deny("finish your current raid first");
  if (now - lastRaidAt < RAID_COOLDOWN_MS) return deny("raiding too fast");
  if (defenderShieldUntil > now) return deny("that tank is shielded");
  if (now - lastHitDefenderAt < REVENGE_LOCK_MS) return deny("you raided that tank recently");
  if (defenderItems <= 0) return deny("that tank is empty");
  return { ok: true };
}

/**
 * Settle a reported raid.
 *
 * `report` is from the browser and is treated as a claim. `facts` is what the
 * server knows: when it handed the raid out, what the vault holds now, and
 * whether this raid is still open. Loot is computed here, from facts.
 */
export function settleRaid(now, raid, report, facts) {
  if (!raid) return deny("no such raid");
  if (raid.status !== "open") return deny("raid already settled");
  if (raid.attacker !== (report && report.pid)) return deny("not your raid");
  if (now > raid.started + RAID_TTL_MS) return deny("raid expired");

  const elapsed = now - raid.started;
  if (elapsed < MIN_RAID_MS) return deny("raid too short");
  if (elapsed > MAX_RAID_MS) return deny("raid too long");

  /* The client's own duration must agree with our clock. It is allowed to be
     under, since a slow network delays the report, but never over: claiming
     more time than elapsed is how you claim damage you had no time to do. */
  const claimed = Number(report.durationMs);
  if (!Number.isFinite(claimed) || claimed < 0) return deny("bad duration");
  if (claimed > elapsed + 2_000) return deny("duration exceeds elapsed time");

  const damage = clamp(Math.round(Number(report.damagePct) || 0), 0, 100);

  /* Damage has to have been physically reachable in the time taken. The rate
     is generous — this is a bound, not a simulation — but it makes a 4-second
     total clear impossible, which is the cheapest cheat there is. */
  const maxDamage = (claimed / 1000) * MAX_DAMAGE_PER_SEC;
  if (damage > maxDamage + 1) return deny("damage impossible in that time");

  const stars = starsFor(damage);
  const loot = lootFor(damage, facts && facts.vaultPearls);

  return {
    ok: true,
    stars,
    damagePct: damage,
    loot,
    /* A beaten defender is shielded; one who held is not, or a failed raid
       would be a free way to protect a friend. */
    shieldUntil: stars > 0 ? now + SHIELD_MS : 0,
    elapsed,
  };
}

/** Generous ceiling on how fast a tank can come apart, in percent per second. */
export const MAX_DAMAGE_PER_SEC = 12;

/** Trim a client log to something safe to store, keeping the head. */
export function boundLog(log) {
  if (typeof log !== "string") return "";
  return log.length > MAX_LOG_CHARS ? log.slice(0, MAX_LOG_CHARS) : log;
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function deny(reason) {
  return { ok: false, reason };
}
