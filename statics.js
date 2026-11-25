// 📐 Конструктор задач по физике — статика: грузы, шары, узлы, блоки, нити, пружины, динамометры, рычаги, опоры, стены, наклонные плоскости, силы.
// Кликаешь по элементу → справа его свойства (невесомый, масса, длина, μ…). Из свойств собирается «Дано».
// Кнопка «▶ Опыт» (statics_sim.js) оживляет рисунок. Работает отдельной страницей и внутри доски (?embed=1): «На доску» отправляет картинку родителю.
"use strict";
const $ = (id) => document.getElementById(id);
const EMBED = /[?&]embed=1/.test(location.search);
const tg = !EMBED && window.Telegram ? window.Telegram.WebApp : null;
try { if (tg) { tg.ready(); tg.expand(); } } catch (e) {}

const W = 1000, H = 640, GRID = 10, M_PX = 80, DEG = Math.PI / 180;   // сцена, шаг сетки, пикселей на метр
const INK = "#2b2f36", FILL = "#dfe9f7", RED = "#e53935", BLUE = "#1c8ef6", PURPLE = "#8e24aa";

// ---------------------------------------------------------------- сцена
let scene = { objs: [], conns: [], g: 10, showG: true, capt: true, seq: 1 };
let sel = null;                       // {kind:"o"|"c", id}
let tool = "select";
let pending = null;                   // первая выбранная точка связи {id, k}
let hist = [], redo = [];
const sim = { on: false };            // состояние режима «Опыт» (statics_sim.js)
const nid = () => scene.seq++;
const byId = (id) => scene.objs.find((o) => o.id === id);
const connById = (id) => scene.conns.find((c) => c.id === id);
const snap = (v) => Math.round(v / GRID) * GRID;

const SUB = "₀₁₂₃₄₅₆₇₈₉";
const pretty = (s) => String(s || "").replace(/_/g, "").replace(/(\p{L})(\d+)/gu, (m, a, d) => a + [...d].map((c) => SUB[c]).join(""));
const num = (v) => { const x = parseFloat(String(v).replace(",", ".")); return Number.isFinite(x) ? x : null; };
const fmt = (x) => String(+x.toPrecision(6)).replace(".", ",");
const rp = (x, y, a) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });

const bodiesCount = (pred) => scene.objs.filter((o) => o.type === "body" && pred(o)).length;
const DEFAULTS = {
  body: () => ({ type: "body", shape: "box", angle: 0, name: "m" + (bodiesCount((o) => o.shape !== "point") + 1), mass: null, weightless: false }),
  ball: () => ({ type: "body", shape: "ball", r: 28, name: "m" + (bodiesCount((o) => o.shape !== "point") + 1), mass: null, weightless: false }),
  knot: () => ({ type: "body", shape: "point", name: String.fromCharCode(65 + bodiesCount((o) => o.shape === "point") % 26), mass: null, weightless: true }),
  pulley: () => ({ type: "pulley", name: "", r: 34, r2: 0, mount: "free", weightless: true, mass: null, smooth: true }),
  beam: () => ({ type: "beam", name: "", len: 4, angle: 0, pivot: 2, sup: "", clamp: false, cm: null, weightless: true, mass: null }),
  spring: () => ({ type: "spring", ax: 0, ay: 0, bx: 0, by: 0, glueA: null, glueB: null, k: null, l0: null, dyn: false, name: "", weightless: true, mass: null }),
  ceil: () => ({ type: "ceil", w: 320 }),
  floor: () => ({ type: "floor", w: 320, mu: null }),
  wall: () => ({ type: "wall", h: 320, face: "right", mu: null }),
  incline: () => ({ type: "incline", w: 400, ang: 30, flip: false, mu: null }),
  force: () => ({ type: "force", to: null, F: 10, ang: 0, name: "F" }),
  hand: () => ({ type: "hand" }),
};
const KIND_NAME = { thread: "Нить", rod: "Стержень", spring: "Пружина" };
const typeName = (o) => (o.type === "body" ? { box: "Груз", ball: "Шар", point: "Узел" }[o.shape || "box"] : { pulley: "Блок", beam: "Рычаг / стержень", spring: o.dyn ? "Динамометр" : "Пружина", ceil: "Потолок", floor: "Пол", wall: "Стена", incline: "Наклонная плоскость", force: "Сила", hand: "Рука" }[o.type]);

function addObj(tl, x, y, extra) {
  const d = DEFAULTS[tl](), o = Object.assign({ id: nid(), x: snap(x), y: snap(y) }, d, extra || {});
  scene.objs.push(o); return o;
}
function addConn(kind, a, b, extra) {
  const c = Object.assign({ id: nid(), kind, a, b, weightless: true, inextensible: kind === "thread", mass: null, name: "", kval: null }, extra || {});
  scene.conns.push(c); return c;
}
function migrate(s) {                           // старые рисунки: блок «закреплён сверху» → mount, гладкий пол → μ
  for (const o of s.objs || []) {
    if (o.type === "pulley") { if (o.mount === undefined) o.mount = o.fixed ? "ceiling" : "free"; delete o.fixed; if (o.r2 === undefined) o.r2 = 0; }
    if (o.type === "floor" && o.mu === undefined) { o.mu = o.smooth === false ? 0.3 : null; delete o.smooth; }
    if (o.type === "body" && !o.shape) { o.shape = "box"; o.angle = o.angle || 0; }
    if (o.type === "beam") { if (o.sup === undefined) o.sup = ""; if (o.clamp === undefined) o.clamp = false; if (o.cm === undefined) o.cm = null; }
  }
  return s;
}

// ---------------------------------------------------------------- геометрия
const beamPt = (o, f) => { const a = o.angle * DEG, d = (f - 0.5) * o.len * M_PX; return { x: o.x + Math.cos(a) * d, y: o.y + Math.sin(a) * d }; };
const supportsOf = (o) => String(o.sup || "").split(/[;\s]+/).map(num).filter((v) => v != null && v >= 0 && v <= o.len);
function inclineGeom(o) {
  const a = o.ang * DEG, h = o.w * Math.tan(a), L = o.w / Math.cos(a);
  const A = o.flip ? { x: o.x + o.w / 2, y: o.y } : { x: o.x - o.w / 2, y: o.y }, apex = o.flip ? { x: o.x - o.w / 2, y: o.y - h } : { x: o.x + o.w / 2, y: o.y - h };
  const C = o.flip ? { x: o.x - o.w / 2, y: o.y } : { x: o.x + o.w / 2, y: o.y };
  const t = o.flip ? { x: -Math.cos(a), y: -Math.sin(a) } : { x: Math.cos(a), y: -Math.sin(a) }, n = o.flip ? { x: Math.sin(a), y: -Math.cos(a) } : { x: -Math.sin(a), y: -Math.cos(a) };
  return { A, apex, C, t, n, L, h };
}
function surfaceOf(o) {                         // опорные поверхности для опыта: n — наружу от твёрдого тела, q — точка, u — вдоль t от q
  if (o.type === "floor") return { n: { x: 0, y: -1 }, t: { x: 1, y: 0 }, q: { x: o.x, y: o.y - 7 }, u0: -o.w / 2, u1: o.w / 2 };
  if (o.type === "ceil") return { n: { x: 0, y: 1 }, t: { x: 1, y: 0 }, q: { x: o.x, y: o.y + 7 }, u0: -o.w / 2, u1: o.w / 2 };
  if (o.type === "wall") { const s = o.face === "right" ? 1 : -1; return { n: { x: s, y: 0 }, t: { x: 0, y: 1 }, q: { x: o.x + 7 * s, y: o.y }, u0: -o.h / 2, u1: o.h / 2 }; }
  if (o.type === "incline") { const g = inclineGeom(o); return { n: g.n, t: g.t, q: g.A, u0: 0, u1: g.L }; }
  return null;
}
function springEnds(o) {
  const a = (o.glueA && anchorPos(o.glueA)) || { x: o.ax, y: o.ay }, b = (o.glueB && anchorPos(o.glueB)) || { x: o.bx, y: o.by };
  return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
}
function forceGeom(o) {
  const base = o.to && anchorPos(o.to); if (!base) return null;
  const a = o.ang * DEG, len = o.F > 0 ? Math.max(50, Math.min(130, 30 + o.F * 4)) : 80;
  return { a: { x: base.x, y: base.y }, b: { x: base.x + Math.cos(a) * len, y: base.y - Math.sin(a) * len } };
}
function anchors(o) {
  const at = (k, lx, ly, a) => { const p = rp(lx, ly, a || 0); return { k, x: o.x + p.x, y: o.y + p.y }; };
  if (o.type === "hand") return [at("c", 0, 0)];
  if (o.type === "body") {
    const sh = o.shape || "box";
    if (sh === "point") return [at("c", 0, 0)];
    if (sh === "ball") { const r = o.r || 28; return [at("c", 0, 0), at("t", 0, -r), at("b", 0, r), at("l", -r, 0), at("r", r, 0)]; }
    const a = (o.angle || 0) * DEG; return [at("c", 0, 0, a), at("t", 0, -25, a), at("b", 0, 25, a), at("l", -35, 0, a), at("r", 35, 0, a)];
  }
  if (o.type === "pulley") { const r = [at("axis", 0, 0), at("L", -o.r, 0), at("R", o.r, 0)]; if (o.r2 > 0) r.push(at("L2", -o.r2, 0), at("R2", o.r2, 0)); return r; }
  if (o.type === "beam") return Array.from({ length: 11 }, (_, i) => Object.assign({ k: String(i) }, beamPt(o, i / 10)));
  if (o.type === "spring") { const e = springEnds(o); return [{ k: "a", x: e.a.x, y: e.a.y }, { k: "b", x: e.b.x, y: e.b.y }]; }
  if (o.type === "wall") { const s = o.face === "right" ? 1 : -1, n = Math.round(o.h / 40); return Array.from({ length: n + 1 }, (_, i) => ({ k: String(i), x: o.x + 7 * s, y: o.y - o.h / 2 + i * 40 })); }
  if (o.type === "incline") { const g = inclineGeom(o); return Array.from({ length: 9 }, (_, i) => ({ k: String(i), x: g.A.x + g.t.x * g.L * i / 8, y: g.A.y + g.t.y * g.L * i / 8 })); }
  if (o.type === "ceil" || o.type === "floor") { const n = Math.round(o.w / 40), y = o.type === "ceil" ? o.y + 7 : o.y - 7; return Array.from({ length: n + 1 }, (_, i) => ({ k: String(i), x: o.x - o.w / 2 + i * 40, y })); }
  return [];
}
const anchorPos = (ref) => { const o = ref && byId(ref.id); return o ? anchors(o).find((a) => a.k === ref.k) || null : null; };

