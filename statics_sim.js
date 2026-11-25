// ▶ «Опыт» для конструктора статики: рисунок оживает, за нить, груз или «руку» можно тянуть и смотреть силы.
// Движок — XPBD (позиционная динамика): грузы, подвижные блоки и рычаги — твёрдые тела; нить — неупругая связь «не длиннее L₀» (на блоках — одна
// верёвка с общим натяжением), стержень — жёсткая связь, пружина — упругая (F = kx), опора рычага — шарнир. Силы выводятся в ньютонах.
// Допущения (честно говорим в панели): блок идеальный (без массы и трения), грузы не сталкиваются друг с другом, не заданная масса = 1 кг.
"use strict";
Object.assign(sim, { B: new Map(), ropes: [], rods: [], springs: [], pins: [], L0: {}, grab: null, temp: null, hand: null, snap: "", eq: false, info: "", infoAt: 0, notes: [] });
const SUBSTEPS = 24, DT = 1 / 60, FEMA = 0.25;

const rotv = (B, l) => { const c = Math.cos(B.th), s = Math.sin(B.th); return { x: c * l.x - s * l.y, y: s * l.x + c * l.y }; };
const wpt = (t) => { const r = rotv(t.B, t.loc); return { x: t.B.x + r.x, y: t.B.y + r.y, rx: r.x, ry: r.y }; };
const massOf = (o) => (o.weightless ? 0.05 : o.mass > 0 ? o.mass : 1);

function mkBody(o) {
  const B = { o, id: o.id, type: o.type, x: o.x, y: o.y, th: o.type === "beam" ? (o.angle || 0) * Math.PI / 180 : 0, vx: 0, vy: 0, om: 0, im: 0, iI: 0, grav: false, m: 0, Fn: 0 };
  if (o.type === "body") { B.m = massOf(o); B.im = 1 / B.m; B.grav = !o.weightless; }
  else if (o.type === "pulley" && !o.fixed) { B.m = massOf(o); B.im = 1 / B.m; B.grav = !o.weightless; }
  else if (o.type === "beam") { const L = o.len * M_PX; B.m = massOf(o); B.im = 1 / B.m; B.iI = 12 / (B.m * L * L); B.grav = !o.weightless; }
  return B;
}
function mkTerm(ref) {
  const B = sim.B.get(ref.id), a = anchorPos(ref), c = Math.cos(-B.th), s = Math.sin(-B.th), dx = a.x - B.x, dy = a.y - B.y;
  return { B, loc: { x: c * dx - s * dy, y: s * dx + c * dy } };
}
const termDist = (a, b) => { const p = wpt(a), q = wpt(b); return Math.hypot(p.x - q.x, p.y - q.y); };

// ---- построение связей из рисунка
function rebuild() {
  sim.ropes = []; sim.rods = []; sim.springs = [];
  const segs = [], parent = [];
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const uni = (i, j) => { parent[find(i)] = find(j); };
  const pulEnds = new Map();
  const addSeg = (c, a, b, L0, refA, refB) => {
    const s = { c, a, b, L0, fa: { x: 0, y: 0 }, fb: { x: 0, y: 0 }, T: 0 }; segs.push(s); parent.push(segs.length - 1);
    for (const ref of [refA, refB]) if (ref && (ref.k === "L" || ref.k === "R") && byId(ref.id) && byId(ref.id).type === "pulley") { const key = ref.id; if (!pulEnds.has(key)) pulEnds.set(key, []); pulEnds.get(key).push(segs.length - 1); }
    return segs.length - 1;
  };
  for (const c of scene.conns) {
    if (!sim.B.has(c.a.id) || !sim.B.has(c.b.id) || !anchorPos(c.a) || !anchorPos(c.b)) continue;
    if (c.kind === "thread") {
      const a = mkTerm(c.a), b = mkTerm(c.b), L0 = sim.L0[c.id] != null ? sim.L0[c.id] : (sim.L0[c.id] = termDist(a, b));
      if (sim.temp && sim.temp.c === c) {
        const p = wpt(a), q = wpt(b), H = { B: sim.temp.B, loc: { x: 0, y: 0 } }, t = sim.temp.t;
        const i = addSeg(c, a, H, L0 * t, c.a, null), j = addSeg(c, H, b, L0 * (1 - t), null, c.b); uni(i, j);
      } else addSeg(c, a, b, L0, c.a, c.b);
    } else if (c.kind === "rod") { const a = mkTerm(c.a), b = mkTerm(c.b); sim.rods.push({ c, a, b, L0: sim.L0[c.id] != null ? sim.L0[c.id] : (sim.L0[c.id] = termDist(a, b)), F: 0 }); }
    else { const a = mkTerm(c.a), b = mkTerm(c.b); sim.springs.push({ c, a, b, L0: sim.L0[c.id] != null ? sim.L0[c.id] : (sim.L0[c.id] = termDist(a, b)), k: c.kval > 0 ? c.kval : 100, F: 0, ext: 0 }); }
  }
  for (const list of pulEnds.values()) for (let i = 1; i < list.length; i++) uni(list[0], list[i]);
  const groups = new Map();
  segs.forEach((s, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(s); });
  for (const g of groups.values()) sim.ropes.push({ segs: g, Ltot: g.reduce((a, s) => a + s.L0, 0), T: 0, acc: 0 });
}

