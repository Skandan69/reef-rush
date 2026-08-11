/**
 * REEF RUSH — server-side rules.
 *
 * The ocean simulation itself runs in the browser (it is a real-time arcade
 * game), so what lives here is the part that must be shared and trusted:
 * the room's live leaderboard. Every player in a room streams their current
 * size and score; the room keeps the board and hands each client a ranked view.
 *
 * Pure, deterministic, JSON-serializable — see ../AGENTS.md.
 */

export const meta = {
  game: "Reef Rush",
  minPlayers: 1,
  maxPlayers: 16,
};

const MAX_NAME = 24;
const BOARD_LIMIT = 16;

function blank() {
  return { name: "", score: 0, mass: 0, best: 0, alive: false, runs: 0, team: 0, kills: 0 };
}

function cleanName(value) {
  if (typeof value !== "string") return "";
  let out = "";
  const src = value.slice(0, MAX_NAME);
  for (let i = 0; i < src.length; i++) {
    const code = src.charCodeAt(i);
    out += code >= 32 && code !== 127 ? src[i] : " ";
  }
  return out.trim();
}

function num(value, lo, hi) {
  if (typeof value !== "number" || !Number.isFinite(value)) return lo;
  const rounded = Math.round(value);
  return rounded < lo ? lo : rounded > hi ? hi : rounded;
}

export function setup(players) {
  const list = Array.isArray(players) ? players : [];
  const board = {};
  for (let i = 0; i < list.length; i++) board[list[i]] = blank();
  return { board, order: list.slice() };
}

/**
 * The client is untrusted: only two action shapes exist, and every field is
 * range-checked here before applyAction is allowed to touch the board.
 */
export function validateAction(state, playerId, action) {
  if (!action || typeof action !== "object") {
    return { ok: false, error: "action must be an object" };
  }
  if (action.t !== "sync" && action.t !== "name") {
    return { ok: false, error: "unknown action" };
  }
  if (action.name !== undefined && typeof action.name !== "string") {
    return { ok: false, error: "name must be a string" };
  }
  if (action.team !== undefined && !Number.isInteger(action.team)) {
    return { ok: false, error: "team must be an integer" };
  }
  if (action.kills !== undefined && (typeof action.kills !== "number" || !Number.isFinite(action.kills) || action.kills < 0)) {
    return { ok: false, error: "kills must be a non-negative number" };
  }
  if (action.t === "sync") {
    if (typeof action.score !== "number" || !Number.isFinite(action.score)) {
      return { ok: false, error: "score must be a finite number" };
    }
    if (typeof action.mass !== "number" || !Number.isFinite(action.mass)) {
      return { ok: false, error: "mass must be a finite number" };
    }
    if (action.score < 0 || action.mass < 0) {
      return { ok: false, error: "score and mass must not be negative" };
    }
  }
  return { ok: true };
}

export function applyAction(state, playerId, action) {
  const board = { ...state.board };
  const prev = board[playerId] || blank();
  const entry = { ...prev };

  if (typeof action.name === "string") {
    const name = cleanName(action.name);
    if (name) entry.name = name;
  }

  if (action.t === "sync") {
    entry.score = num(action.score, 0, 1e9);
    entry.mass = num(action.mass, 0, 1e7);
    entry.alive = action.alive !== false;
    entry.team = Number.isInteger(action.team) ? Math.min(2, Math.max(0, action.team)) : entry.team;
    entry.kills = num(action.kills, 0, 1e6);
    if (entry.score > entry.best) entry.best = entry.score;
    if (action.newRun === true) entry.runs = entry.runs + 1;
  }

  board[playerId] = entry;

  const order = state.order || [];
  const nextOrder = order.indexOf(playerId) === -1 ? order.concat([playerId]) : order;

  return { ...state, board, order: nextOrder };
}

/** Reef Rush is endless — the reef never closes. */
export function isGameOver(state) {
  return { over: false };
}

/**
 * Everyone sees the same ranked board; only `you` differs. Nothing is hidden,
 * so nothing is stripped — but the list is capped so a busy reef stays cheap.
 */
export function viewFor(state, playerId) {
  const order = state.order || [];
  const rows = [];
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    const entry = state.board[id];
    if (!entry) continue;
    rows.push({
      id,
      name: entry.name || "Nameless fish",
      score: entry.score,
      best: entry.best,
      mass: entry.mass,
      alive: entry.alive === true,
      team: entry.team || 0,
      kills: entry.kills || 0,
      you: id === playerId,
      seat: i,
    });
  }

  rows.sort((a, b) => {
    if (b.best !== a.best) return b.best - a.best;
    if (b.score !== a.score) return b.score - a.score;
    return a.seat - b.seat;
  });

  const board = rows.slice(0, BOARD_LIMIT).map((row, index) => ({
    rank: index + 1,
    name: row.name,
    score: row.score,
    best: row.best,
    mass: row.mass,
    alive: row.alive,
    team: row.team,
    kills: row.kills,
    you: row.you,
  }));

  /* team totals: what a side is worth right now, and who is still swimming */
  const teams = [0, 1, 2].map((id) => ({ id, score: 0, players: 0, alive: 0 }));
  for (let i = 0; i < rows.length; i++) {
    const t = teams[rows[i].team] || teams[0];
    t.score += rows[i].score;
    t.players += 1;
    if (rows[i].alive) t.alive += 1;
  }

  const me = state.board[playerId] || blank();
  return {
    board,
    teams,
    swimming: rows.filter((row) => row.alive).length,
    total: rows.length,
    you: { name: me.name, score: me.score, best: me.best, runs: me.runs },
  };
}
