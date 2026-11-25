// ▶ «Опыт» для конструктора статики: рисунок оживает, за нить, груз, пружину или «руку» можно тянуть и смотреть силы.
// Движок — XPBD (позиционная динамика): грузы (брусок — с вращением, шар, узел), подвижные блоки, рычаги и концы пружин — твёрдые тела;
// нить — «не длиннее L₀» (через блоки — одна верёвка с общим натяжением), стержень — жёсткая связь, пружина — F = kx, шарнир, заделка и приклеенные
// концы — точечные связи. Опоры (пол, стена, наклонная плоскость, потолок, рычаг сверху) — контакты с трением Кулона (μ).
// Допущения (честно говорим в панели): блок идеальный (без массы и трения; ступенчатый — как обычный), шар не катится, грузы друг на друга не ставятся,
// не заданная масса = 1 кг.
"use strict";
Object.assign(sim, { B: new Map(), ropes: [], rods: [], springs: [], pins: [], sups: [], forces: [], surfs: [], L0: {}, grab: null, temp: null, hand: null, snap: "", eq: false, info: "", infoAt: 0, notes: [], still: 0 });
const SUBSTEPS = 24, DT = 1 / 60, FEMA = 0.25, DEPTH = 34;

const rotv = (B, l) => { const c = Math.cos(B.th), s = Math.sin(B.th); return { x: c * l.x - s * l.y, y: s * l.x + c * l.y }; };
const wpt = (t) => { const r = rotv(t.B, t.loc); return { x: t.B.x + r.x, y: t.B.y + r.y, rx: r.x, ry: r.y }; };
const massOf = (o) => (o.weightless ? 0.05 : o.mass > 0 ? o.mass : 1);
const comOf = (o) => (o.cm != null && o.cm >= 0 && o.cm <= o.len ? o.cm : o.len / 2);

function mkBody(o) {
  const B = { o, id: o.id, type: o.type, x: o.x, y: o.y, th: 0, vx: 0, vy: 0, om: 0, im: 0, iI: 0, grav: false, m: 0, cps: null, Nx: 0, Ny: 0, Fx: 0, Fy: 0, Nw: 0, cpx: 0, cpy: 0, Nv: { x: 0, y: 0 }, Fv: { x: 0, y: 0 }, cpos: null };
  if (o.type === "body") {
    const sh = o.shape || "box"; B.m = massOf(o); B.im = 1 / B.m; B.grav = !o.weightless;
    if (sh === "box") { B.th = (o.angle || 0) * Math.PI / 180; B.iI = 12 / (B.m * (70 * 70 + 50 * 50)); B.cps = [[-35, -25], [35, -25], [-35, 25], [35, 25]].map(([x, y]) => ({ loc: { x, y }, rad: 0 })); }
    else B.cps = [{ loc: { x: 0, y: 0 }, rad: sh === "ball" ? o.r || 28 : 8 }];
  } else if (o.type === "pulley" && o.mount === "free") { B.m = massOf(o); B.im = 1 / B.m; B.grav = !o.weightless; }
  else if (o.type === "beam") {
    const L = o.len * M_PX, f = comOf(o) / o.len, P = beamPt(o, f), d = (comOf(o) - o.len / 2) * M_PX;
    B.x = P.x; B.y = P.y; B.th = o.angle * Math.PI / 180; B.th0 = B.th; B.m = massOf(o); B.im = 1 / B.m; B.iI = o.clamp ? 0 : 12 / (B.m * (L * L + 12 * d * d)); B.grav = !o.weightless;
    B.cps = [{ loc: { x: -comOf(o) * M_PX, y: 0 }, rad: 0 }, { loc: { x: (o.len - comOf(o)) * M_PX, y: 0 }, rad: 0 }];
  }
  return B;
}
function mkEnd(o, k, p) {                                 // конец пружины — маленькое тело
  const m = o.weightless ? 0.05 : (o.mass > 0 ? o.mass : 0.5) / 2;
  return { o, id: o.id + ":" + k, type: "springend", end: k, x: p.x, y: p.y, th: 0, vx: 0, vy: 0, om: 0, im: 1 / m, iI: 0, grav: !o.weightless, m, cps: null, Nv: { x: 0, y: 0 }, Fv: { x: 0, y: 0 } };
}
function mkTerm(ref) {
  const o = byId(ref.id);
  if (o && o.type === "spring") return { B: sim.B.get(ref.id + ":" + ref.k), loc: { x: 0, y: 0 } };
  const B = sim.B.get(ref.id), a = anchorPos(ref), c = Math.cos(-B.th), s = Math.sin(-B.th), dx = a.x - B.x, dy = a.y - B.y;
  return { B, loc: { x: c * dx - s * dy, y: s * dx + c * dy } };
}
const termDist = (a, b) => { const p = wpt(a), q = wpt(b); return Math.hypot(p.x - q.x, p.y - q.y); };
const refOk = (ref) => { const o = byId(ref.id); return !!o && !!anchorPos(ref) && (o.type === "spring" ? sim.B.has(ref.id + ":" + ref.k) : sim.B.has(ref.id)); };

