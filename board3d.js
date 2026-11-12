// Paragon World board, 3D view (Phase 4, session 2).
// A physical game board on a table, drawn with three.js. Same state object as the flat board
// (World.compute). Renders only when something changes: a camera move or a real event.
// Nothing here animates on its own.
import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";

const LEVEL = { info: "#3b6fd6", good: "#1f9d55", warn: "#d98b0b", bad: "#d7342c", gray: "#a3a09a" };

// ---------- Board geometry (units are arbitrary; the board is 14 x 10.5) ----------
const BW = 14, BD = 10.5, M = 0.3, G = 0.2, TR = 1.6;
const SLAB = 0.3, SPACE_H = 0.16, TILE_H = 0.26;
const SPACE_W = (BW - 2 * M - 3 * G) / 4;
const MID_W = BW - 2 * M - 2 * TR - 2 * G, MID_D = BD - 2 * M - 2 * TR - 2 * G;
const TILE_W = (MID_W - 3 * G) / 4, TILE_D = (MID_D - 2 * G) / 3;
const PX = 200; // label texture pixels per board unit

// Track: 10 spaces clockwise seen from above. Top row 1-4 left to right, right side 5,
// bottom row 6-9 right to left, left side 10 (Retired, next to Concept).
function spaceRect(i) {
  const rowX = (c) => -BW / 2 + M + SPACE_W / 2 + c * (SPACE_W + G);
  if (i < 4) return { x: rowX(i), z: -BD / 2 + M + TR / 2, w: SPACE_W, d: TR, side: false };
  if (i === 4) return { x: BW / 2 - M - TR / 2, z: 0, w: TR, d: MID_D, side: true };
  if (i < 9) return { x: rowX(3 - (i - 5)), z: BD / 2 - M - TR / 2, w: SPACE_W, d: TR, side: false };
  return { x: -BW / 2 + M + TR / 2, z: 0, w: TR, d: MID_D, side: true };
}
function tileRect(i) {
  const c = i % 4, r = Math.floor(i / 4);
  return { x: -MID_W / 2 + TILE_W / 2 + c * (TILE_W + G), z: -MID_D / 2 + TILE_D / 2 + r * (TILE_D + G), w: TILE_W, d: TILE_D };
}

const ease = (k) => k * k * (3 - 2 * k);
function bounce(k) { // ease-out bounce for a token landing
  const n = 7.5625, d = 2.75;
  if (k < 1 / d) return n * k * k;
  if (k < 2 / d) return n * (k -= 1.5 / d) * k + 0.75;
  if (k < 2.5 / d) return n * (k -= 2.25 / d) * k + 0.9375;
  return n * (k -= 2.625 / d) * k + 0.984375;
}