const segDist = (px, py, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2)); return Math.hypot(px - a.x - t * dx, py - a.y - t * dy); };
const PRIO = { hand: 7, body: 6, spring: 6, force: 6, pulley: 5, beam: 4, wall: 2, ceil: 2, floor: 2, incline: 1 };
function hitObj(o, x, y) {
  if (o.type === "body") {
    const sh = o.shape || "box"; if (sh === "ball") return Math.hypot(x - o.x, y - o.y) <= (o.r || 28) + 3; if (sh === "point") return Math.hypot(x - o.x, y - o.y) <= 14;
    const p = rp(x - o.x, y - o.y, -(o.angle || 0) * DEG); return Math.abs(p.x) <= 36 && Math.abs(p.y) <= 26;
  }
  if (o.type === "hand") return Math.hypot(x - o.x, y - o.y) <= 20;
  if (o.type === "pulley") return Math.hypot(x - o.x, y - o.y) <= o.r + 4;
  if (o.type === "beam") { const p = rp(x - o.x, y - o.y, -o.angle * DEG); return Math.abs(p.x) <= o.len * M_PX / 2 + 6 && Math.abs(p.y) <= 12; }
  if (o.type === "spring") { const e = springEnds(o); return segDist(x, y, e.a, e.b) <= 14; }
  if (o.type === "force") { const g = forceGeom(o); return !!g && segDist(x, y, g.a, g.b) <= 10; }
  if (o.type === "wall") return Math.abs(x - o.x) <= 20 && Math.abs(y - o.y) <= o.h / 2 + 4;
  if (o.type === "incline") { const g = inclineGeom(o), s = (p, q, r) => (p.x - r.x) * (q.y - r.y) - (q.x - r.x) * (p.y - r.y), P = { x, y }, d1 = s(P, g.A, g.apex), d2 = s(P, g.apex, g.C), d3 = s(P, g.C, g.A); return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)); }
  return Math.abs(x - o.x) <= o.w / 2 + 4 && Math.abs(y - o.y) <= 12;
}
const hitTop = (x, y) => scene.objs.map((o, i) => ({ o, i })).filter((q) => hitObj(q.o, x, y)).sort((a, b) => (PRIO[b.o.type] - PRIO[a.o.type]) || (b.i - a.i)).map((q) => q.o)[0];
function connEnds(c) { const a = anchorPos(c.a), b = anchorPos(c.b); return a && b ? [a, b] : null; }
function handles(o) {                           // ручки, за которые меняют форму элемента
  if (o.type === "spring") { const e = springEnds(o); return [{ k: "a", x: e.a.x, y: e.a.y }, { k: "b", x: e.b.x, y: e.b.y }]; }
  if (o.type === "force") { const g = forceGeom(o); return g ? [{ k: "tip", x: g.b.x, y: g.b.y }] : []; }
  return [];
}

// ---------------------------------------------------------------- «Дано»
const massTxt = (name, m) => `${pretty(name) || "m"} = ${fmt(m)} кг`;
const massPart = (o, dflt) => (o.weightless ? "невесомый" : o.mass != null ? `массой ${massTxt(o.name || dflt, o.mass)}` : `массой ${pretty(o.name) || dflt}`);
const muTxt = (mu) => (mu > 0 ? `трение есть, μ = ${fmt(mu)}` : "трения нет");
function givenLines() {
  const L = [], objs = scene.objs;
  for (const o of objs.filter((o) => o.type === "body")) {
    const sh = o.shape || "box", nm = sh === "point" ? "Узел" : sh === "ball" ? "Шар" : "Груз";
    L.push(sh === "point" && o.weightless ? `Узел ${pretty(o.name)} невесомый` : o.weightless ? `${nm} ${pretty(o.name)} невесомый` : o.mass != null ? `Масса: ${massTxt(o.name, o.mass)}` : `Масса ${sh === "point" ? "узла" : sh === "ball" ? "шара" : "груза"} ${pretty(o.name) || "m"}`);
  }
  for (const o of objs.filter((o) => o.type === "pulley")) L.push(`Блок ${o.mount === "free" ? "подвижный" : "неподвижный"}${o.r2 > 0 ? " (ступенчатый)" : ""}, ${massPart(o, "M")}${o.smooth ? ", трения в оси нет" : ", трение в оси есть"}`);
  for (const o of objs.filter((o) => o.type === "beam")) {
    const parts = [`длиной ${fmt(o.len)} м`, o.weightless ? "невесомый" : o.mass != null ? `массой ${massTxt(o.name || "m", o.mass)}` : `массой ${pretty(o.name) || "m"}`];
    if (!o.weightless && o.cm != null) parts.push(`центр масс на ${fmt(o.cm)} м от левого конца`);
    if (o.pivot != null) parts.push(o.clamp ? `заделан на расстоянии ${fmt(o.pivot)} м от левого конца` : `шарнир на расстоянии ${fmt(o.pivot)} м от левого конца`);
    const sp = supportsOf(o); if (sp.length) parts.push(`опоры на ${sp.map(fmt).join("; ")} м`);
    if (o.angle) parts.push(`наклон ${fmt(o.angle)}°`);
    L.push(`Рычаг (стержень) ${parts.join(", ")}`);
  }
  for (const o of objs.filter((o) => o.type === "spring")) L.push(`${o.dyn ? "Динамометр" : "Пружина"}${o.name ? " " + pretty(o.name) : ""}: ${o.k != null ? "k = " + fmt(o.k) + " Н/м" : "жёсткость k"}${o.l0 != null ? `, длина без нагрузки ${fmt(o.l0)} м` : ""}${o.weightless ? ", невесомая" : o.mass != null ? `, масса ${fmt(o.mass)} кг` : ""}`);
  for (const o of objs.filter((o) => o.type === "force")) L.push(`Сила ${pretty(o.name) || "F"}${o.F > 0 ? " = " + fmt(o.F) + " Н" : ""}, направление ${fmt(o.ang)}° к горизонтали`);
  const floors = objs.filter((o) => o.type === "floor");
  if (floors.length) L.push(floors.every((o) => !(o.mu > 0)) ? "Пол гладкий" : "Пол: " + floors.map((o) => muTxt(o.mu)).join("; "));
  for (const o of objs.filter((o) => o.type === "wall")) L.push(`Стена: ${muTxt(o.mu)}`);
  for (const o of objs.filter((o) => o.type === "incline")) L.push(`Наклонная плоскость: угол ${fmt(o.ang)}°, ${muTxt(o.mu)}`);
  const threads = scene.conns.filter((c) => c.kind === "thread");
  if (threads.length) {
    const plain = threads.filter((c) => c.weightless && c.inextensible && !c.name);
    if (plain.length) L.push(plain.length === threads.length ? "Нити невесомые и нерастяжимые" : "Остальные нити невесомые и нерастяжимые");
    for (const c of threads.filter((c) => !(c.weightless && c.inextensible && !c.name))) {
      const p = [c.weightless ? "невесомая" : c.mass != null ? `массой ${fmt(c.mass)} кг` : "с массой", c.inextensible ? "нерастяжимая" : "растяжимая"];
      L.push(`Нить${c.name ? " " + pretty(c.name) : ""} ${p.join(", ")}`);
    }
  }
  for (const c of scene.conns.filter((c) => c.kind === "rod")) L.push(`Стержень${c.name ? " " + pretty(c.name) : ""} ${c.weightless ? "невесомый" : "массой " + (c.mass != null ? fmt(c.mass) + " кг" : "m")}`);
  for (const c of scene.conns.filter((c) => c.kind === "spring")) L.push(`Пружина${c.name ? " " + pretty(c.name) : ""} жёсткостью ${c.kval != null ? "k = " + fmt(c.kval) + " Н/м" : "k"}${c.weightless ? ", невесомая" : ""}`);
  if (objs.length) L.push(`g = ${fmt(scene.g)} м/с²`);
  return L;
}

