// «Учить формулы» — мини-приложение в стиле Duolingo.
// Путь из уроков по темам школьной программы: формулы (formulas.js) и их выводы (derivations.js).
// Задания: новая формула → выбери формулу → собери формулу (плитки перетаскиваются в числитель/знаменатель)
// → найди пары → единицы измерения. В уроке-выводе: разбор по шагам → «выведи сам» шаг за шагом.
// Ошибки возвращаются в конец урока. Прогресс хранится в облаке Telegram (CloudStorage), а вне Telegram — в браузере.

const tg = window.Telegram ? window.Telegram.WebApp : null;
const inTelegram = Boolean(tg && tg.initData);
if (tg) {
  tg.ready(); tg.expand();
  // чтобы перетаскивание плитки вниз не сворачивало мини-приложение
  try { if (tg.isVersionAtLeast && tg.isVersionAtLeast("7.7")) tg.disableVerticalSwipes(); } catch (e) {}
}

const $ = (id) => document.getElementById(id);
const OPS = new Set(["/", "·", "+", "−"]);
const GROUP = 3;                   // формул в одном уроке
const XP_LESSON = 10, XP_DERIV = 15, XP_PERFECT = 5;

// ------------------------------------------------------------------ утилиты
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const today = () => new Date().toLocaleDateString("sv-SE");   // ГГГГ-ММ-ДД по местному времени
const toks = (s) => s.split(" ").filter(Boolean);
function haptic(kind) {
  if (!inTelegram || !tg.HapticFeedback) return;
  if (kind === "tap") tg.HapticFeedback.selectionChanged();
  else tg.HapticFeedback.notificationOccurred(kind);
}

// Одна плитка → HTML: «~» — пробел, _xxx — индекс, ^(xxx) — степень, «3/2», «1/R₁» — маленькая дробь
function tokHTML(t) {
  const m = /^(\d+)\/([^\s/]+)$/.exec(t);
  if (m) return `<span class="frac sm"><span>${m[1]}</span><span>${tokHTML(m[2])}</span></span>`;
  return esc(t.replace(/~/g, " "))
    .replace(/\^\(([^)]*)\)/g, "<sup>$1</sup>")
    .replace(/_([^\s·/+−()^<]+)/g, "<sub>$1</sub>");
}
const strip = (t) => (/^\(.*\)$/.test(t) ? t.slice(1, -1) : t);
// Выражение: если в нём ровно одна «/», рисуем настоящую дробь (всё после «/» — знаменатель)
function exprHTML(tokens) {
  const slashes = tokens.filter((t) => t === "/").length;
  if (slashes === 1) {
    const i = tokens.indexOf("/");
    const side = (p) => (p.length === 1 ? tokHTML(strip(p[0])) : p.map(tokHTML).join(" "));
    return `<span class="frac"><span>${side(tokens.slice(0, i))}</span><span>${side(tokens.slice(i + 1))}</span></span>`;
  }
  return tokens.map(tokHTML).join(" ");
}
const formulaHTML = (f, cls = "", rhs = toks(f.rhs)) =>
  `<span class="f ${cls}"><span class="fl">${exprHTML(toks(f.lhs))}</span><span>=</span>${exprHTML(rhs)}</span>`;

// Сравнение ответов. «·» не важна, порядок множителей и слагаемых тоже (m·a = a·m, ΔU + A = A + ΔU),
// а вот что в числителе, а что в знаменателе — важно.
function sideKey(ts) {
  if (!ts.length) return "";
  const terms = []; let sign = "+", cur = [], bad = false;
  ts.forEach((t, j) => {
    if (t === "+" || t === "−") {
      if (cur.length) { terms.push(sign + cur.sort().join("*")); cur = []; }
      else if (j > 0) bad = true;          // два знака подряд
      sign = t === "−" ? "-" : "+";
    } else cur.push(t);
  });
  if (cur.length) terms.push(sign + cur.sort().join("*")); else bad = true;
  return bad ? "?" + ts.join(" ") : terms.sort().join(" ");
}
function cform(tokens) {
  tokens = tokens.filter((t) => t !== "·");
  const i = tokens.indexOf("/");
  if (i >= 0 && tokens.lastIndexOf("/") !== i) return "?" + tokens.join(" ");
  return i < 0 ? sideKey(tokens) + "|" : sideKey(tokens.slice(0, i)) + "|" + sideKey(tokens.slice(i + 1));
}

