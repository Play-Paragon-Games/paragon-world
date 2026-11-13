// Paragon World shared logic: reference data (Entities v1), compute() and the live loop.
// Used by index.html (plain page) and board.html (board view), so both always show the same numbers.
window.World = (() => {
"use strict";
// ---------- Reference data (Entities v1) ----------
const LA = "America/Los_Angeles";
const DISTRICTS = [
  ["design-studio","Design studio","manual"],
  ["art-creative","Art & creative","manual"],
  ["production","Production","manual"],
  ["freight","Freight & customs","manual"],
  ["warehouse","Warehouse / 3PL","stock"],
  ["sales","Sales","sales"],
  ["crowdfunding","Crowdfunding","manual"],
  ["marketing","Marketing","roas"],
  ["customer-service","Customer service","manual"],
  ["finance","Finance","manual"],
  ["legal","Legal & compliance","manual"],
  ["agent-hq","Agent HQ","agents"],
];
const TITLES = [["status","Status: A Victorian Affair"],["trade-and-triumph","Trade and Triumph"],["catacombes-de-paris","Catacombes de Paris"]];
const STAGES = {concept:"Concept",prototype:"Prototype",playtesting:"Playtesting",art:"Art & graphic design",rulebook:"Rulebook & localization",manufacturing:"Manufacturing",freight:"Freight",launch:"Launch",evergreen:"On sale",retired:"Retired"};
const STAGE_ORDER = ["concept","prototype","playtesting","art","rulebook","manufacturing","freight","launch","evergreen","retired"];
const AGENTS = [["claude","Claude"],["chatgpt","ChatGPT / Codex"],["grokbot","Grokbot"]];
const CHANNELS = [["shopify","Shopify"],["amazon","Amazon"]];
const STALE_MS = 7*24*3600e3, SILENT_MS = 24*3600e3;
// Which district an agent belongs to on the board: details.district when the status carries it
// (optional key, proposed to 02), otherwise a per-agent default. No district = Agent HQ.
const AGENT_HOME = {grokbot: "customer-service"};
const SHIP_MILESTONES = ["booked", "departed", "on-water", "customs", "arrived"];
const STATUS_RUN1_UNITS = 5000; // Entities v1: Status run 1 at Sky Game. settings.status_run1_units overrides it if that row exists.
const POLL_MS = 15000;

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const laDate = (d) => new Intl.DateTimeFormat("en-CA",{timeZone:LA,year:"numeric",month:"2-digit",day:"2-digit"}).format(d);
function laDaysBack(n, now){ // last n LA calendar days ending today, as YYYY-MM-DD
  const [y,m,d] = laDate(now).split("-").map(Number);
  const out = [];
  for (let i=0;i<n;i++){ const t = new Date(Date.UTC(y,m-1,d-i)); out.push(t.toISOString().slice(0,10)); }
  return out;
}
function ago(ms){
  const s = Math.max(0, Math.round(ms/1000));
  if (s < 60) return s + "s ago";
  const m = Math.round(s/60); if (m < 60) return m + "m ago";
  const h = Math.round(m/60); if (h < 48) return h + "h ago";
  return Math.round(h/24) + "d ago";
}
const num = (v) => (v === null || v === undefined || v === "" || isNaN(Number(v))) ? null : Number(v);

// Latest non-demo snapshot per key, among events of one type.
function latestBy(events, type, keyFn){
  const m = new Map();
  for (const e of events){
    if (e.type !== type || e.demo) continue;
    const k = keyFn(e); if (!k) continue;
    const prev = m.get(k);
    if (!prev || e.t > prev.t) m.set(k, e);
  }
  return m;
}

// ---------- Compute ----------
function compute(data){
  const now = new Date(data.now);
  const events = data.events.map(e => ({...e, t: Date.parse(e.ts)})).filter(e => !isNaN(e.t));
  events.sort((a,b) => b.t - a.t);
  const settings = data.settings || {};
  const netFactor = num(settings.net_factor) ?? 0.775;
  const fixedDaily = num(settings.fixed_daily_usd) ?? 595;

  // Orders today (LA) and last 7 LA days, demo excluded.
  const today = laDate(now);
  const week = new Set(laDaysBack(7, now));
  const orders = events.filter(e => e.type === "order.created" && !e.demo);
  const todayByChannel = {};
  for (const [slug] of CHANNELS) todayByChannel[slug] = {orders:0, revenue:0, preorders:0};
  // ROAS sales leave out All-In upgrade invoices (details.upgrade_of): extra payments on orders already counted.
  let shopifyWeekSales = 0, weekUpgradeSales = 0, weekUpgrades = 0;
  const todayOrders = [];
  for (const o of orders){
    const d = laDate(new Date(o.t));
    const total = num(o.details?.total) ?? 0;
    const isUpgrade = !!o.details?.upgrade_of;
    if (d === today && todayByChannel[o.source]){
      const c = todayByChannel[o.source];
      c.orders += 1; c.revenue += total;
      if (o.details?.fulfillment === "preorder") c.preorders += 1;
      todayOrders.push(o);
    }
    if (o.source === "shopify" && week.has(d)){
      if (isUpgrade) { weekUpgradeSales += total; weekUpgrades += 1; } else shopifyWeekSales += total;
    }
  }

  // Preorder backlog: latest Shopify inventory.level for Status, details.committed.
  const inv = latestBy(events, "inventory.level", e => (e.entity||"") + "@" + (e.details?.location||""));
  const statusShopify = inv.get("title:status@shopify");
  const backlog = statusShopify ? num(statusShopify.details?.committed) : null;

  // Games to ship: Shopify base-game copies (all-time sum of details.base_games for Status, from the
  // world function's totals) plus the Kickstarter copies (settings.kickstarter_copies).
  const shopifyGames = num(data.totals?.status_base_games);
  const ksGames = num(settings.kickstarter_copies);
  const toShip = shopifyGames === null ? null : {shopify: shopifyGames, kickstarter: ksGames ?? 0, total: shopifyGames + (ksGames ?? 0), ksKnown: ksGames !== null};

  // Meta 7-day ROAS. ads.daily is a snapshot per day (details.date, LA).
  const ads = latestBy(events, "ads.daily", e => e.details?.date || laDate(new Date(e.t)));
  let spend = 0, views = 0, adDays = 0;
  for (const [date, e] of ads){ if (!week.has(date)) continue; adDays++; spend += num(e.details?.spend) ?? 0; views += num(e.details?.views) ?? 0; }
  let meta = null;
  if (ads.size > 0){
    const roas = spend > 0 ? shopifyWeekSales / spend : null;
    const cpv = views > 0 ? spend / views : null;
    let gate = "gray";
    if (roas !== null){
      if (roas < 1.6) gate = "bad";
      else if (roas < 2.2) gate = "warn";
      else if (cpv !== null && cpv >= 1.5) gate = "warn";
      else gate = "good";
    }
    const metaDaily = adDays > 0 ? spend / adDays : 0;
    const marginal = 1 / netFactor;
    const full = metaDaily > 0 ? (metaDaily + fixedDaily) / (netFactor * metaDaily) : null;
    meta = {roas, cpv, gate, spend, views, adDays, sales: shopifyWeekSales, upgradeSales: weekUpgradeSales, upgrades: weekUpgrades, marginal, full, metaDaily};
  }

  const agentDistrict = (slug, e) => { const d = e.details?.district; return DISTRICTS.some(([x]) => x === d) && d !== "agent-hq" ? d : AGENT_HOME[slug] || null; };
  // Agents: latest agent.status per agent; silent after 24h.
  const ag = latestBy(events, "agent.status", e => e.entity);
  const agents = AGENTS.map(([slug, name]) => {
    const e = ag.get("agent:" + slug);
    if (!e) return {slug, name, level:"gray", state:"no status yet", text:"Waiting for the first agent.status event", age:null, silent:true};
    const silent = now - e.t > SILENT_MS;
    const st = e.details?.state || "";
    return {slug, name, level: silent ? "gray" : e.level, state: st, text: e.summary, needs: e.details?.needs, task: e.details?.task, age: now - e.t, silent, event: e,
      district: agentDistrict(slug, e), workingAt: !silent && st === "working" ? agentDistrict(slug, e) : null,
      standsAt: !silent && (st === "working" || st === "waiting" || st === "blocked") ? agentDistrict(slug, e) : null};
  });

  // Districts.
  const ds = latestBy(events, "district.status", e => e.place);
  const districts = DISTRICTS.map(([slug, name, kind]) => {
    const e = ds.get(slug);
    const d = districtState(slug, name, kind, e);
    return {...d, kind, event: d.event ?? e ?? null};
  });
  function districtState(slug, name, kind, e){
    if (kind === "manual"){
      if (!e) return {slug, name, level:"gray", text:"No status line yet", age:null, stale:true};
      const stale = now - e.t > STALE_MS;
      return {slug, name, level: stale ? "gray" : e.level, sentLevel: e.level, text: e.summary, age: now - e.t, stale};
    }
    if (kind === "sales"){
      const n = Object.values(todayByChannel).reduce((a,c) => a + c.orders, 0);
      const r = Object.values(todayByChannel).reduce((a,c) => a + c.revenue, 0);
      return {slug, name, level:"info", text: n + (n === 1 ? " order" : " orders") + " today, " + money(r), age:null, stale:false};
    }
    if (kind === "roas"){
      if (!meta) return {slug, name, level:"gray", text:"No Meta data yet", age:null, stale:true};
      return {slug, name, level: meta.gate, text: meta.roas === null ? "No spend in the last 7 days" : "7-day ROAS " + meta.roas.toFixed(2), age:null, stale:false};
    }
    if (kind === "agents"){
      const live = agents.filter(a => !a.silent);
      if (!live.length) return {slug, name, level:"gray", text:"No agent status in 24h", age:null, stale:true};
      const lv = live.some(a => a.state === "blocked") ? "bad" : live.some(a => a.state === "waiting") ? "warn" : live.some(a => a.state === "working") ? "good" : "info";
      const parts = ["working","waiting","blocked","idle"].map(s => [s, live.filter(a => a.state === s).length]).filter(([,n]) => n).map(([s,n]) => n + " " + s);
      return {slug, name, level: lv, text: parts.join(", ") || "idle", age:null, stale:false};
    }
    if (kind === "stock"){
      const snaps = [...inv.values()];
      if (!snaps.length) return {slug, name, level:"gray", text: e ? e.summary : "No inventory snapshot yet", age: e ? now - e.t : null, stale:true};
      const order = {bad:3, warn:2, good:1, info:0};
      const worst = snaps.reduce((w, s) => (order[s.level] ?? 0) > (order[w.level] ?? 0) ? s : w, snaps[0]);
      const newest = snaps.reduce((a, s) => s.t > a.t ? s : a, snaps[0]);
      return {slug, name, level: worst.level, text: snaps.map(s => s.summary).join(" · "), age: now - newest.t, stale:false, event: newest};
    }
  }

  // Titles.
  const ts = latestBy(events, "title.stage", e => e.entity);
  const titles = TITLES.map(([slug, name]) => {
    const e = ts.get("title:" + slug);
    return {slug, name, stageSlug: e?.details?.stage ?? null, stage: e ? (STAGES[e.details?.stage] || e.details?.stage || e.summary) : "No stage yet", level: e ? "info" : "gray", age: e ? now - e.t : null, event: e ?? null};
  });

  // Needs you: agents waiting or blocked, districts at warn or bad (current, not gray).
  // Agent HQ is left out of the district count: its color comes from the same agents.
  const needAgents = agents.filter(a => !a.silent && (a.state === "waiting" || a.state === "blocked"));
  const needDistricts = districts.filter(d => d.slug !== "agent-hq" && (d.level === "warn" || d.level === "bad"));
  const needs = {n: needAgents.length + needDistricts.length, agents: needAgents, districts: needDistricts};

  // Your move (board view): one card per thing waiting on Kyle. A superset of "Needs you":
  // agents waiting or blocked, districts at warn or bad, stale manual lines, ROAS gate at step down.
  // Marketing gets one card (its color is the ROAS gate), and Agent HQ none (the agents have their own).
  const hand = [];
  for (const a of needAgents) hand.push({kind:"agent", id:a.slug, eid:a.event.id, t:a.event.t, level:a.level, place:"agent-hq", title:a.name, tag:a.state, text:a.needs || a.text, age:a.age});
  for (const d of districts){
    if (d.slug === "agent-hq") continue;
    if (d.kind === "roas"){
      if (meta && (d.level === "warn" || d.level === "bad")) hand.push({kind:"roas", id:d.slug, dkind:d.kind, level:d.level, place:d.slug, title:"Marketing", tag: d.level === "bad" ? "step down" : "hold", text:"7-day ROAS " + meta.roas.toFixed(2) + (d.level === "bad" ? ", below 1.6" : meta.roas < 2.2 ? ", between 1.6 and 2.2" : ", but " + money(meta.cpv) + " per view"), age:null});
    } else if (d.kind === "manual" && d.stale){
      hand.push({kind:"stale", id:d.slug, dkind:d.kind, eid:d.event ? d.event.id : null, level:"gray", place:d.slug, title:d.name, tag:"stale line", text: d.age === null ? "No status line yet" : "Last update " + ago(d.age) + (d.sentLevel === "warn" || d.sentLevel === "bad" ? " (was " + d.sentLevel + "): " : ": ") + d.text, age:d.age});
    } else if (d.level === "warn" || d.level === "bad"){
      hand.push({kind:"district", id:d.slug, dkind:d.kind, eid:d.event ? d.event.id : null, level:d.level, place:d.slug, title:d.name, tag:d.level, text:d.text, age:d.age});
    }
  }
  const rank = {bad:0, warn:1, gray:2};
  hand.sort((a,b) => (rank[a.level] ?? 3) - (rank[b.level] ?? 3));

  // Status mat: copies left in run 1 = run size - Shopify base games - Kickstarter copies.
  const run1 = num(settings.status_run1_units) ?? STATUS_RUN1_UNITS;
  const statusRun = toShip === null ? null : {run: run1, preorders: toShip.shopify, kickstarter: toShip.kickstarter, left: run1 - toShip.total};

  return {now, today, events, todayOrders, hand, statusRun, todayByChannel, backlog, backlogAge: statusShopify ? now - statusShopify.t : null, toShip, meta, agents, districts, titles, needs};
}

// ---------- Live loop (swap this block for a Realtime subscription later) ----------
// The key rides in the URL fragment (#k=...), which the browser never sends to the host.
// A ?k= query string is accepted too and moved into the fragment on load.
const DATA_URL = "https://erxmyapfgytaztmpzxsh.supabase.co/functions/v1/world";
let key = new URLSearchParams(location.hash.replace(/^#/, "")).get("k") || "";
if (!key) {
  const q = new URLSearchParams(location.search);
  key = q.get("k") || "";
  if (key) { try { history.replaceState(null, "", location.pathname + "#k=" + encodeURIComponent(key)); } catch (_) {} }
}
// start(render): polls while the tab is visible and calls render(compute(data)) on every load.
// Expects #dot, #livetxt and #err elements on the page.
function start(render){
  let lastOk = 0, timer = null, inflight = false, fails = 0;
  function setLive(state, txt){ const d = $("dot"); d.className = "dot " + state; $("livetxt").textContent = txt; }
  async function load(){
    if (inflight) return; inflight = true;
    try {
      const r = await fetch(DATA_URL + "?k=" + encodeURIComponent(key) + "&data=1", {cache:"no-store"});
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();
      render(compute(data));
      lastOk = Date.now(); fails = 0;
      $("err").style.display = "none";
      setLive("on", "live");
    } catch (e) {
      fails++;
      if (!lastOk) { $("err").textContent = key ? "Could not load the events (" + (e && e.message || e) + "). Check the link." : "No key in the link. Open the page with #k=<your key>."; $("err").style.display = "block"; }
      setLive("err", lastOk ? "retrying" : "no data");
    } finally { inflight = false; }
  }
  function tick(){ if (document.visibilityState === "visible") load(); }
  function go(){ stop(); tick(); timer = setInterval(tick, POLL_MS); }
  function stop(){ if (timer) clearInterval(timer); timer = null; }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") go(); else stop(); });
  setInterval(() => { if (lastOk && !fails) $("livetxt").textContent = "live · " + ago(Date.now() - lastOk); }, 5000);
  go();
}

return {LA, DISTRICTS, TITLES, STAGES, STAGE_ORDER, SHIP_MILESTONES, AGENTS, CHANNELS, $, esc, money, ago, laDate, num, compute, start, key: () => key};
})();
