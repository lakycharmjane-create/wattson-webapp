// 📐 Конструктор задач по физике — статика: грузы, блоки, нити, пружины, рычаги.
// Кликаешь по элементу → справа его свойства (невесомый, масса, длина…). Из свойств собирается «Дано».
// Работает отдельной страницей и внутри доски (?embed=1): кнопка «На доску» отправляет картинку родителю через postMessage.
"use strict";
const $ = (id) => document.getElementById(id);
const EMBED = /[?&]embed=1/.test(location.search);
const tg = !EMBED && window.Telegram ? window.Telegram.WebApp : null;
try { if (tg) { tg.ready(); tg.expand(); } } catch (e) {}

const W = 1000, H = 640, GRID = 10, M_PX = 80;       // логический размер сцены, шаг сетки, пикселей на метр у рычага
const INK = "#2b2f36", FILL = "#dfe9f7", RED = "#e53935", BLUE = "#1c8ef6";

// ---------------------------------------------------------------- сцена
let scene = { objs: [], conns: [], g: 10, showG: true, capt: true, seq: 1 };
let sel = null;                       // {kind:"o"|"c", id}
let tool = "select";
let pending = null;                   // первая выбранная точка связи {id, k}
let hist = [], redo = [];
const sim = { on: false };          // состояние режима «Опыт» (statics_sim.js)
const nid = () => scene.seq++;
const byId = (id) => scene.objs.find((o) => o.id === id);
const connById = (id) => scene.conns.find((c) => c.id === id);
const snap = (v) => Math.round(v / GRID) * GRID;

const SUB = "₀₁₂₃₄₅₆₇₈₉";
const pretty = (s) => String(s || "").replace(/_/g, "").replace(/(\p{L})(\d+)/gu, (m, a, d) => a + [...d].map((c) => SUB[c]).join(""));
const num = (v) => { const x = parseFloat(String(v).replace(",", ".")); return Number.isFinite(x) ? x : null; };
const fmt = (x) => String(+x.toPrecision(6)).replace(".", ",");

const DEFAULTS = {
  body: () => ({ type: "body", name: "m" + (scene.objs.filter((o) => o.type === "body").length + 1), mass: null, weightless: false }),
  pulley: () => ({ type: "pulley", name: "", r: 34, fixed: true, weightless: true, mass: null, smooth: true }),
  beam: () => ({ type: "beam", name: "", len: 4, angle: 0, pivot: 2, weightless: true, mass: null }),
  ceil: () => ({ type: "ceil", w: 320 }),
  floor: () => ({ type: "floor", w: 320, smooth: true }),
  hand: () => ({ type: "hand" }),
};
const KIND_NAME = { thread: "Нить", rod: "Стержень", spring: "Пружина" };
const TYPE_NAME = { body: "Груз", pulley: "Блок", beam: "Рычаг", ceil: "Потолок", floor: "Пол", hand: "Рука" };

function addObj(type, x, y, extra) {
  const o = Object.assign({ id: nid(), x: snap(x), y: snap(y) }, DEFAULTS[type](), extra || {});
  scene.objs.push(o); return o;
}
function addConn(kind, a, b, extra) {
  const c = Object.assign({ id: nid(), kind, a, b, weightless: true, inextensible: kind === "thread", mass: null, name: "", kval: null }, extra || {});
  scene.conns.push(c); return c;
}