// ------------------------------------------------------------------ прогресс
let P = { d: {}, xp: 0, st: 0, day: "" };   // d — пройденные уроки
const KEY = "wf1";
function loadProgress(cb) {
  try { const s = localStorage.getItem(KEY); if (s) P = Object.assign(P, JSON.parse(s)); } catch (e) {}
  if (inTelegram && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast("6.9")) {
    tg.CloudStorage.getItem(KEY, (err, val) => {
      try { if (!err && val) { const c = JSON.parse(val); if ((c.xp || 0) >= P.xp) P = Object.assign(P, c); } } catch (e) {}
      cb();
    });
  } else cb();
}
function saveProgress() {
  const s = JSON.stringify(P);
  try { localStorage.setItem(KEY, s); } catch (e) {}
  if (inTelegram && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast("6.9")) tg.CloudStorage.setItem(KEY, s);
}
function streakNow() {      // серия «сгорает», если пропущен день
  if (!P.day) return 0;
  const y = new Date(); y.setDate(y.getDate() - 1);
  return P.day === today() || P.day === y.toLocaleDateString("sv-SE") ? P.st : 0;
}
function bumpStreak() {
  const t = today();
  if (P.day === t) return;
  P.st = streakNow() + 1;
  P.day = t;
}

// ------------------------------------------------------------------ уроки
// Тема: уроки по 3 формулы, между ними — выводы формул, в конце «Повторение» (👑)
const goalOf = (d) => { const s = d.steps.filter((x) => !x.q); const g = s[s.length - 1]; return { lhs: g.l, rhs: g.r }; };
function lessonsOf(unit) {
  const n = Math.ceil(unit.formulas.length / GROUP);
  const size = Math.ceil(unit.formulas.length / n);
  const fl = [];
  for (let i = 0; i < n; i++) fl.push({ id: `${unit.id}:${i}`, unit, fs: unit.formulas.slice(i * size, (i + 1) * size), kind: "f" });
  const dl = ((typeof DERIVS !== "undefined" && DERIVS[unit.id]) || []).map((d) => ({ id: `${unit.id}:D${d.id}`, unit, d, kind: "d" }));
  const list = fl.slice(0, 2);
  const restF = fl.slice(2), restD = dl.slice();
  while (restF.length || restD.length) {
    if (restD.length) list.push(restD.shift());
    if (restF.length) list.push(restF.shift());
  }
  if (unit.formulas.length > GROUP) list.push({ id: `${unit.id}:R`, unit, fs: unit.formulas, kind: "r" });
  list.forEach((l, i) => { l.num = i + 1; });
  return list;
}

let grade = 10;
const urlGrade = new URLSearchParams(location.search).get("grade");
if (urlGrade === "11") grade = 11;

