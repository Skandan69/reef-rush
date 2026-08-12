/* Where Reef Rush looks for its server.
 *
 * The game and the server now ship as one Cloudflare Worker, so the answer is
 * always "wherever this page came from". Deriving it from location instead of
 * hard-coding a hostname means the workers.dev URL and any custom domain you
 * add later both work with no edit here.
 *
 * If the page is ever served from somewhere with no server behind it, the
 * connection simply fails and the game falls back to single player: local
 * leaderboard, no shared arenas, everything else untouched.
 */
window.REEF_WS  = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;
window.REEF_API = location.origin;