function simStart() {
  sim.snap = JSON.stringify(scene); sim.B = new Map(); sim.L0 = {}; sim.grab = null; sim.temp = null; sim.hand = null; sim.pins = [];
  for (const o of scene.objs) sim.B.set(o.id, mkBody(o));
  for (const o of scene.objs.filter((o) => o.type === "beam" && o.pivot != null)) {   // шарнир рычага
    const B = sim.B.get(o.id), P = beamPt(o, Math.max(0, Math.min(1, o.pivot / o.len))), c = Math.cos(-B.th), s = Math.sin(-B.th), dx = P.x - B.x, dy = P.y - B.y;
    sim.pins.push({ B, loc: { x: c * dx - s * dy, y: s * dx + c * dy }, P });
  }
  rebuild();
  const notes = [];
  if (scene.objs.some((o) => o.type === "pulley" && (!o.weightless || !o.smooth))) notes.push("блок в опыте считается идеальным (без массы и трения)");
  if (scene.objs.some((o) => (o.type === "body" || (o.type === "beam" && !o.weightless)) && !(o.mass > 0) && !o.weightless)) notes.push("масса, не заданная числом, принята 1 кг");
  sim.notes = notes; sim.on = true; sim.infoAt = 0;
}
function simStop() {
  if (!sim.on) return;
  sim.on = false; const keep = sel; try { scene = JSON.parse(sim.snap); } catch (e) {}
  sel = keep && ((keep.kind === "o" && byId(keep.id)) || (keep.kind === "c" && connById(keep.id))) ? keep : null; sim.grab = null; sim.temp = null;
}

// ---- физика
function applyTerms(C, terms, alphaT) {
  let Wsum = 0;
  for (const t of terms) { t.rg = t.rx * t.gy - t.ry * t.gx; Wsum += t.B.im * (t.gx * t.gx + t.gy * t.gy) + t.B.iI * t.rg * t.rg; }
  if (Wsum + alphaT < 1e-12) return 0;
  const lam = -C / (Wsum + alphaT);
  for (const t of terms) { t.B.x += t.B.im * t.gx * lam; t.B.y += t.B.im * t.gy * lam; t.B.th += t.B.iI * t.rg * lam; }
  return lam;
}
const mkT = (term, gx, gy) => { const p = wpt(term); return { B: term.B, rx: p.rx, ry: p.ry, gx, gy }; };
function pairTerms(a, b, d, p, q) { const ux = (p.x - q.x) / d, uy = (p.y - q.y) / d; return [mkT(a, ux, uy), mkT(b, -ux, -uy)]; }

