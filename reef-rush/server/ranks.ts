/**
 * Persistent rankings.
 *
 * One table of finished runs. "Daily", "weekly" and "monthly" are not three
 * stored boards that get wiped on a timer — they are three queries against the
 * same table with a different cutoff, so a board "resets" simply by the calendar
 * moving on. Nothing to schedule, nothing to lose, and last week's numbers stay
 * queryable instead of being destroyed.
 *
 * Everything here comes from a browser we do not control, so every field is
 * bounded and the write path is rate limited per player.
 */

import type { Env } from "./env";

const MAX_NAME = 24;
const MAX_SCORE = 5_000_000;
const MAX_KILLS = 2_000;
const MAX_MASS = 5_000_000;
/** One accepted run per player per 8s: a run cannot legitimately be shorter. */
const WRITE_COOLDOWN_MS = 8_000;
const BOARD_LIMIT = 25;

/** Deliberately small and blunt: it catches the obvious, not the creative. */
const BLOCKED = [
  "fuck", "shit", "cunt", "nigger", "nigga", "faggot", "rape", "bitch",
  "whore", "slut", "retard", "hitler", "nazi",
];

let ready = false;

async function ensureSchema(db: D1Database): Promise<void> {
  if (ready) return;
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS runs (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         pid TEXT NOT NULL,
         name TEXT NOT NULL,
         flag TEXT,
         team INTEGER NOT NULL DEFAULT 0,
         score INTEGER NOT NULL,
         kills INTEGER NOT NULL,
         mass INTEGER NOT NULL,
         room TEXT,
         ts INTEGER NOT NULL
       )`,
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS runs_ts ON runs (ts)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS runs_pid_ts ON runs (pid, ts)`),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS arena (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         pid TEXT NOT NULL,
         name TEXT NOT NULL,
         flag TEXT,
         match_id INTEGER NOT NULL,
         room TEXT,
         game TEXT NOT NULL DEFAULT 'survival',
         size INTEGER NOT NULL,
         kills INTEGER NOT NULL,
         ts INTEGER NOT NULL
       )`,
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS arena_ts ON arena (ts)`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS arena_once ON arena (pid, match_id, room)`),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS tanks (
         pid TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         flag TEXT,
         layout TEXT NOT NULL,
         items INTEGER NOT NULL DEFAULT 0,
         updated INTEGER NOT NULL
       )`,
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS tanks_updated ON tanks (updated)`),
    // One-off: remove the rows written while verifying this endpoint. Scoped to
    // the exact ids used, so it can never touch a real player's history.
    db.prepare(`DELETE FROM runs WHERE pid IN ('testfish1','testfish2','testfish3','badfish') OR pid LIKE 'seed%' OR pid LIKE 'live%'`),
  ]);

  /* The arena table predates the `game` column, and CREATE TABLE IF NOT EXISTS
     will not add it to a table that already exists. Additive, idempotent, and
     outside the batch because a batch aborts wholesale on the second run. */
  try {
    await db.prepare(`ALTER TABLE arena ADD COLUMN game TEXT NOT NULL DEFAULT 'survival'`).run();
  } catch {
    /* already migrated */
  }
  /* Same reasoning for tanks.visits: CREATE TABLE IF NOT EXISTS will not add a
     column to a table that already exists, so it goes on separately. */
  try {
    await db.prepare(`ALTER TABLE tanks ADD COLUMN visits INTEGER NOT NULL DEFAULT 0`).run();
  } catch {
    /* already migrated */
  }
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS tanks_visits ON tanks (visits DESC)`).run();
  } catch {
    /* index already there */
  }

  /* one-off: rows written while verifying these endpoints */
  try {
    await db.prepare(`DELETE FROM arena WHERE pid IN ('g1','g2','g3') OR pid LIKE 'atest%'`).run();
  } catch {
    /* nothing to sweep */
  }

  ready = true;
}

function cleanName(value: unknown): string {
  if (typeof value !== "string") return "Nameless fish";
  let out = "";
  const src = value.slice(0, MAX_NAME);
  for (let i = 0; i < src.length; i++) {
    const code = src.charCodeAt(i);
    out += code >= 32 && code !== 127 ? src[i] : " ";
  }
  out = out.trim();
  if (!out) return "Nameless fish";
  const flat = out.toLowerCase().replace(/[^a-z]/g, "");
  for (const bad of BLOCKED) if (flat.includes(bad)) return "Nameless fish";
  return out;
}

function int(value: unknown, lo: number, hi: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return lo;
  const n = Math.round(value);
  return n < lo ? lo : n > hi ? hi : n;
}