function renderPath() {
  document.querySelectorAll("#gradeSeg button").forEach((b) => b.classList.toggle("on", +b.dataset.grade === grade));
  $("stStreak").textContent = streakNow();
  $("stXp").textContent = P.xp;

  const units = UNITS.filter((u) => u.grade === grade);
  const zig = [0, 44, 66, 44, 0, -44, -66, -44];
  let html = "", open = true, k = 0, currentFound = false;
  units.forEach((u, ui) => {
    const ls = lessonsOf(u);
    const doneCnt = ls.filter((l) => P.d[l.id]).length;
    const nd = ls.filter((l) => l.kind === "d").length;
    html += `<div class="unithead" style="background:${u.color}">
      <span class="cnt">${doneCnt}/${ls.length}</span>
      <small>Раздел ${ui + 1} · ${u.formulas.length} формул${nd ? ` · ${nd} вывод${nd === 1 ? "" : nd < 5 ? "а" : "ов"}` : ""}</small><b>${esc(u.title)}</b></div><div class="nodes">`;
    ls.forEach((l) => {
      const done = Boolean(P.d[l.id]);
      let cls = done ? "done" : open ? "current" : "locked";
      if (cls === "current") { if (currentFound) cls = "locked"; currentFound = true; }
      if (!done) open = false;
      const icon = l.kind === "r" ? "👑" : done ? "✓" : l.kind === "d" ? "✍" : cls === "locked" ? "🔒" : "★";
      html += `<button class="node ${cls} ${l.kind === "d" ? "deriv" : ""}" style="--c:${u.color};left:${zig[k++ % zig.length]}px"
        data-lesson="${l.id}" ${cls === "locked" ? "disabled" : ""}>${icon}</button>`;
    });
    html += "</div>";
  });
  $("units").innerHTML = html;
  $("units").querySelectorAll(".node:not(.locked)").forEach((b) => b.addEventListener("click", () => openSheet(b.dataset.lesson)));
  const cur = $("units").querySelector(".node.current");
  if (cur) cur.scrollIntoView({ block: "center" });
}

function findLesson(id) {
  for (const u of UNITS) for (const l of lessonsOf(u)) if (l.id === id) return l;
  return null;
}

function openSheet(id) {
  haptic("tap");
  const l = findLesson(id);
  const total = lessonsOf(l.unit).length;
  if (l.kind === "d") {
    $("sheetTitle").textContent = `${l.unit.title} · Вывод формулы ✍`;
    $("sheetText").innerHTML = `${esc(l.d.name)}<div class="sheetf">${formulaHTML(goalOf(l.d))}</div>`;
  } else if (l.kind === "r") {
    $("sheetTitle").textContent = `${l.unit.title} · Повторение 👑`;
    $("sheetText").textContent = "Все формулы темы вперемешку.";
  } else {
    $("sheetTitle").textContent = `${l.unit.title} · Урок ${l.num} из ${total}`;
    $("sheetText").textContent = l.fs.map((f) => f.name).join(" · ");
  }
  $("sheetGo").textContent = P.d[id] ? "Повторить" : "Начать";
  $("sheetGo").onclick = () => { $("sheet").classList.add("hidden"); startLesson(l); };
  $("sheet").classList.remove("hidden");
}
$("sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") $("sheet").classList.add("hidden"); });
document.querySelectorAll("#gradeSeg button").forEach((b) => b.addEventListener("click", () => {
  grade = +b.dataset.grade; haptic("tap"); renderPath(); window.scrollTo(0, 0);
}));

// ------------------------------------------------------------------ генерация заданий
// Неверные варианты формулы: переворот дроби, «·» вместо «/», ловушки, другие формулы рядом
function wrongVariants(f, siblings) {
  const r = toks(f.rhs), out = [];
  const i = r.indexOf("/");
  if (i > 0 && r.lastIndexOf("/") === i) {
    out.push([...r.slice(i + 1), "/", ...r.slice(0, i)]);
    out.push(r.map((t) => (t === "/" ? "·" : t)));
  }
  const m = r.lastIndexOf("·");
  if (m > 0 && i < 0) { const c = r.slice(); c[m] = "/"; out.push(c); }
  const pm = r.findIndex((t) => t === "+" || t === "−");
  if (pm > 0) { const c = r.slice(); c[pm] = r[pm] === "+" ? "−" : "+"; out.push(c); }
  for (const t of f.trap || []) {
    if (OPS.has(t)) continue;
    let best = -1, bestLen = -1;
    r.forEach((x, j) => {
      if (OPS.has(x)) return;
      let p = 0; while (p < x.length && x[p] === t[p]) p++;
      if (p >= bestLen) { bestLen = p; best = j; }
    });
    if (best >= 0) { const c = r.slice(); c[best] = t; out.push(c); }
  }
  for (const g of shuffle(siblings)) if (g !== f && g.lhs === f.lhs) out.push(toks(g.rhs));
  for (const g of shuffle(siblings)) if (g !== f) out.push(toks(g.rhs));
  const seen = new Set([cform(r)]), res = [];
  for (const v of out) { const c = cform(v); if (!seen.has(c)) { seen.add(c); res.push(v); } }
  return res;
}