function substep(h) {
  const gy = scene.g * M_PX, h2 = h * h, dyn = [];
  for (const B of sim.B.values()) if (B.im > 0) { dyn.push(B); if (B.grav) B.vy += gy * h; B.px = B.x; B.py = B.y; B.pth = B.th; B.x += B.vx * h; B.y += B.vy * h; B.th += B.om * h; B.Fn0 = 0; }
  for (const r of sim.ropes) {                              // верёвки (нити, в том числе через блоки): сумма длин ≤ L
    let sum = 0; const ds = r.segs.map((s) => { const p = wpt(s.a), q = wpt(s.b), d = Math.max(1e-6, Math.hypot(p.x - q.x, p.y - q.y)); sum += d; return { p, q, d }; });
    const C = sum - r.Ltot; if (C <= 0) continue;
    const terms = []; r.segs.forEach((s, i) => { const [t1, t2] = pairTerms(s.a, s.b, ds[i].d, ds[i].p, ds[i].q); t1.seg = s; t1.side = "fa"; t2.seg = s; t2.side = "fb"; terms.push(t1, t2); });
    const lam = applyTerms(C, terms, 0); r.acc += -lam;
    for (const t of terms) { t.seg[t.side].x += t.gx * lam; t.seg[t.side].y += t.gy * lam; }
  }
  for (const r of sim.rods) { const p = wpt(r.a), q = wpt(r.b), d = Math.max(1e-6, Math.hypot(p.x - q.x, p.y - q.y)); r.Facc = (r.Facc || 0) + Math.abs(applyTerms(d - r.L0, pairTerms(r.a, r.b, d, p, q), 0)); }
  for (const s of sim.springs) { const p = wpt(s.a), q = wpt(s.b), d = Math.max(1e-6, Math.hypot(p.x - q.x, p.y - q.y)); const lam = applyTerms(d - s.L0, pairTerms(s.a, s.b, d, p, q), 1 / (s.k * h2)); s.Facc = (s.Facc || 0) + lam; }
  for (const pin of sim.pins) for (const [ex, ey] of [[1, 0], [0, 1]]) { const p = wpt(pin); applyTerms((p.x - pin.P.x) * ex + (p.y - pin.P.y) * ey, [{ B: pin.B, rx: p.rx, ry: p.ry, gx: ex, gy: ey }], 0); }
  if (sim.grab) {                                            // мышь тянет груз мягкой пружиной
    const g = sim.grab, p = wpt(g.t), d = Math.max(1e-6, Math.hypot(p.x - g.x, p.y - g.y));
    const lam = applyTerms(d, [{ B: g.t.B, rx: p.rx, ry: p.ry, gx: (p.x - g.x) / d, gy: (p.y - g.y) / d }], 1 / (1500 * h2)); g.Facc = (g.Facc || 0) - lam;
  }
  for (const o of scene.objs) if (o.type === "floor") {      // пол: грузы не проваливаются
    const top = o.y - 7;
    for (const B of dyn) if (B.type === "body" && Math.abs(B.x - o.x) < o.w / 2 + 30 && B.y + 25 > top && B.py + 25 <= top + 30) { const corr = B.y + 25 - top; B.Fn0 += B.m * corr / h2; B.y -= corr; B.py -= corr; B.onFloor = o; }   // поправка не должна давать скорость
  }
  for (const B of dyn) {
    B.vx = (B.x - B.px) / h; B.vy = (B.y - B.py) / h; B.om = (B.th - B.pth) / h;
    if (B.onFloor) { if (B.vy > 0) B.vy = 0; if (!B.onFloor.smooth) B.vx *= 0.9; B.onFloor = null; }
    const k = Math.exp(-0.6 * h), kw = Math.exp(-2 * h); B.vx *= k; B.vy *= k; B.om *= kw;
    B.FnAcc = (B.FnAcc || 0) + B.Fn0;
  }
}

