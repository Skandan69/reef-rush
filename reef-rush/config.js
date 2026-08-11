/* Where Reef Rush looks for its server.
 *
 * Leave both empty and the game runs entirely in the browser: single player,
 * local leaderboard, no shared arenas, no persistent rankings or tanks.
 * Everything else — combat, wormholes, powerups, the shop, flags, the tank
 * builder — works untouched.
 *
 * Deploy server/ to Cloudflare (see README) and paste its host below to turn
 * on shared arenas, the day/week/month boards, the arena ladders and saved
 * fish tanks.
 */
window.REEF_WS  = "";   // e.g. "wss://reef-rush.yourname.workers.dev"
window.REEF_API = "";   // e.g. "https://reef-rush.yourname.workers.dev"