function exChoice(f, siblings = currentUnit.formulas) {
  const opts = shuffle([{ rhs: toks(f.rhs), ok: true }, ...wrongVariants(f, siblings).slice(0, 3).map((rhs) => ({ rhs, ok: false }))]);
  return { t: "choice", f, opts };
}
function exName(f) {
  const others = shuffle(currentUnit.formulas.filter((g) => g !== f && g.name !== f.name)).slice(0, 3);
  return { t: "name", f, opts: shuffle([f, ...others]) };
}
// Плитки для сборки: части формулы без «·» и «/» (черта дроби уже нарисована) + лишние плитки-ловушки
function exBuild(f, siblings = currentUnit.formulas, ctx = null) {
  const r = toks(f.rhs).filter((t) => t !== "·" && t !== "/");
  const extra = [];
  for (const t of f.trap || []) if (t !== "·" && t !== "/" && !extra.includes(t) && (!r.includes(t) || t === "+" || t === "−")) extra.push(t);
  const want = Math.max(2, Math.min(4, 8 - r.length));
  const others = shuffle(siblings.filter((g) => g !== f).flatMap((g) => toks(g.rhs)))
    .filter((t) => !OPS.has(t) && !r.includes(t));
  for (const t of others) { if (extra.length >= want) break; if (!extra.includes(t)) extra.push(t); }
  return { t: "build", f, pool: shuffle([...r, ...extra.slice(0, Math.max(want, 2))]), ctx };
}
function exPairs(fs) {
  return { t: "pairs", fs: shuffle(fs).slice(0, 4) };
}
function exUnit(unit) {
  const q = pick(unit.q);
  const all = [...new Set(UNITS.flatMap((u) => u.q.map((x) => x[2])))].filter((x) => x !== q[2]);
  return { t: "unit", q, opts: shuffle([q[2], ...shuffle(all).slice(0, 3)]) };
}

// Шаг вывода как «формула»
const stepF = (s) => ({ lhs: s.l, rhs: s.r, trap: s.trap, name: s.s, legend: s.why || "" });

let currentUnit = null;
function buildLesson(l) {
  currentUnit = l.unit;
  const firstTime = !P.d[l.id];
  const ex = [];
  if (l.kind === "d") {
    const d = l.d;
    const sib = d.steps.filter((s) => !s.q).map(stepF);
    ex.push({ t: "dgiven", d, first: firstTime });
    if (firstTime) ex.push({ t: "walk", d });
    d.steps.forEach((s, k) => {
      if (s.q) ex.push({ t: "dq", d, k, s, opts: shuffle(s.o.map((h, i) => ({ h, ok: i === 0 }))) });
      else ex.push(exBuild(stepF(s), sib, { d, k }));
    });
    return ex;
  }
  if (l.kind === "f") {
    l.fs.forEach((f, i) => {
      if (firstTime) ex.push({ t: "intro", f });
      ex.push(firstTime || i % 2 === 0 ? exChoice(f) : exName(f));
    });
    shuffle(l.fs).forEach((f) => ex.push(exBuild(f)));
    if (l.fs.length >= 3) ex.push(exPairs(l.fs));
    ex.push(exUnit(l.unit));
    return ex;
  }
  const fs = shuffle(l.fs);
  fs.slice(0, 6).forEach((f) => ex.push(exBuild(f)));
  fs.slice(6, 10).forEach((f, i) => ex.push(i % 2 ? exName(f) : exChoice(f)));
  ex.push(exPairs(fs.slice(0, 4)));
  ex.push(exUnit(l.unit), exUnit(l.unit));
  return [ex[0], ...shuffle(ex.slice(1))];
}