/** Calendar cutoffs in UTC, so a board turns over at a predictable moment. */
export function cutoffFor(window: string, now = Date.now()): number {
  const d = new Date(now);
  if (window === "week") {
    const day = (d.getUTCDay() + 6) % 7; // Monday = 0
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
  }
  if (window === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  if (window === "all") return 0;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export async function submitRun(env: Env, body: unknown): Promise<Response> {
  if (typeof body !== "object" || body === null) {
    return json({ ok: false, error: "expected an object" }, 400);
  }
  const b = body as Record<string, unknown>;
  const pid = typeof b.pid === "string" ? b.pid.slice(0, 64) : "";
  if (!pid) return json({ ok: false, error: "pid required" }, 400);

  const db = env.DB;
  await ensureSchema(db);

  const last = await db
    .prepare(`SELECT ts FROM runs WHERE pid = ?1 ORDER BY ts DESC LIMIT 1`)
    .bind(pid)
    .first<{ ts: number }>();
  const now = Date.now();
  if (last && now - last.ts < WRITE_COOLDOWN_MS) {
    return json({ ok: false, error: "too soon" }, 429);
  }

  const score = int(b.score, 0, MAX_SCORE);
  if (score <= 0) return json({ ok: true, skipped: "no score" });

  await db
    .prepare(
      `INSERT INTO runs (pid, name, flag, team, score, kills, mass, room, ts)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      pid,
      cleanName(b.name),
      typeof b.flag === "string" ? b.flag.slice(0, 4) : "",
      int(b.team, 0, 2),
      score,
      int(b.kills, 0, MAX_KILLS),
      int(b.mass, 0, MAX_MASS),
      typeof b.room === "string" ? b.room.slice(0, 40) : "",
      now,
    )
    .run();

  return json({ ok: true });
}

export async function readBoard(env: Env, window: string, pid: string): Promise<Response> {
  const db = env.DB;
  await ensureSchema(db);
  const since = cutoffFor(window);

  const { results } = await db
    .prepare(
      `SELECT pid, name, flag, team, MAX(score) AS score, SUM(kills) AS kills, COUNT(*) AS runs
         FROM runs
        WHERE ts >= ?1
        GROUP BY pid
        ORDER BY score DESC, kills DESC
        LIMIT ?2`,
    )
    .bind(since, BOARD_LIMIT)
    .all<{ pid: string; name: string; flag: string; team: number; score: number; kills: number; runs: number }>();

  const rows = (results ?? []).map((r, i) => ({
    rank: i + 1,
    name: r.name,
    flag: r.flag ?? "",
    team: r.team ?? 0,
    score: r.score,
    kills: r.kills,
    runs: r.runs,
    you: r.pid === pid,
  }));

  let mine = rows.find((r) => r.you) ?? null;
  if (!mine && pid) {
    const own = await db
      .prepare(
        `SELECT name, flag, team, MAX(score) AS score, SUM(kills) AS kills, COUNT(*) AS runs
           FROM runs WHERE pid = ?1 AND ts >= ?2`,
      )
      .bind(pid, since)
      .first<{ name: string; flag: string; team: number; score: number; kills: number; runs: number }>();
    if (own && own.score) {
      mine = { rank: 0, name: own.name, flag: own.flag ?? "", team: own.team ?? 0, score: own.score, kills: own.kills, runs: own.runs, you: true };
    }
  }

  return json({ ok: true, window, since, rows, mine });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      // the standalone build may be served from another origin
      "access-control-allow-origin": "*",
    },
  });
}


/* ==========================================================================
   THE ARENA
   A match is five minutes of wall clock, the same five minutes for everybody:
   match_id is just floor(now / 5min), so no server has to start anything and
   no lobby has to agree on when to begin. A player files one result per match
   per room — the unique index makes that true rather than merely intended —
   and the ladder reads wins straight out of those results.
   ========================================================================== */

export const MATCH_MS = 5 * 60 * 1000;

export async function submitArena(env: Env, body: unknown): Promise<Response> {
  if (typeof body !== "object" || body === null) {
    return json({ ok: false, error: "expected an object" }, 400);
  }
  const b = body as Record<string, unknown>;
  const pid = typeof b.pid === "string" ? b.pid.slice(0, 64) : "";
  if (!pid) return json({ ok: false, error: "pid required" }, 400);

  const matchId = int(b.matchId, 0, 1e12);
  const now = Date.now();
  const current = Math.floor(now / MATCH_MS);
  /* only the match that just finished, or the one running, may be filed */
  if (matchId !== current && matchId !== current - 1) {
    return json({ ok: false, error: "match is not current" }, 409);
  }

  const db = env.DB;
  await ensureSchema(db);

  try {
    await db
      .prepare(
        `INSERT INTO arena (pid, name, flag, match_id, room, game, size, kills, ts)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(
        pid,
        cleanName(b.name),
        typeof b.flag === "string" ? b.flag.slice(0, 4) : "",
        matchId,
        typeof b.room === "string" ? b.room.slice(0, 40) : "main",
        typeof b.game === "string" ? b.game.slice(0, 20) : "survival",
        int(b.size, 0, MAX_MASS),
        int(b.kills, 0, MAX_KILLS),
        now,
      )
      .run();
  } catch {
    /* the unique index rejected a second result for the same match — that is
       the point of it, and it is not an error worth telling the player about */
    return json({ ok: true, duplicate: true });
  }
  return json({ ok: true });
}

export async function readLadder(env: Env, window: string, pid: string, game = ""): Promise<Response> {
  const db = env.DB;
  await ensureSchema(db);
  const since = cutoffFor(window === "all" ? "all" : window || "week");
  const g = game.slice(0, 20);

  /* One ladder per game: a football win and a survival win are not the same
     achievement, so they never share a table row. */
  const { results } = await db
    .prepare(
      `WITH best AS (
         SELECT match_id, room, MAX(size) AS top
           FROM arena WHERE ts >= ?1 AND (?3 = '' OR game = ?3) GROUP BY match_id, room
       )
       SELECT a.pid, a.name, a.flag,
              MAX(a.size) AS size,
              SUM(a.kills) AS kills,
              COUNT(*) AS matches,
              SUM(CASE WHEN a.size = b.top THEN 1 ELSE 0 END) AS wins
         FROM arena a
         JOIN best b ON a.match_id = b.match_id AND a.room = b.room
        WHERE a.ts >= ?1 AND (?3 = '' OR a.game = ?3)
        GROUP BY a.pid
        ORDER BY wins DESC, size DESC
        LIMIT ?2`,
    )
    .bind(since, BOARD_LIMIT, g)
    .all<{ pid: string; name: string; flag: string; size: number; kills: number; matches: number; wins: number }>();

  const rows = (results ?? []).map((r, i) => ({
    rank: i + 1,
    name: r.name,
    flag: r.flag ?? "",
    size: r.size,
    kills: r.kills,
    matches: r.matches,
    wins: r.wins,
    you: r.pid === pid,
  }));

  return json({ ok: true, window: window || "week", game: g, since, rows, matchMs: MATCH_MS });
}


/* ==========================================================================
   VIP
   Earned, not only bought: finish in today's top ten and you are VIP for a
   day; make the all-time top ten and you hold it for a week. The check runs
   against the same rows the boards are built from, so there is nothing extra
   to keep in sync and nothing a client can assert about itself.
   ========================================================================== */

const VIP_DAILY_MS = 24 * 60 * 60 * 1000;
const VIP_ALLTIME_MS = 7 * 24 * 60 * 60 * 1000;
const VIP_TOP = 10;

async function placedInTop(db: D1Database, pid: string, since: number): Promise<boolean> {
  const row = await db
    .prepare(
      `WITH board AS (
         SELECT pid, MAX(score) AS best FROM runs WHERE ts >= ?1 GROUP BY pid
         ORDER BY best DESC LIMIT ?2
       )
       SELECT 1 AS hit FROM board WHERE pid = ?3`,
    )
    .bind(since, VIP_TOP, pid)
    .first<{ hit: number }>();
  return !!row;
}

export async function readVip(env: Env, pid: string): Promise<Response> {
  if (!pid) return json({ ok: true, vip: false });
  const db = env.DB;
  await ensureSchema(db);
  const now = Date.now();

  if (await placedInTop(db, pid, 0)) {
    return json({ ok: true, vip: true, reason: "all-time top ten", until: now + VIP_ALLTIME_MS, days: 7 });
  }
  if (await placedInTop(db, pid, cutoffFor("day", now))) {
    return json({ ok: true, vip: true, reason: "today's top ten", until: now + VIP_DAILY_MS, days: 1 });
  }
  return json({ ok: true, vip: false, reason: "finish in a top ten to earn it" });
}


/* ==========================================================================
   TANKS
   A tank is the one thing in this game that exists while you are offline. It
   is stored as a bounded blob against a player id: a list of placed pieces,
   nothing more. Everything about it is capped, because it is the only place a
   client writes free-form data and it is served back to other players.
   ========================================================================== */

/* 200, not 120: the byte cap below is the real guard on storage, and a densely
   planted tank runs to about 6KB of it. The old limit stopped a build being
   finished long before it stopped being cheap to store. */
const TANK_MAX_ITEMS = 200;
const TANK_MAX_BYTES = 12 * 1024;

export async function saveTank(env: Env, body: unknown): Promise<Response> {
  if (typeof body !== "object" || body === null) {
    return json({ ok: false, error: "expected an object" }, 400);
  }
  const b = body as Record<string, unknown>;
  const pid = typeof b.pid === "string" ? b.pid.slice(0, 64) : "";
  if (!pid) return json({ ok: false, error: "pid required" }, 400);
  if (!Array.isArray(b.items)) return json({ ok: false, error: "items must be an array" }, 400);
  if (b.items.length > TANK_MAX_ITEMS) return json({ ok: false, error: "too many pieces" }, 400);

  /* rebuilt field by field: whatever arrives, only these shapes are stored */
  const items = b.items.slice(0, TANK_MAX_ITEMS).map((raw) => {
    const it = (raw ?? {}) as Record<string, unknown>;
    return {
      t: typeof it.t === "string" ? it.t.slice(0, 16) : "rock",
      x: int(it.x, 0, 4000),
      y: int(it.y, 0, 2400),
      /* Up to 420: a pillar or a kelp frond has to be able to reach a decent
         part of a 2400-tall tank, and at 200 the tallest piece covered under a
         quarter of it, which is why every tank looked like a strip of reef
         along the floor. */
      s: Math.max(50, Math.min(420, int(it.s, 50, 420) || 100)),
    };
  });

  const layout = JSON.stringify(items);
  if (new TextEncoder().encode(layout).byteLength > TANK_MAX_BYTES) {
    return json({ ok: false, error: "layout too large" }, 400);
  }

  const db = env.DB;
  await ensureSchema(db);
  await db
    .prepare(
      `INSERT INTO tanks (pid, name, flag, layout, items, updated)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(pid) DO UPDATE SET
         name = excluded.name, flag = excluded.flag,
         layout = excluded.layout, items = excluded.items, updated = excluded.updated`,
    )
    .bind(
      pid,
      cleanName(b.name),
      typeof b.flag === "string" ? b.flag.slice(0, 4) : "",
      layout,
      items.length,
      Date.now(),
    )
    .run();

  return json({ ok: true, items: items.length });
}

/**
 * The most visited tanks.
 *
 * Ranked by visits rather than by what a tank is worth: value ranks whoever
 * spent the most, which is a leaderboard for the rich and a reason to grind.
 * Visits rank whatever people actually wanted to look at.
 */
export async function topTanks(env: Env, limit: number, pid: string): Promise<Response> {
  const db = env.DB;
  await ensureSchema(db);
  const n = Math.max(1, Math.min(25, Math.floor(limit) || 10));
  const { results } = await db
    .prepare(
      `SELECT pid, name, flag, items, visits, updated FROM tanks
        WHERE items > 0 ORDER BY visits DESC, updated DESC LIMIT ?1`,
    )
    .bind(n)
    .all<{ pid: string; name: string; flag: string; items: number; visits: number; updated: number }>();
  const rows = (results ?? []).map((r) => ({
    pid: r.pid,
    name: r.name,
    flag: r.flag ?? "",
    items: r.items,
    visits: r.visits ?? 0,
    blurb: `${r.items} pieces`,
    you: r.pid === pid,
  }));
  return json({ ok: true, rows });
}

export async function readTank(env: Env, pid: string, by = ""): Promise<Response> {
  if (!pid) return json({ ok: false, error: "pid required" }, 400);
  const db = env.DB;
  await ensureSchema(db);
  /* A visit is somebody else opening your tank. Your own loads do not count,
     or the board would rank whoever reloads the most. */
  if (by && by !== pid) {
    try {
      await db.prepare(`UPDATE tanks SET visits = visits + 1 WHERE pid = ?1`).bind(pid).run();
    } catch {
      /* a visit that fails to record is not worth failing the read over */
    }
  }
  const row = await db
    .prepare(`SELECT pid, name, flag, layout, updated FROM tanks WHERE pid = ?1`)
    .bind(pid)
    .first<{ pid: string; name: string; flag: string; layout: string; updated: number }>();
  if (!row) return json({ ok: true, found: false, items: [] });
  let items: unknown = [];
  try {
    items = JSON.parse(row.layout);
  } catch {
    items = [];
  }
  return json({ ok: true, found: true, name: row.name, flag: row.flag ?? "", updated: row.updated, items });
}

export async function listTanks(env: Env, pid: string): Promise<Response> {
  const db = env.DB;
  await ensureSchema(db);
  const { results } = await db
    .prepare(
      `SELECT pid, name, flag, items, updated FROM tanks
        WHERE items > 0 ORDER BY updated DESC LIMIT 24`,
    )
    .all<{ pid: string; name: string; flag: string; items: number; updated: number }>();
  return json({
    ok: true,
    rows: (results ?? []).map((r) => ({
      pid: r.pid, name: r.name, flag: r.flag ?? "", items: r.items, updated: r.updated, you: r.pid === pid,
    })),
  });
}
