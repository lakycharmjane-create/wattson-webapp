// «Учить формулы» — мини-приложение в стиле Duolingo.
// Путь из уроков по темам школьной программы (данные — formulas.js).
// Задания: новая формула → выбери формулу → собери формулу из плиток → найди пары → единицы измерения.
// Ошибки возвращаются в конец урока. Прогресс хранится в облаке Telegram (CloudStorage), а вне Telegram — в браузере.

const tg = window.Telegram ? window.Telegram.WebApp : null;
const inTelegram = Boolean(tg && tg.initData);
if (tg) { tg.ready(); tg.expand(); }

const $ = (id) => document.getElementById(id);
const OPS = new Set(["/", "·", "+", "−"]);
const GROUP = 3;                   // формул в одном уроке
const XP_LESSON = 10, XP_PERFECT = 5;

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

// Одна плитка → HTML: «~» — пробел, _xxx — индекс, ^(xxx) — степень
function tokHTML(t) {
  return esc(t.replace(/~/g, " "))
    .replace(/\^\(([^)]*)\)/g, "<sup>$1</sup>")
    .replace(/_([^\s·/+−()^<]+)/g, "<sub>$1</sub>");
}
const strip = (t) => (/^\(.*\)$/.test(t) ? t.slice(1, -1) : t);
// Правая часть: если в ней ровно одна «/», рисуем настоящую дробь
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
  `<span class="f ${cls}"><span>${tokHTML(f.lhs)}</span><span>=</span>${exprHTML(rhs)}</span>`;

