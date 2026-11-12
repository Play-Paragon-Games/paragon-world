// Paragon World board, 3D view (Phase 4, sessions 2 and 3).
// A game board on a wooden table, drawn with three.js: a ring of track spaces around a raised
// center where each district has a small building. Same state object as the flat board
// (World.compute). Renders only when something changes: a camera move or a real event.
// Nothing here animates on its own.
import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";

const V2 = THREE.Vector2;

// ---------- Board geometry (units are arbitrary; the board is 14 x 10.5) ----------
const BW = 14, BD = 10.5, M = 0.3, G = 0.2, TR = 1.6;
const SLAB = 0.3, SPACE_H = 0.12, PLAT_H = 0.2, PLOT_H = 0.06;
const SPACE_W = (BW - 2 * M - 3 * G) / 4;
const MID_W = BW - 2 * M - 2 * TR - 2 * G, MID_D = BD - 2 * M - 2 * TR - 2 * G;
const TILE_W = (MID_W - 3 * G) / 4, TILE_D = (MID_D - 2 * G) / 3;
const PLOT_TOP = SLAB + PLAT_H + PLOT_H;
const PX = 200; // label texture pixels per board unit

// Track: 10 spaces clockwise seen from above. Top row 1-4 left to right, right side 5,
// bottom row 6-9 right to left, left side 10 (Retired, next to Concept).
const rowX = (c) => -BW / 2 + M + SPACE_W / 2 + c * (SPACE_W + G);
const ROW_Z = BD / 2 - M - TR / 2, COL_X = BW / 2 - M - TR / 2;
function spaceRect(i) {
  if (i < 4) return { x: rowX(i), z: -ROW_Z, w: SPACE_W, d: TR, side: false };
  if (i === 4) return { x: COL_X, z: 0, w: TR, d: MID_D, side: true };
  if (i < 9) return { x: rowX(3 - (i - 5)), z: ROW_Z, w: SPACE_W, d: TR, side: false };
  return { x: -COL_X, z: 0, w: TR, d: MID_D, side: true };
}
// Inlaid arrow from space i to the next: where it sits and which way it points (angle about y; 0 = +x).
function arrowAt(i) {
  const gz = MID_D / 2 + G / 2;
  if (i < 3) return { x: rowX(i) + SPACE_W / 2 + G / 2, z: -ROW_Z, a: 0 };
  if (i === 3) return { x: COL_X, z: -gz, a: -Math.PI / 2 };
  if (i === 4) return { x: COL_X, z: gz, a: -Math.PI / 2 };
  if (i < 8) return { x: rowX(3 - (i - 5)) - SPACE_W / 2 - G / 2, z: ROW_Z, a: Math.PI };
  if (i === 8) return { x: -COL_X, z: gz, a: Math.PI / 2 };
  return { x: -COL_X, z: -gz, a: Math.PI / 2 };
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
function rng(seed) { return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296; }

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
  canvas.setAttribute("aria-label", "3D board. Drag to rotate, scroll to zoom, click a building or piece for details.");
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const ROOM = new THREE.Color("#221a14"); // a warm, dim room around the lit table
  scene.background = ROOM; scene.fog = new THREE.Fog(ROOM, 36, 74);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 140);
  const VIEW_DIR = new THREE.Vector3(Math.sin(-0.24) * Math.cos(0.72), Math.sin(0.72), Math.cos(-0.24) * Math.cos(0.72)); // three-quarter view, a little lower than session 2
  const CENTER = new THREE.Vector3(-1.4, 0.5, 0.3); // board plus the box stack on its left
  camera.position.copy(CENTER).addScaledVector(VIEW_DIR, 24);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(CENTER);
  controls.cursor.copy(controls.target); // keeps update() from reporting a change every frame (target clamp round-off)
  controls.enableDamping = true; controls.dampingFactor = 0.12;
  controls.enablePan = false;
  controls.minDistance = 7; controls.maxDistance = 36;
  controls.minPolarAngle = 0.15; controls.maxPolarAngle = 1.42; // never below the table
  controls.update();

  scene.add(new THREE.HemisphereLight(0xfff0d8, 0x4a3524, 1.0));
  const sun = new THREE.DirectionalLight(0xffe6c2, 2.1);
  sun.position.set(8, 14, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -13, right: 11, top: 10, bottom: -10, near: 2, far: 42 });
  sun.shadow.bias = -0.0012; sun.shadow.normalBias = 0.02;
  scene.add(sun);

  const mat = (color, extra) => new THREE.MeshLambertMaterial({ color, ...extra });
  const mesh = (geo, material, opts = {}) => { const m = new THREE.Mesh(geo, material); m.castShadow = opts.cast !== false; m.receiveShadow = opts.receive !== false; return m; };
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // ---------- Table: a wooden surface under the board ----------
  function woodTexture() {
    const c = document.createElement("canvas"); c.width = c.height = 1024; const x = c.getContext("2d"), r = rng(7);
    x.fillStyle = "#6b4a30"; x.fillRect(0, 0, 1024, 1024);
    for (let p = 0; p < 8; p++) { // planks
      const y = p * 128, shade = 0.9 + r() * 0.2;
      x.fillStyle = `rgba(${Math.round(120 * shade)},${Math.round(84 * shade)},${Math.round(54 * shade)},1)`; x.fillRect(0, y, 1024, 128);
      for (let k = 0; k < 46; k++) { // grain
        const gy = y + r() * 128; x.strokeStyle = `rgba(52,33,18,${0.06 + r() * 0.16})`; x.lineWidth = 0.6 + r() * 1.6;
        x.beginPath(); x.moveTo(0, gy); x.bezierCurveTo(340, gy + (r() - 0.5) * 9, 680, gy + (r() - 0.5) * 9, 1024, gy); x.stroke();
      }
      x.fillStyle = "rgba(30,18,10,0.55)"; x.fillRect(0, y, 1024, 3);
      const cut = r() * 1024; x.fillRect(cut, y, 3, 128);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(16, 16); t.anisotropy = maxAniso;
    return t;
  }
  const table = mesh(new THREE.PlaneGeometry(110, 110), new THREE.MeshLambertMaterial({ map: woodTexture() }), { cast: false });
  table.rotation.x = -Math.PI / 2; scene.add(table);

  // ---------- Board: dark slab, the track ring on it, a raised lighter center for the districts ----------
  const slab = mesh(new THREE.BoxGeometry(BW, SLAB, BD), mat("#3a2a1e")); slab.position.y = SLAB / 2; scene.add(slab);
  const felt = mesh(new THREE.PlaneGeometry(BW - 0.16, BD - 0.16), mat("#2c2018"), { cast: false });
  felt.rotation.x = -Math.PI / 2; felt.position.y = SLAB + 0.002; scene.add(felt);
  const plateau = mesh(new THREE.BoxGeometry(MID_W + 0.24, PLAT_H, MID_D + 0.24), mat("#b79d74")); plateau.position.y = SLAB + PLAT_H / 2; scene.add(plateau);

  // ---------- Labels (canvas textures; short text only) ----------
  function makeLabel(w, d, basic) {
    const c = document.createElement("canvas"); c.width = Math.round(w * PX); c.height = Math.round(d * PX);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = maxAniso;
    const plane = mesh(new THREE.PlaneGeometry(w, d), basic ? new THREE.MeshBasicMaterial({ map: tex }) : new THREE.MeshLambertMaterial({ map: tex }), { cast: false });
    return { plane, ctx: c.getContext("2d"), c, tex };
  }
  const flat = (L) => { L.plane.rotation.x = -Math.PI / 2; return L; };
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

  // ---------- Picking ----------
  const pickables = [];
  const pickable = (obj, kind, id) => { obj.userData.pick = { kind, id }; pickables.push(obj); return obj; };

  // ---------- Track spaces: dark wood, brass lettering, lit when a pawn stands on them ----------
  const BRASS = "#d9b872";
  function drawSpace(sp, on) {
    const { ctx, c } = sp.L, i = sp.i;
    ctx.fillStyle = on ? "#a8793c" : "#5a4029"; ctx.fillRect(0, 0, c.width, c.height);
    if (on) { ctx.strokeStyle = "#f3d489"; ctx.lineWidth = 12; ctx.strokeRect(6, 6, c.width - 12, c.height - 12); }
    const pad = 20; let y = pad; ctx.textBaseline = "top";
    ctx.fillStyle = on ? "#fff1cf" : BRASS; ctx.font = `600 28px ${FONT}`; ctx.fillText(String(i + 1), pad, y);
    if (i === 0) { // the marked start
      ctx.fillStyle = BRASS; const w = 128; ctx.fillRect(pad + 36, y - 4, w, 38);
      ctx.fillStyle = "#3a2a1e"; ctx.font = `800 26px ${FONT}`; ctx.fillText("START", pad + 36 + 16, y + 3);
    }
    y += 40;
    ctx.fillStyle = on ? "#fffaf0" : "#f1e2c2"; const size = sp.r.side ? 34 : 40; ctx.font = `700 ${size}px ${FONT}`;
    for (const line of wrap(ctx, STAGES[sp.slug], c.width - 2 * pad)) { ctx.fillText(line, pad, y); y += size * 1.15; }
    sp.L.tex.needsUpdate = true;
  }
  const spaces = STAGE_ORDER.map((slug, i) => {
    const r = spaceRect(i);
    const g = new THREE.Group(); g.position.set(r.x, SLAB, r.z);
    const m = mat("#4a3423");
    const block = mesh(new THREE.BoxGeometry(r.w, SPACE_H, r.d), m); block.position.y = SPACE_H / 2; g.add(block);
    const L = flat(makeLabel(r.w - 0.12, r.d - 0.12)); L.plane.position.y = SPACE_H + 0.003; g.add(L.plane);
    pickable(g, "stage", slug); scene.add(g);
    const sp = { slug, i, r, g, m, L, on: null };
    return sp;
  });
  function lightSpaces(onSet) {
    for (const sp of spaces) { const on = onSet.has(sp.i); if (on !== sp.on) { sp.on = on; sp.m.color.set(on ? "#c9963f" : "#4a3423"); drawSpace(sp, on); } }
  }
  // Brass arrows inlaid between spaces, showing the way round.
  const arrowShape = new THREE.Shape([[-0.2, 0.15], [0.03, 0.15], [0.2, 0], [0.03, -0.15], [-0.2, -0.15], [-0.05, 0]].map(([x, y]) => new V2(x, y)));
  const arrowGeo = new THREE.ExtrudeGeometry(arrowShape, { depth: 0.03, bevelEnabled: false }); arrowGeo.rotateX(-Math.PI / 2);
  const arrowMat = mat("#c9a45c");
  const arrows = STAGE_ORDER.map((_, i) => { const a = arrowAt(i), m = mesh(arrowGeo, arrowMat); m.position.set(a.x, SLAB + SPACE_H - 0.012, a.z); m.rotation.y = a.a; scene.add(m); return m; });

  // Where a pawn stands on its space: k-th of n pawns sharing it.
  function pawnSlot(i, k, n) {
    const r = spaceRect(i), off = (k - (n - 1) / 2) * 0.95;
    if (r.side) return new THREE.Vector3(r.x, SLAB + SPACE_H, r.z + 0.4 + off);
    // Top row: stand on the far half, clear of the buildings in front. Bottom row: the near half.
    return new THREE.Vector3(r.x + 0.7 + off, SLAB + SPACE_H, r.z + (r.z < 0 ? -0.28 : 0.22));
  }
  const spaceCenter = (i) => { const r = spaceRect(i); return new THREE.Vector3(r.x, SLAB + SPACE_H, r.z + (r.side ? 0 : r.z < 0 ? -0.28 : 0.22)); };

  // ---------- District buildings (low-poly, built here) ----------
  // Each building sits at the back of its plot; the front is left free for its name, meeples and tokens.
  // Building-local frame: x across the plot, +z toward the viewer, y = 0 at the plot surface.
  const C = { cream: "#e6d5b0", plaster: "#efe3c8", brick: "#a5543a", brickDark: "#7c3d2a", wood: "#9a744a", dark: "#4f3a2a", slate: "#55606b", terra: "#b5603c", stone: "#d3c9b5", white: "#f4eee2", steel: "#7f878d", gold: "#c9a45c", red: "#b8402f", blue: "#3d5f8f", green: "#2f7a55", yellow: "#d9a21b", card: "#c49a5e", glass: "#8fa3ad", night: "#2d3440", plum: "#3b3350", verdigris: "#6f9a92" };
  function makeBuilding(slug) {
    const g = new THREE.Group(), mats = [];
    const P = (hex) => { const m = mat(hex, { flatShading: true }); m.userData.base = new THREE.Color(hex); mats.push(m); return m; };
    const pal = {}; const K = (name) => pal[name] || (pal[name] = P(C[name]));
    const win = new THREE.MeshLambertMaterial({ color: "#2a2623" }); // windows and lamps: lit when the district is current
    const add = (o, x, y, z) => { o.position.set(x, y, z); g.add(o); return o; };
    const box = (w, h, d, m, x, y, z) => add(mesh(new THREE.BoxGeometry(w, h, d), m), x, y + h / 2, z);
    const cyl = (rt, rb, h, m, x, y, z, seg = 8) => add(mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m), x, y + h / 2, z);
    const prism = (w, h, d, m, x, y, z, ry = 0) => { // gable roof; ridge along z unless turned
      const geo = new THREE.ExtrudeGeometry(new THREE.Shape([new V2(-w / 2, 0), new V2(w / 2, 0), new V2(0, h)]), { depth: d, bevelEnabled: false }); geo.translate(0, 0, -d / 2);
      const o = add(mesh(geo, m), x, y, z); o.rotation.y = ry; return o;
    };
    const W = (w, h, x, y, z) => box(w, h, 0.03, win, x, y, z); // a window on a front wall at z
    let board = null;

    if (slug === "design-studio") { // workshop with a drafting table
      box(1.45, 0.55, 0.8, K("cream"), -0.2, 0, -0.05); prism(0.92, 0.34, 1.55, K("slate"), -0.2, 0.55, -0.05, Math.PI / 2);
      W(0.55, 0.26, -0.45, 0.17, 0.36); box(0.22, 0.38, 0.03, K("dark"), 0.25, 0, 0.36);
      box(0.03, 0.3, 0.03, K("dark"), 0.78, 0, 0.32); box(0.03, 0.3, 0.03, K("dark"), 1.02, 0, 0.32);
      const top = box(0.46, 0.035, 0.36, K("wood"), 0.9, 0.3, 0.34); top.rotation.x = 0.5;
      const paper = box(0.3, 0.012, 0.24, K("white"), 0.9, 0.325, 0.345); paper.rotation.x = 0.5;
    } else if (slug === "art-creative") { // studio with an easel
      box(1.2, 0.62, 0.8, K("plaster"), -0.3, 0, -0.05);
      const roof = box(1.34, 0.06, 0.96, K("terra"), -0.3, 0.66, -0.05); roof.rotation.z = 0.16;
      W(0.72, 0.36, -0.3, 0.14, 0.36);
      const l1 = box(0.03, 0.56, 0.03, K("wood"), 0.7, 0, 0.36); l1.rotation.z = -0.16; const l2 = box(0.03, 0.56, 0.03, K("wood"), 0.94, 0, 0.36); l2.rotation.z = 0.16;
      const l3 = box(0.03, 0.54, 0.03, K("wood"), 0.82, 0, 0.22); l3.rotation.x = -0.3;
      box(0.34, 0.26, 0.02, K("white"), 0.82, 0.22, 0.385); box(0.12, 0.1, 0.012, K("red"), 0.76, 0.3, 0.397); box(0.1, 0.08, 0.012, K("blue"), 0.89, 0.26, 0.397);
    } else if (slug === "production") { // factory with a chimney
      box(1.5, 0.5, 0.8, K("brick"), -0.15, 0, -0.05);
      for (const x of [-0.65, -0.15, 0.35]) prism(0.5, 0.22, 0.8, K("slate"), x, 0.5, -0.05);
      cyl(0.085, 0.12, 1.05, K("brickDark"), 0.86, 0, -0.2); cyl(0.11, 0.11, 0.08, K("dark"), 0.86, 1.05, -0.2);
      for (const x of [-0.65, -0.15, 0.35]) W(0.24, 0.16, x, 0.2, 0.36);
    } else if (slug === "freight") { // crane and containers
      box(0.32, 0.1, 0.32, K("steel"), -0.78, 0, -0.1); box(0.1, 1.25, 0.1, K("yellow"), -0.78, 0.1, -0.1);
      box(1.3, 0.07, 0.07, K("yellow"), -0.3, 1.3, -0.1); box(0.18, 0.16, 0.18, K("white"), -0.78, 1.14, 0.03); W(0.12, 0.08, -0.78, 1.18, 0.125);
      box(0.014, 0.52, 0.014, K("dark"), 0.25, 0.78, -0.1); box(0.1, 0.05, 0.05, K("dark"), 0.25, 0.74, -0.1);
      box(0.64, 0.24, 0.27, K("red"), 0.45, 0, -0.22); box(0.64, 0.24, 0.27, K("blue"), 0.45, 0, 0.1); box(0.64, 0.24, 0.27, K("green"), 0.45, 0.24, -0.06);
    } else if (slug === "warehouse") { // shed with stacked boxes
      box(1.55, 0.45, 0.85, K("stone"), -0.25, 0, -0.05); prism(0.97, 0.2, 1.65, K("steel"), -0.25, 0.45, -0.05, Math.PI / 2);
      box(0.5, 0.34, 0.03, K("dark"), -0.5, 0, 0.385); W(0.3, 0.12, 0.15, 0.24, 0.385);
      box(0.26, 0.2, 0.26, K("card"), 0.82, 0, 0.26); box(0.26, 0.2, 0.26, K("card"), 0.86, 0, -0.06); box(0.24, 0.2, 0.24, K("card"), 0.84, 0.2, 0.1);
    } else if (slug === "sales") { // shop with a striped awning
      box(1.3, 0.62, 0.75, K("plaster"), 0, 0, -0.1); box(1.36, 0.08, 0.81, K("terra"), 0, 0.62, -0.1);
      for (let k = 0; k < 6; k++) { const s = box(0.2, 0.03, 0.34, K(k % 2 ? "white" : "red"), -0.5 + k * 0.2, 0.4, 0.42); s.rotation.x = 0.36; }
      box(0.24, 0.36, 0.03, K("dark"), 0, 0, 0.29); W(0.34, 0.2, -0.4, 0.12, 0.29); W(0.34, 0.2, 0.4, 0.12, 0.29);
    } else if (slug === "crowdfunding") { // stage with a banner
      box(1.7, 0.14, 0.8, K("wood"), 0, 0, -0.05); box(1.7, 0.72, 0.06, K("plum"), 0, 0.14, -0.42);
      box(0.06, 0.98, 0.06, K("dark"), -0.82, 0.14, 0.3); box(0.06, 0.98, 0.06, K("dark"), 0.82, 0.14, 0.3);
      box(1.6, 0.28, 0.03, K("green"), 0, 0.84, 0.3); box(1.1, 0.05, 0.036, K("white"), 0, 0.955, 0.3);
      for (const x of [-0.6, -0.2, 0.2, 0.6]) box(0.1, 0.1, 0.04, win, x, 0.7, -0.375); // stage lights
    } else if (slug === "marketing") { // billboard showing 7-day ROAS
      box(0.08, 0.5, 0.08, K("steel"), -0.6, 0, -0.1); box(0.08, 0.5, 0.08, K("steel"), 0.6, 0, -0.1);
      box(1.84, 0.88, 0.08, K("night"), 0, 0.44, -0.1);
      board = makeLabel(1.7, 0.74, true); add(board.plane, 0, 0.88, -0.055);
      box(0.12, 0.05, 0.14, win, -0.5, 0.4, 0.0); box(0.12, 0.05, 0.14, win, 0.5, 0.4, 0.0); // lamps under the board
    } else if (slug === "customer-service") { // post office with a bell
      box(1.3, 0.55, 0.8, K("cream"), -0.1, 0, -0.1); prism(0.92, 0.3, 1.4, K("blue"), -0.1, 0.55, -0.1, Math.PI / 2);
      box(0.24, 0.36, 0.03, K("blue"), -0.1, 0, 0.31); W(0.28, 0.2, -0.5, 0.2, 0.31); W(0.28, 0.2, 0.3, 0.2, 0.31);
      box(0.04, 0.3, 0.04, K("white"), -0.24, 0.8, -0.1); box(0.04, 0.3, 0.04, K("white"), 0.04, 0.8, -0.1); box(0.4, 0.05, 0.22, K("blue"), -0.1, 1.1, -0.1);
      cyl(0.035, 0.1, 0.15, K("gold"), -0.1, 0.92, -0.1, 8); // the bell
      box(0.03, 0.16, 0.03, K("dark"), 0.86, 0, 0.3); box(0.14, 0.16, 0.12, K("blue"), 0.86, 0.16, 0.3); // mailbox
    } else if (slug === "finance") { // bank with columns
      box(1.7, 0.08, 1.0, K("stone"), 0, 0, 0); box(1.4, 0.6, 0.6, K("stone"), 0, 0.08, -0.2);
      for (const x of [-0.6, -0.2, 0.2, 0.6]) cyl(0.06, 0.07, 0.6, K("white"), x, 0.08, 0.32, 8);
      box(1.6, 0.08, 0.9, K("stone"), 0, 0.68, -0.05); prism(1.6, 0.3, 0.9, K("stone"), 0, 0.76, -0.05);
      box(0.2, 0.38, 0.03, K("gold"), 0, 0.08, 0.11); W(0.2, 0.3, -0.4, 0.2, 0.11); W(0.2, 0.3, 0.4, 0.2, 0.11);
      const coin = cyl(0.09, 0.09, 0.03, K("gold"), 0, 0.84, 0.41, 10); coin.rotation.x = Math.PI / 2;
    } else if (slug === "legal") { // courthouse with a dome
      box(1.8, 0.06, 1.05, K("stone"), 0, 0, 0); box(1.5, 0.06, 0.9, K("stone"), 0, 0.06, -0.03);
      box(1.3, 0.55, 0.6, K("plaster"), 0, 0.12, -0.2); box(1.4, 0.07, 0.72, K("stone"), 0, 0.67, -0.18);
      for (const x of [-0.5, -0.17, 0.17, 0.5]) cyl(0.05, 0.06, 0.55, K("white"), x, 0.12, 0.2, 8);
      cyl(0.36, 0.36, 0.1, K("stone"), 0, 0.74, -0.2, 10);
      add(mesh(new THREE.SphereGeometry(0.33, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), K("verdigris")), 0, 0.84, -0.2);
      box(0.2, 0.36, 0.03, K("dark"), 0, 0.12, 0.11); W(0.18, 0.26, -0.4, 0.26, 0.11); W(0.18, 0.26, 0.4, 0.26, 0.11);
    } else { // agent-hq: an office block; the meeples stand outside
      box(1.0, 1.05, 0.7, K("glass"), -0.3, 0, -0.15); box(1.06, 0.05, 0.76, K("night"), -0.3, 1.05, -0.15); box(0.02, 0.4, 0.02, K("dark"), -0.55, 1.1, -0.3);
      for (const y of [0.14, 0.44, 0.74]) W(0.8, 0.15, -0.3, y, 0.205);
      box(0.55, 0.5, 0.6, K("steel"), 0.5, 0, -0.15); W(0.36, 0.14, 0.5, 0.22, 0.155);
    }
    // Lantern on a post at the front corner: amber for warn, red for bad, unlit otherwise.
    box(0.035, 0.42, 0.035, K("dark"), -1.06, 0, 0.6);
    const lamp = new THREE.MeshLambertMaterial({ color: "#3a3531" });
    box(0.13, 0.14, 0.13, lamp, -1.06, 0.42, 0.6); box(0.17, 0.03, 0.17, K("dark"), -1.06, 0.56, 0.6);
    return { g, mats, win, lamp, board };
  }
  function drawBoard(b, d, s) { // the Marketing billboard
    const { ctx, c } = b.board, m = s.meta, live = d.level !== "gray" && m && m.roas !== null;
    ctx.fillStyle = live ? "#fbf3df" : "#3a3836"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.textBaseline = "top"; ctx.fillStyle = live ? "#6b5a45" : "#8b8782"; ctx.font = `700 26px ${FONT}`; ctx.fillText("7-DAY ROAS", 22, 16);
    if (live) {
      ctx.fillStyle = "#231a12"; ctx.font = `800 84px ${FONT}`; ctx.fillText(m.roas.toFixed(2), 20, 46);
      const word = { bad: "STEP DOWN", warn: "HOLD", good: "STEP UP" }[m.gate] || "", col = { bad: "#c0392b", warn: "#c97a06", good: "#1f8a4c" }[m.gate] || "#6b5a45";
      ctx.font = `800 30px ${FONT}`; const w = ctx.measureText(word).width; ctx.fillStyle = col; ctx.fillRect(c.width - w - 46, 60, w + 28, 46);
      ctx.fillStyle = "#fff"; ctx.fillText(word, c.width - w - 32, 68);
    } else { ctx.font = `700 40px ${FONT}`; ctx.fillText("no data yet", 22, 60); }
    b.board.tex.needsUpdate = true;
  }

  // ---------- District plots ----------
  const SIGN_Y = { "design-studio": 1.0, "art-creative": 0.92, "production": 1.25, "freight": 1.5, "warehouse": 0.78, "sales": 0.82, "crowdfunding": 1.22, "marketing": 1.42, "customer-service": 1.24, "finance": 1.16, "legal": 1.28, "agent-hq": 1.56 };
  const tiles = {};
  DISTRICTS.forEach(([slug, name], i) => {
    const r = tileRect(i);
    const g = new THREE.Group(); g.position.set(r.x, SLAB + PLAT_H, r.z);
    const pm = mat("#e3d2aa");
    const plot = mesh(new THREE.BoxGeometry(r.w, PLOT_H, r.d), pm); plot.position.y = PLOT_H / 2; g.add(plot);
    const b = makeBuilding(slug); b.g.position.set(0, PLOT_H, -0.45); g.add(b.g);
    // Name sign above the building. A sprite, so it faces the camera from any angle.
    const sc = document.createElement("canvas"), sx = sc.getContext("2d"); sx.font = `700 44px ${FONT}`;
    sc.width = Math.ceil(sx.measureText(name).width) + 52; sc.height = 74;
    const stex = new THREE.CanvasTexture(sc); stex.colorSpace = THREE.SRGBColorSpace; stex.anisotropy = maxAniso;
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: stex })); sign.center.set(0.5, 0); sign.scale.set(sc.width / 250, sc.height / 250, 1);
    sign.position.set(0, PLOT_H + SIGN_Y[slug], -0.45); g.add(sign);
    const L = { c: sc, ctx: sx, tex: stex };
    pickable(g, "district", slug); scene.add(g);
    tiles[slug] = { slug, name, r, g, pm, L, b, sig: null, flipKey: undefined, flips: 0, level: null, top: PLOT_TOP, lit: null, lantern: null };
  });
  // Status on the building: lit windows when current, amber or red lantern for warn or bad, dark and gray when stale.
  function paintTile(t, d, s) {
    const current = d.level !== "gray";
    for (const m of t.b.mats) {
      if (current) m.color.copy(m.userData.base);
      else { const c = m.userData.base, l = (c.r * 0.3 + c.g * 0.59 + c.b * 0.11) * 0.62 + 0.035; m.color.setRGB(l, l, l * 0.98); }
    }
    t.b.win.color.set(current ? "#ffe6a8" : "#262321"); t.b.win.emissive.set(current ? "#f5b54a" : "#000000");
    const lantern = current && (d.level === "warn" || d.level === "bad") ? d.level : null;
    t.b.lamp.color.set(lantern === "bad" ? "#ff5a48" : lantern === "warn" ? "#ffb526" : "#3a3531");
    t.b.lamp.emissive.set(lantern === "bad" ? "#e02b1d" : lantern === "warn" ? "#e08a00" : "#000000");
    t.pm.color.set(current ? "#e3d2aa" : "#a8a296");
    const { ctx, c } = t.L; ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = current ? "#fbf3df" : "#b9b3a7"; ctx.strokeStyle = current ? "#3a2a1e" : "#6e6a62"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.roundRect(3, 3, c.width - 6, c.height - 6, 18); ctx.fill(); ctx.stroke();
    ctx.textBaseline = "middle"; ctx.textAlign = "center"; ctx.fillStyle = current ? "#2a1f15" : "#55514a"; ctx.font = `700 44px ${FONT}`; ctx.fillText(t.name, c.width / 2, c.height / 2 + 3);
    t.L.tex.needsUpdate = true;
    if (t.b.board) drawBoard(t.b, d, s);
    t.level = d.level; t.lit = current; t.lantern = lantern;
  }

  // ---------- Pawns (low-poly, built here) ----------
  function topHat() { // Status
    const g = new THREE.Group(), body = mat("#5a1a2e", { flatShading: true }), gold = mat("#c9a45c", { flatShading: true });
    const brim = mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.06, 14), body); brim.position.y = 0.03;
    const crown = mesh(new THREE.CylinderGeometry(0.3, 0.27, 0.56, 14), body); crown.position.y = 0.34;
    const band = mesh(new THREE.CylinderGeometry(0.285, 0.28, 0.1, 14), gold); band.position.y = 0.13;
    g.add(brim, crown, band); return g;
  }
  function boneCart() { // Catacombes de Paris
    const g = new THREE.Group(), wood = mat("#6b5238", { flatShading: true }), iron = mat("#8a8275", { flatShading: true }), bone = mat("#efe6d2", { flatShading: true });
    const bed = mesh(new THREE.BoxGeometry(0.78, 0.07, 0.5), wood); bed.position.y = 0.26;
    const wallGeoL = new THREE.BoxGeometry(0.78, 0.2, 0.05), wallGeoS = new THREE.BoxGeometry(0.05, 0.2, 0.5);
    for (const z of [-0.225, 0.225]) { const w = mesh(wallGeoL, wood); w.position.set(0, 0.38, z); g.add(w); }
    for (const x of [-0.365, 0.365]) { const w = mesh(wallGeoS, wood); w.position.set(x, 0.38, 0); g.add(w); }
    const wheelGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.06, 10); wheelGeo.rotateX(Math.PI / 2);
    for (const z of [-0.3, 0.3]) { const w = mesh(wheelGeo, iron); w.position.set(-0.08, 0.2, z); g.add(w); }
    const shaftGeo = new THREE.BoxGeometry(0.5, 0.04, 0.04);
    for (const z of [-0.2, 0.2]) { const sft = mesh(shaftGeo, wood); sft.position.set(0.6, 0.2, z); sft.rotation.z = -0.28; g.add(sft); }
    const leg = mesh(new THREE.BoxGeometry(0.04, 0.24, 0.04), wood); leg.position.set(0.3, 0.12, 0); g.add(leg);
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
    const rim = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 16), mat("#1f5a44", { flatShading: true })); rim.position.y = 0.06;
    const face = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 16), mat("#d4b04f", { flatShading: true })); face.position.y = 0.125;
    const boss = mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.05, 8), mat("#1f5a44", { flatShading: true })); boss.position.y = 0.16;
    g.add(rim, face, boss); return g;
  }
  const PAWN_BUILD = { "status": topHat, "catacombes-de-paris": boneCart, "trade-and-triumph": coin };
  const pawns = {};
  for (const [slug, build] of Object.entries(PAWN_BUILD)) {
    const g = build(); g.visible = false; pickable(g, "title", slug); scene.add(g);
    pawns[slug] = { g, stage: undefined, moving: false, slides: 0 };
  }

  // ---------- Order tokens, stacked in front of the shop ----------
  const TOKEN_H = 0.045, PILE = 10, PILES_PER_ROW = 8;
  const tokenGeo = new THREE.CylinderGeometry(0.11, 0.11, TOKEN_H - 0.006, 12);
  const tokenMat = { shopify: mat("#3b6fd6"), amazon: mat("#e08f10"), upgrade: mat("#c9d8f6") };
  const tokens = new Map(); // order id -> mesh
  const tokenGroup = new THREE.Group(); pickable(tokenGroup, "district", "sales"); scene.add(tokenGroup);
  function tokenPos(i) {
    const t = tiles["sales"], pile = Math.floor(i / PILE), lvl = i % PILE;
    return new THREE.Vector3(t.r.x - t.r.w / 2 + 0.3 + (pile % PILES_PER_ROW) * 0.255, t.top + TOKEN_H / 2 + lvl * TOKEN_H, t.r.z + 0.36 + Math.floor(pile / PILES_PER_ROW) * 0.26);
  }

  // ---------- Agent meeples ----------
  const LEVEL = { info: "#3b6fd6", good: "#1f9d55", warn: "#e08f10", bad: "#d7342c", gray: "#8f8a80" };
  const meepleShape = new THREE.Shape([[-0.07, 0.38], [-0.27, 0.3], [-0.28, 0.19], [-0.12, 0.2], [-0.24, 0], [-0.07, 0], [0, 0.11], [0.07, 0], [0.24, 0], [0.12, 0.2], [0.28, 0.19], [0.27, 0.3], [0.07, 0.38]].map(([x, y]) => new V2(x, y)));
  const meepleBody = new THREE.ExtrudeGeometry(meepleShape, { depth: 0.14, bevelEnabled: false }); meepleBody.translate(0, 0, -0.07);
  const meepleHead = new THREE.CylinderGeometry(0.115, 0.115, 0.14, 10); meepleHead.rotateX(Math.PI / 2);
  const poleGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.62, 5);
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0.16, 0, -0.24, 0.08, 0], 3)); flagGeo.computeVertexNormals();
  const poleMat = mat("#2a2926"), flagMat = new THREE.MeshLambertMaterial({ color: "#e23a2e", side: THREE.DoubleSide });
  const meeples = {};
  // Outside the building, at the front of the plot.
  function meepleHome(place, i) { const t = tiles[place] || tiles["agent-hq"]; return new THREE.Vector3(t.r.x + 0.15 + (i - 1) * 0.5, t.top, t.r.z + 0.34); }
  function setFlag(m, u) { m.flagU = u; m.pole.visible = m.flag.visible = u > 0.001; m.flag.position.y = 0.2 + 0.5 * u; }

  // ---------- Run 1 box stack ----------
  const BOX_COPIES = 100, BOX_N = 50, BOX_H = 0.14;
  const run = { x: -BW / 2 - 1.75, z: 1.4, n: -1, boxes: [], left: null };
  const runGroup = new THREE.Group(); runGroup.position.set(run.x, 0, run.z); pickable(runGroup, "run", "status"); scene.add(runGroup);
  const pallet = mesh(new THREE.BoxGeometry(2.45, 0.07, 1.7), mat("#b08a57", { flatShading: true })); pallet.position.y = 0.035; runGroup.add(pallet);
  const boxGeo = new THREE.BoxGeometry(0.66, BOX_H - 0.012, 0.66), boxMats = [mat("#5a1a2e"), mat("#6b2238")];
  for (let k = 0; k < BOX_N; k++) { // stacks of 10, three across
    const b = mesh(boxGeo, boxMats[k % 2]); const st = Math.floor(k / 10), lvl = k % 10;
    b.position.set(-0.78 + (st % 3) * 0.78, 0.07 + BOX_H / 2 + lvl * BOX_H, -0.4 + Math.floor(st / 3) * 0.8);
    b.visible = false; runGroup.add(b); run.boxes.push(b);
  }
  const runLabel = flat(makeLabel(2.3, 0.62)); runLabel.plane.position.set(0, 0.004, 1.3); runGroup.add(runLabel.plane);
  function drawRun(text) {
    const { ctx, c } = runLabel; ctx.fillStyle = "#f3e7cf"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.textBaseline = "middle"; ctx.fillStyle = "#5a1a2e"; ctx.font = `700 40px ${FONT}`; ctx.fillText(text, 18, c.height / 2 + 2); runLabel.tex.needsUpdate = true;
  }

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
      const dist = Math.min(controls.maxDistance, Math.max(15, 1.04 * Math.max(8.9 / (t * camera.aspect * fx), 4.0 / (t * fy))));
      camera.position.copy(CENTER).addScaledVector(VIEW_DIR, dist); controls.update();
    }
    camera.updateProjectionMatrix(); invalidate();
  }
  const ro = new ResizeObserver(resize); ro.observe(host);
  resize();

  // ---------- Pointer: click a building or piece for details ----------
  const ray = new THREE.Raycaster(), ndc = new V2(); let down = null;
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
  function pawnSpaces() { const on = new Set(); for (const p of Object.values(pawns)) if (p.g.visible && p.stage != null && !p.moving) on.add(p.stage); lightSpaces(on); }
  function update(s) {
    // Buildings: status shows on the building; it turns once when its line changes.
    for (const d of s.districts) {
      const t = tiles[d.slug]; if (!t) continue;
      const sig = d.level + "|" + (d.kind === "roas" && s.meta && s.meta.roas !== null ? s.meta.roas.toFixed(2) + s.meta.gate : "");
      // What counts as "the line changed": a new status or stock event; for Marketing, a new gate color.
      const flipKey = d.kind === "manual" || d.kind === "stock" ? (d.event ? d.event.id : null) : d.kind === "roas" ? d.level : undefined;
      const flip = !first && flipKey !== undefined && t.flipKey !== undefined && flipKey !== t.flipKey;
      t.flipKey = flipKey;
      if (flip) {
        t.flips++; let painted = false;
        tween(0.9, (k) => {
          t.b.g.rotation.y = Math.PI * 2 * ease(k); t.b.g.position.y = PLOT_H + Math.sin(Math.PI * k) * 0.45;
          if (k >= 0.5 && !painted) { painted = true; paintTile(t, d, s); }
        }, 0, () => { t.b.g.rotation.y = 0; t.b.g.position.y = PLOT_H; });
      } else if (sig !== t.sig) paintTile(t, d, s);
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
      }, 0, () => { p.moving = false; p.g.position.copy(target); pawnSpaces(); });
    }
    pawnSpaces(); // the space under each pawn is lit (a sliding pawn lights its new space on arrival)

    // Order tokens: today's orders stacked in front of the shop, oldest at the bottom; new ones drop in.
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

    // Meeples: outside Agent HQ, or outside the building they are working in; flag up when waiting or blocked.
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
        } else if (!m.walking) m.g.position.copy(target);
        if (flagUp !== m.flagUp) { const u0 = m.flagU, u1 = flagUp ? 1 : 0; tween(0.5, (k) => setFlag(m, u0 + (u1 - u0) * ease(k))); }
      }
      m.place = place; m.flagUp = flagUp;
    });

    // Run 1: one box per 100 copies left.
    const r = s.statusRun, left = r ? r.left : null;
    const n = left === null ? 0 : Math.max(0, Math.min(BOX_N, Math.ceil(left / BOX_COPIES)));
    if (n !== run.n) { run.boxes.forEach((b, k) => { b.visible = k < n; }); run.n = n; }
    if (left !== run.left) { run.left = left; drawRun(left === null ? "Run 1" : left >= 0 ? `Run 1 · ${left.toLocaleString("en-US")} left` : `Run 1 · ${(-left).toLocaleString("en-US")} over`); }

    first = false; invalidate();
  }

  // ---------- For tests and the perf note ----------
  function screenOf(kind, id) {
    const o = kind === "district" ? tiles[id].b.g : kind === "title" ? pawns[id].g : kind === "agent" ? meeples[id].g : kind === "stage" ? spaces.find((x) => x.slug === id).g : runGroup;
    const v = new THREE.Vector3(); o.getWorldPosition(v);
    if (kind === "agent") v.y += 0.25; if (kind === "title") v.y += 0.12; if (kind === "run") v.y += 0.05; if (kind === "district") v.y += 0.2;
    if (kind === "stage") { const r = spaceRect(STAGE_ORDER.indexOf(id)); v.x -= r.w / 2 - 0.3; v.z += r.side ? r.d / 2 - 0.3 : r.d / 2 - 0.25; v.y += SPACE_H; }
    v.project(camera); const b = canvas.getBoundingClientRect();
    return { x: b.left + (v.x + 1) / 2 * b.width, y: b.top + (1 - v.y) / 2 * b.height };
  }
  function debug() {
    return {
      tiles: Object.fromEntries(Object.values(tiles).map((t) => [t.slug, { level: t.level, flips: t.flips, lit: t.lit, lantern: t.lantern, parts: t.b.g.children.length }])),
      pawns: Object.fromEntries(Object.entries(pawns).map(([k, p]) => [k, { stage: p.stage == null ? null : STAGE_ORDER[p.stage], visible: p.g.visible, moving: p.moving, slides: p.slides, x: +p.g.position.x.toFixed(2), z: +p.g.position.z.toFixed(2) }])),
      litSpaces: spaces.filter((sp) => sp.on).map((sp) => sp.slug), arrows: arrows.length,
      tokens: tokens.size, tokensFalling: [...tokens.values()].filter((m) => m.userData.falling).length,
      meeples: Object.fromEntries(Object.entries(meeples).map(([k, m]) => [k, { place: m.place, flag: m.flagUp, flagU: +m.flagU.toFixed(2), walks: m.walks, color: "#" + m.bm.color.getHexString() }])),
      boxes: run.n, boxesVisible: run.boxes.filter((b) => b.visible && b.parent === runGroup).length, tweens: tweens.length, frames, lastFrameMs: +lastFrameMs.toFixed(2),
      calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, pixelRatio: renderer.getPixelRatio(),
    };
  }

  return {
    update, debug, screenOf,
    setInset(right, bottom) { if (right === inset.right && bottom === inset.bottom) return; inset = { right, bottom }; resize(); },
    dispose() {
      disposed = true; cancelAnimationFrame(raf); ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointermove", onMove);
      controls.dispose();
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); const ms = o.material ? [].concat(o.material) : []; for (const m of ms) { m.map && m.map.dispose(); m.dispose(); } });
      renderer.dispose(); canvas.remove();
    },
  };
}