// ------------------------------------------------------------------ прохождение урока
let L = null;   // { lesson, queue, pos, mistakes, answered, retried:Set, answer, locked }

function show(id) {
  ["path", "lesson", "done"].forEach((s) => $(s).classList.toggle("hidden", s !== id));
  if (tg && tg.BackButton) id === "path" ? tg.BackButton.hide() : tg.BackButton.show();
  window.scrollTo(0, 0);
}

function startLesson(l) {
  const queue = buildLesson(l);
  L = { lesson: l, queue, pos: 0, mistakes: 0, answered: 0, retried: new Set() };
  show("lesson");
  renderExercise();
}

function setProgress() {
  $("progFill").style.width = `${Math.round((100 * L.pos) / L.queue.length)}%`;
}

function setAction(text, enabled, onClick, red = false) {
  const b = $("action");
  b.textContent = text; b.disabled = !enabled; b.onclick = onClick;
  b.classList.toggle("red", red);
}

function resetFooter() {
  $("footer").className = "footer";
  $("feedback").innerHTML = "";
}

// Карточка шага вывода (для разбора)
function stepCardHTML(s, k) {
  const body = s.q
    ? `<div class="stepq">${tokHTML(s.q)} → <b>${tokHTML(s.o[0])}</b></div>${s.why ? `<div class="legend">${tokHTML(s.why)}</div>` : ""}`
    : `<div class="stepf">${formulaHTML(stepF(s))}</div>${s.why ? `<div class="legend">${tokHTML(s.why)}</div>` : ""}`;
  return `<div class="step"><div class="stepn">${k + 1}</div><div class="stepb"><div class="says">${tokHTML(s.s)}</div>${body}</div></div>`;
}
// Что уже выведено к шагу k (для «выведи сам»)
function knownHTML(d, k) {
  const prev = d.steps.slice(0, k).filter((s) => !s.q).slice(-3);
  return `<div class="known"><div class="given">${tokHTML(d.given)}</div>${prev.length ? `<div class="knownf">${prev.map((s) => formulaHTML(stepF(s), "small")).join("")}</div>` : ""}</div>`;
}