// ---- построение связей из рисунка
function rebuild() {
  sim.ropes = []; sim.rods = []; sim.springs = [];
  const segs = [], parent = [];
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const uni = (i, j) => { parent[find(i)] = find(j); };
  const pulEnds = new Map();
  const addSeg = (c, a, b, L0, refA, refB) => {
    const s = { c, a, b, L0, fa: { x: 0, y: 0 }, fb: { x: 0, y: 0 }, T: 0 }; segs.push(s); parent.push(segs.length - 1);
    for (const ref of [refA, refB]) if (ref && /^[LR]2?$/.test(ref.k) && byId(ref.id) && byId(ref.id).type === "pulley") { if (!pulEnds.has(ref.id)) pulEnds.set(ref.id, []); pulEnds.get(ref.id).push(segs.length - 1); }
    return segs.length - 1;
  };
  for (const c of scene.conns) {
    if (!refOk(c.a) || !refOk(c.b)) continue;
    const a = mkTerm(c.a), b = mkTerm(c.b), L0 = sim.L0[c.id] != null ? sim.L0[c.id] : (sim.L0[c.id] = termDist(a, b));
    if (c.kind === "thread") {
      if (sim.temp && sim.temp.c === c) {
        const H = { B: sim.temp.B, loc: { x: 0, y: 0 } }, t = sim.temp.t;
        const i = addSeg(c, a, H, L0 * t, c.a, null), j = addSeg(c, H, b, L0 * (1 - t), null, c.b); uni(i, j);
      } else addSeg(c, a, b, L0, c.a, c.b);
    } else if (c.kind === "rod") sim.rods.push({ c, a, b, L0, F: 0 });
    else sim.springs.push({ c, a, b, L0, k: c.kval > 0 ? c.kval : 100, F: 0, ext: 0 });
  }
  for (const o of scene.objs.filter((o) => o.type === "spring")) {      // пружины-элементы
    const a = mkTerm({ id: o.id, k: "a" }), b = mkTerm({ id: o.id, k: "b" }), key = "s" + o.id;
    const L0 = sim.L0[key] != null ? sim.L0[key] : (sim.L0[key] = o.l0 != null && o.l0 > 0 ? o.l0 * M_PX : termDist(a, b));
    sim.springs.push({ src: o, a, b, L0, k: o.k > 0 ? o.k : 100, F: 0, ext: 0 });
  }
  for (const list of pulEnds.values()) for (let i = 1; i < list.length; i++) uni(list[0], list[i]);
  const groups = new Map();
  segs.forEach((s, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(s); });
  for (const g of groups.values()) sim.ropes.push({ segs: g, Ltot: g.reduce((a, s) => a + s.L0, 0), T: 0, acc: 0 });
}

