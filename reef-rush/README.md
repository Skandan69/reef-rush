# Reef Rush

A browser game. You start as a tadpole in a coral reef where everything is
hungry and most of it is bigger than you. Eat, grow, dodge, and by the end the
reef is swimming away from *you*.

Two of the characters are painted illustrations; everything else — every fish,
the kelp, the coral, the wormholes — is drawn live with canvas paths. No sprite
sheets, no engine, no build step, no dependencies.

## Play it right now

Open `index.html` in a browser. That is the whole game.

In this mode it is single player: AI fish, a local leaderboard, no shared
arenas and no saved tanks. Combat, wormholes, powerups, the shop, flags, the
evolution tiers and the tank builder all work.

## Part 1 — put it online with Vercel (5 minutes, free)

1. Push this folder to a GitHub repository.
2. Go to vercel.com, **Add New → Project**, and import that repository.
3. Framework preset: **Other**. Build command: **none**. Output directory: **/**.
4. Deploy.

That is it — it is static files, so there is nothing to build. Every push to
`main` redeploys. Add your own domain in Vercel's project settings whenever you
like.

## Part 2 — turn on multiplayer, rankings and tanks with Cloudflare (free)

`server/` is a Cloudflare Worker. It does three jobs Vercel cannot: it relays
player positions so everyone on a room link shares one ocean, it stores
finished runs for the day/week/month boards and the arena ladders, and it keeps
each player's fish tank.

You need a free Cloudflare account.

```bash
npm install -g wrangler
cd server
wrangler login

# create the database, then paste the printed id into wrangler.jsonc
wrangler d1 create reef-rush

wrangler deploy
```

`wrangler deploy` prints a URL like `https://reef-rush.<you>.workers.dev`.
Put it into `config.js` at the top level of this folder:

```js
window.REEF_WS  = "wss://reef-rush.<you>.workers.dev";
window.REEF_API = "https://reef-rush.<you>.workers.dev";
```

Commit, push, and Vercel redeploys. Everything switches on.

The tables create themselves on first use — there is nothing to migrate. The
boards are three queries against one table with different cutoffs, so a board
"resets" because the calendar moved rather than because anything was deleted.

## Controls

| | |
|---|---|
| Move | mouse, or `WASD` / arrows |
| Sprint | `space` or `shift` — costs stamina |
| Spit | left click or `F` — fires a lump of your own mass |
| Net | `Q` or right click — tangles a fish for five seconds |
| Quit | `Esc` |

Spitting kills anything much smaller outright and chips bigger fish, but every
shot shrinks you. Past 900 mass the reef starts eating away at you, so nobody
runs away with a lead. Fish ringed in green are poisonous; the plastic drifting
in the water costs you more.

## Modes

- **Reef** — endless. Grow as far as you can, on a map you cannot see all of.
- **Arena** — five-minute matches on a shared wall clock, so everyone starts
  together with nothing to coordinate. Five games, each with its own ladder:
  Survival, Last Fish Out, Closing Waves, Team Wars, Fish Football, Fish
  Volleyball.
- **Your Tank** — the part that persists while you are logged out. Buy pieces
  with the pearls you earned in the reef, drag them where you want them, and
  visit other people's tanks.

## Layout

```
index.html      markup, styles, every screen
client.js       the entire game: rendering, physics, AI, combat, netcode, shop, tanks
config.js       where to find the server (empty = offline)
art/            the painted characters
vercel.json     caching rules
server/         the optional Cloudflare Worker: rooms, rankings, tanks
```

## How the multiplayer works

Each client owns its own fish and nothing else. You broadcast where you are
twelve times a second; when something eats you, **you** decide that and tell
your killer, which is why there is never an argument about who ate whom. Shared
objects that cannot work that way — the football, Poseidon's health — are owned
by the lowest player id in the room, which broadcasts them; if that player
leaves, the next lowest notices the silence and takes over.

The live channel never touches storage, which is what makes 12 Hz affordable.
It is also untrusted by design: fine for a casual arcade game, worth replacing
with a server-authoritative tick loop if it ever needs to be competitive.

## Tuning

The numbers worth playing with are near the top of `client.js`: `WORLD`,
`MAX_FISH`, `MAX_FOOD`, `PLAYER_START_MASS`, `GROWTH`, `AI_MAX_MASS`,
`EAT_RATIO`, `SPIT_COST`, `SHIELD_TIME`, and the `STAGES` ladder.