function renderExercise() {
  setProgress();
  resetFooter();
  const e = L.queue[L.pos];
  const box = $("exercise");
  L.answer = null;

  if (e.t === "intro") {
    box.innerHTML = `<div class="kicker">Новая формула</div>
      <div class="introcard"><div class="name">${esc(e.f.name)}</div>
      ${formulaHTML(e.f, "big")}<div class="legend">${tokHTML(e.f.legend)}</div></div>`;
    setAction("Понятно", true, next);
    return;
  }

  if (e.t === "dgiven") {
    box.innerHTML = `<div class="kicker">Вывод формулы</div>
      <div class="introcard"><div class="name">${esc(e.d.name)}</div>
      <div class="legend" style="margin-bottom:10px">${tokHTML(e.d.given)}</div>
      <div class="kicker" style="color:var(--muted)">Получим</div>${formulaHTML(goalOf(e.d), "big")}
      <div class="legend">${e.first ? "Сначала разберём вывод по шагам, потом выведешь сам." : "Выведи формулу сам, шаг за шагом."}</div></div>`;
    setAction(e.first ? "Разберём" : "Начать", true, next);
    return;
  }

  if (e.t === "walk") {
    let shown = 1;
    const draw = () => {
      box.innerHTML = `<div class="kicker">Разбор вывода</div><h2 class="task">${esc(e.d.name)}</h2>
        <div class="steps">${e.d.steps.slice(0, shown).map(stepCardHTML).join("")}</div>`;
      const last = box.querySelector(".step:last-child");
      if (last) { last.classList.add("fresh"); last.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
      if (shown < e.d.steps.length) setAction("Следующий шаг", true, () => { haptic("tap"); shown++; draw(); });
      else setAction("Теперь выведи сам", true, next);
    };
    draw();
    return;
  }

  if (e.t === "choice" || e.t === "name" || e.t === "unit" || e.t === "dq") {
    let title, opts, kicker = "Выбери ответ", pre = "";
    if (e.t === "choice") {
      title = `Какая формула верная?<br><span class="legend">${esc(e.f.name)}</span>`;
      opts = e.opts.map((o) => formulaHTML(e.f, "", o.rhs));
    } else if (e.t === "name") {
      title = `Что это за формула?<div style="margin-top:12px">${formulaHTML(e.f, "big")}</div>`;
      opts = e.opts.map((g) => esc(g.name));
    } else if (e.t === "unit") {
      title = `В чём измеряется ${esc(e.q[1])} <span class="f small">${tokHTML(e.q[0])}</span>?`;
      opts = e.opts.map(esc);
    } else {
      kicker = `Выведи сам · шаг ${e.k + 1} из ${e.d.steps.length}`;
      pre = knownHTML(e.d, e.k) + `<div class="says">${tokHTML(e.s.s)}</div>`;
      title = tokHTML(e.s.q);
      opts = e.opts.map((o) => tokHTML(o.h));
    }
    box.innerHTML = `<div class="kicker">${kicker}</div>${pre}<h2 class="task">${title}</h2>
      <div class="options">${opts.map((h, i) => `<button class="opt" data-i="${i}">${h}</button>`).join("")}</div>`;
    box.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => {
      if (L.locked) return;
      haptic("tap");
      box.querySelectorAll(".opt").forEach((x) => x.classList.remove("sel"));
      b.classList.add("sel"); L.answer = +b.dataset.i;
      setAction("Проверить", true, check);
    }));
    setAction("Проверить", false, check);
    return;
  }

  if (e.t === "build") { renderBuild(e, box); return; }

  if (e.t === "pairs") {
    const left = shuffle(e.fs), right = shuffle(e.fs);
    box.innerHTML = `<div class="kicker">Найди пары</div><h2 class="task">Соедини название и формулу</h2>
      <div class="pairs">${left.map((f, i) => `
        <button class="opt" data-side="L" data-id="${f.id}">${esc(f.name)}</button>
        <button class="opt" data-side="R" data-id="${right[i].id}">${formulaHTML(right[i])}</button>`).join("")}</div>`;
    let sel = null, left_ = e.fs.length, errors = 0;
    box.querySelectorAll(".pairs .opt").forEach((b) => b.addEventListener("click", () => {
      if (b.classList.contains("gone")) return;
      haptic("tap");
      if (!sel || sel.dataset.side === b.dataset.side) {
        if (sel) sel.classList.remove("sel");
        sel = b; b.classList.add("sel"); return;
      }
      const a = sel; sel = null; a.classList.remove("sel");
      if (a.dataset.id === b.dataset.id) {
        [a, b].forEach((x) => x.classList.add("ok"));
        setTimeout(() => [a, b].forEach((x) => { x.classList.remove("ok"); x.classList.add("gone"); }), 350);
        if (--left_ === 0) {
          if (errors) L.mistakes += 1;
          L.answered += 1;
          haptic("success");
          showResult(true, errors ? "Все пары найдены!" : "Отлично!");
        }
      } else {
        errors += 1; haptic("error");
        [a, b].forEach((x) => x.classList.add("bad"));
        setTimeout(() => [a, b].forEach((x) => x.classList.remove("bad")), 450);
      }
    }));
    setAction("Проверить", false, null);
  }
}