export function createBoard3D(host, World, onPick) {
  const { STAGE_ORDER, STAGES, DISTRICTS } = World;
  const reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Renderer, scene, camera ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline:none";
  canvas.setAttribute("aria-label", "3D board. Drag to rotate, scroll to zoom, click a piece or tile for details.");
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 120);
  const VIEW_DIR = new THREE.Vector3(Math.sin(-0.24) * Math.cos(0.84), Math.sin(0.84), Math.cos(-0.24) * Math.cos(0.84)); // three-quarter view, slightly from the left
  const CENTER = new THREE.Vector3(-1.4, 0.2, 0.3); // board plus the box stack on its left
  camera.position.copy(CENTER).addScaledVector(VIEW_DIR, 24);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(CENTER);
  controls.cursor.copy(controls.target); // keeps update() from reporting a change every frame (target clamp round-off)
  controls.enableDamping = true; controls.dampingFactor = 0.12;
  controls.enablePan = false;
  controls.minDistance = 7; controls.maxDistance = 34;
  controls.minPolarAngle = 0.15; controls.maxPolarAngle = 1.38; // never below the table
  controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8f887a, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 1.9);
  sun.position.set(7, 15, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 10, bottom: -10, near: 2, far: 40 });
  sun.shadow.bias = -0.0015;
  scene.add(sun);

  const mat = (color, extra) => new THREE.MeshLambertMaterial({ color, ...extra });
  const mesh = (geo, material, opts = {}) => { const m = new THREE.Mesh(geo, material); m.castShadow = opts.cast !== false; m.receiveShadow = opts.receive !== false; return m; };

  // Table and board slab. The board keeps its own light colors in both themes; the room follows the page.
  const tableMat = mat("#d6d1c6");
  const table = mesh(new THREE.PlaneGeometry(90, 90), tableMat, { cast: false });
  table.rotation.x = -Math.PI / 2; scene.add(table);
  function applyTheme() {
    const dark = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light" || document.documentElement.dataset.theme === "dark";
    const bg = new THREE.Color(dark ? "#0f100e" : "#ecebe6");
    scene.background = bg; scene.fog = new THREE.Fog(bg, 30, 62);
    tableMat.color.set(dark ? "#2a2b27" : "#d6d1c6");
    invalidate();
  }
  const slab = mesh(new THREE.BoxGeometry(BW, SLAB, BD), mat("#cfc8b8"));
  slab.position.y = SLAB / 2; scene.add(slab);
  const felt = mesh(new THREE.PlaneGeometry(BW - 0.16, BD - 0.16), mat("#e4dfd3"), { cast: false });
  felt.rotation.x = -Math.PI / 2; felt.position.y = SLAB + 0.002; scene.add(felt);

  // ---------- Labels (canvas textures; short text only) ----------
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  function makeLabel(w, d) {
    const c = document.createElement("canvas"); c.width = Math.round(w * PX); c.height = Math.round(d * PX);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = maxAniso;
    const plane = mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: tex }), { cast: false });
    plane.rotation.x = -Math.PI / 2;
    return { plane, ctx: c.getContext("2d"), c, tex };
  }
  const FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
  function wrap(ctx, text, maxW) {
    const out = []; let line = "";
    for (const word of String(text).split(" ")) {
      const t = line ? line + " " + word : word;
      if (line && ctx.measureText(t).width > maxW) { out.push(line); line = word; } else line = t;
    }
    if (line) out.push(line);
    return out;
  }
  function drawLabel(L, { title, sub, num, bg = "#fbfaf6", ink = "#1c1b19", size = 42 }) {
    const { ctx, c } = L;
    ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);
    const pad = 18; let y = pad;
    ctx.textBaseline = "top";
    if (num != null) { ctx.fillStyle = "#8a867d"; ctx.font = `600 28px ${FONT}`; ctx.fillText(String(num), pad, y); y += 36; }
    ctx.fillStyle = ink; ctx.font = `700 ${size}px ${FONT}`;
    for (const line of wrap(ctx, title, c.width - 2 * pad)) { ctx.fillText(line, pad, y); y += size * 1.15; }
    if (sub) { ctx.fillStyle = "#6b6862"; ctx.font = `500 32px ${FONT}`; for (const line of wrap(ctx, sub, c.width - 2 * pad).slice(0, 1)) { ctx.fillText(line, pad, y + 4); } }
    L.tex.needsUpdate = true;
  }

  // ---------- Picking ----------
  const pickables = [];
  const pickable = (obj, kind, id) => { obj.userData.pick = { kind, id }; pickables.push(obj); return obj; };

  // ---------- Track spaces ----------
  const spaceMat = mat("#b9b3a4");
  const spaces = STAGE_ORDER.map((slug, i) => {
    const r = spaceRect(i);
    const g = new THREE.Group(); g.position.set(r.x, SLAB, r.z);
    const block = mesh(new THREE.BoxGeometry(r.w, SPACE_H, r.d), spaceMat); block.position.y = SPACE_H / 2; g.add(block);
    const L = makeLabel(r.w - 0.14, r.d - 0.14); L.plane.position.y = SPACE_H + 0.003; g.add(L.plane);
    drawLabel(L, { title: STAGES[slug], num: i + 1, size: r.side ? 34 : 40 });
    pickable(g, "stage", slug); scene.add(g);
    return { slug, r, g };
  });
  // Where a pawn stands on its space: k-th of n pawns sharing it.
  function pawnSlot(i, k, n) {
    const r = spaceRect(i), off = (k - (n - 1) / 2) * 0.95;
    return r.side ? new THREE.Vector3(r.x, SLAB + SPACE_H, r.z + 0.4 + off) : new THREE.Vector3(r.x + 0.55 + off, SLAB + SPACE_H, r.z + 0.22);
  }
  const spaceCenter = (i) => { const r = spaceRect(i); return new THREE.Vector3(r.x, SLAB + SPACE_H, r.z + (r.side ? 0 : 0.22)); };

  // ---------- District tiles ----------
  const tiles = {};
  DISTRICTS.forEach(([slug, name], i) => {
    const r = tileRect(i);
    const g = new THREE.Group(); g.position.set(r.x, SLAB + TILE_H / 2, r.z);
    const m = mat(LEVEL.gray);
    const block = mesh(new THREE.BoxGeometry(r.w, TILE_H, r.d), m); g.add(block);
    const L = makeLabel(r.w - 0.2, r.d - 0.2); L.plane.position.y = TILE_H / 2 + 0.003; g.add(L.plane);
    pickable(g, "district", slug); scene.add(g);
    tiles[slug] = { slug, name, r, g, m, L, sig: null, flipKey: undefined, flips: 0, level: null, top: SLAB + TILE_H };
  });
  function tileSub(d, s) {
    if (d.kind === "manual") return d.stale ? "stale" : "";
    if (d.kind === "sales") { const n = s.todayOrders.length; return n + (n === 1 ? " order today" : " orders today"); }
    if (d.kind === "roas") return s.meta && s.meta.roas !== null ? "ROAS " + s.meta.roas.toFixed(2) : "no data";
    if (d.kind === "stock") return d.level === "gray" ? "no data" : "";
    return "";
  }
  function paintTile(t, d, sub) {
    t.m.color.set(LEVEL[d.level] || LEVEL.gray);
    drawLabel(t.L, { title: t.name, sub, bg: d.level === "gray" ? "#eeece7" : "#fbfaf6", ink: d.level === "gray" ? "#6b6862" : "#1c1b19" });
    t.level = d.level;
  }

  // ---------- Pawns (low-poly, built here) ----------
  function topHat() { // Status
    const g = new THREE.Group(), body = mat("#4a1626", { flatShading: true }), gold = mat("#c9a45c", { flatShading: true });
    const brim = mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.06, 14), body); brim.position.y = 0.03;
    const crown = mesh(new THREE.CylinderGeometry(0.3, 0.27, 0.56, 14), body); crown.position.y = 0.34;
    const band = mesh(new THREE.CylinderGeometry(0.285, 0.28, 0.1, 14), gold); band.position.y = 0.13;
    g.add(brim, crown, band); return g;
  }
  function boneCart() { // Catacombes de Paris
    const g = new THREE.Group(), wood = mat("#3a332b", { flatShading: true }), iron = mat("#6f685a", { flatShading: true }), bone = mat("#e9e0cb", { flatShading: true });
    const bed = mesh(new THREE.BoxGeometry(0.78, 0.07, 0.5), wood); bed.position.y = 0.26;
    const wallGeoL = new THREE.BoxGeometry(0.78, 0.2, 0.05), wallGeoS = new THREE.BoxGeometry(0.05, 0.2, 0.5);
    for (const z of [-0.225, 0.225]) { const w = mesh(wallGeoL, wood); w.position.set(0, 0.38, z); g.add(w); }
    for (const x of [-0.365, 0.365]) { const w = mesh(wallGeoS, wood); w.position.set(x, 0.38, 0); g.add(w); }
    const wheelGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.06, 10); wheelGeo.rotateX(Math.PI / 2);
    for (const z of [-0.3, 0.3]) { const w = mesh(wheelGeo, iron); w.position.set(-0.08, 0.2, z); g.add(w); }
    const shaftGeo = new THREE.BoxGeometry(0.5, 0.04, 0.04);
    for (const z of [-0.2, 0.2]) { const sft = mesh(shaftGeo, wood); sft.position.set(0.6, 0.2, z); sft.rotation.z = -0.28; g.add(sft); }
    const leg = mesh(new THREE.BoxGeometry(0.04, 0.24, 0.04), wood); leg.position.set(0.3, 0.12, 0); g.add(leg);
    // The load: a small pile of bones.
    const shaft = new THREE.CylinderGeometry(0.028, 0.028, 0.46, 5); shaft.rotateZ(Math.PI / 2);
    const knob = new THREE.IcosahedronGeometry(0.058, 0);
    const pile = [[-0.05, 0.44, -0.1, 0.2, 0.1], [0.02, 0.45, 0.08, -0.5, -0.1], [-0.02, 0.5, 0, 1.2, 0.25], [0.08, 0.53, -0.04, 0.6, -0.2], [-0.1, 0.55, 0.05, -0.9, 0.15]];
    for (const [x, y, z, ry, rz] of pile) {
      const b = new THREE.Group(); b.add(mesh(shaft, bone));
      for (const e of [-0.23, 0.23]) { const k = mesh(knob, bone); k.position.x = e; b.add(k); }
      b.position.set(x, y, z); b.rotation.set(0, ry, rz); g.add(b);
    }
    g.add(bed); return g;
  }
  function coin() { // Trade and Triumph
    const g = new THREE.Group();
    const rim = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 16), mat("#1f4a3a", { flatShading: true })); rim.position.y = 0.06;
    const face = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 16), mat("#c7a548", { flatShading: true })); face.position.y = 0.125;
    const boss = mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.05, 8), mat("#1f4a3a", { flatShading: true })); boss.position.y = 0.16;
    g.add(rim, face, boss); return g;
  }
  const PAWN_BUILD = { "status": topHat, "catacombes-de-paris": boneCart, "trade-and-triumph": coin };
  const pawns = {};
  for (const [slug, build] of Object.entries(PAWN_BUILD)) {
    const g = build(); g.visible = false; pickable(g, "title", slug); scene.add(g);
    pawns[slug] = { g, stage: undefined, moving: false, slides: 0 };
  }

  // ---------- Order tokens on Sales ----------
  const TOKEN_H = 0.045, PILE = 10, PILES_PER_ROW = 8;
  const tokenGeo = new THREE.CylinderGeometry(0.11, 0.11, TOKEN_H - 0.006, 12);
  const tokenMat = { shopify: mat("#3b6fd6"), amazon: mat("#d98b0b"), upgrade: mat("#c9d8f6") };
  const tokens = new Map(); // order id -> mesh
  const tokenGroup = new THREE.Group(); pickable(tokenGroup, "district", "sales"); scene.add(tokenGroup);
  function tokenPos(i) {
    const t = tiles["sales"], pile = Math.floor(i / PILE), lvl = i % PILE;
    return new THREE.Vector3(t.r.x - t.r.w / 2 + 0.34 + (pile % PILES_PER_ROW) * 0.255, t.top + TOKEN_H / 2 + lvl * TOKEN_H, t.r.z + 0.08 + Math.floor(pile / PILES_PER_ROW) * 0.27);
  }

  // ---------- Agent meeples ----------
  const meepleShape = new THREE.Shape([[-0.07, 0.38], [-0.27, 0.3], [-0.28, 0.19], [-0.12, 0.2], [-0.24, 0], [-0.07, 0], [0, 0.11], [0.07, 0], [0.24, 0], [0.12, 0.2], [0.28, 0.19], [0.27, 0.3], [0.07, 0.38]].map(([x, y]) => new THREE.Vector2(x, y)));
  const meepleBody = new THREE.ExtrudeGeometry(meepleShape, { depth: 0.14, bevelEnabled: false }); meepleBody.translate(0, 0, -0.07);
  const meepleHead = new THREE.CylinderGeometry(0.115, 0.115, 0.14, 10); meepleHead.rotateX(Math.PI / 2);
  const poleGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.62, 5);
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0.16, 0, -0.24, 0.08, 0], 3)); flagGeo.computeVertexNormals();
  const poleMat = mat("#2a2926"), flagMat = new THREE.MeshLambertMaterial({ color: LEVEL.bad, side: THREE.DoubleSide });
  const meeples = {};
  function meepleHome(place, i) { const t = tiles[place] || tiles["agent-hq"]; return new THREE.Vector3(t.r.x + (i - 1) * 0.62, t.top, t.r.z + 0.42); }
  function setFlag(m, u) { m.flagU = u; m.pole.visible = m.flag.visible = u > 0.001; m.flag.position.y = 0.2 + 0.5 * u; }

  // ---------- Run 1 box stack ----------
  const BOX_COPIES = 100, BOX_N = 50, BOX_H = 0.14;
  const run = { x: -BW / 2 - 1.75, z: 1.4, n: -1, boxes: [], left: null };
  const runGroup = new THREE.Group(); runGroup.position.set(run.x, 0, run.z); pickable(runGroup, "run", "status"); scene.add(runGroup);
  const pallet = mesh(new THREE.BoxGeometry(2.45, 0.07, 1.7), mat("#a58f6c", { flatShading: true })); pallet.position.y = 0.035; runGroup.add(pallet);
  const boxGeo = new THREE.BoxGeometry(0.66, BOX_H - 0.012, 0.66), boxMats = [mat("#4a1626"), mat("#5a1d30")];
  for (let k = 0; k < BOX_N; k++) { // stacks of 10, three across
    const b = mesh(boxGeo, boxMats[k % 2]); const st = Math.floor(k / 10), lvl = k % 10;
    b.position.set(-0.78 + (st % 3) * 0.78, 0.07 + BOX_H / 2 + lvl * BOX_H, -0.4 + Math.floor(st / 3) * 0.8); b.visible = false; runGroup.add(b); run.boxes.push(b);
  }
  const runLabel = makeLabel(2.3, 0.62); runLabel.plane.position.set(0, 0.004, 1.3); runGroup.add(runLabel.plane);

  // ---------- Render on demand + tweens ----------
  const tweens = []; let raf = 0, disposed = false, frames = 0, lastFrameMs = 0;
  function tween(dur, fn, delay = 0, done) {
    if (reduceMotion) { fn(1); done && done(); invalidate(); return; }
    tweens.push({ t0: performance.now() + delay * 1000, dur: dur * 1000, fn, done }); invalidate();
  }
  function invalidate() { if (!raf && !disposed) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0; if (disposed) return;
    const t0 = performance.now();
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i], k = (now - tw.t0) / tw.dur;
      if (k < 0) continue;
      tw.fn(Math.min(k, 1));
      if (k >= 1) { tweens.splice(i, 1); tw.done && tw.done(); }
    }
    const moved = controls.update();
    renderer.render(scene, camera);
    frames++; lastFrameMs = performance.now() - t0;
    if (tweens.length || moved) invalidate();
  }
  controls.addEventListener("change", invalidate);
  let userMoved = false; controls.addEventListener("start", () => { userMoved = true; });

  // Keep the board centered in the part of the scene not covered by the mats and the hand.
  let inset = { right: 0, bottom: 0 };
  function resize() {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const dx = Math.min(inset.right, w * 0.45) / 2, dy = Math.min(inset.bottom, h * 0.4) / 2;
    if (dx || dy) camera.setViewOffset(w, h, dx, dy, w, h); else camera.clearViewOffset();
    // Until the camera is touched, stand far enough back that the whole board fits the free area.
    if (!userMoved) {
      const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), fx = 1 - 2 * dx / w, fy = 1 - 2 * dy / h;
      const dist = Math.min(controls.maxDistance, Math.max(18, 1.06 * Math.max(9.6 / (t * camera.aspect * fx), 4.6 / (t * fy))));
      camera.position.copy(CENTER).addScaledVector(VIEW_DIR, dist); controls.update();
    }
    camera.updateProjectionMatrix(); invalidate();
  }
  const ro = new ResizeObserver(resize); ro.observe(host);
  const mq = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
  mq && mq.addEventListener && mq.addEventListener("change", applyTheme);
  applyTheme(); resize();

  // ---------- Pointer: click a piece or tile for details ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let down = null;
  function pickAt(ev) {
    const b = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - b.left) / b.width) * 2 - 1, -((ev.clientY - b.top) / b.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables.filter((o) => o.visible), true)[0];
    for (let o = hit && hit.object; o; o = o.parent) if (o.userData.pick) return o.userData.pick;
    return null;
  }
  const onDown = (ev) => { down = { x: ev.clientX, y: ev.clientY }; };
  const onUp = (ev) => { if (down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 5) { const p = pickAt(ev); if (p) onPick(p.kind, p.id); } down = null; };
  let moveQueued = false;
  const onMove = (ev) => { if (moveQueued || ev.buttons) return; moveQueued = true; requestAnimationFrame(() => { moveQueued = false; canvas.style.cursor = pickAt(ev) ? "pointer" : "grab"; }); };
  canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointermove", onMove);

  // ---------- Update from a new state. Motion happens only where the state changed. ----------
  let first = true;
  function update(s) {
    // Tiles: color and label; a tile flips when its line changes.
    for (const d of s.districts) {
      const t = tiles[d.slug]; if (!t) continue;
      const sub = tileSub(d, s), sig = d.level + "|" + sub;
      // What counts as "the line changed": a new status or stock event; for Marketing, a new gate color.
      const flipKey = d.kind === "manual" || d.kind === "stock" ? (d.event ? d.event.id : null) : d.kind === "roas" ? d.level : undefined;
      const flip = !first && flipKey !== undefined && t.flipKey !== undefined && flipKey !== t.flipKey;
      t.flipKey = flipKey;
      if (flip) {
        t.flips++; let painted = false; const y0 = SLAB + TILE_H / 2;
        const riders = Object.values(meeples).filter((m) => m.place === d.slug && !m.walking);
        tween(0.9, (k) => {
          const lift = Math.sin(Math.PI * k);
          t.g.position.y = y0 + lift * 1.15; t.g.rotation.x = Math.PI * 2 * ease(k);
          for (const m of riders) m.g.position.y = t.top + lift * 2.1;
          if (k >= 0.5 && !painted) { painted = true; paintTile(t, d, sub); }
        }, 0, () => { t.g.rotation.x = 0; t.g.position.y = y0; });
      } else if (sig !== t.sig) paintTile(t, d, sub);
      t.sig = sig;
    }

    // Pawns: stand on their stage; slide along the track when the stage changes.
    const onStage = {};
    for (const t of s.titles) { const i = STAGE_ORDER.indexOf(t.stageSlug); if (i >= 0) (onStage[i] = onStage[i] || []).push(t.slug); }
    for (const t of s.titles) {
      const p = pawns[t.slug]; if (!p) continue;
      const i = STAGE_ORDER.indexOf(t.stageSlug);
      if (i < 0) { p.g.visible = false; p.stage = null; continue; }
      const target = pawnSlot(i, onStage[i].indexOf(t.slug), onStage[i].length);
      const from = p.stage;
      p.stage = i; p.g.visible = true;
      if (first || from == null || from === i) { if (!p.moving) p.g.position.copy(target); continue; }
      // Walk the track space by space, the short way round (Retired and Concept are neighbours).
      const fwd = (i - from + 10) % 10, step = fwd <= 5 ? 1 : -1, n = fwd <= 5 ? fwd : 10 - fwd;
      const pts = [p.g.position.clone()];
      for (let k = 1; k < n; k++) pts.push(spaceCenter((from + step * k + 10) % 10));
      pts.push(target);
      p.moving = true; p.slides++;
      tween(0.5 * n, (k) => {
        const f = k * n, seg = Math.min(Math.floor(f), n - 1);
        p.g.position.lerpVectors(pts[seg], pts[seg + 1], ease(f - seg));
      }, 0, () => { p.moving = false; p.g.position.copy(target); });
    }

    // Order tokens: today's orders stacked on Sales, oldest at the bottom; new ones drop in.
    const list = [...s.todayOrders].reverse(), ids = new Set(list.map((o) => o.id));
    for (const [id, m] of tokens) if (!ids.has(id)) { tokenGroup.remove(m); tokens.delete(id); } // new LA day, or an order removed
    let fresh = 0;
    list.forEach((o, i) => {
      const pos = tokenPos(i); let m = tokens.get(o.id);
      if (m) { if (!m.userData.falling) m.position.copy(pos); return; }
      m = mesh(tokenGeo, o.details && o.details.upgrade_of ? tokenMat.upgrade : tokenMat[o.source] || tokenMat.shopify);
      tokens.set(o.id, m); tokenGroup.add(m);
      if (first) { m.position.copy(pos); return; }
      m.userData.falling = true; m.position.set(pos.x, pos.y + 4, pos.z); m.visible = false;
      tween(0.7, (k) => { m.visible = true; m.position.y = pos.y + 4 * (1 - bounce(k)); }, 0.15 * fresh++, () => { m.userData.falling = false; m.position.copy(pos); });
    });

    // Meeples: on Agent HQ, or on the district they are working in; flag up when waiting or blocked.
    s.agents.forEach((a, i) => {
      let m = meeples[a.slug];
      if (!m) {
        const g = new THREE.Group(), bm = mat(LEVEL.gray);
        const body = mesh(meepleBody, bm), head = mesh(meepleHead, bm); head.position.y = 0.47;
        const pole = mesh(poleGeo, poleMat); pole.position.set(0.3, 0.51, 0);
        const flag = mesh(flagGeo, flagMat, { cast: false }); flag.position.set(0.3, 0.7, 0);
        g.add(body, head, pole, flag); pickable(g, "agent", a.slug); scene.add(g);
        m = meeples[a.slug] = { g, bm, pole, flag, place: null, flagUp: null, flagU: 0, walking: false, walks: 0 };
      }
      m.bm.color.set(LEVEL[a.level] || LEVEL.gray);
      const place = a.workingAt && tiles[a.workingAt] ? a.workingAt : "agent-hq";
      const flagUp = !a.silent && (a.state === "waiting" || a.state === "blocked");
      const target = meepleHome(place, i);
      if (first || m.place === null) { m.g.position.copy(target); setFlag(m, flagUp ? 1 : 0); }
      else {
        if (place !== m.place) {
          const from = m.g.position.clone(); from.y = target.y; const dist = from.distanceTo(target), steps = Math.max(2, Math.round(dist / 0.45));
          m.walking = true; m.walks++;
          tween(Math.max(0.6, dist / 3), (k) => { m.g.position.lerpVectors(from, target, ease(k)); m.g.position.y = target.y + Math.abs(Math.sin(k * steps * Math.PI)) * 0.09; }, 0, () => { m.walking = false; m.g.position.copy(target); });
        } else if (!m.walking && !tweens.length) m.g.position.copy(target);
        if (flagUp !== m.flagUp) { const u0 = m.flagU, u1 = flagUp ? 1 : 0; tween(0.5, (k) => setFlag(m, u0 + (u1 - u0) * ease(k))); }
      }
      m.place = place; m.flagUp = flagUp;
    });

    // Run 1: one box per 100 copies left.
    const r = s.statusRun, left = r ? r.left : null;
    const n = left === null ? 0 : Math.max(0, Math.min(BOX_N, Math.ceil(left / BOX_COPIES)));
    if (n !== run.n) { run.boxes.forEach((b, k) => { b.visible = k < n; }); run.n = n; }
    if (left !== run.left) {
      run.left = left;
      drawLabel(runLabel, { title: left === null ? "Run 1" : left >= 0 ? `Run 1 · ${left.toLocaleString("en-US")} left` : `Run 1 · ${(-left).toLocaleString("en-US")} over`, size: 38, bg: "#f3ecdc", ink: "#4a1626" });
    }

    first = false; invalidate();
  }

  // ---------- For tests and the perf note ----------
  function screenOf(kind, id) {
    const o = kind === "district" ? tiles[id].g : kind === "title" ? pawns[id].g : kind === "agent" ? meeples[id].g : kind === "stage" ? spaces.find((x) => x.slug === id).g : runGroup;
    const v = new THREE.Vector3(); o.getWorldPosition(v);
    if (kind === "agent") v.y += 0.25; if (kind === "title") v.y += 0.12; if (kind === "run") { v.y += 0.05; }
    v.project(camera); const b = canvas.getBoundingClientRect();
    return { x: b.left + (v.x + 1) / 2 * b.width, y: b.top + (1 - v.y) / 2 * b.height };
  }
  function debug() {
    return {
      tiles: Object.fromEntries(Object.values(tiles).map((t) => [t.slug, { level: t.level, flips: t.flips }])),
      pawns: Object.fromEntries(Object.entries(pawns).map(([k, p]) => [k, { stage: p.stage == null ? null : STAGE_ORDER[p.stage], visible: p.g.visible, moving: p.moving, slides: p.slides, x: +p.g.position.x.toFixed(2), z: +p.g.position.z.toFixed(2) }])),
      tokens: tokens.size, tokensFalling: [...tokens.values()].filter((m) => m.userData.falling).length,
      meeples: Object.fromEntries(Object.entries(meeples).map(([k, m]) => [k, { place: m.place, flag: m.flagUp, flagU: +m.flagU.toFixed(2), walks: m.walks, color: "#" + m.bm.color.getHexString() }])),
      boxes: run.n, boxesVisible: run.boxes.filter((b) => b.visible && b.parent === runGroup).length, tweens: tweens.length, frames, lastFrameMs: +lastFrameMs.toFixed(2),
      calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, pixelRatio: renderer.getPixelRatio(),
    };
  }

  return {
    update, debug, screenOf,
    setInset(right, bottom) { inset = { right, bottom }; resize(); },
    dispose() {
      disposed = true; cancelAnimationFrame(raf); ro.disconnect();
      mq && mq.removeEventListener && mq.removeEventListener("change", applyTheme);
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointermove", onMove);
      controls.dispose();
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); const ms = o.material ? [].concat(o.material) : []; for (const m of ms) { m.map && m.map.dispose(); m.dispose(); } });
      renderer.dispose(); canvas.remove();
    },
  };
}