function simStart() {
  sim.snap = JSON.stringify(scene); sim.B = new Map(); sim.L0 = {}; sim.grab = null; sim.temp = null; sim.hand = null; sim.pins = []; sim.sups = []; sim.forces = []; sim.surfs = []; sim.still = 0;
  for (const o of scene.objs) {
    if (o.type === "spring") { const e = springEnds(o); sim.B.set(o.id + ":a", mkEnd(o, "a", e.a)); sim.B.set(o.id + ":b", mkEnd(o, "b", e.b)); }
    else if (o.type !== "force") sim.B.set(o.id, mkBody(o));
  }
  for (const o of scene.objs) {
    if (o.type === "beam") {
      const B = sim.B.get(o.id), loc = (pos) => { const P = beamPt(o, Math.max(0, Math.min(1, pos / o.len))), c = Math.cos(-B.th), s = Math.sin(-B.th), dx = P.x - B.x, dy = P.y - B.y; return { P, loc: { x: c * dx - s * dy, y: s * dx + c * dy } }; };
      if (o.pivot != null) { const q = loc(o.pivot); sim.pins.push({ a: { B, loc: q.loc }, w: q.P }); }
      for (const pos of supportsOf(o)) { const q = loc(pos); sim.sups.push({ B, cp: { loc: q.loc, rad: 0 }, sf: { nx: 0, ny: -1, tx: 1, ty: 0, qx: q.P.x, qy: q.P.y, u0: -1e9, u1: 1e9, mu: 2, owner: null } }); }
    }
    if (o.type === "spring") for (const k of ["a", "b"]) { const g = k === "a" ? o.glueA : o.glueB; if (g && refOk(g)) sim.pins.push({ a: { B: sim.B.get(o.id + ":" + k), loc: { x: 0, y: 0 } }, b: mkTerm(g) }); }
    if (o.type === "force" && o.to && refOk(o.to)) sim.forces.push({ o, t: mkTerm(o.to) });
    const sf = surfaceOf(o); if (sf) sim.surfs.push({ nx: sf.n.x, ny: sf.n.y, tx: sf.t.x, ty: sf.t.y, qx: sf.q.x, qy: sf.q.y, u0: sf.u0, u1: sf.u1, mu: o.mu > 0 ? o.mu : 0, owner: null });
  }
  rebuild();
  const notes = [];
  if (scene.objs.some((o) => o.type === "pulley" && (!o.weightless || !o.smooth || o.r2 > 0))) notes.push("блок в опыте идеальный: без массы и трения (ступенчатый считается обычным)");
  if (scene.objs.some((o) => (o.type === "body" || o.type === "beam" || o.type === "pulley" || o.type === "spring") && !o.weightless && !(o.mass > 0))) notes.push("масса, не заданная числом, принята 1 кг (пружины — 0,5 кг)");
  if (scene.objs.some((o) => o.type === "force" && !(o.F > 0))) notes.push("сила без числа принята 10 Н");
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
const prevPt = (B, l) => { const c = Math.cos(B.pth), s = Math.sin(B.pth); return { x: B.px + c * l.x - s * l.y, y: B.py + s * l.x + c * l.y }; };

// контакт точки cp тела B с поверхностью sf; возвращает нормальный импульс λ (≥ 0)
function contact(B, cp, sf) {
  let p = wpt({ B, loc: cp.loc });
  let sx = p.x - sf.qx, sy = p.y - sf.qy, dn = sf.nx * sx + sf.ny * sy - cp.rad;
  const u = sf.tx * sx + sf.ty * sy;
  if (dn >= 0 || dn < -DEPTH || u < sf.u0 - cp.rad || u > sf.u1 + cp.rad) return 0;
  const ow = sf.owner && sf.owner.im > 0 ? sf.owner : null;
  if (dn < -2) {                                           // глубокое проникновение (например, рисунок собран «внахлёст»): выталкиваем без скорости, иначе тело «выстрелит»
    const bodies = ow ? [B, ow] : [B], before = bodies.map((b) => [b.x, b.y, b.th]), tm = [{ B, rx: p.rx, ry: p.ry, gx: sf.nx, gy: sf.ny }];
    if (ow) { const k = sf.nx * sx + sf.ny * sy; tm.push({ B: ow, rx: p.x - sf.nx * k - ow.x, ry: p.y - sf.ny * k - ow.y, gx: -sf.nx, gy: -sf.ny }); }
    applyTerms(dn + 2, tm, 0); bodies.forEach((b, i) => { b.px += b.x - before[i][0]; b.py += b.y - before[i][1]; b.pth += b.th - before[i][2]; });
    p = wpt({ B, loc: cp.loc }); sx = p.x - sf.qx; sy = p.y - sf.qy; dn = sf.nx * sx + sf.ny * sy - cp.rad;
  }
  const terms = [{ B, rx: p.rx, ry: p.ry, gx: sf.nx, gy: sf.ny }];
  let q = null;
  if (ow) { q = { x: p.x - sf.nx * (sf.nx * sx + sf.ny * sy), y: p.y - sf.ny * (sf.nx * sx + sf.ny * sy) }; terms.push({ B: ow, rx: q.x - ow.x, ry: q.y - ow.y, gx: -sf.nx, gy: -sf.ny }); }
  const lam = applyTerms(dn, terms, 0);
  B.Nx += sf.nx * lam; B.Ny += sf.ny * lam; B.Nw += lam; B.cpx += p.x * lam; B.cpy += p.y * lam;
  if (sf.mu > 0 && lam > 0) {                              // трение Кулона: сколько сместилось вдоль поверхности, не больше μ·N
    p = wpt({ B, loc: cp.loc }); const pp = prevPt(B, cp.loc); let rel = sf.tx * (p.x - pp.x) + sf.ty * (p.y - pp.y), ft = [{ B, rx: p.rx, ry: p.ry, gx: sf.tx, gy: sf.ty }];
    if (ow) {
      const c0 = Math.cos(-ow.th), s0 = Math.sin(-ow.th), dx = q.x - ow.x, dy = q.y - ow.y, lx = c0 * dx - s0 * dy, ly = s0 * dx + c0 * dy, c1 = Math.cos(ow.pth), s1 = Math.sin(ow.pth);
      const qp = { x: ow.px + c1 * lx - s1 * ly, y: ow.py + s1 * lx + c1 * ly }; rel -= sf.tx * (q.x - qp.x) + sf.ty * (q.y - qp.y);
      ft.push({ B: ow, rx: q.x - ow.x, ry: q.y - ow.y, gx: -sf.tx, gy: -sf.ty });
    }
    let Wt = 0; for (const t of ft) { t.rg = t.rx * t.gy - t.ry * t.gx; Wt += t.B.im + t.B.iI * t.rg * t.rg; }
    if (Wt > 1e-12) {
      let lt = -rel / Wt; const lim = sf.mu * lam; lt = Math.max(-lim, Math.min(lim, lt));
      for (const t of ft) { t.B.x += t.B.im * t.gx * lt; t.B.y += t.B.im * t.gy * lt; t.B.th += t.B.iI * t.rg * lt; }
      B.Fx += sf.tx * lt; B.Fy += sf.ty * lt;
    }
  }
  return lam;
}

function substep(h) {
  const gy = scene.g * M_PX, h2 = h * h, dyn = [];
  for (const B of sim.B.values()) if (B.im > 0) { dyn.push(B); if (B.grav) B.vy += gy * h; B.px = B.x; B.py = B.y; B.pth = B.th; }
  for (const f of sim.forces) {                              // постоянные внешние силы
    const B = f.t.B; if (!(B.im > 0)) continue; const a = f.o.ang * Math.PI / 180, F = (f.o.F > 0 ? f.o.F : 10) * M_PX, fx = Math.cos(a) * F, fy = -Math.sin(a) * F, p = wpt(f.t);
    B.vx += fx * B.im * h; B.vy += fy * B.im * h; B.om += B.iI * (p.rx * fy - p.ry * fx) * h;
  }
  for (const B of dyn) { B.x += B.vx * h; B.y += B.vy * h; B.th += B.om * h; }
  for (const r of sim.ropes) {                              // верёвки (нити, в том числе через блоки): сумма длин ≤ L
    let sum = 0; const ds = r.segs.map((s) => { const p = wpt(s.a), q = wpt(s.b), d = Math.max(1e-6, Math.hypot(p.x - q.x, p.y - q.y)); sum += d; return { p, q, d }; });
    const C = sum - r.Ltot; if (C <= 0) continue;
    const terms = []; r.segs.forEach((s, i) => { const [t1, t2] = pairTerms(s.a, s.b, ds[i].d, ds[i].p, ds[i].q); t1.seg = s; t1.side = "fa"; t2.seg = s; t2.side = "fb"; terms.push(t1, t2); });
    const lam = applyTerms(C, terms, 0); r.acc += -lam;
    for (const t of terms) { t.seg[t.side].x += t.gx * lam; t.seg[t.side].y += t.gy * lam; }
  }
  for (const r of sim.rods) { const p = wpt(r.a), q = wpt(r.b), d = Math.max(1e-6, Math.hypot(p.x - q.x, p.y - q.y)); r.Facc = (r.Facc || 0) + Math.abs(applyTerms(d - r.L0, pairTerms(r.a, r.b, d, p, q), 0)); }
  for (const s of sim.springs) { const p = wpt(s.a), q = wpt(s.b), d = Math.max(1e-6, Math.hypot(p.x - q.x, p.y - q.y)); const lam = applyTerms(d - s.L0, pairTerms(s.a, s.b, d, p, q), 1 / (s.k * h2)); s.Facc = (s.Facc || 0) + lam; }
  for (const pin of sim.pins) for (const [ex, ey] of [[1, 0], [0, 1]]) {   // шарниры, заделка, приклеенные концы
    const p = wpt(pin.a);
    if (pin.w) applyTerms((p.x - pin.w.x) * ex + (p.y - pin.w.y) * ey, [{ B: pin.a.B, rx: p.rx, ry: p.ry, gx: ex, gy: ey }], 0);
    else { const q = wpt(pin.b); applyTerms((p.x - q.x) * ex + (p.y - q.y) * ey, [{ B: pin.a.B, rx: p.rx, ry: p.ry, gx: ex, gy: ey }, { B: pin.b.B, rx: q.rx, ry: q.ry, gx: -ex, gy: -ey }], 0); }
  }
  if (sim.grab) {                                            // мышь тянет мягкой пружиной
    const g = sim.grab, p = wpt(g.t), d = Math.max(1e-6, Math.hypot(p.x - g.x, p.y - g.y));
    const lam = applyTerms(d, [{ B: g.t.B, rx: p.rx, ry: p.ry, gx: (p.x - g.x) / d, gy: (p.y - g.y) / d }], 1 / (1500 * h2)); g.Facc = (g.Facc || 0) - lam;
  }
  const beamSurfs = [];                                      // верх рычага — опора для грузов
  for (const B of dyn) if (B.type === "beam") {
    const o = B.o, c = Math.cos(B.th), s = Math.sin(B.th), d = (comOf(o) - o.len / 2) * M_PX, thk = o.weightless ? 3 : 7, cx = B.x - c * d, cy = B.y - s * d;
    beamSurfs.push({ nx: s, ny: -c, tx: c, ty: s, qx: cx + s * thk, qy: cy - c * thk, u0: -o.len * M_PX / 2, u1: o.len * M_PX / 2, mu: 0.45, owner: B });
  }
  for (const sp of sim.sups) contact(sp.B, sp.cp, sp.sf);
  for (const B of dyn) if (B.cps) for (const cp of B.cps) {
    for (const sf of sim.surfs) contact(B, cp, sf);
    if (B.type === "body") for (const sf of beamSurfs) contact(B, cp, sf);
  }
  for (const B of dyn) if (B.type === "beam" && B.o.pivot != null && !B.o.clamp) {   // рычаг упирается (в пол, в упор): поворот не больше ±50° от рисунка
    const lim = 50 * Math.PI / 180; if (B.th - B.th0 > lim) { B.th = B.th0 + lim; B.pth = B.th; } else if (B.th - B.th0 < -lim) { B.th = B.th0 - lim; B.pth = B.th; }
  }
  for (const B of dyn) {
    B.vx = (B.x - B.px) / h; B.vy = (B.y - B.py) / h; B.om = (B.th - B.pth) / h;
    const k = Math.exp(-1.0 * h), kw = Math.exp(-2 * h); B.vx *= k; B.vy *= k; B.om *= kw;
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
  for (const r of sim.rods) r.Facc = 0; for (const s of sim.springs) s.Facc = 0;
  for (const B of sim.B.values()) { B.Nx = B.Ny = B.Fx = B.Fy = B.Nw = B.cpx = B.cpy = 0; }
  if (sim.grab) sim.grab.Facc = 0;
  for (let i = 0; i < SUBSTEPS; i++) substep(h);
  const ema = (old, v) => old + (v - old) * FEMA, toN = 1 / (SUBSTEPS * h * h * M_PX);   // сумма λ за кадр → среднее по подшагам → ньютоны
  for (const r of sim.ropes) { r.T = ema(r.T, r.acc * toN); for (const s of r.segs) { s.T = r.T; for (const side of ["fa", "fb"]) { const f = s[side]; f.ex = ema(f.ex || 0, f.x * toN); f.ey = ema(f.ey || 0, f.y * toN); f.x = f.ex; f.y = f.ey; } } }
  for (const r of sim.rods) r.F = ema(r.F, r.Facc * toN);
  for (const s of sim.springs) { s.F = ema(s.F, s.Facc * toN); const p = wpt(s.a), q = wpt(s.b); s.ext = Math.hypot(p.x - q.x, p.y - q.y) - s.L0; if (s.src) s.src.read = Math.abs(s.k * s.ext / M_PX); }
  for (const B of sim.B.values()) if (B.im > 0 && B.cps) {
    B.Nv.x = ema(B.Nv.x, B.Nx * toN); B.Nv.y = ema(B.Nv.y, B.Ny * toN); B.Fv.x = ema(B.Fv.x, B.Fx * toN); B.Fv.y = ema(B.Fv.y, B.Fy * toN);
    if (B.Nw > 0) B.cpos = { x: B.cpx / B.Nw, y: B.cpy / B.Nw };
  }
  if (sim.grab) sim.grab.F = ema(sim.grab.F || 0, Math.abs(sim.grab.Facc) * toN);
  let moving = 0;                                                  // равновесие: всё почти неподвижно
  for (const B of sim.B.values()) if (B.im > 0) moving = Math.max(moving, Math.hypot(B.vx, B.vy), Math.abs(B.om) * 80);
  sim.still = moving < 6 ? sim.still + 1 : 0; sim.eq = sim.still > 45;   // «равновесие» — неподвижно почти секунду (в верхней точке качания скорость тоже на миг нулевая)
  for (const B of sim.B.values()) {
    const o = B.o; if (!o) continue;
    if (B.type === "body") { o.x = B.x; o.y = B.y; if ((o.shape || "box") === "box") o.angle = B.th * 180 / Math.PI; }
    else if (B.type === "pulley" || B.type === "hand") { o.x = B.x; o.y = B.y; }
    else if (B.type === "beam") { const d = (comOf(o) - o.len / 2) * M_PX; o.x = B.x - Math.cos(B.th) * d; o.y = B.y - Math.sin(B.th) * d; o.angle = B.th * 180 / Math.PI; }
    else if (B.type === "springend") { o[B.end === "a" ? "ax" : "bx"] = B.x; o[B.end === "a" ? "ay" : "by"] = B.y; }
  }
  if (performance.now() - sim.infoAt > 180) { sim.infoAt = performance.now(); buildInfo(); }
}

// ---- мышь
const GRABBABLE = new Set(["body", "pulley", "beam"]);
function simDown(p) {
  const rev = [...scene.objs].reverse();
  const hand = rev.find((o) => o.type === "hand" && hitObj(o, p.x, p.y));
  if (hand) { const B = sim.B.get(hand.id); sim.hand = { B, tx: p.x, ty: p.y, dx: B.x - p.x, dy: B.y - p.y }; return; }
  let hit = rev.find((o) => GRABBABLE.has(o.type) && sim.B.get(o.id).im > 0 && hitObj(o, p.x, p.y)), B = hit && sim.B.get(hit.id);
  if (!hit) for (const o of rev) if (o.type === "spring") for (const k of ["a", "b"]) { const E = sim.B.get(o.id + ":" + k); if (!hit && Math.hypot(E.x - p.x, E.y - p.y) < 22) { hit = o; B = E; } }
  if (hit) { const c = Math.cos(-B.th), s = Math.sin(-B.th), dx = p.x - B.x, dy = p.y - B.y; sim.grab = { t: { B, loc: { x: c * dx - s * dy, y: s * dx + c * dy } }, x: p.x, y: p.y, tx: p.x, ty: p.y, F: 0 }; return; }
  let best = null, bd = 12 / S;                                      // нить: хватаем за любое место
  for (const c of scene.conns) if (c.kind === "thread") { const e = connEnds(c); if (!e) continue; const d = segDist(p.x, p.y, e[0], e[1]); if (d < bd) { bd = d; best = { c, e }; } }
  if (best) {
    const [a, b] = best.e, dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1, t = Math.max(0.05, Math.min(0.95, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    const Bt = { o: null, id: -1, type: "tmp", x: a.x + dx * t, y: a.y + dy * t, th: 0, vx: 0, vy: 0, om: 0, im: 0, iI: 0 };
    sim.temp = { c: best.c, B: Bt, t, tx: p.x, ty: p.y }; rebuild();
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
const ordinal = (list, x) => list.indexOf(x) + 1;
function connName(c) {
  if (c.type === "spring") return c.name ? pretty(c.name) : `${c.dyn ? "Динамометр" : "Пружина"} ${ordinal(scene.objs.filter((o) => o.type === "spring"), c)}`;
  return c.name ? pretty(c.name) : `${KIND_NAME[c.kind]} ${ordinal(scene.conns.filter((q) => q.kind === c.kind), c)}`;
}
function buildInfo() {
  const L = [];
  L.push(sim.eq ? "✅ Равновесие: всё неподвижно, силы уравновешены" : "⏳ Идёт движение…");
  for (const r of sim.ropes) { const cs = [...new Set(r.segs.map((s) => s.c))]; if (r.T > 0.05) L.push(`${connName(cs[0])}${cs.length > 1 ? "…" : ""}: T = ${fN(r.T)}`); else L.push(`${connName(cs[0])}: провисла (T = 0)`); }
  for (const r of sim.rods) L.push(`${connName(r.c)}: F = ${fN(r.F)}`);
  for (const s of sim.springs) L.push(`${connName(s.src || s.c)}: ${s.src && s.src.dyn ? "показание" : "F = kx ="} ${fN(Math.abs(s.k * s.ext / M_PX))}, x = ${fmt(+(s.ext / M_PX * 100).toFixed(1))} см`);
  for (const B of sim.B.values()) if (B.type === "body" && B.im > 0) {
    const N = Math.hypot(B.Nv.x, B.Nv.y), Ff = Math.hypot(B.Fv.x, B.Fv.y), nm = B.o.shape === "point" ? pretty(B.o.name) || "узел" : pretty(B.o.name) || "m";
    L.push(`${nm}: ${B.grav ? `mg = ${fN(B.m * scene.g)}` : "невесомый"}${N > 0.5 ? `, N = ${fN(N)}` : ""}${Ff > 0.5 ? `, F_тр = ${fN(Ff)}` : ""}`);
  }
  if (sim.grab && sim.grab.F > 0.1) L.push(`Ты тянешь с силой ≈ ${fN(sim.grab.F)}`);
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
  if (label) text(c, label, x1 + (fx >= 0 ? 8 : -8), y1 + (fy >= 0 ? 8 : -8), 13, col, fx >= 0 ? "left" : "right", true);
}
function simDraw(c) {
  for (const r of sim.ropes) for (const s of r.segs) { const p = wpt(s.a), q = wpt(s.b); if (r.T > 0.05) pill(c, `T = ${fN(r.T)}`, (p.x + q.x) / 2 + 28, (p.y + q.y) / 2, BLUE); }
  for (const r of sim.rods) { const p = wpt(r.a), q = wpt(r.b); if (r.F > 0.05) pill(c, `F = ${fN(r.F)}`, (p.x + q.x) / 2 + 28, (p.y + q.y) / 2, BLUE); }
  for (const s of sim.springs) { const p = wpt(s.a), q = wpt(s.b); if (!(s.src && s.src.dyn)) pill(c, `F = ${fN(Math.abs(s.k * s.ext / M_PX))}`, (p.x + q.x) / 2 + 40, (p.y + q.y) / 2, BLUE); }
  if (sim.grab) { const p = wpt(sim.grab.t); c.setLineDash([6, 4]); c.strokeStyle = "#fb8c00"; c.lineWidth = 2.5; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(sim.grab.x, sim.grab.y); c.stroke(); c.setLineDash([]); c.fillStyle = "#fb8c00"; c.beginPath(); c.arc(sim.grab.x, sim.grab.y, 6, 0, 6.2832); c.fill(); }
  if (!scene.showG) return;
  for (const B of sim.B.values()) {                                 // силы на телах: тяжесть, опора, трение
    if (!B.o || B.im === 0 || !["body", "beam", "pulley"].includes(B.type)) continue;
    const nm = pretty(B.o.name) || (B.type === "pulley" ? "M" : "m");
    if (B.grav) forceArrow(c, B.x, B.y, 0, B.m * scene.g, RED, `${nm}g = ${fN(B.m * scene.g)}`);
    const N = Math.hypot(B.Nv.x, B.Nv.y), Ff = Math.hypot(B.Fv.x, B.Fv.y), cp = B.cpos;
    if (cp && N > 0.5) forceArrow(c, cp.x, cp.y, B.Nv.x, B.Nv.y, "#2e9a49", `N = ${fN(N)}`);
    if (cp && Ff > 0.5) forceArrow(c, cp.x, cp.y, B.Fv.x, B.Fv.y, "#fb8c00", `F_тр = ${fN(Ff)}`);
  }
}
// стрелки натяжения рисуем отдельно: нужна сила на конкретном конце нити
function simTensionArrows(c) {
  if (!scene.showG) return;
  for (const r of sim.ropes) for (const s of r.segs) for (const [term, f] of [[s.a, s.fa], [s.b, s.fb]]) {
    if (term.B.type !== "body" || !r.T || r.T < 0.3) continue; const p = wpt(term);
    const m = Math.hypot(f.x, f.y) || 1; forceArrow(c, p.x, p.y, f.x / m * r.T, f.y / m * r.T, BLUE, "");
  }
  for (const s of sim.springs) for (const term of [s.a, s.b]) { if (term.B.type !== "body") continue; const p = wpt(term), q = wpt(term === s.a ? s.b : s.a), d = Math.hypot(q.x - p.x, q.y - p.y) || 1, F = s.k * s.ext / M_PX; forceArrow(c, p.x, p.y, (q.x - p.x) / d * F, (q.y - p.y) / d * F, BLUE, ""); }
}
// провисшая нить: парабола с провисом, длина которой равна L₀
function slackOf(c) {
  if (!sim.on || c.kind !== "thread") return 0;
  for (const r of sim.ropes) if (r.segs.length === 1 && r.segs[0].c === c) { const s = r.segs[0]; return Math.max(0, s.L0 - termDist(s.a, s.b)); }
  return 0;
}