// ------------------------------------------------------------------ сборка формулы: перетаскивание плиток
// Справа от «=» уже нарисована дробь: плитки кладутся в числитель или знаменатель.
// Если дроби в формуле нет — знаменатель оставляют пустым.
// Плитку можно перетащить пальцем/мышкой или просто нажать: из запаса она прыгает в выбранное место
// (числитель или знаменатель — что подсвечено), а нажатие по поставленной плитке возвращает её в запас.
function renderBuild(e, box) {
  const ctx = e.ctx;
  const kicker = ctx ? `Выведи сам · шаг ${ctx.k + 1} из ${ctx.d.steps.length}` : "Собери формулу";
  const head = ctx ? `${knownHTML(ctx.d, ctx.k)}<h2 class="task says">${tokHTML(e.f.name)}</h2>` : `<h2 class="task">${esc(e.f.name)}</h2>`;
  box.innerHTML = `<div class="kicker">${kicker}</div>${head}
    <div class="eqbuild">
      <span class="f lhs"><span>${exprHTML(toks(e.f.lhs))}</span><span>=</span></span>
      <div class="fracbox">
        <div class="zone znum act" id="zNum" data-ph="перетащи сюда"></div>
        <div class="fbar"></div>
        <div class="zone zden" id="zDen" data-ph="знаменатель — пусто, если дроби нет"></div>
      </div>
    </div>
    <div class="zone pool" id="pool">${e.pool.map((t, i) => `<button class="tile" data-i="${i}">${tokHTML(t)}</button>`).join("")}</div>`;

  const zNum = $("zNum"), zDen = $("zDen"), pool = $("pool");
  let active = zNum;
  const setActive = (z) => { active = z; zNum.classList.toggle("act", z === zNum); zDen.classList.toggle("act", z === zDen); };
  const update = () => setAction("Проверить", zNum.children.length > 0 && !L.locked, check);
  const backToPool = (tile) => {   // вернуть на своё место в запасе
    const i = +tile.dataset.i;
    const after = [...pool.children].find((c) => +c.dataset.i > i);
    pool.insertBefore(tile, after || null);
  };
  [zNum, zDen].forEach((z) => z.addEventListener("click", (ev) => { if (ev.target === z) { haptic("tap"); setActive(z); } }));

  const zones = [zDen, zNum, pool];
  const zoneAt = (x, y) => {
    for (const z of zones) {
      const r = z.getBoundingClientRect();
      if (x >= r.left - 14 && x <= r.right + 14 && y >= r.top - 14 && y <= r.bottom + 14) return z;
    }
    return null;
  };
  const placeAt = (tile, z, x, y) => {
    const others = [...z.children].filter((c) => c !== tile);
    let before = null;
    for (const c of others) {
      const r = c.getBoundingClientRect();
      if (y < r.top) { before = c; break; }
      if (y <= r.bottom && x < r.left + r.width / 2) { before = c; break; }
    }
    if (tile.parentNode !== z || tile.nextSibling !== before) z.insertBefore(tile, before);
  };

  box.querySelectorAll(".tile").forEach((tile) => {
    tile.addEventListener("pointerdown", (ev) => {
      if (L.locked || ev.button > 0) return;
      ev.preventDefault();
      const sx = ev.clientX, sy = ev.clientY;
      let ghost = null, offX = 0, offY = 0, overZ = null;
      const move = (m) => {
        if (!ghost) {
          if (Math.hypot(m.clientX - sx, m.clientY - sy) < 6) return;
          const r = tile.getBoundingClientRect();
          offX = sx - r.left; offY = sy - r.top;
          ghost = tile.cloneNode(true);
          ghost.className = "tile ghostdrag";
          ghost.style.width = r.width + "px";
          document.body.appendChild(ghost);
          tile.classList.add("dragging");
          haptic("tap");
        }
        m.preventDefault();
        ghost.style.transform = `translate(${m.clientX - offX}px, ${m.clientY - offY}px)`;
        const z = zoneAt(m.clientX, m.clientY);
        if (overZ !== z) { if (overZ) overZ.classList.remove("over"); if (z) z.classList.add("over"); overZ = z; }
        if (z) placeAt(tile, z, m.clientX, m.clientY);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        if (overZ) overZ.classList.remove("over");
        if (ghost) {
          ghost.remove(); tile.classList.remove("dragging");
          if (tile.parentNode !== pool) setActive(tile.parentNode);
        } else {                          // просто нажатие
          haptic("tap");
          if (tile.parentNode === pool) active.appendChild(tile); else backToPool(tile);
        }
        update();
      };
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    });
  });
  L.readBuild = () => {
    const get = (z) => [...z.children].map((c) => e.pool[+c.dataset.i]);
    const num = get(zNum), den = get(zDen);
    return den.length ? [...num, "/", ...den] : num;
  };
  update();
}