// Сравнение ответов: порядок множителей и слагаемых не важен (m·a = a·m, ΔU + A = A + ΔU)
function canon(tokens) {
  const prod = (part) => {
    const s = part.join(" ").split(" / ");
    if (s.length > 2) return "?" + part.join(" ");
    const side = (x) => x.split(" · ").sort().join("*");
    return side(s[0]) + (s.length === 2 ? "|" + side(s[1]) : "");
  };
  if (tokens.includes("−") || tokens.length === 0) return tokens.join(" ");
  if (tokens.includes("+")) {
    const terms = tokens.join(" ").split(" + ").map((t) => prod(t.split(" ")));
    return terms.sort().join("+");
  }
  return prod(tokens);
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
// Тема делится на уроки по 3 формулы + итоговое «Повторение» (👑)
function lessonsOf(unit) {
  const n = Math.ceil(unit.formulas.length / GROUP);
  const size = Math.ceil(unit.formulas.length / n);
  const list = [];
  for (let i = 0; i < n; i++) list.push({ id: `${unit.id}:${i}`, unit, fs: unit.formulas.slice(i * size, (i + 1) * size), review: false, num: i + 1 });
  if (unit.formulas.length > GROUP) list.push({ id: `${unit.id}:R`, unit, fs: unit.formulas, review: true, num: n + 1 });
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
    html += `<div class="unithead" style="background:${u.color}">
      <span class="cnt">${doneCnt}/${ls.length}</span>
      <small>Раздел ${ui + 1}</small><b>${esc(u.title)}</b></div><div class="nodes">`;
    ls.forEach((l) => {
      const done = Boolean(P.d[l.id]);
      let cls = done ? "done" : open ? "current" : "locked";
      if (cls === "current") { if (currentFound) cls = "locked"; currentFound = true; }
      if (!done) open = false;
      const icon = l.review ? "👑" : done ? "✓" : cls === "locked" ? "🔒" : "★";
      html += `<button class="node ${cls}" style="--c:${u.color};left:${zig[k++ % zig.length]}px"
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
  $("sheetTitle").textContent = l.review ? `${l.unit.title} · Повторение 👑` : `${l.unit.title} · Урок ${l.num} из ${total}`;
  $("sheetText").textContent = l.review ? "Все формулы темы вперемешку." : l.fs.map((f) => f.name).join(" · ");
  $("sheetGo").textContent = P.d[id] ? "Повторить" : "Начать";
  $("sheetGo").onclick = () => { $("sheet").classList.add("hidden"); startLesson(l); };
  $("sheet").classList.remove("hidden");
}
$("sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") $("sheet").classList.add("hidden"); });
document.querySelectorAll("#gradeSeg button").forEach((b) => b.addEventListener("click", () => {
  grade = +b.dataset.grade; haptic("tap"); renderPath(); window.scrollTo(0, 0);
}));

// ------------------------------------------------------------------ генерация заданий
// Неверные варианты формулы: переворот дроби, «·» вместо «/», ловушки, другие формулы темы
function wrongVariants(f) {
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
  for (const g of shuffle(currentUnit.formulas)) if (g !== f && g.lhs === f.lhs) out.push(toks(g.rhs));
  for (const g of shuffle(currentUnit.formulas)) if (g !== f) out.push(toks(g.rhs));
  const seen = new Set([canon(r)]), res = [];
  for (const v of out) { const c = canon(v); if (!seen.has(c)) { seen.add(c); res.push(v); } }
  return res;
}

function exChoice(f) {
  const opts = shuffle([{ rhs: toks(f.rhs), ok: true }, ...wrongVariants(f).slice(0, 3).map((rhs) => ({ rhs, ok: false }))]);
  return { t: "choice", f, opts };
}
function exName(f) {
  const others = shuffle(currentUnit.formulas.filter((g) => g !== f && g.name !== f.name)).slice(0, 3);
  return { t: "name", f, opts: shuffle([f, ...others]) };
}
function exBuild(f) {
  const r = toks(f.rhs);
  const extra = [...new Set((f.trap || []).filter((t) => !r.includes(t) || OPS.has(t)))];
  const others = shuffle(currentUnit.formulas.filter((g) => g !== f).flatMap((g) => toks(g.rhs)))
    .filter((t) => !OPS.has(t) && !r.includes(t));
  for (const t of others) { if (extra.length >= 4) break; if (!extra.includes(t)) extra.push(t); }
  return { t: "build", f, pool: shuffle([...r, ...extra]) };
}
function exPairs(fs) {
  return { t: "pairs", fs: shuffle(fs).slice(0, 4) };
}
function exUnit(unit) {
  const q = pick(unit.q);
  const all = [...new Set(UNITS.flatMap((u) => u.q.map((x) => x[2])))].filter((x) => x !== q[2]);
  return { t: "unit", q, opts: shuffle([q[2], ...shuffle(all).slice(0, 3)]) };
}

let currentUnit = null;
function buildLesson(l) {
  currentUnit = l.unit;
  const firstTime = !P.d[l.id];
  const ex = [];
  if (!l.review) {
    l.fs.forEach((f, i) => {
      if (firstTime) ex.push({ t: "intro", f });
      ex.push(firstTime || i % 2 === 0 ? exChoice(f) : exName(f));
    });
    shuffle(l.fs).forEach((f) => ex.push(exBuild(f)));
    if (l.fs.length >= 3) ex.push(exPairs(l.fs));
    ex.push(exUnit(l.unit));
  } else {
    const fs = shuffle(l.fs);
    fs.slice(0, 6).forEach((f) => ex.push(exBuild(f)));
    fs.slice(6, 9).forEach((f, i) => ex.push(i % 2 ? exName(f) : exChoice(f)));
    ex.push(exPairs(fs.slice(0, 4)));
    ex.push(exUnit(l.unit), exUnit(l.unit));
    return [ex[0], ...shuffle(ex.slice(1))];
  }
  return ex;
}

// ------------------------------------------------------------------ прохождение урока
let L = null;   // { lesson, queue, pos, total, mistakes, retried:Set, answer }

function show(id) {
  ["path", "lesson", "done"].forEach((s) => $(s).classList.toggle("hidden", s !== id));
  if (tg && tg.BackButton) id === "path" ? tg.BackButton.hide() : tg.BackButton.show();
  window.scrollTo(0, 0);
}

function startLesson(l) {
  const queue = buildLesson(l);
  L = { lesson: l, queue, pos: 0, total: queue.length, mistakes: 0, answered: 0, retried: new Set() };
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

  if (e.t === "choice" || e.t === "name" || e.t === "unit") {
    let title, opts;
    if (e.t === "choice") {
      title = `Какая формула верная?<br><span class="legend">${esc(e.f.name)}</span>`;
      opts = e.opts.map((o) => formulaHTML(e.f, "", o.rhs));
    } else if (e.t === "name") {
      title = `Что это за формула?<div style="margin-top:12px">${formulaHTML(e.f, "big")}</div>`;
      opts = e.opts.map((g) => esc(g.name));
    } else {
      title = `В чём измеряется ${esc(e.q[1])} <span class="f small">${tokHTML(e.q[0])}</span>?`;
      opts = e.opts.map(esc);
    }
    box.innerHTML = `<div class="kicker">Выбери ответ</div><h2 class="task">${title}</h2>
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

  if (e.t === "build") {
    box.innerHTML = `<div class="kicker">Собери формулу</div><h2 class="task">${esc(e.f.name)}</h2>
      <div class="answerline" id="ansLine"><span class="f lhs">${tokHTML(e.f.lhs)} =</span></div>
      <div class="pool" id="pool">${e.pool.map((t, i) => `<button class="tile" data-i="${i}">${tokHTML(t)}</button>`).join("")}</div>`;
    L.answer = [];
    const line = $("ansLine");
    box.querySelectorAll("#pool .tile").forEach((src) => src.addEventListener("click", () => {
      if (L.locked || src.classList.contains("ghost")) return;
      haptic("tap");
      src.classList.add("ghost");
      const i = +src.dataset.i;
      L.answer.push(i);
      const t = document.createElement("button");
      t.className = "tile"; t.innerHTML = src.innerHTML;
      t.addEventListener("click", () => {
        if (L.locked) return;
        haptic("tap");
        L.answer.splice(L.answer.indexOf(i), 1); t.remove(); src.classList.remove("ghost");
        setAction("Проверить", L.answer.length > 0, check);
      });
      line.appendChild(t);
      setAction("Проверить", true, check);
    }));
    setAction("Проверить", false, check);
    return;
  }

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

function check() {
  const e = L.queue[L.pos];
  let ok, correctHTML = "";
  if (e.t === "choice") { ok = e.opts[L.answer].ok; correctHTML = formulaHTML(e.f); }
  else if (e.t === "name") { ok = e.opts[L.answer] === e.f; correctHTML = `<b>${esc(e.f.name)}</b>`; }
  else if (e.t === "unit") { ok = e.opts[L.answer] === e.q[2]; correctHTML = `<b>${esc(e.q[2])}</b>`; }
  else if (e.t === "build") {
    ok = canon(L.answer.map((i) => e.pool[i])) === canon(toks(e.f.rhs));
    correctHTML = formulaHTML(e.f);
  }
  L.answered += 1;
  if (ok) haptic("success");
  else {
    haptic("error");
    L.mistakes += 1;
    if (!L.retried.has(L.pos)) {        // ошибку повторим в конце урока
      L.retried.add(L.queue.length);
      L.queue.push(e.t === "build" ? exBuildAgain(e) : e);
    }
  }
  const praise = pick(["Отлично!", "Верно!", "Так держать!", "Супер!", "Мяу, правильно!"]);
  const legend = e.f ? `<div class="legend">${tokHTML(e.f.legend)}</div>` : "";
  showResult(ok, ok ? praise : "Правильный ответ:", ok ? (e.t === "build" || e.t === "choice" ? legend : "") : correctHTML + legend);
}
function exBuildAgain(e) { return { t: "build", f: e.f, pool: shuffle(e.pool) }; }

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
  const xp = XP_LESSON + (L.mistakes === 0 ? XP_PERFECT : 0);
  P.d[l.id] = 1;
  P.xp += xp;
  bumpStreak();
  saveProgress();
  $("doneTitle").textContent = L.mistakes === 0 ? "Идеально! 🎉" : "Урок пройден!";
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