function simFrame() {
  const h = DT / SUBSTEPS;
  const follow = (o, tx, ty, ratio) => { let dx = (tx - o.x) * ratio, dy = (ty - o.y) * ratio; const m = Math.hypot(dx, dy); if (m > 12) { dx *= 12 / m; dy *= 12 / m; } o.x += dx; o.y += dy; };
  const pull = (o, tx, ty) => {                                    // рука разгоняется плавно (≈3g), а не телепортируется: иначе силы получились бы нереальными
    o.vx = o.vx || 0; o.vy = o.vy || 0; let wx = (tx - o.x) * 8, wy = (ty - o.y) * 8; const m = Math.hypot(wx, wy); if (m > 450) { wx *= 450 / m; wy *= 450 / m; }
    let ax = wx - o.vx, ay = wy - o.vy; const am = Math.hypot(ax, ay); if (am > 40) { ax *= 40 / am; ay *= 40 / am; }
    o.vx += ax; o.vy += ay; o.x += o.vx * DT; o.y += o.vy * DT;
  };
  if (sim.hand) pull(sim.hand.B, sim.hand.tx, sim.hand.ty);
  if (sim.temp) pull(sim.temp.B, sim.temp.tx, sim.temp.ty);
  if (sim.grab) follow(sim.grab, sim.grab.tx, sim.grab.ty, 0.5);
  for (const r of sim.ropes) { r.acc = 0; for (const s of r.segs) { s.fa.x = s.fa.y = s.fb.x = s.fb.y = 0; } }
  for (const r of sim.rods) r.Facc = 0; for (const s of sim.springs) s.Facc = 0; for (const B of sim.B.values()) B.FnAcc = 0; if (sim.grab) sim.grab.Facc = 0;
  for (let i = 0; i < SUBSTEPS; i++) substep(h);
  const ema = (old, v) => old + (v - old) * FEMA;
  const toN = 1 / (SUBSTEPS * h * h * M_PX);                       // сумма λ за кадр → среднее по подшагам → ньютоны
  for (const r of sim.ropes) { r.T = ema(r.T, r.acc * toN); for (const s of r.segs) { s.T = r.T; s.fa.x = ema(s.fa.ex || 0, s.fa.x * toN); s.fa.y = ema(s.fa.ey || 0, s.fa.y * toN); s.fb.x = ema(s.fb.ex || 0, s.fb.x * toN); s.fb.y = ema(s.fb.ey || 0, s.fb.y * toN); s.fa.ex = s.fa.x; s.fa.ey = s.fa.y; s.fb.ex = s.fb.x; s.fb.ey = s.fb.y; } }
  for (const r of sim.rods) r.F = ema(r.F, r.Facc * toN);
  for (const s of sim.springs) { s.F = ema(s.F, s.Facc * toN); const p = wpt(s.a), q = wpt(s.b); s.ext = Math.hypot(p.x - q.x, p.y - q.y) - s.L0; }
  for (const B of sim.B.values()) if (B.im > 0) B.Fn = ema(B.Fn, B.FnAcc / SUBSTEPS / M_PX);
  if (sim.grab) sim.grab.F = ema(sim.grab.F || 0, Math.abs(sim.grab.Facc) * toN);
  let moving = 0;                                                  // равновесие: всё почти неподвижно
  for (const B of sim.B.values()) if (B.im > 0) moving = Math.max(moving, Math.hypot(B.vx, B.vy), Math.abs(B.om) * 80);
  sim.still = moving < 4 ? (sim.still || 0) + 1 : 0; sim.eq = sim.still > 45;   // «равновесие» — неподвижно почти секунду (в верхней точке качания скорость тоже на миг нулевая)
  for (const B of sim.B.values()) if (B.o && B.type !== "ceil" && B.type !== "floor") { B.o.x = B.x; B.o.y = B.y; if (B.type === "beam") B.o.angle = B.th * 180 / Math.PI; }
  if (performance.now() - sim.infoAt > 180) { sim.infoAt = performance.now(); buildInfo(); }
}