// ---------------------------------------------------------------- рисование
function arrowTo(c, x0, y0, x1, y1, col, lw = 3) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  c.strokeStyle = col; c.fillStyle = col; c.lineWidth = lw; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x1 - 12 * Math.cos(a - 0.4), y1 - 12 * Math.sin(a - 0.4)); c.lineTo(x1 - 12 * Math.cos(a + 0.4), y1 - 12 * Math.sin(a + 0.4)); c.closePath(); c.fill();
}
function hatch(c, x0, y0, w, dir) {      // штриховка под потолком (dir=-1) или под полом (dir=1)
  c.strokeStyle = "#8a919c"; c.lineWidth = 1.5; c.beginPath();
  for (let x = x0 - 10; x < x0 + w; x += 14) { c.moveTo(x + 10, y0); c.lineTo(x, y0 + 12 * dir); }
  c.stroke();
}
function text(c, s, x, y, size = 15, col = INK, align = "center", bold = false) {
  c.font = `${bold ? "700 " : ""}${size}px system-ui, "Segoe UI", Roboto, sans-serif`; c.fillStyle = col; c.textAlign = align; c.textBaseline = "middle"; c.fillText(s, x, y);
}
const massLabel = (o, dflt) => (o.weightless ? "" : (pretty(o.name) || dflt) + (o.mass != null ? ` = ${fmt(o.mass)} кг` : ""));

function zigzag(c, a, b, lead, n, amp) {
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / d, uy = (b.y - a.y) / d, nx = -uy, ny = ux, ld = Math.min(lead, d / 4), span = d - 2 * ld;
  c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(a.x + ux * ld, a.y + uy * ld);
  for (let i = 0; i < n; i++) { const t = ld + span * (i + 0.5) / n, s = i % 2 ? -amp : amp; c.lineTo(a.x + ux * t + nx * s, a.y + uy * t + ny * s); }
  c.lineTo(b.x - ux * ld, b.y - uy * ld); c.lineTo(b.x, b.y); c.stroke();
}

