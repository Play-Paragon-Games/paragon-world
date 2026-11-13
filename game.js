// Paragon World, game layer: Kyle's own track around the board.
// It only READS the business state (World.compute's result) and never writes business data:
// there is no network call in this file. Its own state (pawn position, laps, unused rolls,
// cards played, and the last-seen hand) lives in this browser's localStorage.
// Moving that state to the database is a later Layer 2 change (see the Map's Later list).
//
// A card is "played" only when its real condition clears:
//   agent waiting or blocked   -> that agent later reports working or idle
//   manual district line       -> the district gets a new line (stale, warn or bad cards alike)
//   stock-driven district      -> its level leaves warn/bad
//   ROAS step down             -> the gate leaves step down
// A ROAS hold card never pays: the brief names only step down.
// Each played card adds one roll. There is no manual "done".
window.Game = (() => {
"use strict";
const KEY = "pw-game-v1", SPACES = 20;
const fresh = () => ({v: 1, pos: 0, laps: 0, rolls: 0, played: 0, hand: null});
function load(){
  try {
    const j = JSON.parse(localStorage.getItem(KEY));
    if (j && j.v === 1) return {v: 1, pos: ((j.pos | 0) % SPACES + SPACES) % SPACES, laps: Math.max(0, j.laps | 0), rolls: Math.max(0, j.rolls | 0), played: Math.max(0, j.played | 0), hand: j.hand && typeof j.hand === "object" ? j.hand : null};
  } catch (_) {}
  return fresh();
}
let st = load(), stored = true;
function save(){ try { localStorage.setItem(KEY, JSON.stringify(st)); stored = true; } catch (_) { stored = false; } }

// The hand as game cards: a key that changes when the underlying thing changes, and the rule that clears it.
function cards(s){
  return s.hand.map(c => {
    if (c.kind === "agent") return {key: "agent:" + c.id + "@" + c.eid, rule: "agent", id: c.id, t: c.t, title: c.title};
    if (c.kind === "roas") return {key: "roas:" + c.level, rule: c.level === "bad" ? "roas" : null, id: c.id, title: c.title};
    if (c.dkind === "manual") return {key: "place:" + c.id + "@" + (c.eid || "none"), rule: "line", id: c.id, eid: c.eid || null, title: c.title};
    return {key: "place:" + c.id, rule: "level", id: c.id, title: c.title};
  });
}
function cleared(c, s){
  if (c.rule === "agent") return s.events.some(e => e.type === "agent.status" && !e.demo && e.entity === "agent:" + c.id && e.t > c.t && (e.details?.state === "working" || e.details?.state === "idle"));
  const d = s.districts.find(x => x.slug === c.id);
  if (c.rule === "line") return !!(d && d.event && d.event.id !== c.eid);
  if (c.rule === "level") return !!(d && d.level !== "warn" && d.level !== "bad" && d.level !== "gray");
  if (c.rule === "roas") return !!(s.meta && s.meta.roas !== null && s.meta.gate !== "bad");
  return false;
}
// Call once per fresh state. Compares the last-seen hand (also from a previous visit) with now:
// cards that cleared are played and each adds a roll; cards that just went away are dropped.
function reconcile(s){
  const now = cards(s), keys = new Set(now.map(c => c.key)), played = [], gone = [], first = st.hand === null;
  if (st.hand) for (const [k, c] of Object.entries(st.hand)) if (!keys.has(k)) (cleared(c, s) ? played : gone).push({...c, key: k});
  st.rolls += played.length; st.played += played.length;
  st.hand = Object.fromEntries(now.map(c => [c.key, {rule: c.rule, id: c.id, t: c.t, eid: c.eid, title: c.title}]));
  save();
  return {cards: now, played, gone, first};
}
function d6(){ // fair 1 to 6
  const a = new Uint32Array(1);
  if (window.crypto && crypto.getRandomValues) { do crypto.getRandomValues(a); while (a[0] >= 4294967292); return 1 + a[0] % 6; }
  return 1 + Math.floor(Math.random() * 6);
}
// Spend one roll: the pawn moves n spaces clockwise; passing Start adds a lap. Saved before any animation.
function roll(){
  if (st.rolls < 1) return null;
  const n = d6(), from = st.pos, lap = from + n >= SPACES ? 1 : 0;
  st.rolls -= 1; st.pos = (from + n) % SPACES; st.laps += lap; save();
  return {n, from, to: st.pos, lap};
}
return {SPACES, state: () => ({pos: st.pos, laps: st.laps, rolls: st.rolls, played: st.played, stored}), cards, cleared, reconcile, roll};
})();