function check() {
  const e = L.queue[L.pos];
  let ok, correctHTML = "";
  if (e.t === "choice") { ok = e.opts[L.answer].ok; correctHTML = formulaHTML(e.f); }
  else if (e.t === "name") { ok = e.opts[L.answer] === e.f; correctHTML = `<b>${esc(e.f.name)}</b>`; }
  else if (e.t === "unit") { ok = e.opts[L.answer] === e.q[2]; correctHTML = `<b>${esc(e.q[2])}</b>`; }
  else if (e.t === "dq") { ok = e.opts[L.answer].ok; correctHTML = `<b>${tokHTML(e.s.o[0])}</b>`; }
  else if (e.t === "build") {
    ok = cform(L.readBuild()) === cform(toks(e.f.rhs));
    correctHTML = formulaHTML(e.f);
    $("exercise").querySelectorAll(".zone").forEach((z) => z.classList.add("lockedz"));
  }
  L.answered += 1;
  if (ok) haptic("success");
  else {
    haptic("error");
    L.mistakes += 1;
    if (!L.retried.has(L.pos)) {        // ошибку повторим в конце урока
      L.retried.add(L.queue.length);
      L.queue.push(e.t === "build" ? { ...e, pool: shuffle(e.pool) } : e);
    }
  }
  const praise = pick(["Отлично!", "Верно!", "Так держать!", "Супер!", "Мяу, правильно!"]);
  const why = e.t === "dq" ? e.s.why : e.f && e.f.legend;
  const legend = why ? `<div class="legend">${tokHTML(why)}</div>` : "";
  showResult(ok, ok ? praise : "Правильный ответ:", ok ? (e.t === "name" || e.t === "unit" ? "" : legend) : correctHTML + legend);
}

function showResult(ok, title, extra = "") {
  L.locked = true;
  $("footer").className = "footer " + (ok ? "good" : "bad");
  $("feedback").innerHTML = `<div class="title">${ok ? "✅" : "❌"} ${title}</div>${extra}`;
  setAction(ok ? "Дальше" : "Понятно", true, next, !ok);
}

function next() {
  L.locked = false;
  L.pos += 1;
  if (L.pos >= L.queue.length) return finishLesson();
  renderExercise();
}

function finishLesson() {
  setProgress();
  const l = L.lesson;
  const acc = L.answered ? Math.round(100 * (L.answered - L.mistakes) / L.answered) : 100;
  const xp = (l.kind === "d" ? XP_DERIV : XP_LESSON) + (L.mistakes === 0 ? XP_PERFECT : 0);
  P.d[l.id] = 1;
  P.xp += xp;
  bumpStreak();
  saveProgress();
  $("doneTitle").textContent = l.kind === "d" ? (L.mistakes === 0 ? "Выведено без ошибок! 🎓" : "Формула выведена! 🎓")
    : L.mistakes === 0 ? "Идеально! 🎉" : "Урок пройден!";
  $("doneXp").textContent = `+${xp}`;
  $("doneAcc").textContent = `${Math.max(0, acc)}%`;
  $("doneStreak").textContent = P.st;
  haptic("success");
  show("done");
}

$("doneBtn").addEventListener("click", () => { show("path"); renderPath(); });
function quitLesson() { L = null; show("path"); renderPath(); }
$("quit").addEventListener("click", quitLesson);
if (tg && tg.BackButton) tg.BackButton.onClick(() => { if (!$("lesson").classList.contains("hidden") || !$("done").classList.contains("hidden")) quitLesson(); });

// ------------------------------------------------------------------ старт
loadProgress(() => { show("path"); renderPath(); });