function drawConn(c, cn, picked) {
  const e = connEnds(cn); if (!e) return;
  const [a, b] = e, d = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
  c.lineCap = "round"; c.lineJoin = "round";
  if (sim.on && sim.temp && sim.temp.c === cn) {                    // тянем за нить: она идёт через точку, за которую держим
    c.strokeStyle = INK; c.lineWidth = 2; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(sim.temp.B.x, sim.temp.B.y); c.lineTo(b.x, b.y); c.stroke();
    c.fillStyle = "#fb8c00"; c.beginPath(); c.arc(sim.temp.B.x, sim.temp.B.y, 6, 0, 6.2832); c.fill(); return;
  }
  if (picked) { c.strokeStyle = "rgba(28,142,246,.35)"; c.lineWidth = 12; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
  c.strokeStyle = cn.kind === "rod" ? "#5b6472" : INK;
  if (cn.kind === "spring") { c.lineWidth = 2; zigzag(c, a, b, 22, 9, 10); }
  else {
    c.lineWidth = cn.kind === "rod" ? (cn.weightless ? 5 : 9) : (cn.weightless ? 1.8 : 4.5);
    if (cn.kind === "thread" && !cn.inextensible) c.setLineDash([7, 4]);
    const slack = sim.on ? slackOf(cn) : 0;
    c.beginPath(); c.moveTo(a.x, a.y);
    if (slack > 1.5) { const sag = Math.min(160, Math.sqrt(3 * d * slack / 8)); c.quadraticCurveTo((a.x + b.x) / 2, Math.max(a.y, b.y) + 2 * sag, b.x, b.y); } else c.lineTo(b.x, b.y);
    c.stroke(); c.setLineDash([]);
  }
  let lab = pretty(cn.name);
  if (cn.kind === "spring") lab = (lab ? lab + ", " : "") + (cn.kval != null ? `k = ${fmt(cn.kval)} Н/м` : "k");
  else if (!cn.weightless && cn.mass != null) lab = (lab ? lab + ", " : "") + `${fmt(cn.mass)} кг`;
  if (lab) text(c, lab, (a.x + b.x) / 2 + (-uy) * 18 + 4, (a.y + b.y) / 2 + ux * 18, 14, INK, "left");
}

function drawSpring(c, o, picked) {
  const { a, b } = springEnds(o), d = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
  c.lineCap = "round"; c.lineJoin = "round";
  if (picked) { c.strokeStyle = "rgba(28,142,246,.35)"; c.lineWidth = 14; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
  c.strokeStyle = INK; c.lineWidth = o.weightless ? 2 : 3.2;
  if (o.dyn) {                                                     // динамометр: трубка со шкалой и стрелкой-показанием
    const hook = Math.min(16, d / 5), p0 = { x: a.x + ux * hook, y: a.y + uy * hook }, p1 = { x: b.x - ux * hook, y: b.y - uy * hook }, L = Math.hypot(p1.x - p0.x, p1.y - p0.y), ang = Math.atan2(uy, ux);
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(p0.x, p0.y); c.moveTo(p1.x, p1.y); c.lineTo(b.x, b.y); c.stroke();
    c.save(); c.translate((p0.x + p1.x) / 2, (p0.y + p1.y) / 2); c.rotate(ang);
    c.fillStyle = "#f4f6fa"; c.strokeStyle = INK; c.lineWidth = 2; c.beginPath(); c.roundRect(-L / 2, -13, L, 26, 6); c.fill(); c.stroke();
    c.lineWidth = 1.2; c.beginPath(); for (let i = 1; i < 8; i++) { const x = -L / 2 + L * i / 8; c.moveTo(x, -13); c.lineTo(x, i % 2 ? -5 : -8); } c.stroke();
    const rd = sim.on && o.read != null ? o.read : null, frac = rd != null && o.k > 0 ? Math.min(1, rd / (o.k * 1.5)) : 0.25; c.strokeStyle = RED; c.lineWidth = 3; c.beginPath(); c.moveTo(-L / 2 + L * frac, -13); c.lineTo(-L / 2 + L * frac, 13); c.stroke();
    c.restore();
    const lab = rd != null ? `${fmt(+rd.toFixed(1))} Н` : "F"; text(c, lab, (a.x + b.x) / 2 + (-uy) * 26, (a.y + b.y) / 2 + ux * 26, 15, RED, "center", true);
  } else {
    zigzag(c, a, b, 20, 10, 11);
    const lab = [o.name ? pretty(o.name) : "", o.k != null ? `k = ${fmt(o.k)} Н/м` : "k", !o.weightless ? (o.mass != null ? `${fmt(o.mass)} кг` : "") : ""].filter(Boolean).join(", ");
    text(c, lab, (a.x + b.x) / 2 + (-uy) * 22 + 6, (a.y + b.y) / 2 + ux * 22, 14, INK, "left");
  }
  for (const p of [a, b]) { c.fillStyle = "#fff"; c.strokeStyle = INK; c.lineWidth = 2; c.beginPath(); c.arc(p.x, p.y, 4, 0, 6.2832); c.fill(); c.stroke(); }
}

function drawObj(c, o, picked) {
  c.lineCap = "round"; c.lineJoin = "round";
  if (o.type === "hand") {
    c.fillStyle = "#ffe3b8"; c.strokeStyle = picked ? BLUE : "#fb8c00"; c.lineWidth = picked ? 3.5 : 2.5; c.beginPath(); c.arc(o.x, o.y, 17, 0, 6.2832); c.fill(); c.stroke(); text(c, "✋", o.x, o.y + 1, 18);
  } else if (o.type === "ceil" || o.type === "floor") {
    c.fillStyle = "#cfd4dc"; c.strokeStyle = INK; c.lineWidth = 2; c.beginPath(); c.rect(o.x - o.w / 2, o.y - 7, o.w, 14); c.fill(); c.stroke();
    hatch(c, o.x - o.w / 2, o.type === "ceil" ? o.y - 7 : o.y + 7, o.w, o.type === "ceil" ? -1 : 1);
    if (picked) { c.strokeStyle = BLUE; c.lineWidth = 3; c.strokeRect(o.x - o.w / 2 - 3, o.y - 10, o.w + 6, 20); }
    if (o.type === "floor" && o.mu > 0) text(c, `μ = ${fmt(o.mu)}`, o.x + o.w / 2 - 6, o.y + 26, 13, "#7b828d", "right");
  } else if (o.type === "wall") {
    const s = o.face === "right" ? 1 : -1;
    c.fillStyle = "#cfd4dc"; c.strokeStyle = INK; c.lineWidth = 2; c.beginPath(); c.rect(o.x - 7, o.y - o.h / 2, 14, o.h); c.fill(); c.stroke();
    c.strokeStyle = "#8a919c"; c.lineWidth = 1.5; c.beginPath(); for (let y = o.y - o.h / 2; y < o.y + o.h / 2; y += 14) { c.moveTo(o.x - 7 * s, y + 4); c.lineTo(o.x - 7 * s - 12 * s, y + 16); } c.stroke();
    if (picked) { c.strokeStyle = BLUE; c.lineWidth = 3; c.strokeRect(o.x - 10, o.y - o.h / 2 - 3, 20, o.h + 6); }
    if (o.mu > 0) text(c, `μ = ${fmt(o.mu)}`, o.x + 20 * s, o.y - o.h / 2 - 10, 13, "#7b828d", s > 0 ? "left" : "right");
  } else if (o.type === "incline") {
    const g = inclineGeom(o);
    c.fillStyle = "#e4e8ee"; c.strokeStyle = picked ? BLUE : INK; c.lineWidth = picked ? 3.5 : 2.2; c.beginPath(); c.moveTo(g.A.x, g.A.y); c.lineTo(g.apex.x, g.apex.y); c.lineTo(g.C.x, g.C.y); c.closePath(); c.fill(); c.stroke();
    const s = o.flip ? -1 : 1; c.strokeStyle = "#7b828d"; c.lineWidth = 1.5; c.beginPath(); c.arc(g.A.x, g.A.y, 42, o.flip ? Math.PI : -o.ang * DEG, o.flip ? Math.PI + o.ang * DEG : 0, false); c.stroke();
    text(c, `${fmt(o.ang)}°`, g.A.x + s * 62, g.A.y - 10, 14, "#7b828d", s > 0 ? "left" : "right"); if (o.mu > 0) text(c, `μ = ${fmt(o.mu)}`, (g.A.x + g.apex.x) / 2 + g.n.x * 24, (g.A.y + g.apex.y) / 2 + g.n.y * 24, 13, "#7b828d");
  } else if (o.type === "body") {
    const sh = o.shape || "box";
    if (sh === "point") {
      c.fillStyle = o.weightless ? "#fff" : INK; c.strokeStyle = picked ? BLUE : INK; c.lineWidth = picked ? 3.5 : 2.2; c.beginPath(); c.arc(o.x, o.y, 7, 0, 6.2832); c.fill(); c.stroke();
      text(c, [pretty(o.name), !o.weightless && o.mass != null ? `${fmt(o.mass)} кг` : ""].filter(Boolean).join(", "), o.x + 12, o.y - 13, 15, INK, "left", true);
    } else if (sh === "ball") {
      const r = o.r || 28; c.fillStyle = o.weightless ? "#fff" : FILL; c.strokeStyle = picked ? BLUE : INK; c.lineWidth = picked ? 3.5 : 2.2; if (o.weightless) c.setLineDash([6, 4]);
      c.beginPath(); c.arc(o.x, o.y, r, 0, 6.2832); c.fill(); c.stroke(); c.setLineDash([]);
      const mt = o.mass != null && !o.weightless ? `${fmt(o.mass)} кг` : ""; text(c, pretty(o.name) || "m", o.x, mt ? o.y - 7 : o.y, 17, INK, "center", true); if (mt) text(c, mt, o.x, o.y + 11, 13);
    } else {
      c.save(); c.translate(o.x, o.y); c.rotate((o.angle || 0) * DEG);
      c.fillStyle = o.weightless ? "#fff" : FILL; c.strokeStyle = picked ? BLUE : INK; c.lineWidth = picked ? 3.5 : 2.2; if (o.weightless) c.setLineDash([6, 4]);
      c.beginPath(); c.roundRect(-35, -25, 70, 50, 6); c.fill(); c.stroke(); c.setLineDash([]);
      const lab = o.weightless ? pretty(o.name) : (pretty(o.name) || "m"), mt = o.mass != null && !o.weightless ? `${fmt(o.mass)} кг` : "";
      text(c, lab, 0, mt ? -8 : 0, 18, INK, "center", true); if (mt) text(c, mt, 0, 12, 14); c.restore();
    }
  } else if (o.type === "pulley") {
    if (o.mount === "ceiling") { c.strokeStyle = INK; c.lineWidth = 3; c.beginPath(); c.moveTo(o.x, o.y); c.lineTo(o.x, o.y - o.r - 26); c.stroke(); c.beginPath(); c.moveTo(o.x - 22, o.y - o.r - 26); c.lineTo(o.x + 22, o.y - o.r - 26); c.stroke(); hatch(c, o.x - 22, o.y - o.r - 26, 44, -1); }
    c.fillStyle = o.weightless ? "#fff" : "#b9c4d6"; c.strokeStyle = picked ? BLUE : INK; c.lineWidth = o.weightless ? (picked ? 3.5 : 2) : (picked ? 4 : 4.5);
    c.beginPath(); c.arc(o.x, o.y, o.r, 0, 6.2832); c.fill(); c.stroke();
    if (o.r2 > 0) { c.lineWidth = 2; c.fillStyle = "#eef1f6"; c.beginPath(); c.arc(o.x, o.y, o.r2, 0, 6.2832); c.fill(); c.stroke(); }
    c.fillStyle = INK; c.beginPath(); c.arc(o.x, o.y, o.mount === "free" ? 4 : 7, 0, 6.2832); c.fill();
    if (o.mount === "axle") { c.strokeStyle = INK; c.lineWidth = 2; c.beginPath(); c.arc(o.x, o.y, 11, 0, 6.2832); c.stroke(); }
    const ml = massLabel(o, "M"); if (ml || o.name) text(c, ml || pretty(o.name), o.x + o.r + 8, o.y - o.r + 4, 14, INK, "left");
  } else if (o.type === "beam") {
    const a = o.angle * DEG, L = o.len * M_PX, th = o.weightless ? 6 : 14;
    const tri = (pos, light) => {                                   // опора-треугольник под точкой
      const p = beamPt(o, Math.max(0, Math.min(1, pos / o.len)));
      c.fillStyle = light ? "#e4e8ee" : "#cfd4dc"; c.strokeStyle = INK; c.lineWidth = 2; c.beginPath(); c.moveTo(p.x, p.y + 2); c.lineTo(p.x - 20, p.y + 46); c.lineTo(p.x + 20, p.y + 46); c.closePath(); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(p.x - 34, p.y + 46); c.lineTo(p.x + 34, p.y + 46); c.stroke(); hatch(c, p.x - 34, p.y + 46, 68, 1);
    };
    if (o.pivot != null && !o.clamp) tri(o.pivot, false);
    for (const s of supportsOf(o)) tri(s, true);
    if (o.pivot != null && o.clamp) { const p = beamPt(o, Math.max(0, Math.min(1, o.pivot / o.len))); c.fillStyle = "#cfd4dc"; c.strokeStyle = INK; c.lineWidth = 2; c.beginPath(); c.rect(p.x - 8, p.y - 34, 16, 68); c.fill(); c.stroke(); c.strokeStyle = "#8a919c"; c.lineWidth = 1.5; c.beginPath(); for (let y = p.y - 34; y < p.y + 30; y += 12) { c.moveTo(p.x - 8, y + 4); c.lineTo(p.x - 20, y + 16); } c.stroke(); }
    c.save(); c.translate(o.x, o.y); c.rotate(a);
    c.fillStyle = o.weightless ? "#e7ebf1" : "#b9c4d6"; c.strokeStyle = picked ? BLUE : INK; c.lineWidth = picked ? 3.5 : 2;
    c.beginPath(); c.rect(-L / 2, -th / 2, L, th); c.fill(); c.stroke(); c.restore();
    if (o.pivot != null && !o.clamp) { const p = beamPt(o, Math.max(0, Math.min(1, o.pivot / o.len))); c.fillStyle = INK; c.beginPath(); c.arc(p.x, p.y, 4, 0, 6.2832); c.fill(); }
    if (!o.weightless && o.cm != null) { const p = beamPt(o, Math.max(0, Math.min(1, o.cm / o.len))); c.strokeStyle = RED; c.lineWidth = 2; c.beginPath(); c.moveTo(p.x - 6, p.y - 6); c.lineTo(p.x + 6, p.y + 6); c.moveTo(p.x + 6, p.y - 6); c.lineTo(p.x - 6, p.y + 6); c.stroke(); }
    const ml = massLabel(o, "m"), r = beamPt(o, 1); if (ml || o.name) text(c, ml || pretty(o.name), r.x + 8, r.y - 16, 14, INK, "left");
  } else if (o.type === "spring") drawSpring(c, o, picked);
  else if (o.type === "force") {
    const g = forceGeom(o); if (!g) return;
    if (picked) { c.strokeStyle = "rgba(28,142,246,.35)"; c.lineWidth = 12; c.beginPath(); c.moveTo(g.a.x, g.a.y); c.lineTo(g.b.x, g.b.y); c.stroke(); }
    arrowTo(c, g.a.x, g.a.y, g.b.x, g.b.y, PURPLE, 3.5);
    const lab = `${pretty(o.name) || "F"}${o.F > 0 ? ` = ${fmt(o.F)} Н` : ""}`, dx = g.b.x - g.a.x; text(c, lab, g.b.x + (dx >= 0 ? 8 : -8), g.b.y - 12, 15, PURPLE, dx >= 0 ? "left" : "right", true);
  }
}

function gravityArrows(c) {
  for (const o of scene.objs) {
    if (o.weightless || !["body", "pulley", "beam", "spring"].includes(o.type)) continue;
    const nm = pretty(o.name) || (o.type === "pulley" ? "M" : "m"); let x = o.x, y = o.y;
    if (o.type === "beam") { const p = beamPt(o, o.cm != null ? Math.max(0, Math.min(1, o.cm / o.len)) : 0.5); x = p.x; y = p.y; }
    if (o.type === "spring") { const e = springEnds(o); x = (e.a.x + e.b.x) / 2; y = (e.a.y + e.b.y) / 2; }
    const y0 = o.type === "body" && (o.shape || "box") !== "point" ? y + ((o.shape === "ball" ? o.r || 28 : 25)) : y;
    arrowTo(c, x, y0, x, y0 + 60, RED, 3); text(c, nm + "g", x + 8, y0 + 50, 14, RED, "left", true);
  }
}

function paint(c, ui) {
  const picked = (kind, id) => ui && sel && sel.kind === kind && sel.id === id, of = (...t) => scene.objs.filter((o) => t.includes(o.type));
  for (const o of of("incline", "wall", "ceil", "floor")) drawObj(c, o, picked("o", o.id));
  for (const o of of("beam")) drawObj(c, o, picked("o", o.id));
  for (const cn of scene.conns) drawConn(c, cn, picked("c", cn.id));
  for (const o of of("spring")) drawObj(c, o, picked("o", o.id));
  for (const o of of("pulley")) {
    drawObj(c, o, picked("o", o.id));
    const has = (k) => scene.conns.some((q) => (q.a.id === o.id && q.a.k === k) || (q.b.id === o.id && q.b.k === k));
    for (const [kl, kr, rad] of [["L", "R", o.r], ["L2", "R2", o.r2]]) if (rad > 0 && has(kl) && has(kr)) { c.strokeStyle = INK; c.lineWidth = 1.8; c.beginPath(); c.arc(o.x, o.y, rad, Math.PI, 2 * Math.PI); c.stroke(); }
  }
  for (const o of of("body")) drawObj(c, o, picked("o", o.id));
  for (const o of of("force", "hand")) drawObj(c, o, picked("o", o.id));
  if (sim.on && ui) { simTensionArrows(c); simDraw(c); } else if (scene.showG) gravityArrows(c);
  if (ui && !sim.on && sel && sel.kind === "o") { const o = byId(sel.id); if (o) for (const h of handles(o)) { c.fillStyle = "#fff"; c.strokeStyle = BLUE; c.lineWidth = 2.5; c.beginPath(); c.arc(h.x, h.y, 8, 0, 6.2832); c.fill(); c.stroke(); } }
  if (ui && (["thread", "rod", "force"].includes(tool) || drag && drag.handle && byId(drag.id) && byId(drag.id).type === "spring")) {      // точки подключения
    for (const o of scene.objs) if (o.type !== "spring" || !drag) for (const a of anchors(o)) {
      const used = pending && pending.id === o.id && pending.k === a.k;
      c.fillStyle = used ? BLUE : "rgba(28,142,246,.25)"; c.strokeStyle = BLUE; c.lineWidth = 1.5; c.beginPath(); c.arc(a.x, a.y, used ? 7 : 5.5, 0, 6.2832); c.fill(); c.stroke();
    }
    if (pending) { const p = anchorPos(pending); if (p) { c.setLineDash([6, 5]); c.strokeStyle = BLUE; c.lineWidth = 2; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(mouse.x, mouse.y); c.stroke(); c.setLineDash([]); } }
  }
}

// ---------------------------------------------------------------- холст
const cv = $("cv"), ctx = cv.getContext("2d");
let dpr = 1, S = 1, OX = 0, OY = 0, cssW = 0, cssH = 0, dirty = true;
const mouse = { x: 0, y: 0 };
function resize() {
  const r = cv.getBoundingClientRect(); dpr = window.devicePixelRatio || 1; cssW = r.width; cssH = r.height;
  cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
  S = Math.min(cssW / W, cssH / H); OX = (cssW - W * S) / 2; OY = (cssH - H * S) / 2; dirty = true;
}
window.addEventListener("resize", resize);
function render() {
  if (sim.on) { simFrame(); dirty = true; }
  if (dirty) {
    dirty = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cssW, cssH);
    ctx.setTransform(dpr * S, 0, 0, dpr * S, dpr * OX, dpr * OY);
    if (!scene.objs.length) text(ctx, "Добавь элементы сверху или выбери пример", W / 2, H / 2, 22, "#9aa1ad");
    paint(ctx, true);
  }
  requestAnimationFrame(render);
}
const invalidate = () => { dirty = true; };
const toWorld = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left - OX) / S, y: (e.clientY - r.top - OY) / S }; };