// ---- мышь
function simDown(p) {
  const dynHit = [...scene.objs].reverse().find((o) => o.type === "hand" && hitObj(o, p.x, p.y)) || [...scene.objs].reverse().find((o) => ["body", "pulley", "beam"].includes(o.type) && sim.B.get(o.id).im > 0 && hitObj(o, p.x, p.y));
  if (dynHit && dynHit.type === "hand") { const B = sim.B.get(dynHit.id); sim.hand = { B, tx: p.x, ty: p.y, dx: B.x - p.x, dy: B.y - p.y }; return; }
  if (dynHit) { const B = sim.B.get(dynHit.id), c = Math.cos(-B.th), s = Math.sin(-B.th), dx = p.x - B.x, dy = p.y - B.y; sim.grab = { t: { B, loc: { x: c * dx - s * dy, y: s * dx + c * dy } }, x: p.x, y: p.y, tx: p.x, ty: p.y, F: 0 }; return; }
  let best = null, bd = 12 / S;                                      // нить: хватаем за любое место
  for (const c of scene.conns) if (c.kind === "thread") { const e = connEnds(c); if (!e) continue; const d = segDist(p.x, p.y, e[0], e[1]); if (d < bd) { bd = d; best = { c, e }; } }
  if (best) {
    const [a, b] = best.e, dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1, t = Math.max(0.05, Math.min(0.95, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    const B = { o: null, id: -1, type: "tmp", x: a.x + dx * t, y: a.y + dy * t, th: 0, vx: 0, vy: 0, om: 0, im: 0, iI: 0 };
    sim.temp = { c: best.c, B, t, tx: p.x, ty: p.y }; rebuild();
  }
}
function simMove(p) {
  if (sim.hand) { sim.hand.tx = p.x + sim.hand.dx; sim.hand.ty = p.y + sim.hand.dy; }
  if (sim.temp) { sim.temp.tx = p.x; sim.temp.ty = p.y; }
  if (sim.grab) { sim.grab.tx = p.x; sim.grab.ty = p.y; }
}
function simUp() { sim.hand = null; sim.grab = null; if (sim.temp) { sim.temp = null; rebuild(); } }

// ---- силы: панель и стрелки
const fN = (x) => (Math.abs(x) < 0.05 ? "0" : fmt(+x.toFixed(1))) + " Н";
const connName = (c) => c.name ? pretty(c.name) : `${KIND_NAME[c.kind]} ${scene.conns.filter((q) => q.kind === c.kind).indexOf(c) + 1}`;
function buildInfo() {
  const L = [];
  L.push(sim.eq ? "✅ Равновесие: всё неподвижно, силы уравновешены" : "⏳ Идёт движение…");
  for (const r of sim.ropes) { const cs = [...new Set(r.segs.map((s) => s.c))]; if (r.T > 0.05) L.push(`${connName(cs[0])}${cs.length > 1 ? "…" : ""}: T = ${fN(r.T)}`); else L.push(`${connName(cs[0])}: провисла (T = 0)`); }
  for (const r of sim.rods) L.push(`${connName(r.c)}: F = ${fN(r.F)}`);
  for (const s of sim.springs) L.push(`${connName(s.c)}: F = kx = ${fN(Math.abs(s.k * s.ext / M_PX))}, x = ${fmt(+(s.ext / M_PX * 100).toFixed(1))} см`);
  for (const B of sim.B.values()) { if (B.type === "body" && B.grav) L.push(`${pretty(B.o.name) || "m"}: mg = ${fN(B.m * scene.g)}${B.Fn > 0.5 ? `, N = ${fN(B.Fn)}` : ""}`); }
  if (sim.grab && sim.grab.F > 0.1) L.push(`Ты тянешь грузик с силой ≈ ${fN(sim.grab.F)}`);
  if (sim.notes.length) L.push("", "ℹ️ " + sim.notes.join("; "));
  sim.info = L.join("\n"); const el = $("forces"); if (el && el.textContent !== sim.info) el.textContent = sim.info;
}
function pill(c, s, x, y, col) {
  c.font = "700 13px system-ui, sans-serif"; const w = c.measureText(s).width + 12; c.fillStyle = "rgba(255,255,255,.92)"; c.strokeStyle = col; c.lineWidth = 1.5;
  c.beginPath(); c.roundRect(x - w / 2, y - 11, w, 22, 8); c.fill(); c.stroke(); text(c, s, x, y, 13, col, "center", true);
}
const F_SCALE = 3, F_MIN = 22, F_MAX = 150;
function forceArrow(c, x, y, fx, fy, col, label) {
  const m = Math.hypot(fx, fy); if (m < 0.3) return; const len = Math.max(F_MIN, Math.min(F_MAX, m * F_SCALE));
  const x1 = x + fx / m * len, y1 = y + fy / m * len; arrowTo(c, x, y, x1, y1, col, 3.5);
  text(c, label, x1 + (fx >= 0 ? 8 : -8), y1 + (fy >= 0 ? 8 : -8), 13, col, fx >= 0 ? "left" : "right", true);
}
function simDraw(c) {
  for (const r of sim.ropes) for (const s of r.segs) { const p = wpt(s.a), q = wpt(s.b); if (r.T > 0.05) pill(c, `T = ${fN(r.T)}`, (p.x + q.x) / 2 + 28, (p.y + q.y) / 2, BLUE); }
  for (const r of sim.rods) { const p = wpt(r.a), q = wpt(r.b); if (r.F > 0.05) pill(c, `F = ${fN(r.F)}`, (p.x + q.x) / 2 + 28, (p.y + q.y) / 2, BLUE); }
  for (const s of sim.springs) { const p = wpt(s.a), q = wpt(s.b); pill(c, `F = ${fN(Math.abs(s.k * s.ext / M_PX))}`, (p.x + q.x) / 2 + 40, (p.y + q.y) / 2, BLUE); }
  if (sim.grab) { const p = wpt(sim.grab.t); c.setLineDash([6, 4]); c.strokeStyle = "#fb8c00"; c.lineWidth = 2.5; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(sim.grab.x, sim.grab.y); c.stroke(); c.setLineDash([]); c.fillStyle = "#fb8c00"; c.beginPath(); c.arc(sim.grab.x, sim.grab.y, 6, 0, 6.2832); c.fill(); }
  if (!scene.showG) return;
  for (const B of sim.B.values()) {                                 // силы на грузах: тяжесть, натяжения, опора
    if (B.type !== "body") continue;
    if (B.grav) forceArrow(c, B.x, B.y + 25, 0, B.m * scene.g, RED, `${pretty(B.o.name) || "m"}g = ${fN(B.m * scene.g)}`);
    if (B.Fn > 0.5) forceArrow(c, B.x + 18, B.y + 25, 0, -B.Fn, "#2e9a49", `N = ${fN(B.Fn)}`);
  }
}
// стрелки натяжения рисуем отдельно: нужна сила на конкретном конце нити
function simTensionArrows(c) {
  if (!scene.showG) return;
  for (const r of sim.ropes) for (const s of r.segs) for (const [term, f] of [[s.a, s.fa], [s.b, s.fb]]) {
    if (term.B.type !== "body" || !r.T || r.T < 0.3) continue; const p = wpt(term);
    const m = Math.hypot(f.x, f.y) || 1; forceArrow(c, p.x, p.y, f.x / m * r.T, f.y / m * r.T, BLUE, "");
  }
  for (const s of sim.springs) for (const [term, sg] of [[s.a, 1], [s.b, -1]]) { if (term.B.type !== "body") continue; const p = wpt(term), q = wpt(term === s.a ? s.b : s.a), d = Math.hypot(q.x - p.x, q.y - p.y) || 1, F = s.k * s.ext / M_PX; forceArrow(c, p.x, p.y, (q.x - p.x) / d * F, (q.y - p.y) / d * F, BLUE, ""); }
}
// провисшая нить: парабола с провисом, длина которой равна L₀
function slackOf(c) {
  if (!sim.on || c.kind !== "thread") return 0;
  for (const r of sim.ropes) if (r.segs.length === 1 && r.segs[0].c === c) { const s = r.segs[0]; return Math.max(0, s.L0 - termDist(s.a, s.b)); }
  return 0;
}
