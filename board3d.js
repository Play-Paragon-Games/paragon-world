// Paragon World board, 3D view (Phase 4, sessions 2 and 3).
// A game board on a wooden table, drawn with three.js: a ring of track spaces around a raised
// center where each district has a small building. Same state object as the flat board
// (World.compute). Renders only when something changes: a camera move or a real event.
// Nothing here animates on its own.
import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";

const V2 = THREE.Vector2;

// ---------- Board geometry (units are arbitrary; the board is 14 x 10.5) ----------
const BW = 14, BD = 9.7, M = 0.3, G = 0.2, TR = 1.2, SG = 0.1;
const SLAB = 0.3, SPACE_H = 0.12, PLAT_H = 0.2, PLOT_H = 0.06;
const MID_W = BW - 2 * M - 2 * TR - 2 * G, MID_D = BD - 2 * M - 2 * TR - 2 * G;
const TILE_W = (MID_W - 3 * G) / 4, TILE_D = (MID_D - 2 * G) / 3;
const PLOT_TOP = SLAB + PLAT_H + PLOT_H;
const PX = 200; // label texture pixels per board unit

// Kyle's track: 20 plain spaces clockwise seen from above. Top row 0-6 left to right (0 is Start),
// right side 7-9 downward, bottom row 10-16 right to left, left side 17-19 upward.
const RING = 20;
const SPACE_W = (BW - 2 * M - 6 * SG) / 7, SIDE_D = (BD - 2 * M - 2 * TR - 2 * G - 2 * SG) / 3;
const rowX = (c) => -BW / 2 + M + SPACE_W / 2 + c * (SPACE_W + SG);
const colZ = (c) => -(BD - 2 * M - 2 * TR - 2 * G) / 2 + SIDE_D / 2 + c * (SIDE_D + SG);
const ROW_Z = BD / 2 - M - TR / 2, COL_X = BW / 2 - M - TR / 2;
function spaceRect(i) {
  if (i < 7) return { x: rowX(i), z: -ROW_Z, w: SPACE_W, d: TR };
  if (i < 10) return { x: COL_X, z: colZ(i - 7), w: TR, d: SIDE_D };
  if (i < 17) return { x: rowX(6 - (i - 10)), z: ROW_Z, w: SPACE_W, d: TR };
  return { x: -COL_X, z: colZ(2 - (i - 17)), w: TR, d: SIDE_D };
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
  const { DISTRICTS, SHIP_MILESTONES, money } = World;
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

  // ---------- Kyle's track: a ring of plain dark-wood spaces, a brass Start, and the founder pawn ----------
  const BRASS = "#d9b872";
  const spaceGeoRow = new THREE.BoxGeometry(SPACE_W, SPACE_H, TR), spaceGeoCol = new THREE.BoxGeometry(TR, SPACE_H, SIDE_D);
  const inlayRow = new THREE.PlaneGeometry(SPACE_W - 0.22, TR - 0.22), inlayCol = new THREE.PlaneGeometry(TR - 0.22, SIDE_D - 0.22);
  const spaces = Array.from({ length: RING }, (_, i) => {
    const r = spaceRect(i), row = i < 7 || (i >= 10 && i < 17);
    const g = new THREE.Group(); g.position.set(r.x, SLAB, r.z);
    const m = mat(i === 0 ? "#c9a45c" : "#4a3423"), im = mat(i === 0 ? "#e2c684" : i % 2 ? "#5d4530" : "#553e2a");
    const block = mesh(row ? spaceGeoRow : spaceGeoCol, m); block.position.y = SPACE_H / 2; g.add(block);
    const inlay = mesh(row ? inlayRow : inlayCol, im, { cast: false }); inlay.rotation.x = -Math.PI / 2; inlay.position.y = SPACE_H + 0.003; g.add(inlay);
    if (i === 0) { // the marked Start
      const L = flat(makeLabel(SPACE_W - 0.3, 0.42)); L.plane.position.set(0, SPACE_H + 0.006, -TR / 2 + 0.36); g.add(L.plane);
      const { ctx, c } = L; ctx.fillStyle = "#3a2a1e"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = BRASS; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `800 54px ${FONT}`; ctx.fillText("START", c.width / 2, c.height / 2 + 3); L.tex.needsUpdate = true;
    }
    pickable(g, "founder", "me"); scene.add(g);
    return { i, r, g, im, base: im.color.clone(), on: false };
  });
  function lightSpace(at) { for (const sp of spaces) { const on = sp.i === at; if (on !== sp.on) { sp.on = on; if (on) sp.im.color.set("#f0c66a"); else sp.im.color.copy(sp.base); } } }
  // Brass arrows inlaid after Start and at the four turns, showing the way round.
  const arrowShape = new THREE.Shape([[-0.2, 0.15], [0.03, 0.15], [0.2, 0], [0.03, -0.15], [-0.2, -0.15], [-0.05, 0]].map(([x, y]) => new V2(x, y)));
  const arrowGeo = new THREE.ExtrudeGeometry(arrowShape, { depth: 0.03, bevelEnabled: false }); arrowGeo.rotateX(-Math.PI / 2);
  const arrowMat = mat("#c9a45c");
  const arrows = [0, 6, 9, 16, 19].map((i) => {
    const a = spaceRect(i), b = spaceRect((i + 1) % RING), m = mesh(arrowGeo, arrowMat);
    m.position.set((a.x + b.x) / 2, SLAB + SPACE_H + 0.004, (a.z + b.z) / 2); m.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x); scene.add(m); return m;
  });
  const spaceCenter = (i) => { const r = spaceRect(((i % RING) + RING) % RING); // Top row: stand on the far half, clear of the buildings in front of it.
    return new THREE.Vector3(r.x, SLAB + SPACE_H, r.z + (i % RING === 0 ? 0.22 : r.z < -ROW_Z + 0.01 ? -0.2 : 0)); };
  // The founder pawn: a low-poly crown, Paragon ink and brass.
  const founder = { g: new THREE.Group(), pos: 0, moving: false, walks: 0 };
  {
    const ink = mat("#1c1b19", { flatShading: true }), gold = mat("#d9b24a", { flatShading: true }), gem = mat("#7a1f34", { flatShading: true });
    const base = mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.1, 12), ink); base.position.y = 0.05;
    const band = mesh(new THREE.CylinderGeometry(0.27, 0.25, 0.22, 12), gold); band.position.y = 0.21;
    founder.g.add(base, band);
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2, p = mesh(new THREE.ConeGeometry(0.075, 0.2, 4), gold); p.position.set(Math.cos(a) * 0.235, 0.42, Math.sin(a) * 0.235); founder.g.add(p); }
    const jewel = mesh(new THREE.IcosahedronGeometry(0.06, 0), gem); jewel.position.set(0, 0.22, 0.27); founder.g.add(jewel);
    founder.g.scale.setScalar(1.45); founder.g.position.copy(spaceCenter(0));
    pickable(founder.g, "founder", "me"); scene.add(founder.g);
  }
  function setFounder(pos) { if (founder.moving) return; founder.pos = ((pos % RING) + RING) % RING; founder.g.position.copy(spaceCenter(founder.pos)); lightSpace(founder.pos); invalidate(); }
  // The pawn walks n spaces clockwise from where it stands, one hop per space. Only a roll calls this.
  function walkFounder(n, done) {
    const from = founder.pos, pts = []; for (let k = 0; k <= n; k++) pts.push(spaceCenter(from + k));
    founder.moving = true; founder.walks++; founder.pos = (from + n) % RING;
    tween(0.3 * n, (k) => {
      const f = k * n, seg = Math.min(Math.floor(f), n - 1), u = f - seg;
      founder.g.position.lerpVectors(pts[seg], pts[seg + 1], ease(u)); founder.g.position.y += Math.sin(Math.PI * u) * 0.35;
      lightSpace((from + seg + (u > 0.5 ? 1 : 0)) % RING);
    }, 0, () => { founder.moving = false; founder.g.position.copy(spaceCenter(founder.pos)); lightSpace(founder.pos); done && done(); });
  }

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
      box(0.08, 0.2, 0.08, K("steel"), -0.6, 0, -0.1); box(0.08, 0.2, 0.08, K("steel"), 0.6, 0, -0.1); // a low board, so the sea lane behind it stays in view
      box(1.84, 0.88, 0.08, K("night"), 0, 0.16, -0.1);
      board = makeLabel(1.7, 0.74, true); add(board.plane, 0, 0.6, -0.055);
      box(0.12, 0.05, 0.14, win, -0.5, 0.1, 0.0); box(0.12, 0.05, 0.14, win, 0.5, 0.1, 0.0); // lamps under the board
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
    // Closed shutters, shown when the district is stale and nobody is working inside.
    const shut = [], shutMat = mat("#8d8b86", { flatShading: true });
    const S = (w, h, x, y, z, d = 0.035) => { const o = box(w, h, d, shutMat, x, y, z + 0.016); o.visible = false; shut.push(o); return o; };
    ({
      "design-studio": () => { S(0.3, 0.42, 0.25, 0, 0.36); S(0.62, 0.32, -0.45, 0.14, 0.36); },
      "art-creative": () => S(0.8, 0.44, -0.3, 0.1, 0.36),
      "production": () => S(1.4, 0.34, -0.15, 0.08, 0.36),
      "freight": () => { S(1.9, 0.06, 0.1, 0.22, 0.72, 0.05); S(0.06, 0.26, -0.82, 0, 0.72, 0.06); S(0.06, 0.26, 1.02, 0, 0.72, 0.06); }, // a barrier across the yard
      "warehouse": () => { S(0.56, 0.38, -0.5, 0, 0.385); S(0.36, 0.18, 0.15, 0.21, 0.385); },
      "sales": () => S(1.2, 0.4, 0, 0, 0.29),
      "crowdfunding": () => S(1.56, 0.7, 0, 0.14, 0.26, 0.04), // the curtain
      "customer-service": () => { S(0.3, 0.4, -0.1, 0, 0.31); S(0.34, 0.26, -0.5, 0.17, 0.31); S(0.34, 0.26, 0.3, 0.17, 0.31); },
      "finance": () => S(1.02, 0.46, 0, 0.08, 0.115),
      "legal": () => S(1.0, 0.44, 0, 0.12, 0.115),
      "agent-hq": () => { S(0.9, 0.86, -0.3, 0.08, 0.205); S(0.42, 0.24, 0.5, 0.17, 0.155); },
    }[slug] || (() => {}))();
    // Production: chimney smoke, shown only while the line says printing.
    let smoke = null, spot = null;
    if (slug === "production") {
      smoke = [];
      for (let i = 0; i < 5; i++) {
        const o = add(mesh(new THREE.IcosahedronGeometry(0.1, 0), new THREE.MeshLambertMaterial({ color: "#e4e0d8", transparent: true, opacity: 0, depthWrite: false, flatShading: true }), { cast: false, receive: false }), 0.86, 1.2, -0.2);
        o.visible = false; smoke.push(o);
      }
    }
    // Marketing: a spotlight whose beam sweeps only at step up.
    if (slug === "marketing") {
      spot = new THREE.Group(); spot.visible = false; add(spot, -1.0, 0, 0.2);
      spot.add(mesh(new THREE.BoxGeometry(0.16, 0.1, 0.16), K("steel")));
      const beamGeo = new THREE.ConeGeometry(0.46, 2.6, 14, 1, true); beamGeo.translate(0, -1.3, 0); beamGeo.rotateX(Math.PI);
      const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: "#fff0bf", transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      beam.position.y = 0.06; beam.rotation.x = -0.3; spot.add(beam); spot.userData.beam = beam;
    }
    // Lantern on a post at the front corner: amber for warn, red for bad, unlit otherwise.
    box(0.035, 0.42, 0.035, K("dark"), -1.06, 0, 0.6);
    const lamp = new THREE.MeshLambertMaterial({ color: "#3a3531" });
    box(0.13, 0.14, 0.13, lamp, -1.06, 0.42, 0.6); box(0.17, 0.03, 0.17, K("dark"), -1.06, 0.56, 0.6);
    return { g, mats, win, lamp, board, shut, smoke, spot };
  }
  function drawBoard(b, d, s) { // the Marketing billboard: 7-day ROAS on the gate color
    const { ctx, c } = b.board, m = s.meta, live = d.level !== "gray" && m && m.roas !== null;
    ctx.fillStyle = live ? ({ bad: "#c0392b", warn: "#d98b0b", good: "#1f8a4c" }[m.gate] || "#6b5a45") : "#3a3836"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.textBaseline = "top"; ctx.fillStyle = live ? "rgba(255,255,255,.88)" : "#8b8782"; ctx.font = `700 26px ${FONT}`; ctx.fillText("MARKETING · 7-DAY ROAS", 22, 16);
    if (live) {
      ctx.fillStyle = "#fff"; ctx.font = `800 84px ${FONT}`; ctx.fillText(m.roas.toFixed(2), 20, 46);
      const word = { bad: "STEP DOWN", warn: "HOLD", good: "STEP UP" }[m.gate] || "";
      ctx.font = `800 30px ${FONT}`; const w = ctx.measureText(word).width; ctx.fillStyle = "#fff"; ctx.fillRect(c.width - w - 46, 60, w + 28, 46);
      ctx.fillStyle = "#231a12"; ctx.fillText(word, c.width - w - 32, 68);
    } else { ctx.font = `700 40px ${FONT}`; ctx.fillText("no data yet", 22, 60); }
    b.board.tex.needsUpdate = true;
  }

  // ---------- District plots ----------
  const sales = { sign: null, n: null, rev: null, text: "" };
  // Freight: where the ship sits along its short sea lane, by milestone (0 = far end, 1 = at the dock).
  const LANE = { "booked": 0, "departed": 0.22, "on-water": 0.5, "customs": 0.8, "arrived": 1 };
  const LANE_X = (t) => 0.86 - t * 1.34;
  const ship = { g: null, flag: null, fc: null, ftex: null, milestone: null, eta: null, moves: 0 };
  let workingIn = new Set(); // districts with an agent working inside
  const ambient = { smoke: false, spot: false };
  const SIGN_Y = { "design-studio": 1.0, "art-creative": 0.92, "production": 1.25, "freight": 1.5, "warehouse": 0.78, "sales": 1.14, "crowdfunding": 1.22, "marketing": 1.1, "customer-service": 1.24, "finance": 1.16, "legal": 1.28, "agent-hq": 1.56 };
  const tiles = {};
  DISTRICTS.forEach(([slug, name], i) => {
    const r = tileRect(i);
    const g = new THREE.Group(); g.position.set(r.x, SLAB + PLAT_H, r.z);
    const pm = mat("#e3d2aa");
    const plot = mesh(new THREE.BoxGeometry(r.w, PLOT_H, r.d), pm); plot.position.y = PLOT_H / 2; g.add(plot);
    // Back-row buildings stand forward on their plots so they do not hide the far side of Kyle's track.
    const bz = slug === "marketing" ? 0.3 : i < 4 ? -0.1 : -0.45;
    const b = makeBuilding(slug); b.g.position.set(0, PLOT_H, bz); g.add(b.g);
    // Name sign above the building. A sprite, so it faces the camera from any angle.
    const sc = document.createElement("canvas"), sx = sc.getContext("2d"); sx.font = `700 44px ${FONT}`;
    sc.width = Math.ceil(sx.measureText(name).width) + 52; sc.height = 74;
    const stex = new THREE.CanvasTexture(sc); stex.colorSpace = THREE.SRGBColorSpace; stex.anisotropy = maxAniso;
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: stex })); sign.center.set(0.5, 0); sign.scale.set(sc.width / 250, sc.height / 250, 1);
    sign.position.set(0, PLOT_H + SIGN_Y[slug], bz); g.add(sign);
    if (slug === "marketing") sign.visible = false; // its name is on the billboard itself, so no sign hides the sea lane behind it
    const L = { c: sc, ctx: sx, tex: stex };
    pickable(g, "district", slug); scene.add(g);
    tiles[slug] = { slug, name, r, g, pm, L, b, row0: i < 4, sig: null, flipKey: undefined, flips: 0, level: null, top: PLOT_TOP, lights: null, shut: null, lantern: null };
    if (slug === "sales") { // a sign on the shop: today's orders and revenue
      sales.sign = makeLabel(1.36, 0.3, true); sales.sign.plane.position.set(0, PLOT_H + 0.86, -0.165); g.add(sales.sign.plane);
    }
    if (slug === "freight") { // a strip of sea along the front of the yard, a dock by the crane, and the ship
      const water = mesh(new THREE.PlaneGeometry(r.w - 0.1, 0.5), mat("#3f7fa6"), { cast: false }); water.rotation.x = -Math.PI / 2; water.position.set(0, PLOT_H + 0.004, 0.68); g.add(water);
      const dock = mesh(new THREE.BoxGeometry(0.56, 0.06, 0.16), mat(C.wood, { flatShading: true })); dock.position.set(-0.82, PLOT_H + 0.03, 0.38); g.add(dock);
      const sg = new THREE.Group(); sg.visible = false; sg.scale.setScalar(1.45); sg.position.set(LANE_X(0), PLOT_H + 0.004, 0.68); g.add(sg);
      const part = (w, h, d, col, x, y, z = 0) => { const o = mesh(new THREE.BoxGeometry(w, h, d), mat(col, { flatShading: true })); o.position.set(x, y + h / 2, z); sg.add(o); return o; };
      part(0.5, 0.1, 0.17, "#7c2f2a", 0, 0); part(0.1, 0.05, 0.13, "#7c2f2a", -0.28, 0.03); // hull and bow
      part(0.1, 0.13, 0.13, C.white, 0.17, 0.1); part(0.12, 0.07, 0.13, C.blue, -0.14, 0.1); part(0.12, 0.07, 0.13, C.yellow, -0.01, 0.1); part(0.012, 0.34, 0.012, C.dark, 0.17, 0.23);
      const fc = document.createElement("canvas"); fc.width = 260; fc.height = 74;
      const ftex = new THREE.CanvasTexture(fc); ftex.colorSpace = THREE.SRGBColorSpace;
      const flag = new THREE.Sprite(new THREE.SpriteMaterial({ map: ftex })); flag.center.set(0, 0); flag.scale.set(0.72, 0.205, 1); flag.position.set(0.17, 0.42, 0); flag.visible = false; sg.add(flag);
      ship.g = sg; ship.flag = flag; ship.fc = fc; ship.ftex = ftex;
    }
  });
  // Status on the building. Lights: bright while an agent works inside, a low glow when the line is current,
  // off when stale. Stale also closes the shutters and grays the building. Lantern: amber for warn, red for bad.
  function paintTile(t, d, s) {
    const current = d.level !== "gray", working = workingIn.has(t.slug), open = current || working;
    for (const m of t.b.mats) {
      if (current) m.color.copy(m.userData.base);
      else { const c = m.userData.base, l = (c.r * 0.3 + c.g * 0.59 + c.b * 0.11) * 0.62 + 0.035; m.color.setRGB(l, l, l * 0.98); }
    }
    t.b.win.color.set(working ? "#fff6d6" : current ? "#b89860" : "#262321"); t.b.win.emissive.set(working ? "#ffc44d" : current ? "#4f3a17" : "#000000");
    for (const o of t.b.shut) o.visible = !open;
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
    t.level = d.level; t.lights = working ? "on" : current ? "low" : "off"; t.shut = !open; t.lantern = lantern;
  }
  function drawSalesSign(n, rev) {
    const { ctx, c } = sales.sign; sales.text = `${Math.round(n)} ${Math.round(n) === 1 ? "order" : "orders"} · ${money(rev)}`;
    ctx.fillStyle = "#231a12"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.textBaseline = "middle"; ctx.textAlign = "center"; ctx.fillStyle = "#ffd98a";
    let px = 34; do { ctx.font = `800 ${px}px ${FONT}`; px -= 2; } while (ctx.measureText(sales.text).width > c.width - 20 && px > 14); // always fits the sign
    ctx.fillText(sales.text, c.width / 2, c.height / 2 + 2);
    sales.sign.tex.needsUpdate = true;
  }
  function etaText(eta) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(eta));
    return "ETA " + (m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : String(eta).slice(0, 12));
  }
  function drawEta(text) {
    const x = ship.fc.getContext("2d"), c = ship.fc; x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = "#fbf3df"; x.strokeStyle = "#7c2f2a"; x.lineWidth = 5; x.beginPath(); x.roundRect(3, 3, c.width - 6, c.height - 6, 10); x.fill(); x.stroke();
    x.textBaseline = "middle"; x.textAlign = "center"; x.fillStyle = "#3a1512"; x.font = `800 36px ${FONT}`; x.fillText(text, c.width / 2, c.height / 2 + 2); ship.ftex.needsUpdate = true;
  }

  // ---------- Order tokens, stacked in front of the shop ----------
  const TOKEN_H = 0.045, PILE = 10, PILES_PER_ROW = 8;
  const tokenGeo = new THREE.CylinderGeometry(0.11, 0.11, TOKEN_H - 0.006, 12);
  const tokenMat = { shopify: mat("#e3b93c"), amazon: mat("#c9783a"), upgrade: mat("#cfd3d8") }; // gold, copper (Amazon), silver (All-In upgrade invoice)
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
  const poleMat = mat("#2a2926");
  const meeples = {};
  // Outside the building, at the front of the plot.
  function meepleHome(place, i) { const t = tiles[place] || tiles["agent-hq"]; return new THREE.Vector3(t.r.x + 0.15 + (i - 1) * 0.5, t.top, t.r.z + (place === "freight" ? 0.36 : place === "marketing" ? 0.78 : t.row0 ? 0.74 : 0.34)); }
  // A waiting or blocked agent holds up a sign with what it needs.
  function setSign(m, u) { m.signU = u; m.pole.visible = m.sign.visible = u > 0.001; m.sign.scale.set(1.5 * u, 0.5 * u, 1); }
  function drawSign(m, text) {
    const c = m.sc, x = c.getContext("2d"); x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = "#fffaf0"; x.strokeStyle = "#cf3329"; x.lineWidth = 8; x.beginPath(); x.roundRect(5, 5, c.width - 10, c.height - 10, 14); x.fill(); x.stroke();
    x.fillStyle = "#231a12"; x.font = `700 38px ${FONT}`; x.textAlign = "center"; x.textBaseline = "middle";
    const lines = wrap(x, text, c.width - 40).slice(0, 2); if (lines.length === 2 && wrap(x, text, c.width - 40).length > 2) lines[1] = lines[1].replace(/.{1}$/, "…");
    lines.forEach((ln, i) => x.fillText(ln, c.width / 2, c.height / 2 + (i - (lines.length - 1) / 2) * 44 + 2));
    m.stex.needsUpdate = true; m.signText = text;
  }

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
  let lastDraw = 0;
  function frame(now) {
    raf = 0; if (disposed) return;
    const t0 = performance.now();
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i], k = (now - tw.t0) / tw.dur;
      if (k < 0) continue;
      tw.fn(Math.min(k, 1));
      if (k >= 1) { tweens.splice(i, 1); tw.done && tw.done(); }
    }
    const moved = controls.update(), looping = (ambient.smoke || ambient.spot) && !reduceMotion;
    // Smoke and the spotlight are the only things that move on their own, and only while their state holds.
    // Alone, they draw at about 30 frames a second to stay light.
    if (looping && !tweens.length && !moved && now - lastDraw < 30) { invalidate(); return; }
    if (ambient.smoke) tiles["production"].b.smoke.forEach((o, i) => {
      const p = reduceMotion ? i / 5 : (now / 4200 + i / 5) % 1;
      o.position.set(0.86 + p * 0.32, 1.18 + p * 1.0, -0.2); o.scale.setScalar(0.7 + p * 1.5); o.material.opacity = 0.75 * (1 - p);
    });
    if (ambient.spot) tiles["marketing"].b.spot.userData.beam.rotation.z = reduceMotion ? -0.5 : -0.55 + Math.sin(now / 1100) * 0.5;
    renderer.render(scene, camera);
    frames++; lastDraw = now; lastFrameMs = performance.now() - t0;
    if (tweens.length || moved || looping) invalidate();
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
  function update(s) {
    workingIn = new Set(s.agents.filter((a) => a.workingAt && tiles[a.workingAt]).map((a) => a.workingAt));
    const byPlace = Object.fromEntries(s.districts.map((d) => [d.slug, d]));

    // Buildings: status shows on the building; it turns once when its line changes.
    for (const d of s.districts) {
      const t = tiles[d.slug]; if (!t) continue;
      const sig = d.level + "|" + (workingIn.has(d.slug) ? "w" : "") + "|" + (d.kind === "roas" && s.meta && s.meta.roas !== null ? s.meta.roas.toFixed(2) + s.meta.gate : "");
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

    // A current (not stale) manual line's milestone drives the smoke and the ship.
    const milestone = (slug) => { const d = byPlace[slug]; return d && !d.stale && d.event && d.event.details ? String(d.event.details.milestone || "").trim().toLowerCase() : ""; };

    // Production: smoke only while the line's milestone is "printing".
    const smoke = milestone("production") === "printing";
    if (smoke !== ambient.smoke) { ambient.smoke = smoke; for (const o of tiles["production"].b.smoke) o.visible = smoke; }

    // Marketing: the spotlight sweeps only at step up.
    const spot = !!(s.meta && s.meta.gate === "good" && byPlace["marketing"] && byPlace["marketing"].level === "good");
    if (spot !== ambient.spot) { ambient.spot = spot; tiles["marketing"].b.spot.visible = spot; }

    // Freight: a ship only while a shipment is under way; its place on the lane follows the milestone.
    const ms = milestone("freight"), sailing = SHIP_MILESTONES.includes(ms) ? ms : null;
    const eta = sailing && byPlace["freight"].event.details.eta ? String(byPlace["freight"].event.details.eta) : null;
    if (sailing !== ship.milestone) {
      const was = ship.milestone; ship.milestone = sailing; ship.g.visible = !!sailing;
      if (sailing) {
        const x1 = LANE_X(LANE[sailing]);
        if (first || !was) ship.g.position.x = x1; // a shipment that is already under way starts where it is
        else { const x0 = ship.g.position.x; ship.moves++; tween(Math.max(0.8, Math.abs(x1 - x0) * 2.2), (k) => { ship.g.position.x = x0 + (x1 - x0) * ease(k); }, 0, () => { ship.g.position.x = x1; }); }
      }
    }
    if (eta !== ship.eta) { ship.eta = eta; ship.flag.visible = !!eta; if (eta) drawEta(etaText(eta)); }

    // Sales sign: today's orders and revenue; it counts up when an order lands.
    const n = s.todayOrders.length, rev = Object.values(s.todayByChannel).reduce((a, c) => a + c.revenue, 0);
    if (n !== sales.n || rev !== sales.rev) {
      const n0 = sales.n, r0 = sales.rev; sales.n = n; sales.rev = rev;
      if (first || n0 === null || n < n0) drawSalesSign(n, rev);
      else tween(0.9, (k) => drawSalesSign(n0 + (n - n0) * ease(k), r0 + (rev - r0) * ease(k)), 0.3, () => drawSalesSign(n, rev));
    }

    // Orders: today's coins stacked in front of the shop, oldest at the bottom. A new order pops out of the shop door.
    const list = [...s.todayOrders].reverse(), ids = new Set(list.map((o) => o.id));
    for (const [id, m] of tokens) if (!ids.has(id)) { tokenGroup.remove(m); tokens.delete(id); } // new LA day, or an order removed
    let fresh = 0; const shop = tiles["sales"], door = new THREE.Vector3(shop.r.x, shop.top + 0.2, shop.r.z - 0.12);
    list.forEach((o, i) => {
      const pos = tokenPos(i); let m = tokens.get(o.id);
      if (m) { if (!m.userData.falling) m.position.copy(pos); return; }
      m = mesh(tokenGeo, o.details && o.details.upgrade_of ? tokenMat.upgrade : tokenMat[o.source] || tokenMat.shopify);
      tokens.set(o.id, m); tokenGroup.add(m);
      if (first) { m.position.copy(pos); return; }
      m.userData.falling = true; m.visible = false; pops++;
      tween(0.75, (k) => {
        m.visible = true; m.position.lerpVectors(door, pos, k); m.position.y += Math.sin(Math.PI * k) * 1.1; m.rotation.x = k * Math.PI * 4;
      }, 0.18 * fresh++, () => { m.userData.falling = false; m.rotation.x = 0; m.position.copy(pos); });
    });

    // Meeples: outside Agent HQ, or outside their district's building while working or waiting there.
    // A waiting or blocked agent holds a sign with what it needs.
    s.agents.forEach((a, i) => {
      let m = meeples[a.slug];
      if (!m) {
        const g = new THREE.Group(), bm = mat(LEVEL.gray);
        const body = mesh(meepleBody, bm), head = mesh(meepleHead, bm); head.position.y = 0.47;
        const pole = mesh(poleGeo, poleMat); pole.position.set(0.3, 0.51, 0);
        const sc = document.createElement("canvas"); sc.width = 380; sc.height = 128;
        const stex = new THREE.CanvasTexture(sc); stex.colorSpace = THREE.SRGBColorSpace; stex.anisotropy = maxAniso;
        const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: stex })); sign.center.set(0.5, 0); sign.position.set(0.3, 0.8, 0);
        g.add(body, head, pole, sign); pickable(g, "agent", a.slug); scene.add(g);
        m = meeples[a.slug] = { g, bm, pole, sign, sc, stex, place: null, signUp: null, signU: 0, signText: "", walking: false, walks: 0 };
      }
      m.bm.color.set(LEVEL[a.level] || LEVEL.gray);
      const place = a.standsAt && tiles[a.standsAt] ? a.standsAt : "agent-hq";
      const signUp = !a.silent && (a.state === "waiting" || a.state === "blocked");
      if (signUp) { const text = String(a.needs || (a.state === "blocked" ? "Blocked" : "Waiting on you")).slice(0, 60); if (text !== m.signText) drawSign(m, text); }
      const target = meepleHome(place, i);
      if (first || m.place === null) { m.g.position.copy(target); setSign(m, signUp ? 1 : 0); }
      else {
        if (place !== m.place) {
          const from = m.g.position.clone(); from.y = target.y; const dist = from.distanceTo(target), steps = Math.max(2, Math.round(dist / 0.45));
          m.walking = true; m.walks++;
          tween(Math.max(0.6, dist / 3), (k) => { m.g.position.lerpVectors(from, target, ease(k)); m.g.position.y = target.y + Math.abs(Math.sin(k * steps * Math.PI)) * 0.09; }, 0, () => { m.walking = false; m.g.position.copy(target); });
        } else if (!m.walking) m.g.position.copy(target);
        if (signUp !== m.signUp) { const u0 = m.signU, u1 = signUp ? 1 : 0; tween(0.5, (k) => setSign(m, u0 + (u1 - u0) * ease(k))); }
      }
      m.place = place; m.signUp = signUp;
    });

    // Run 1: one box per 100 copies left.
    const r = s.statusRun, left = r ? r.left : null;
    const nb = left === null ? 0 : Math.max(0, Math.min(BOX_N, Math.ceil(left / BOX_COPIES)));
    if (nb !== run.n) { run.boxes.forEach((b, k) => { b.visible = k < nb; }); run.n = nb; }
    if (left !== run.left) { run.left = left; drawRun(left === null ? "Run 1" : left >= 0 ? `Run 1 · ${left.toLocaleString("en-US")} left` : `Run 1 · ${(-left).toLocaleString("en-US")} over`); }

    first = false; invalidate();
  }
  let pops = 0;

  // ---------- For tests and the perf note ----------
  function screenOf(kind, id) {
    const o = kind === "district" ? tiles[id].b.g : kind === "agent" ? meeples[id].g : kind === "founder" ? founder.g : kind === "space" ? spaces[+id].g : runGroup;
    const v = new THREE.Vector3(); o.getWorldPosition(v);
    if (kind === "agent") v.y += 0.25; if (kind === "founder") v.y += 0.15; if (kind === "run") v.y += 0.05; if (kind === "district") v.y += 0.2; if (kind === "space") v.y += SPACE_H;
    v.project(camera); const b = canvas.getBoundingClientRect();
    return { x: b.left + (v.x + 1) / 2 * b.width, y: b.top + (1 - v.y) / 2 * b.height };
  }
  function debug() {
    return {
      tiles: Object.fromEntries(Object.values(tiles).map((t) => [t.slug, { level: t.level, flips: t.flips, lights: t.lights, shut: t.shut, shutters: t.b.shut.length, lantern: t.lantern, parts: t.b.g.children.length }])),
      founder: { pos: founder.pos, moving: founder.moving, walks: founder.walks, x: +founder.g.position.x.toFixed(2), z: +founder.g.position.z.toFixed(2) },
      spaces: spaces.length, litSpaces: spaces.filter((sp) => sp.on).map((sp) => sp.i), arrows: arrows.length,
      tokens: tokens.size, tokensFalling: [...tokens.values()].filter((m) => m.userData.falling).length, pops,
      salesSign: sales.text, smoke: ambient.smoke, spot: ambient.spot,
      ship: { visible: ship.g.visible, milestone: ship.milestone, x: +ship.g.position.x.toFixed(2), eta: ship.eta, flag: ship.flag.visible, moves: ship.moves },
      meeples: Object.fromEntries(Object.entries(meeples).map(([k, m]) => [k, { place: m.place, sign: m.signUp ? m.signText : null, signU: +m.signU.toFixed(2), walks: m.walks, color: "#" + m.bm.color.getHexString() }])),
      boxes: run.n, boxesVisible: run.boxes.filter((b) => b.visible && b.parent === runGroup).length, tweens: tweens.length, frames, lastFrameMs: +lastFrameMs.toFixed(2),
      calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, pixelRatio: renderer.getPixelRatio(),
    };
  }

  return {
    update, debug, screenOf, setFounder, walkFounder,
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