// ---------------------------------------------------------------- история и сохранение
const lsGet = (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
function commit() {                         // зафиксировать состояние в истории + сохранить
  if (sim.on) return;
  const s = JSON.stringify(scene);
  if (hist.length && hist[hist.length - 1] === s) return;
  hist.push(s); if (hist.length > 100) hist.shift(); redo = []; lsSet("statics_scene", s); syncUI();
}
function restore(s) { scene = migrate(JSON.parse(s)); sel = null; pending = null; lsSet("statics_scene", s); syncUI(); }
function undo() { if (hist.length < 2) return; redo.push(hist.pop()); restore(hist[hist.length - 1]); }
function redoIt() { if (!redo.length) return; const s = redo.pop(); hist.push(s); restore(s); }

// ---------------------------------------------------------------- панель свойств
const props = $("props");
function fld(label, input, unit) { return `<div class="fld"><label>${label}</label>${input}${unit ? `<span class="u">${unit}</span>` : ""}</div>`; }
const inpText = (k, v, ph) => `<input type="text" data-k="${k}" value="${String(v ?? "").replace(/"/g, "&quot;")}" placeholder="${ph || ""}" autocomplete="off">`;
const inpNum = (k, v, ph) => `<input type="text" inputmode="decimal" data-k="${k}" data-num="1" value="${v == null ? "" : fmt(v)}" placeholder="${ph || ""}" autocomplete="off">`;
const inpChk = (k, v) => `<input type="checkbox" data-k="${k}" ${v ? "checked" : ""}>`;
const inpRange = (k, v, lo, hi, st) => `<input type="range" data-k="${k}" data-rng="1" min="${lo}" max="${hi}" step="${st}" value="${v}">`;
const inpSel = (k, v, opts) => `<select data-k="${k}">${opts.map(([val, lab]) => `<option value="${val}" ${String(v) === String(val) ? "selected" : ""}>${lab}</option>`).join("")}</select>`;

function massFields(o) {
  return fld("Невесомый", inpChk("weightless", o.weightless)) +
    (o.weightless ? "" : fld("Обозначение", inpText("name", o.name)) + fld("Масса", inpNum("mass", o.mass, "не задана"), "кг"));
}
function renderProps() {
  const o = sel && sel.kind === "o" ? byId(sel.id) : null, cn = sel && sel.kind === "c" ? connById(sel.id) : null;
  if (!o && !cn) { props.innerHTML = `<div class="empty">Нажми на элемент на рисунке, чтобы задать его характеристики. Чтобы соединить элементы, выбери 🧵 или ➖ и нажми две синие точки. Концы пружины можно приклеить к любой точке — перетащи конец (кружок) на синюю точку.</div>`; return; }
  let h = "";
  if (o) {
    h += `<div class="fld"><b>${typeName(o)}</b></div>`;
    if (o.type === "hand") h += `<div class="empty">Привяжи к ✋ нить: выбери 🧵, нажми точку на руке и точку на грузе. Потом включи «▶ Опыт» и потяни за руку — увидишь, какая сила нужна.</div>`;
    if (o.type === "body") { h += massFields(o); if ((o.shape || "box") === "box") h += fld("Наклон", inpRange("angle", o.angle || 0, -90, 90, 5), `${o.angle || 0}°`); if (o.shape === "point") h += `<div class="empty">Узел — точка, где сходятся нити. Можно сделать невесомой или с массой.</div>`; }
    if (o.type === "pulley") h += fld("Крепление", inpSel("mount", o.mount, [["free", "свободный (подвижный)"], ["axle", "ось закреплена"], ["ceiling", "на кронштейне к потолку"]])) + massFields(o) + fld("Трения нет", inpChk("smooth", o.smooth)) + fld("Радиус", inpRange("r", o.r, 22, 60, 2)) + fld("Ступенчатый (малый радиус)", inpRange("r2", o.r2, 0, Math.max(0, o.r - 8), 2), o.r2 > 0 ? "" : "нет") + (o.mount === "free" ? `<div class="empty">Свободный блок держится только на нитях — как подвижный блок.</div>` : "");
    if (o.type === "beam") h += massFields(o) + (o.weightless ? "" : fld("Центр масс на", inpNum("cm", o.cm, "середина"), "м")) + fld("Длина", inpNum("len", o.len, "4"), "м") + fld(o.clamp ? "Заделка на" : "Шарнир на", inpNum("pivot", o.pivot, "нет"), "м") + (o.pivot != null ? fld("Заделка (не вращается)", inpChk("clamp", o.clamp)) : "") + fld("Опоры снизу, м", inpText("sup", o.sup, "напр. 0,5; 3,5")) + fld("Наклон", inpRange("angle", o.angle, -60, 60, 5), `${o.angle}°`);
    if (o.type === "spring") h += fld("Динамометр", inpChk("dyn", o.dyn)) + fld("Жёсткость k", inpNum("k", o.k, "не задана"), "Н/м") + fld("Длина без нагрузки", inpNum("l0", o.l0, "как нарисовано"), "м") + massFields(o) + `<div class="empty">Тяни за кружки на концах. Поднеси конец к синей точке другого элемента — пружина приклеится. К концам можно привязывать нити.</div>`;
    if (o.type === "force") h += fld("Обозначение", inpText("name", o.name)) + fld("Сила F", inpNum("F", o.F, "не задана"), "Н") + fld("Направление", inpRange("ang", o.ang, 0, 345, 15), `${o.ang}°`) + `<div class="empty">0° — вправо, 90° — вверх. Можно тянуть за кружок на конце стрелки.</div>`;
    if (o.type === "ceil") h += fld("Длина", inpRange("w", o.w, 120, 800, 40));
    if (o.type === "floor") h += fld("Длина", inpRange("w", o.w, 120, 800, 40)) + fld("Трение μ", inpNum("mu", o.mu, "гладкий"));
    if (o.type === "wall") h += fld("Высота", inpRange("h", o.h, 120, 600, 40)) + fld("Свободное место", inpSel("face", o.face, [["right", "справа"], ["left", "слева"]])) + fld("Трение μ", inpNum("mu", o.mu, "гладкая"));
    if (o.type === "incline") h += fld("Угол", inpRange("ang", o.ang, 10, 70, 5), `${o.ang}°`) + fld("Основание", inpRange("w", o.w, 160, 600, 20)) + fld("Подъём влево", inpChk("flip", o.flip)) + fld("Трение μ", inpNum("mu", o.mu, "гладкая")) + `<div class="empty">Брусок на плоскости наклони на тот же угол (свойство «Наклон» у груза).</div>`;
    h += `<div class="row"><button class="btn red" id="del">Удалить</button>${["body", "pulley", "beam"].includes(o.type) ? `<button class="btn ghost" id="dup">Копия</button>` : ""}</div>`;
  } else {
    const kinds = inpSel("kind", cn.kind, [["thread", "нить"], ["rod", "стержень"], ["spring", "пружина"]]);
    h += fld("Тип", kinds) + fld("Невесомая", inpChk("weightless", cn.weightless)) + fld("Обозначение", inpText("name", cn.name));
    if (cn.kind === "thread") h += fld("Нерастяжимая", inpChk("inextensible", cn.inextensible));
    if (cn.kind === "spring") h += fld("Жёсткость k", inpNum("kval", cn.kval, "не задана"), "Н/м");
    if (!cn.weightless) h += fld("Масса", inpNum("mass", cn.mass, "не задана"), "кг");
    h += `<div class="row"><button class="btn red" id="del">Удалить</button></div>`;
  }
  props.innerHTML = h;
}
props.addEventListener("input", (e) => {
  const t = e.target, k = t.dataset.k; if (!k) return;
  const tgt = sel.kind === "o" ? byId(sel.id) : connById(sel.id); if (!tgt) return;
  if (t.type === "checkbox") tgt[k] = t.checked;
  else if (t.dataset.num) { tgt[k] = num(t.value); if (k === "len" && (tgt.len == null || tgt.len < 0.5)) tgt.len = 0.5; if (k === "mu" && tgt.mu != null && tgt.mu < 0) tgt.mu = 0; }
  else if (t.dataset.rng) tgt[k] = +t.value;
  else tgt[k] = t.value;
  if (k === "r" && tgt.r2 > tgt.r - 8) tgt.r2 = Math.max(0, tgt.r - 8);
  if (t.type === "checkbox" || t.tagName === "SELECT" || t.dataset.rng) { commit(); renderProps(); } else commitSoon();
  refreshGiven(); invalidate();
});
let cmTimer = 0; const commitSoon = () => { clearTimeout(cmTimer); cmTimer = setTimeout(commit, 500); };
props.addEventListener("click", (e) => {
  if (e.target.id === "del") deleteSel();
  if (e.target.id === "dup" && sel) { const o = byId(sel.id); if (o) { const c = Object.assign({}, o, { id: nid(), x: o.x + 40, y: o.y + 40 }); if (o.type === "body") c.name = "m" + (bodiesCount((q) => q.shape !== "point") + 1); scene.objs.push(c); sel = { kind: "o", id: c.id }; commit(); syncUI(); } }
});

function deleteSel() {
  if (!sel || sim.on) return;
  if (sel.kind === "o") {
    const id = sel.id;
    for (const o of scene.objs) if (o.type === "spring" && ((o.glueA && o.glueA.id === id) || (o.glueB && o.glueB.id === id))) { const e = springEnds(o); o.ax = e.a.x; o.ay = e.a.y; o.bx = e.b.x; o.by = e.b.y; if (o.glueA && o.glueA.id === id) o.glueA = null; if (o.glueB && o.glueB.id === id) o.glueB = null; }
    scene.objs = scene.objs.filter((o) => o.id !== id && !(o.type === "force" && o.to && o.to.id === id));
    scene.conns = scene.conns.filter((c) => c.a.id !== id && c.b.id !== id);
  } else scene.conns = scene.conns.filter((c) => c.id !== sel.id);
  sel = null; commit(); syncUI();
}
function refreshGiven() { const l = givenLines(); $("given").textContent = l.length ? l.join("\n") : "Пока ничего нет."; }
function syncUI() {
  $("undo").disabled = hist.length < 2; $("redo").disabled = !redo.length;
  $("gSel").value = String(scene.g); $("showG").checked = scene.showG; $("capt").checked = scene.capt;
  const act = document.activeElement; if (!(act && props.contains(act) && act.tagName === "INPUT" && act.type === "text")) renderProps();
  refreshGiven(); hintUpdate(); invalidate();
}
const HINTS = { thread: "Нить: нажми две синие точки", rod: "Стержень-связь: нажми две синие точки", force: "Сила: нажми синюю точку, куда её приложить" };
function hintUpdate() {
  if (sim.on) { $("hint").textContent = "Опыт: тяни за нить, за груз, за пружину или за ✋ мышью или пальцем. Отпустишь — всё продолжит двигаться по законам физики."; return; }
  $("hint").textContent = tool === "select" ? (scene.objs.length ? "Перетаскивай элементы. Нажми на элемент — справа его свойства." : "") :
    HINTS[tool] ? (pending ? "Теперь нажми вторую точку (Esc — отмена)" : HINTS[tool]) : "Нажми на рисунок, чтобы поставить элемент";
}

// ---------------------------------------------------------------- ввод
function setTool(t) {
  tool = t; pending = null; document.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === t));
  cv.style.cursor = t === "select" ? "default" : "crosshair"; hintUpdate(); invalidate();
}
document.querySelectorAll("[data-tool]").forEach((b) => (b.onclick = () => setTool(tool === b.dataset.tool && tool !== "select" ? "select" : b.dataset.tool)));