// ---------------------------------------------------------------- геометрия
const beamPt = (o, f) => { const a = o.angle * Math.PI / 180, d = (f - 0.5) * o.len * M_PX; return { x: o.x + Math.cos(a) * d, y: o.y + Math.sin(a) * d }; };
function anchors(o) {
  if (o.type === "hand") return [{ k: "c", x: o.x, y: o.y }];
  if (o.type === "body") return [{ k: "t", x: o.x, y: o.y - 25 }, { k: "b", x: o.x, y: o.y + 25 }, { k: "l", x: o.x - 35, y: o.y }, { k: "r", x: o.x + 35, y: o.y }];
  if (o.type === "pulley") return [{ k: "axis", x: o.x, y: o.y }, { k: "L", x: o.x - o.r, y: o.y }, { k: "R", x: o.x + o.r, y: o.y }];
  if (o.type === "beam") return Array.from({ length: 11 }, (_, i) => Object.assign({ k: String(i) }, beamPt(o, i / 10)));
  const n = Math.round(o.w / 40), y = o.type === "ceil" ? o.y + 7 : o.y - 7;
  return Array.from({ length: n + 1 }, (_, i) => ({ k: String(i), x: o.x - o.w / 2 + i * 40, y }));
}
const anchorPos = (ref) => { const o = byId(ref.id); return o ? anchors(o).find((a) => a.k === ref.k) || null : null; };

function hitObj(o, x, y) {
  if (o.type === "body") return Math.abs(x - o.x) <= 35 && Math.abs(y - o.y) <= 25;
  if (o.type === "hand") return Math.hypot(x - o.x, y - o.y) <= 20;
  if (o.type === "pulley") return Math.hypot(x - o.x, y - o.y) <= o.r + 4;
  if (o.type === "beam") { const a = -o.angle * Math.PI / 180, dx = x - o.x, dy = y - o.y, lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a); return Math.abs(lx) <= o.len * M_PX / 2 + 6 && Math.abs(ly) <= 12; }
  return Math.abs(x - o.x) <= o.w / 2 + 4 && Math.abs(y - o.y) <= 12;
}
const segDist = (px, py, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2)); return Math.hypot(px - a.x - t * dx, py - a.y - t * dy); };
function connEnds(c) { const a = anchorPos(c.a), b = anchorPos(c.b); return a && b ? [a, b] : null; }

