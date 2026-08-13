/**
 * Raids: attacking another player's tank.
 *
 * The shape is Clash's, because it is the shape that works for a game people
 * play in different timezones: you attack a *stored snapshot* of someone's tank
 * while they are offline, and they see what happened when they come back. No
 * matchmaking, no waiting for a live opponent, and it reuses the tank layouts
 * this database already holds.
 *
 * Everything that decides an outcome lives in raidrules.js and runs here. The
 * browser reports what it did — how long it took, how much of the tank it took
 * down — and the server decides what that was worth. A client that lies about
 * its loot changes nothing, because its loot number is never read.
 *
 * The input log is stored from the first raid onward even though nothing reads
 * it yet. When a replay checker exists it can be run over raids that have
 * already been settled, which is not possible if the logs were never kept.
 */

import type { Env } from "./env";
import {
  canOpenRaid,
  settleRaid,
  boundLog,
  RAID_TTL_MS,
  MAX_LOOT_SHARE,
} from "./raidrules.js";

const MAX_NAME = 24;
/** Candidate pool for a target search. Small: this is a pick, not a ladder. */
const TARGET_POOL = 40;

let ready = false;

async function ensureSchema(db: D1Database): Promise<void> {
  if (ready) return;
  await db.batch([
    db.prepare(
      /* What a tank holds that can be taken, and how long it is safe for.
         Separate from the tank layout: a raid changes this and never the
         build, so losing a raid can never cost somebody their tank. */
      `CREATE TABLE IF NOT EXISTS vaults (
         pid TEXT PRIMARY KEY,
         pearls INTEGER NOT NULL DEFAULT 0,
         shield_until INTEGER NOT NULL DEFAULT 0,
         last_raid_at INTEGER NOT NULL DEFAULT 0,
         updated INTEGER NOT NULL
       )`,
    ),
    db.prepare(
      /* One row per raid, written when it is handed out and updated once when
         it settles. `status` is what makes a raid single-use. */
      `CREATE TABLE IF NOT EXISTS raids (
         id TEXT PRIMARY KEY,
         attacker TEXT NOT NULL,
         defender TEXT NOT NULL,
         seed INTEGER NOT NULL,
         started INTEGER NOT NULL,
         status TEXT NOT NULL DEFAULT 'open',
         stars INTEGER NOT NULL DEFAULT 0,
         damage INTEGER NOT NULL DEFAULT 0,
         loot INTEGER NOT NULL DEFAULT 0,
         ended INTEGER,
         log TEXT
       )`,
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS raids_attacker ON raids (attacker, started)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS raids_defender ON raids (defender, started)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS vaults_shield ON vaults (shield_until)`),
  ]);
  ready = true;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });

const clean = (s: unknown, max: number): string =>
  typeof s === "string" ? s.slice(0, max).replace(/[\x00-\x1f]/g, "").trim() : "";

interface VaultRow {
  pid: string;
  pearls: number;
  shield_until: number;
  last_raid_at: number;
}

async function vaultOf(db: D1Database, pid: string): Promise<VaultRow> {
  const row = await db
    .prepare(`SELECT pid, pearls, shield_until, last_raid_at FROM vaults WHERE pid = ?1`)
    .bind(pid)
    .first<VaultRow>();
  return row ?? { pid, pearls: 0, shield_until: 0, last_raid_at: 0 };
}

/**
 * Credit a player's vault. Called when a reef run is banked: a share of what
 * you earn out in the water is what sits in your tank for someone else to come
 * and take. Without this there is nothing at stake and no reason to defend.
 */
export async function creditVault(env: Env, pid: string, pearls: number): Promise<void> {
  const amount = Math.max(0, Math.min(50_000, Math.floor(pearls) || 0));
  if (!pid || amount <= 0) return;
  const db = env.DB;
  await ensureSchema(db);
  await db
    .prepare(
      `INSERT INTO vaults (pid, pearls, shield_until, last_raid_at, updated)
            VALUES (?1, ?2, 0, 0, ?3)
       ON CONFLICT(pid) DO UPDATE SET pearls = pearls + ?2, updated = ?3`,
    )
    .bind(pid, amount, Date.now())
    .run();
}

/** GET /api/raid/state — what the client needs to draw the raid screen. */
export async function readRaidState(env: Env, pid: string): Promise<Response> {
  if (!pid) return json({ ok: false, error: "pid required" }, 400);
  const db = env.DB;
  await ensureSchema(db);
  const now = Date.now();
  const v = await vaultOf(db, pid);
  const open = await db
    .prepare(`SELECT id, defender, started FROM raids WHERE attacker = ?1 AND status = 'open' ORDER BY started DESC LIMIT 1`)
    .bind(pid)
    .first<{ id: string; defender: string; started: number }>();
  /* Raids on you since you last looked, so coming back has something to show. */
  const { results: incoming } = await db
    .prepare(
      `SELECT r.attacker, r.stars, r.damage, r.loot, r.ended
         FROM raids r WHERE r.defender = ?1 AND r.status = 'done'
        ORDER BY r.ended DESC LIMIT 10`,
    )
    .bind(pid)
    .all<{ attacker: string; stars: number; damage: number; loot: number; ended: number }>();
  return json({
    ok: true,
    vault: v.pearls,
    shielded: v.shield_until > now,
    shieldUntil: v.shield_until,
    openRaid: open && now <= open.started + RAID_TTL_MS ? open : null,
    lootShare: MAX_LOOT_SHARE,
    incoming: incoming ?? [],
  });
}

/**
 * POST /api/raid/start — hand out a target and open a raid.
 *
 * The target is chosen here, not requested: letting a client name its own
 * victim is how you get one unlucky player farmed by a script.
 */
export async function startRaid(env: Env, body: unknown): Promise<Response> {
  const b = (body ?? {}) as Record<string, unknown>;
  const pid = clean(b.pid, MAX_NAME);
  if (!pid) return json({ ok: false, error: "pid required" }, 400);

  const db = env.DB;
  await ensureSchema(db);
  const now = Date.now();

  const mine = await vaultOf(db, pid);
  const open = await db
    .prepare(`SELECT id, started FROM raids WHERE attacker = ?1 AND status = 'open' ORDER BY started DESC LIMIT 1`)
    .bind(pid)
    .first<{ id: string; started: number }>();
  /* An abandoned raid should not lock the attacker out for ever. */
  if (open && now > open.started + RAID_TTL_MS) {
    await db.prepare(`UPDATE raids SET status = 'void' WHERE id = ?1`).bind(open.id).run();
  }
  const stillOpen = open && now <= open.started + RAID_TTL_MS ? open : null;

  /* Candidates: real tanks, not mine, not shielded, ordered by who has been
     left alone longest so the same few are not served over and over. */
  const { results } = await db
    .prepare(
      `SELECT t.pid, t.name, t.flag, t.items, COALESCE(v.pearls, 0) AS pearls,
              COALESCE(v.shield_until, 0) AS shield_until
         FROM tanks t LEFT JOIN vaults v ON v.pid = t.pid
        WHERE t.pid != ?1 AND t.items > 0 AND COALESCE(v.shield_until, 0) <= ?2
        ORDER BY COALESCE(v.last_raid_at, 0) ASC
        LIMIT ?3`,
    )
    .bind(pid, now, TARGET_POOL)
    .all<{ pid: string; name: string; flag: string; items: number; pearls: number; shield_until: number }>();

  const pool = results ?? [];
  if (!pool.length) return json({ ok: false, error: "no tanks to raid yet" }, 409);

  /* Skip anyone this attacker hit recently, then take the first that passes. */
  for (const cand of pool) {
    const lastHit = await db
      .prepare(
        `SELECT started FROM raids WHERE attacker = ?1 AND defender = ?2 AND status = 'done'
          ORDER BY started DESC LIMIT 1`,
      )
      .bind(pid, cand.pid)
      .first<{ started: number }>();

    const verdict = canOpenRaid(now, {
      attacker: pid,
      defender: cand.pid,
      defenderShieldUntil: cand.shield_until,
      lastRaidAt: mine.last_raid_at,
      openRaid: stillOpen,
      lastHitDefenderAt: lastHit?.started ?? 0,
      defenderItems: cand.items,
    });
    if (!verdict.ok) continue;

    const tank = await db
      .prepare(`SELECT layout FROM tanks WHERE pid = ?1`)
      .bind(cand.pid)
      .first<{ layout: string }>();
    let items: unknown = [];
    try {
      items = JSON.parse(tank?.layout ?? "[]");
    } catch {
      items = [];
    }

    const id = crypto.randomUUID();
    /* The seed is the server's. A deterministic replay check later needs the
       randomness to have come from us, not from the machine being checked. */
    const seed = Math.floor(Math.random() * 2 ** 31);
    await db
      .prepare(`INSERT INTO raids (id, attacker, defender, seed, started, status) VALUES (?1, ?2, ?3, ?4, ?5, 'open')`)
      .bind(id, pid, cand.pid, seed, now)
      .run();
    await db
      .prepare(
        `INSERT INTO vaults (pid, pearls, shield_until, last_raid_at, updated) VALUES (?1, 0, 0, ?2, ?2)
         ON CONFLICT(pid) DO UPDATE SET last_raid_at = ?2, updated = ?2`,
      )
      .bind(pid, now)
      .run();

    return json({
      ok: true,
      raidId: id,
      seed,
      expiresAt: now + RAID_TTL_MS,
      target: { pid: cand.pid, name: cand.name, flag: cand.flag ?? "", items },
      vault: cand.pearls,
    });
  }

  /* Everyone in the pool was shielded, recently hit, or the attacker is on
     cooldown. Re-run the check against the first candidate purely to get a
     reason worth showing, rather than a blank "no". */
  const first = pool[0];
  const why = first
    ? canOpenRaid(now, {
        attacker: pid,
        defender: first.pid,
        defenderShieldUntil: first.shield_until,
        lastRaidAt: mine.last_raid_at,
        openRaid: stillOpen,
        defenderItems: first.items,
      })
    : ({ ok: false, reason: "no tanks to raid yet" } as const);
  return json({ ok: false, error: why.ok ? "no eligible tanks right now" : why.reason }, 409);
}

/** POST /api/raid/end — report a raid and let the server decide what it was worth. */
export async function endRaid(env: Env, body: unknown): Promise<Response> {
  const b = (body ?? {}) as Record<string, unknown>;
  const pid = clean(b.pid, MAX_NAME);
  const raidId = clean(b.raidId, 64);
  if (!pid || !raidId) return json({ ok: false, error: "pid and raidId required" }, 400);

  const db = env.DB;
  await ensureSchema(db);
  const now = Date.now();

  const raid = await db
    .prepare(`SELECT id, attacker, defender, seed, started, status FROM raids WHERE id = ?1`)
    .bind(raidId)
    .first<{ id: string; attacker: string; defender: string; seed: number; started: number; status: string }>();

  /* The vault is read at settlement, not at hand-out: whatever the defender
     actually holds now is what can be taken, so two raids racing the same tank
     cannot between them remove more than is there. */
  const theirs = raid ? await vaultOf(db, raid.defender) : null;

  const verdict = settleRaid(
    now,
    raid,
    { pid, durationMs: b.durationMs, damagePct: b.damagePct },
    { vaultPearls: theirs?.pearls ?? 0 },
  );

  if (!verdict.ok) {
    /* A refused report still closes the raid, or a client could keep retrying
       with different numbers until one is accepted. */
    if (raid && raid.status === "open" && raid.attacker === pid) {
      await db.prepare(`UPDATE raids SET status = 'void', ended = ?2 WHERE id = ?1`).bind(raidId, now).run();
    }
    return json({ ok: false, error: verdict.reason }, 400);
  }

  const loot = Math.min(verdict.loot, theirs?.pearls ?? 0);
  const stamps = [
    db
      .prepare(
        `UPDATE raids SET status = 'done', stars = ?2, damage = ?3, loot = ?4, ended = ?5, log = ?6
          WHERE id = ?1 AND status = 'open'`,
      )
      .bind(raidId, verdict.stars, verdict.damagePct, loot, now, boundLog(b.log as string)),
    db
      .prepare(
        `INSERT INTO vaults (pid, pearls, shield_until, last_raid_at, updated) VALUES (?1, 0, ?2, 0, ?3)
         ON CONFLICT(pid) DO UPDATE SET
           pearls = MAX(0, pearls - ?4),
           shield_until = MAX(shield_until, ?2),
           updated = ?3`,
      )
      .bind(raid!.defender, verdict.shieldUntil, now, loot),
    db
      .prepare(
        `INSERT INTO vaults (pid, pearls, shield_until, last_raid_at, updated) VALUES (?1, ?2, 0, ?3, ?3)
         ON CONFLICT(pid) DO UPDATE SET pearls = pearls + ?2, last_raid_at = ?3, updated = ?3`,
      )
      .bind(pid, loot, now),
  ];
  await db.batch(stamps);

  return json({
    ok: true,
    stars: verdict.stars,
    damagePct: verdict.damagePct,
    loot,
    defender: raid!.defender,
    shieldedUntil: verdict.shieldUntil,
  });
}