let drag = null;
function pickAnchor(p, skipSprings) {
  let best = null, bd = 18 / S;
  for (const o of scene.objs) { if (skipSprings && o.type === "spring") continue; for (const a of anchors(o)) { const d = Math.hypot(a.x - p.x, a.y - p.y); if (d < bd) { bd = d; best = { id: o.id, k: a.k }; } } }
  return best;
}
const CONNECT = ["thread", "rod", "force"];
cv.addEventListener("pointerdown", (e) => {
  const p = toWorld(e); mouse.x = p.x; mouse.y = p.y; cv.setPointerCapture(e.pointerId);
  if (sim.on) { simDown(p); return; }
  if (CONNECT.includes(tool)) {
    const a = pickAnchor(p); if (!a) { pending = null; hintUpdate(); invalidate(); return; }
    if (tool === "force") { const f = addObj("force", 0, 0, { to: a }); sel = { kind: "o", id: f.id }; commit(); setTool("select"); syncUI(); return; }
    if (!pending) { pending = a; hintUpdate(); invalidate(); return; }
    if (pending.id === a.id && pending.k === a.k) { pending = null; hintUpdate(); invalidate(); return; }
    const c = addConn(tool, pending, a); sel = { kind: "c", id: c.id }; pending = null; commit(); setTool("select"); syncUI(); return;
  }
  if (tool !== "select") {
    const o = addObj(tool, p.x, p.y);
    if (tool === "spring") { o.ax = snap(p.x); o.ay = snap(p.y) - 60; o.bx = snap(p.x); o.by = snap(p.y) + 60; }
    sel = { kind: "o", id: o.id }; commit(); setTool("select"); syncUI(); return;
  }
  if (sel && sel.kind === "o") {                                   // ручки выбранного элемента
    const o = byId(sel.id), h = o && handles(o).find((q) => Math.hypot(q.x - p.x, q.y - p.y) <= 14 / S + 4);
    if (h) { drag = { id: o.id, handle: h.k, moved: false }; return; }
  }
  const o = hitTop(p.x, p.y);
  if (o) {
    sel = { kind: "o", id: o.id };
    drag = o.type === "spring" ? { id: o.id, body: true, px: p.x, py: p.y, moved: false } : o.type === "force" ? null : { id: o.id, dx: o.x - p.x, dy: o.y - p.y, moved: false };
  } else {
    const c = scene.conns.find((q) => { const e2 = connEnds(q); return e2 && segDist(p.x, p.y, e2[0], e2[1]) < 9 / S + 3; });
    sel = c ? { kind: "c", id: c.id } : null;
  }
  syncUI();
});
cv.addEventListener("pointermove", (e) => {
  const p = toWorld(e); mouse.x = p.x; mouse.y = p.y;
  if (sim.on) { simMove(p); return; }
  if (drag) {
    const o = byId(drag.id); if (!o) return; drag.moved = true;
    if (drag.handle) {
      if (o.type === "spring") { const k = drag.handle, g = pickAnchor(p, true); o[k === "a" ? "ax" : "bx"] = snap(p.x); o[k === "a" ? "ay" : "by"] = snap(p.y); o[k === "a" ? "glueA" : "glueB"] = null; drag.over = g; if (g) { const q = anchorPos(g); o[k === "a" ? "ax" : "bx"] = q.x; o[k === "a" ? "ay" : "by"] = q.y; } }
      else if (o.type === "force") { const g = forceGeom(o); if (g) o.ang = (Math.round(Math.atan2(-(p.y - g.a.y), p.x - g.a.x) / DEG / 15) * 15 + 360) % 360; }
    } else if (drag.body) {                                         // тянем пружину целиком: свободные концы едут, приклеенные остаются
      const dx = snap(p.x) - snap(drag.px), dy = snap(p.y) - snap(drag.py);
      if (dx || dy) { if (!o.glueA) { o.ax += dx; o.ay += dy; } if (!o.glueB) { o.bx += dx; o.by += dy; } drag.px = p.x; drag.py = p.y; }
    } else { o.x = snap(p.x + drag.dx); o.y = snap(p.y + drag.dy); }
    invalidate();
  } else if (pending) invalidate();
});
const endDrag = () => {
  if (sim.on) { simUp(); return; }
  if (drag && drag.handle && drag.over) { const o = byId(drag.id); if (o && o.type === "spring") o[drag.handle === "a" ? "glueA" : "glueB"] = drag.over; }
  if (drag && drag.moved) { commit(); refreshGiven(); }
  drag = null; invalidate();
};
cv.addEventListener("pointerup", endDrag); cv.addEventListener("pointercancel", endDrag);
window.addEventListener("keydown", (e) => {
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { if (e.key === "Escape") document.activeElement.blur(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redoIt() : undo(); }
  else if (e.key === "Delete" || e.key === "Backspace") deleteSel();
  else if (e.key === "Escape") { if (tool !== "select") setTool("select"); else { sel = null; syncUI(); } }
  else if (e.key.toLowerCase() === "v" && !sim.on) setTool("select");
});

// ---------------------------------------------------------------- общие настройки, кнопки
$("gSel").onchange = () => { scene.g = +$("gSel").value; commit(); refreshGiven(); };
$("showG").onchange = () => { scene.showG = $("showG").checked; commit(); invalidate(); };
$("capt").onchange = () => { scene.capt = $("capt").checked; commit(); };
$("undo").onclick = undo; $("redo").onclick = redoIt;
function setSim(on) {
  if (on) { if (!scene.objs.length) { toast("Сначала собери схему или выбери пример"); return; } setTool("select"); simStart(); }
  else simStop();
  document.body.classList.toggle("sim", sim.on); $("simBtn").classList.toggle("on", sim.on); $("simBtn").querySelector(".t").textContent = sim.on ? "Остановить" : "Опыт";
  $("simReset").style.display = sim.on ? "" : "none"; syncUI();
}
$("simBtn").onclick = () => setSim(!sim.on);
$("simReset").onclick = () => { if (sim.on) { simStop(); setSim(true); } };
$("clear").onclick = () => { if (sim.on) return; if (!scene.objs.length || confirm("Очистить весь рисунок?")) { scene.objs = []; scene.conns = []; sel = null; commit(); syncUI(); } };

// ---------------------------------------------------------------- примеры
function place(o, x, y) { o.x = x; o.y = y; return o; }
function addSpring(a, b, extra) {          // a, b — ссылка {id,k} (приклеить) или точка {x,y}
  const o = addObj("spring", 0, 0, extra || {});
  for (const [k, e] of [["a", a], ["b", b]]) {
    if (e.id) { const q = anchorPos(e); o["glue" + k.toUpperCase()] = e; o[k + "x"] = q.x; o[k + "y"] = q.y; } else { o[k + "x"] = e.x; o[k + "y"] = e.y; }
  }
  return o;
}
const PRESETS = {
  "Груз на нити": () => { const c = addObj("ceil", 500, 60, { w: 320 }), b = addObj("body", 500, 300); addConn("thread", { id: c.id, k: "4" }, { id: b.id, k: "t" }); },
  "Груз на двух нитях": () => { const c = addObj("ceil", 500, 60, { w: 480 }), b = addObj("body", 500, 300); addConn("thread", { id: c.id, k: "2" }, { id: b.id, k: "t" }); addConn("thread", { id: c.id, k: "10" }, { id: b.id, k: "t" }); },
  "Узел с тремя нитями": () => { const c = addObj("ceil", 500, 60, { w: 480 }), k = addObj("knot", 500, 220), b = addObj("body", 500, 400, { mass: 3 }); addConn("thread", { id: c.id, k: "2" }, { id: k.id, k: "c" }); addConn("thread", { id: c.id, k: "10" }, { id: k.id, k: "c" }); addConn("thread", { id: k.id, k: "c" }, { id: b.id, k: "t" }); },
  "Два груза через блок": () => { const p = addObj("pulley", 500, 130, { r: 40, mount: "ceiling" }), a = addObj("body", 460, 340, { mass: 2 }), b = addObj("body", 540, 400); b.name = "m2"; b.mass = 3; addConn("thread", { id: p.id, k: "L" }, { id: a.id, k: "t" }); addConn("thread", { id: p.id, k: "R" }, { id: b.id, k: "t" }); },
  "Подвижный блок": () => { const c = addObj("ceil", 500, 60, { w: 320 }), p = addObj("pulley", 500, 220, { r: 40, mount: "free" }), b = addObj("body", 500, 400, { mass: 4 }); addConn("thread", { id: c.id, k: "2" }, { id: p.id, k: "L" }); addConn("thread", { id: c.id, k: "6" }, { id: p.id, k: "R" }); addConn("thread", { id: p.id, k: "axis" }, { id: b.id, k: "t" }); },
  "Подвижный и неподвижный блок (рука)": () => {
    const c = addObj("ceil", 400, 60, { w: 320 }), f = addObj("pulley", 600, 120, { r: 30, mount: "axle" }), m = addObj("pulley", 500, 260, { r: 34, mount: "free" }), b = addObj("body", 500, 430, { mass: 4 }), h = addObj("hand", 660, 340);
    addConn("thread", { id: c.id, k: "6" }, { id: m.id, k: "L" }); addConn("thread", { id: m.id, k: "R" }, { id: f.id, k: "L" }); addConn("thread", { id: f.id, k: "R" }, { id: h.id, k: "c" }); addConn("thread", { id: m.id, k: "axis" }, { id: b.id, k: "t" });
  },
  "Рычаг с грузами": () => { const r = addObj("beam", 500, 300, { len: 4, pivot: 2 }), a = addObj("body", 372, 420, { mass: 6 }), b = addObj("body", 596, 420, { mass: 8 }); b.name = "m2"; addConn("thread", { id: r.id, k: "1" }, { id: a.id, k: "t" }); addConn("thread", { id: r.id, k: "8" }, { id: b.id, k: "t" }); },
  "Доска на двух опорах": () => { const r = addObj("beam", 500, 350, { len: 4, pivot: null, sup: "0,5; 3,5", weightless: false, mass: 10, name: "M" }); place(addObj("body", 0, 0, { mass: 5 }), 500, 350 - 7 - 25); },
  "Консоль с грузом": () => { const w = addObj("wall", 300, 320, { h: 320, face: "right" }), r = addObj("beam", 500, 300, { len: 4, pivot: 0, clamp: true, weightless: false, mass: 4, name: "M" }); place(r, 300 + 7 + 160, 300); const b = addObj("body", 580, 400, { mass: 2 }); addConn("thread", { id: r.id, k: "9" }, { id: b.id, k: "t" }); },
  "Груз на пружине": () => { const c = addObj("ceil", 500, 60, { w: 320 }), b = addObj("body", 500, 360, { mass: 1 }); addSpring({ id: c.id, k: "4" }, { id: b.id, k: "t" }, { k: 100 }); },
  "Динамометр с грузом": () => { const c = addObj("ceil", 500, 60, { w: 320 }), b = addObj("body", 500, 380, { mass: 2 }); addSpring({ id: c.id, k: "4" }, { id: b.id, k: "t" }, { k: 200, dyn: true }); },
  "Груз между двумя пружинами": () => { const wl = addObj("wall", 200, 400, { h: 280, face: "right" }), wr = addObj("wall", 800, 400, { h: 280, face: "left" }), f = addObj("floor", 500, 560, { w: 640 }), b = place(addObj("body", 0, 0, { mass: 2 }), 500, 513 - 25); addSpring({ id: wl.id, k: "3" }, { id: b.id, k: "l" }, { k: 100 }); addSpring({ id: wr.id, k: "3" }, { id: b.id, k: "r" }, { k: 150 }); },
  "Брусок на наклонной плоскости": () => { const i = addObj("incline", 500, 520, { w: 520, ang: 30, mu: 0.6 }), g = inclineGeom(i), b = addObj("body", 0, 0, { mass: 4, angle: -30 }); place(b, g.A.x + g.t.x * 260 + g.n.x * 25, g.A.y + g.t.y * 260 + g.n.y * 25); },
  "Шар на нити у стены": () => { const w = addObj("wall", 700, 300, { h: 400, face: "left" }), s = place(addObj("ball", 0, 0, { mass: 2 }), 665, 380); addConn("thread", { id: w.id, k: "1" }, { id: s.id, k: "c" }); },
  "Лестница у стены": () => { addObj("floor", 500, 520, { w: 640, mu: 0.4 }); addObj("wall", 700, 330, { h: 400, face: "left" }); addObj("beam", 613, 374.5, { len: 4, angle: -60, pivot: null, weightless: false, mass: 10, name: "m" }); },
  "Брусок и сила на полу": () => { addObj("floor", 500, 520, { w: 640, mu: 0.2 }); const b = place(addObj("body", 0, 0, { mass: 5 }), 500, 513 - 25); addObj("force", 0, 0, { to: { id: b.id, k: "l" }, F: 8, ang: 180 }); },
};
for (const k of Object.keys(PRESETS)) { const op = document.createElement("option"); op.value = k; op.textContent = k; $("presets").appendChild(op); }
$("presets").onchange = () => {
  const k = $("presets").value; $("presets").value = ""; if (!k || sim.on) return;
  if (scene.objs.length && !confirm("Заменить текущий рисунок примером?")) return;
  scene.objs = []; scene.conns = []; sel = null; PRESETS[k](); commit(); syncUI();
};

// ---------------------------------------------------------------- экспорт в картинку
function bounds() {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; const add = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  for (const o of scene.objs) {
    if (o.type === "body") { const r = o.shape === "ball" ? o.r || 28 : o.shape === "point" ? 8 : 40; add(o.x - r, o.y - r); add(o.x + r + 70, o.y + r); }
    else if (o.type === "pulley") { add(o.x - o.r, o.y - o.r - (o.mount === "ceiling" ? 28 : 0)); add(o.x + o.r + 90, o.y + o.r); }
    else if (o.type === "hand") { add(o.x - 20, o.y - 20); add(o.x + 20, o.y + 20); }
    else if (o.type === "beam") { for (const f of [0, 1]) { const p = beamPt(o, f); add(p.x, p.y - 20); add(p.x + 110, p.y + 20); } for (const s of [...supportsOf(o), ...(o.pivot != null ? [o.pivot] : [])]) { const p = beamPt(o, s / o.len); add(p.x - 36, p.y + 60); } }
    else if (o.type === "spring") { const e = springEnds(o); for (const p of [e.a, e.b]) { add(p.x - 70, p.y - 20); add(p.x + 120, p.y + 20); } }
    else if (o.type === "force") { const g = forceGeom(o); if (g) { add(g.a.x - 100, g.a.y - 30); add(g.b.x + 130, g.b.y + 30); } }
    else if (o.type === "wall") { add(o.x - 30, o.y - o.h / 2 - 24); add(o.x + 30, o.y + o.h / 2); }
    else if (o.type === "incline") { const g = inclineGeom(o); add(g.A.x - 70, g.A.y + 10); add(g.apex.x, g.apex.y); add(g.C.x + 20, g.C.y + 10); }
    else { add(o.x - o.w / 2, o.y - 22); add(o.x + o.w / 2, o.y + 24); }
    if (scene.showG && !o.weightless && ["body", "pulley", "beam"].includes(o.type)) { add(o.x, o.y + 96); add(o.x + 60, o.y); }
  }
  for (const c of scene.conns) { const e = connEnds(c); if (e) { add(e[0].x - 70, e[0].y); add(e[1].x + 120, e[1].y); } }
  return { x0: x0 - 24, y0: y0 - 24, x1: x1 + 24, y1: y1 + 24 };
}
function exportCanvas(maxPx) {
  if (!scene.objs.length) return null;
  const b = bounds(), bw = b.x1 - b.x0, lines = scene.capt ? givenLines() : [], capH = lines.length ? 26 * lines.length + 38 : 0;
  const scale = Math.min(2, maxPx / Math.max(bw, b.y1 - b.y0 + capH)), c = document.createElement("canvas");
  c.width = Math.round(bw * scale); c.height = Math.round((b.y1 - b.y0 + capH) * scale);
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.setTransform(scale, 0, 0, scale, -b.x0 * scale, -b.y0 * scale);
  const keepSel = sel; sel = null; paint(g, false); sel = keepSel;
  if (lines.length) {
    g.setTransform(scale, 0, 0, scale, 0, 0); const top = b.y1 - b.y0 + 14;
    g.strokeStyle = "#d0d4da"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(16, top - 8); g.lineTo(bw - 16, top - 8); g.stroke();
    text(g, "Дано:", 20, top + 10, 18, INK, "left", true);
    lines.forEach((l, i) => text(g, l, 20, top + 36 + i * 26, 17, INK, "left"));
    const need = Math.max(...lines.map((l) => g.measureText(l).width)) + 40;   // подпись шире рисунка — расширяем
    if (need > c.width / scale) { const c2 = document.createElement("canvas"); c2.width = Math.round(need * scale); c2.height = c.height; const g2 = c2.getContext("2d"); g2.fillStyle = "#fff"; g2.fillRect(0, 0, c2.width, c2.height); g2.drawImage(c, 0, 0); return c2; }
  }
  return c;
}
function toast(t) { const el = $("toast"); el.textContent = t; el.classList.add("show"); clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove("show"), 2200); }
$("save").onclick = () => {
  const c = exportCanvas(1800); if (!c) { toast("Сначала нарисуй что-нибудь"); return; }
  c.toBlob((bl) => { const a = document.createElement("a"); a.href = URL.createObjectURL(bl); a.download = "statika.png"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, "image/png");
};
if (EMBED) {
  $("toBoard").style.display = ""; $("save").style.display = "none";
  $("toBoard").onclick = () => {
    let c = exportCanvas(1400); if (!c) { toast("Сначала нарисуй что-нибудь"); return; }
    let data = c.toDataURL("image/png"); if (data.length > 900000) { c = exportCanvas(1000); data = c.toDataURL("image/jpeg", 0.9); }
    parent.postMessage({ type: "statics_png", data, w: c.width, h: c.height }, "*");
  };
}

// ---------------------------------------------------------------- старт
try { const s = lsGet("statics_scene"); if (s) { const d = JSON.parse(s); if (d && Array.isArray(d.objs)) scene = migrate(Object.assign(scene, d)); } } catch (e) {}
resize(); commit(); syncUI(); requestAnimationFrame(render);
window.__statics = { get scene() { return scene; }, exportCanvas, givenLines, PRESETS, sim, setSim, addObj, addConn, inclineGeom };