// ---------------------------------------------------------------- «Дано»
const massTxt = (name, m) => `${pretty(name) || "m"} = ${fmt(m)} кг`;
function givenLines() {
  const L = [], objs = scene.objs;
  for (const o of objs.filter((o) => o.type === "body")) {
    L.push(o.weightless ? `Груз ${pretty(o.name)} невесомый` : o.mass != null ? `Масса груза ${massTxt(o.name, o.mass)}` : `Масса груза ${pretty(o.name) || "m"}`);
  }
  for (const o of objs.filter((o) => o.type === "pulley")) {
    const w = o.weightless ? "невесомый" : o.mass != null ? `массой ${massTxt(o.name || "M", o.mass)}` : `массой ${pretty(o.name) || "M"}`;
    L.push(`Блок ${o.fixed ? "неподвижный" : "подвижный"}, ${w}${o.smooth ? ", трения в оси нет" : ", трение в оси есть"}`);
  }
  for (const o of objs.filter((o) => o.type === "beam")) {
    const w = o.weightless ? "невесомый" : o.mass != null ? `массой ${massTxt(o.name || "m", o.mass)}` : `массой ${pretty(o.name) || "m"}`;
    L.push(`Рычаг длиной ${fmt(o.len)} м, ${w}${o.pivot != null ? `, опора на расстоянии ${fmt(o.pivot)} м от левого конца` : ""}${o.angle ? `, наклон ${fmt(o.angle)}°` : ""}`);
  }
  if (objs.some((o) => o.type === "floor" && o.smooth)) L.push("Поверхность гладкая");
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
function hatch(c, x0, y0, w, dir) {      // штриховка под потолком (dir=1) или под полом (dir=1 вниз)
  c.strokeStyle = "#8a919c"; c.lineWidth = 1.5; c.beginPath();
  for (let x = x0 - 10; x < x0 + w; x += 14) { c.moveTo(x + 10, y0); c.lineTo(x, y0 + 12 * dir); }
  c.stroke();
}
function text(c, s, x, y, size = 15, col = INK, align = "center", bold = false) {
  c.font = `${bold ? "700 " : ""}${size}px system-ui, "Segoe UI", Roboto, sans-serif`; c.fillStyle = col; c.textAlign = align; c.textBaseline = "middle"; c.fillText(s, x, y);
}
const massLabel = (o, dflt) => (o.weightless ? "" : (pretty(o.name) || dflt) + (o.mass != null ? ` = ${fmt(o.mass)} кг` : ""));

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
  if (cn.kind === "spring") {
    const lead = Math.min(22, d / 4), n = 9, amp = 10, nx = -uy, ny = ux, span = d - 2 * lead;
    c.lineWidth = 2; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(a.x + ux * lead, a.y + uy * lead);
    for (let i = 0; i < n; i++) { const t = lead + span * (i + 0.5) / n, s = i % 2 ? -amp : amp; c.lineTo(a.x + ux * t + nx * s, a.y + uy * t + ny * s); }
    c.lineTo(b.x - ux * lead, b.y - uy * lead); c.lineTo(b.x, b.y); c.stroke();
  } else {
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

function drawObj(c, o, picked) {
  c.lineCap = "round"; c.lineJoin = "round";
  if (o.type === "hand") {
    c.fillStyle = "#ffe3b8"; c.strokeStyle = picked ? BLUE : "#fb8c00"; c.lineWidth = picked ? 3.5 : 2.5; c.beginPath(); c.arc(o.x, o.y, 17, 0, 6.2832); c.fill(); c.stroke(); text(c, "✋", o.x, o.y + 1, 18);
  } else if (o.type === "ceil" || o.type === "floor") {
    c.fillStyle = "#cfd4dc"; c.strokeStyle = INK; c.lineWidth = 2; c.beginPath(); c.rect(o.x - o.w / 2, o.y - 7, o.w, 14); c.fill(); c.stroke();
    hatch(c, o.x - o.w / 2, o.type === "ceil" ? o.y - 7 : o.y + 7, o.w, o.type === "ceil" ? -1 : 1);
    if (picked) { c.strokeStyle = BLUE; c.lineWidth = 3; c.strokeRect(o.x - o.w / 2 - 3, o.y - 10, o.w + 6, 20); }
  } else if (o.type === "body") {
    c.fillStyle = o.weightless ? "#fff" : FILL; c.strokeStyle = picked ? BLUE : INK; c.lineWidth = picked ? 3.5 : 2.2;
    if (o.weightless) c.setLineDash([6, 4]);
    c.beginPath(); c.roundRect(o.x - 35, o.y - 25, 70, 50, 6); c.fill(); c.stroke(); c.setLineDash([]);
    const lab = o.weightless ? pretty(o.name) : (pretty(o.name) || "m"), mt = o.mass != null && !o.weightless ? `${fmt(o.mass)} кг` : "";
    text(c, lab, o.x, mt ? o.y - 8 : o.y, 18, INK, "center", true); if (mt) text(c, mt, o.x, o.y + 12, 14);
  } else if (o.type === "pulley") {
    if (o.fixed) { c.strokeStyle = INK; c.lineWidth = 3; c.beginPath(); c.moveTo(o.x, o.y); c.lineTo(o.x, o.y - o.r - 26); c.stroke(); c.beginPath(); c.moveTo(o.x - 22, o.y - o.r - 26); c.lineTo(o.x + 22, o.y - o.r - 26); c.stroke(); hatch(c, o.x - 22, o.y - o.r - 26, 44, -1); }
    c.fillStyle = o.weightless ? "#fff" : "#b9c4d6"; c.strokeStyle = picked ? BLUE : INK; c.lineWidth = o.weightless ? (picked ? 3.5 : 2) : (picked ? 4 : 4.5);
    c.beginPath(); c.arc(o.x, o.y, o.r, 0, 6.2832); c.fill(); c.stroke();
    c.fillStyle = INK; c.beginPath(); c.arc(o.x, o.y, 4, 0, 6.2832); c.fill();
    const ml = massLabel(o, "M"); if (ml || o.name) text(c, ml || pretty(o.name), o.x + o.r + 8, o.y - o.r + 4, 14, INK, "left");
  } else if (o.type === "beam") {
    const a = o.angle * Math.PI / 180, L = o.len * M_PX, th = o.weightless ? 6 : 14;
    if (o.pivot != null) {            // опора-треугольник под точкой подвеса
      const f = Math.max(0, Math.min(1, o.pivot / o.len)), p = beamPt(o, f);
      c.fillStyle = "#cfd4dc"; c.strokeStyle = INK; c.lineWidth = 2; c.beginPath(); c.moveTo(p.x, p.y + 2); c.lineTo(p.x - 20, p.y + 46); c.lineTo(p.x + 20, p.y + 46); c.closePath(); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(p.x - 34, p.y + 46); c.lineTo(p.x + 34, p.y + 46); c.stroke(); hatch(c, p.x - 34, p.y + 46, 68, 1);
    }
    c.save(); c.translate(o.x, o.y); c.rotate(a);
    c.fillStyle = o.weightless ? "#e7ebf1" : "#b9c4d6"; c.strokeStyle = picked ? BLUE : INK; c.lineWidth = picked ? 3.5 : 2;
    c.beginPath(); c.rect(-L / 2, -th / 2, L, th); c.fill(); c.stroke(); c.restore();
    if (o.pivot != null) { const p = beamPt(o, Math.max(0, Math.min(1, o.pivot / o.len))); c.fillStyle = INK; c.beginPath(); c.arc(p.x, p.y, 4, 0, 6.2832); c.fill(); }
    const ml = massLabel(o, "m"), r = beamPt(o, 1); if (ml || o.name) text(c, ml || pretty(o.name), r.x + 8, r.y - 16, 14, INK, "left");
  }
}

function gravityArrows(c) {
  const items = [];
  for (const o of scene.objs) {
    if (o.weightless || o.type === "ceil" || o.type === "floor") continue;
    const nm = pretty(o.name) || (o.type === "pulley" ? "M" : "m");
    items.push({ x: o.x, y: o.type === "body" ? o.y + 25 : o.y, label: nm + "g" });
  }
  for (const it of items) { arrowTo(c, it.x, it.y, it.x, it.y + 60, RED, 3); text(c, it.label, it.x + 8, it.y + 50, 14, RED, "left", true); }
}

function paint(c, ui) {
  const picked = (kind, id) => ui && sel && sel.kind === kind && sel.id === id;
  for (const o of scene.objs.filter((o) => o.type === "ceil" || o.type === "floor")) drawObj(c, o, picked("o", o.id));
  for (const o of scene.objs.filter((o) => o.type === "beam")) drawObj(c, o, picked("o", o.id));
  for (const cn of scene.conns) drawConn(c, cn, picked("c", cn.id));
  for (const o of scene.objs.filter((o) => o.type === "pulley")) {
    drawObj(c, o, picked("o", o.id));
    const hasL = scene.conns.some((k) => (k.a.id === o.id && k.a.k === "L") || (k.b.id === o.id && k.b.k === "L"));
    const hasR = scene.conns.some((k) => (k.a.id === o.id && k.a.k === "R") || (k.b.id === o.id && k.b.k === "R"));
    if (hasL && hasR) { c.strokeStyle = INK; c.lineWidth = 1.8; c.beginPath(); c.arc(o.x, o.y, o.r, Math.PI, 2 * Math.PI); c.stroke(); }
  }
  for (const o of scene.objs.filter((o) => o.type === "body")) drawObj(c, o, picked("o", o.id));
  if (sim.on && ui) { simTensionArrows(c); simDraw(c); } else if (scene.showG) gravityArrows(c);
  if (ui && ["thread", "rod", "spring"].includes(tool)) {            // точки подключения связей
    for (const o of scene.objs) for (const a of anchors(o)) {
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
function restore(s) { scene = JSON.parse(s); sel = null; pending = null; lsSet("statics_scene", s); syncUI(); }
function undo() { if (hist.length < 2) return; redo.push(hist.pop()); restore(hist[hist.length - 1]); }
function redoIt() { if (!redo.length) return; const s = redo.pop(); hist.push(s); restore(s); }

// ---------------------------------------------------------------- панель свойств
const props = $("props");
function fld(label, input, unit) { return `<div class="fld"><label>${label}</label>${input}${unit ? `<span class="u">${unit}</span>` : ""}</div>`; }
const inpText = (k, v) => `<input type="text" data-k="${k}" value="${String(v ?? "").replace(/"/g, "&quot;")}" autocomplete="off">`;
const inpNum = (k, v, ph) => `<input type="text" inputmode="decimal" data-k="${k}" data-num="1" value="${v == null ? "" : fmt(v)}" placeholder="${ph || ""}" autocomplete="off">`;
const inpChk = (k, v) => `<input type="checkbox" data-k="${k}" ${v ? "checked" : ""}>`;
const inpRange = (k, v, lo, hi, st) => `<input type="range" data-k="${k}" data-rng="1" min="${lo}" max="${hi}" step="${st}" value="${v}">`;

function massFields(o, nameDef) {
  return fld("Невесомый", inpChk("weightless", o.weightless)) +
    (o.weightless ? "" : fld("Обозначение", inpText("name", o.name), "") + fld("Масса", inpNum("mass", o.mass, "не задана"), "кг"));
}
function renderProps() {
  const o = sel && sel.kind === "o" ? byId(sel.id) : null, cn = sel && sel.kind === "c" ? connById(sel.id) : null;
  if (!o && !cn) { props.innerHTML = `<div class="empty">Нажми на элемент на рисунке, чтобы задать его характеристики. Чтобы соединить элементы, выбери 🧵 / ➖ / 🌀 и нажми две синие точки.</div>`; return; }
  let h = "";
  if (o) {
    h += `<div class="fld"><b>${TYPE_NAME[o.type]}</b></div>`;
    if (o.type === "hand") h += `<div class="empty">Привяжи к ✋ нить: выбери 🧵, нажми точку на руке и точку на грузе. Потом включи «▶ Опыт» и потяни за руку — увидишь, какая сила нужна.</div>`;
    if (o.type === "body") h += massFields(o);
    if (o.type === "pulley") h += fld("Неподвижный", inpChk("fixed", o.fixed)) + massFields(o) + fld("Трения нет", inpChk("smooth", o.smooth)) + fld("Радиус", inpRange("r", o.r, 22, 60, 2));
    if (o.type === "beam") h += massFields(o) + fld("Длина", inpNum("len", o.len, "4"), "м") + fld("Опора на", inpNum("pivot", o.pivot, "нет"), "м") + fld("Наклон", inpRange("angle", o.angle, -45, 45, 5), `${o.angle}°`);
    if (o.type === "ceil" || o.type === "floor") h += fld("Длина", inpRange("w", o.w, 120, 800, 40)) + (o.type === "floor" ? fld("Гладкая (трения нет)", inpChk("smooth", o.smooth)) : "");
    h += `<div class="row"><button class="btn red" id="del">Удалить</button>${o.type === "body" || o.type === "pulley" ? `<button class="btn ghost" id="dup">Копия</button>` : ""}</div>`;
  } else {
    const kinds = `<select data-k="kind"><option value="thread">нить</option><option value="rod">стержень</option><option value="spring">пружина</option></select>`.replace(`value="${cn.kind}"`, `value="${cn.kind}" selected`);
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
  else if (t.dataset.num) { tgt[k] = num(t.value); if (k === "len" && (tgt.len == null || tgt.len < 0.5)) tgt.len = 0.5; }
  else if (t.dataset.rng) tgt[k] = +t.value;
  else tgt[k] = t.value;
  if (t.type === "checkbox" || t.tagName === "SELECT" || t.dataset.rng) { commit(); renderProps(); } else commitSoon();
  refreshGiven(); invalidate();
});
let cmTimer = 0; const commitSoon = () => { clearTimeout(cmTimer); cmTimer = setTimeout(commit, 500); };
props.addEventListener("click", (e) => {
  if (e.target.id === "del") deleteSel();
  if (e.target.id === "dup" && sel) { const o = byId(sel.id); if (o) { const c = addObj(o.type, o.x + 40, o.y + 40, Object.assign({}, o, { id: undefined, x: undefined, y: undefined, name: o.type === "body" ? "m" + (scene.objs.filter((q) => q.type === "body").length + 1) : o.name })); sel = { kind: "o", id: c.id }; commit(); syncUI(); } }
});

function deleteSel() {
  if (!sel) return;
  if (sel.kind === "o") { scene.objs = scene.objs.filter((o) => o.id !== sel.id); scene.conns = scene.conns.filter((c) => c.a.id !== sel.id && c.b.id !== sel.id); }
  else scene.conns = scene.conns.filter((c) => c.id !== sel.id);
  sel = null; commit(); syncUI();
}
function refreshGiven() { const l = givenLines(); $("given").textContent = l.length ? l.join("\n") : "Пока ничего нет."; }
function syncUI() {
  $("undo").disabled = hist.length < 2; $("redo").disabled = !redo.length;
  $("gSel").value = String(scene.g); $("showG").checked = scene.showG; $("capt").checked = scene.capt;
  const act = document.activeElement; if (!(act && props.contains(act) && act.tagName === "INPUT" && act.type === "text")) renderProps();
  refreshGiven(); hintUpdate(); invalidate();
}
function hintUpdate() {
  if (sim.on) { $("hint").textContent = "Опыт: тяни за нить, за груз или за ✋ мышью или пальцем. Отпустишь — всё продолжит двигаться по законам физики."; return; }
  $("hint").textContent = tool === "select" ? (scene.objs.length ? "Перетаскивай элементы. Нажми на элемент — справа его свойства." : "") :
    ["thread", "rod", "spring"].includes(tool) ? (pending ? "Теперь нажми вторую точку (Esc — отмена)" : "Нажми первую синюю точку") : "Нажми на рисунок, чтобы поставить элемент";
}

// ---------------------------------------------------------------- ввод
function setTool(t) {
  tool = t; pending = null; document.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === t));
  cv.style.cursor = t === "select" ? "default" : "crosshair"; hintUpdate(); invalidate();
}
document.querySelectorAll("[data-tool]").forEach((b) => (b.onclick = () => setTool(tool === b.dataset.tool && tool !== "select" ? "select" : b.dataset.tool)));

let drag = null;
function pickAnchor(p) {
  let best = null, bd = 18 / S;
  for (const o of scene.objs) for (const a of anchors(o)) { const d = Math.hypot(a.x - p.x, a.y - p.y); if (d < bd) { bd = d; best = { id: o.id, k: a.k }; } }
  return best;
}
cv.addEventListener("pointerdown", (e) => {
  const p = toWorld(e); mouse.x = p.x; mouse.y = p.y; cv.setPointerCapture(e.pointerId);
  if (sim.on) { simDown(p); return; }
  if (["thread", "rod", "spring"].includes(tool)) {
    const a = pickAnchor(p); if (!a) { pending = null; hintUpdate(); invalidate(); return; }
    if (!pending) { pending = a; hintUpdate(); invalidate(); return; }
    if (pending.id === a.id && pending.k === a.k) { pending = null; hintUpdate(); invalidate(); return; }
    const c = addConn(tool, pending, a); sel = { kind: "c", id: c.id }; pending = null; commit(); setTool("select"); syncUI(); return;
  }
  if (tool !== "select") { const o = addObj(tool, p.x, p.y); sel = { kind: "o", id: o.id }; commit(); setTool("select"); syncUI(); return; }
  const o = [...scene.objs].reverse().find((q) => hitObj(q, p.x, p.y));
  if (o) { sel = { kind: "o", id: o.id }; drag = { id: o.id, dx: o.x - p.x, dy: o.y - p.y, moved: false }; }
  else {
    const c = scene.conns.find((q) => { const e2 = connEnds(q); return e2 && segDist(p.x, p.y, e2[0], e2[1]) < 9 / S + 3; });
    sel = c ? { kind: "c", id: c.id } : null;
  }
  syncUI();
});
cv.addEventListener("pointermove", (e) => {
  const p = toWorld(e); mouse.x = p.x; mouse.y = p.y;
  if (sim.on) { simMove(p); return; }
  if (drag) { const o = byId(drag.id); if (o) { o.x = snap(p.x + drag.dx); o.y = snap(p.y + drag.dy); drag.moved = true; } invalidate(); }
  else if (pending) invalidate();
});
const endDrag = () => { if (sim.on) { simUp(); return; } if (drag && drag.moved) { commit(); refreshGiven(); } drag = null; };
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
const PRESETS = {
  "Груз на нити": () => { const c = addObj("ceil", 500, 60, { w: 320 }), b = addObj("body", 500, 300); addConn("thread", { id: c.id, k: "4" }, { id: b.id, k: "t" }); },
  "Груз на двух нитях": () => { const c = addObj("ceil", 500, 60, { w: 480 }), b = addObj("body", 500, 300); addConn("thread", { id: c.id, k: "2" }, { id: b.id, k: "t" }); addConn("thread", { id: c.id, k: "10" }, { id: b.id, k: "t" }); },
  "Два груза через блок": () => { const p = addObj("pulley", 500, 130, { r: 40 }), a = addObj("body", 460, 340, { mass: 2 }), b = addObj("body", 540, 400); b.name = "m2"; b.mass = 3; addConn("thread", { id: p.id, k: "L" }, { id: a.id, k: "t" }); addConn("thread", { id: p.id, k: "R" }, { id: b.id, k: "t" }); },
  "Подвижный блок": () => { const c = addObj("ceil", 500, 60, { w: 320 }), p = addObj("pulley", 500, 220, { r: 40, fixed: false }), b = addObj("body", 500, 400); addConn("thread", { id: c.id, k: "2" }, { id: p.id, k: "L" }); addConn("thread", { id: c.id, k: "6" }, { id: p.id, k: "R" }); addConn("thread", { id: p.id, k: "axis" }, { id: b.id, k: "t" }); },
  "Рычаг с грузами": () => { const r = addObj("beam", 500, 300, { len: 4, pivot: 2 }), a = addObj("body", 372, 420, { mass: 6 }), b = addObj("body", 596, 420); b.name = "m2"; addConn("thread", { id: r.id, k: "1" }, { id: a.id, k: "t" }); addConn("thread", { id: r.id, k: "8" }, { id: b.id, k: "t" }); },
  "Груз на пружине": () => { const c = addObj("ceil", 500, 60, { w: 320 }), b = addObj("body", 500, 360); addConn("spring", { id: c.id, k: "4" }, { id: b.id, k: "t" }, { kval: 100 }); },
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
    if (o.type === "body") { add(o.x - 35, o.y - 25); add(o.x + 35, o.y + 25); }
    else if (o.type === "pulley") { add(o.x - o.r, o.y - o.r - (o.fixed ? 28 : 0)); add(o.x + o.r + 90, o.y + o.r); }
    else if (o.type === "hand") { add(o.x - 20, o.y - 20); add(o.x + 20, o.y + 20); }
    else if (o.type === "beam") { for (const f of [0, 1]) { const p = beamPt(o, f); add(p.x, p.y - 20); add(p.x + 110, p.y + 20); } if (o.pivot != null) { const p = beamPt(o, o.pivot / o.len); add(p.x - 36, p.y + 60); } }
    else { add(o.x - o.w / 2, o.y - 22); add(o.x + o.w / 2, o.y + 22); }
    if (scene.showG && !o.weightless && o.type !== "ceil" && o.type !== "floor") { add(o.x, o.y + 90); add(o.x + 60, o.y); }
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
try { const s = lsGet("statics_scene"); if (s) { const d = JSON.parse(s); if (d && Array.isArray(d.objs)) scene = Object.assign(scene, d); } } catch (e) {}
resize(); commit(); syncUI(); requestAnimationFrame(render);
window.__statics = { get scene() { return scene; }, exportCanvas, givenLines, PRESETS, sim, setSim };
