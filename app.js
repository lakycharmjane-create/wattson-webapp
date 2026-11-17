// «Повторение формул» — мини-приложение бота.
// Кнопка «🧠 Повторение формул» в меню бота открывает приложение: ученик выбирает раздел/темы/формулы и повторяет.
// (Адрес ?r=1.1,dyn1 сразу запускает повторение этих тем/формул — сейчас бот его не использует.)
// Задания: собери формулу из плиток (перетаскиванием; дробная черта уже нарисована, корень — отдельная плитка,
// которая накрывает всё, что в неё положишь), выбери верную формулу, узнай формулу, найди пары.
// Ошибки возвращаются в конец; в итоге — список формул с ошибками и кнопка «Повторить ошибки».

const tg = window.Telegram ? window.Telegram.WebApp : null;
const inTelegram = Boolean(tg && tg.initData);
if (tg) {
  tg.ready(); tg.expand();
  // чтобы перетаскивание плитки вниз не сворачивало мини-приложение
  try { if (tg.isVersionAtLeast && tg.isVersionAtLeast("7.7")) tg.disableVerticalSwipes(); } catch (e) {}
}

const $ = (id) => document.getElementById(id);
const OPS = new Set(["/", "·", "+", "−"]);

// ------------------------------------------------------------------ утилиты
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const toks = (s) => s.split(" ").filter(Boolean);
function haptic(kind) {
  if (!inTelegram || !tg.HapticFeedback) return;
  if (kind === "tap") tg.HapticFeedback.selectionChanged();
  else tg.HapticFeedback.notificationOccurred(kind);
}

// Знак корня: растягивается на всю высоту того, что под ним (и дробь, и одна буква)
const ROOT_SIGN = `<span class="rsign"><svg viewBox="0 0 10 30" preserveAspectRatio="none"><path d="M0 18 L3 15.5 L6.5 30 L10 0" vector-effect="non-scaling-stroke"/></svg></span>`;

// Одна плитка → HTML: «~» — пробел, _xxx — индекс, ^(xxx) — степень.
// Дробь внутри плитки («3/2», «1/R₁», «at²/2») рисуется с чертой, корень √(m/k) — знаком корня над дробью.
function tokHTML(t) {
  const q = t.indexOf("√(");
  if (q >= 0 && t.endsWith(")")) {
    return (q ? tokHTML(t.slice(0, q)) : "") + `<span class="sqrt">${ROOT_SIGN}<span class="rad">${tokHTML(t.slice(q + 2, -1))}</span></span>`;
  }
  const m = /^([^/()]+)\/([^/()]+)$/.exec(t);
  if (m) return `<span class="frac sm"><span>${tokHTML(m[1])}</span><span>${tokHTML(m[2])}</span></span>`;
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

// Корень в сборке: содержимое корня — отдельные плитки-буквы. «3kT/m₀» → [3, k, T] / [m₀]
function atoms(s) {
  const out = []; let i = 0;
  while (i < s.length) {
    let a = s[i++];
    if (/\d/.test(a)) while (i < s.length && /\d/.test(s[i])) a += s[i++];
    while (i < s.length && /[₀-₉²³]/.test(s[i])) a += s[i++];
    out.push(a);
  }
  return out;
}
const rootKey = (num, den) => `√(${num.slice().sort().join("·")}${den.length ? "/" + den.slice().sort().join("·") : ""})`;
function rootKeyOf(tok) {            // «√(m/k)» → ключ для сравнения
  const [n, d] = tok.slice(2, -1).split("/");
  return rootKey(atoms(n), d ? atoms(d) : []);
}
const isRootTok = (t) => t.startsWith("√(") && t.endsWith(")");
const canon = (f) => toks(f.rhs).map((t) => (isRootTok(t) ? rootKeyOf(t) : t));

// ------------------------------------------------------------------ данные
const SECTIONS = { "1": "Механика", "2": "Молекулярная физика и термодинамика", "3": "Электродинамика" };
UNITS.forEach((u) => u.formulas.forEach((f) => { f.unit = u; }));
const ALL = UNITS.flatMap((u) => u.formulas);
const byId = new Map(ALL.map((f) => [f.id, f]));
const unitById = new Map(UNITS.map((u) => [u.id, u]));

// ?r=1.1,dyn1 → список формул
function fromQuery() {
  const r = new URLSearchParams(location.search).get("r");
  if (!r) return [];
  const out = [];
  r.split(",").forEach((x) => {
    if (unitById.has(x)) out.push(...unitById.get(x).formulas);
    else if (byId.has(x)) out.push(byId.get(x));
  });
  return [...new Set(out)];
}

// ------------------------------------------------------------------ экран выбора
const picked = new Set();
try { JSON.parse(localStorage.getItem("wf_pick") || "[]").forEach((id) => byId.has(id) && picked.add(id)); } catch (e) {}
const opened = new Set();
function renderPicker() {
  let html = "";
  Object.entries(SECTIONS).forEach(([sec, title]) => {
    const us = UNITS.filter((u) => u.id.split(".")[0] === sec);
    if (!us.length) return;
    const sf = us.flatMap((u) => u.formulas), sk = sf.filter((f) => picked.has(f.id)).length;
    html += `<button class="sechead" data-sec="${sec}"><span class="chk ${sk === sf.length ? "on" : sk ? "part" : ""}"></span>${esc(title)}<small>${sk ? `${sk}/${sf.length}` : "весь раздел"}</small></button>`;
    us.forEach((u) => {
      const k = u.formulas.filter((f) => picked.has(f.id)).length;
      const mark = k === u.formulas.length ? "on" : k ? "part" : "";
      html += `<div class="topic" style="--c:${u.color}">
        <button class="trow" data-unit="${u.id}"><span class="chk ${mark}"></span><b>${esc(u.title)}</b><small>${k}/${u.formulas.length}</small></button>
        <button class="more" data-open="${u.id}">${opened.has(u.id) ? "▴" : "▾"}</button></div>`;
      if (opened.has(u.id)) {
        html += `<div class="flist">${u.formulas.map((f) => `<button class="frow" data-f="${f.id}">
          <span class="chk ${picked.has(f.id) ? "on" : ""}"></span><span class="fn">${esc(f.name)}${formulaHTML(f, "small")}</span></button>`).join("")}</div>`;
      }
    });
  });
  const t = $("topics");
  t.innerHTML = html;
  const toggle = (fs) => { const all = fs.every((f) => picked.has(f.id)); fs.forEach((f) => (all ? picked.delete(f.id) : picked.add(f.id))); };
  t.querySelectorAll("[data-sec]").forEach((b) => b.addEventListener("click", () => {
    haptic("tap");
    toggle(UNITS.filter((u) => u.id.split(".")[0] === b.dataset.sec).flatMap((u) => u.formulas));
    renderPicker();
  }));
  t.querySelectorAll("[data-unit]").forEach((b) => b.addEventListener("click", () => {
    haptic("tap");
    toggle(unitById.get(b.dataset.unit).formulas);
    renderPicker();
  }));
  t.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => {
    haptic("tap");
    const id = b.dataset.open; opened.has(id) ? opened.delete(id) : opened.add(id);
    renderPicker();
  }));
  t.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => {
    haptic("tap");
    const id = b.dataset.f; picked.has(id) ? picked.delete(id) : picked.add(id);
    renderPicker();
  }));
  try { localStorage.setItem("wf_pick", JSON.stringify([...picked])); } catch (e) {}   // запомнить выбор
  $("startBtn").disabled = picked.size === 0;
  $("startBtn").textContent = picked.size ? `Повторить (${picked.size})` : "Выбери формулы";
}
$("startBtn").addEventListener("click", () => startSession(ALL.filter((f) => picked.has(f.id))));

// ------------------------------------------------------------------ генерация заданий
// Буква величины слева от «=» (без Δ и индексов): F_тр → F, a_цс → a.
// Формулы ОДНОЙ величины (P = UI и P = I²R) не подмешиваем друг к другу как «неверные» —
// иначе верный ответ мог бы оказаться «ошибкой».
const qty = (f) => f.lhs.replace(/^Δ/, "")[0];
const rival = (f, g) => g !== f && qty(g) !== qty(f);

// Неверные варианты формулы: переворот дроби, «·» вместо «/», ловушки, формулы других величин темы
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
  for (const g of shuffle(siblings)) if (rival(f, g)) out.push(toks(g.rhs));
  const seen = new Set([cform(r)]), res = [];
  for (const v of out) { const c = cform(v); if (!seen.has(c)) { seen.add(c); res.push(v); } }
  return res;
}

function exChoice(f) {
  const opts = shuffle([{ rhs: toks(f.rhs), ok: true }, ...wrongVariants(f, f.unit.formulas).slice(0, 3).map((rhs) => ({ rhs, ok: false }))]);
  return { t: "choice", f, opts };
}
function exName(f) {
  const others = shuffle(f.unit.formulas.filter((g) => rival(f, g) && g.name !== f.name)).slice(0, 3);
  return { t: "name", f, opts: shuffle([f, ...others]) };
}
// Плитки для сборки: части формулы без «·» и «/» (черта дроби уже нарисована) + лишние плитки-ловушки.
// Если в формуле корень — он отдельная плитка «√», а его содержимое разбито на буквы.
function exBuild(f) {
  const all = toks(f.rhs);
  const rootTok = all.find(isRootTok);
  let r = all.filter((t) => t !== "·" && t !== "/" && t !== rootTok);
  let rootFrac = false;
  if (rootTok) {
    const [n, d] = rootTok.slice(2, -1).split("/");
    rootFrac = d !== undefined;
    r = [...r, "√", ...atoms(n), ...(d ? atoms(d) : [])];
  }
  const extra = [];
  const add = (t) => { if (!extra.includes(t) && !r.includes(t)) extra.push(t); };
  for (const t of f.trap || []) {
    if (t === "·" || t === "/") continue;
    if (rootTok) atoms(t.replace(/[√()/]/g, "")).forEach(add);
    else if (!extra.includes(t) && (!r.includes(t) || t === "+" || t === "−")) extra.push(t);
  }
  const want = Math.max(2, Math.min(4, 9 - r.length));
  const others = shuffle(f.unit.formulas.filter((g) => rival(f, g)).flatMap((g) => toks(g.rhs)))
    .filter((t) => !OPS.has(t) && !r.includes(t) && !t.includes("√"));
  for (const t of others) { if (extra.length >= want) break; add(t); }
  return { t: "build", f, rootFrac, pool: shuffle([...r, ...extra.slice(0, Math.max(want, 2))]) };
}
function exPairs(fs) {
  return { t: "pairs", fs: shuffle(fs).slice(0, 4) };
}

// Каждая формула — одно задание (чаще всего «собери»), после каждых 4 формул — «найди пары» по ним
function buildSession(fs) {
  const ex = [];
  const list = shuffle(fs);
  for (let i = 0; i < list.length; i += 4) {
    const chunk = list.slice(i, i + 4);
    chunk.forEach((f) => {
      const x = Math.random();
      ex.push(x < 0.6 ? exBuild(f) : x < 0.85 ? exChoice(f) : exName(f));
    });
    if (chunk.length >= 3) ex.push(exPairs(chunk));
  }
  return ex;
}

// ------------------------------------------------------------------ сессия повторения
let L = null;   // { fs, queue, pos, mistakes, answered, retried:Set, bad:Set, answer, locked }

function show(id) {
  ["picker", "lesson", "done"].forEach((s) => $(s).classList.toggle("hidden", s !== id));
  if (tg && tg.BackButton) id === "picker" ? tg.BackButton.hide() : tg.BackButton.show();
  window.scrollTo(0, 0);
}

function startSession(fs) {
  if (!fs.length) return;
  haptic("tap");
  L = { fs, queue: buildSession(fs), pos: 0, mistakes: 0, answered: 0, retried: new Set(), bad: new Set() };
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

  if (e.t === "choice" || e.t === "name") {
    let title, opts, kicker;
    if (e.t === "choice") {
      kicker = "Выбери верную";
      title = `Какая формула верная?<br><span class="legend">${esc(e.f.name)}</span>`;
      opts = e.opts.map((o) => formulaHTML(e.f, "", o.rhs));
    } else {
      kicker = "Узнай формулу";
      title = `Что это за формула?<div style="margin-top:12px">${formulaHTML(e.f, "big")}</div>`;
      opts = e.opts.map((g) => esc(g.name));
    }
    box.innerHTML = `<div class="kicker">${kicker} · ${esc(e.f.unit.title)}</div><h2 class="task">${title}</h2>
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
// Если в формуле есть дробь, справа от «=» уже нарисована черта: плитки кладутся в числитель или знаменатель.
// Плитка «√», положенная в формулу, раскрывается в знак корня с местом внутри (а если под корнем дробь —
// с чертой): туда перетаскиваются буквы, и корень растягивается над всем, что в нём лежит.
// Плитку можно перетащить пальцем/мышкой или просто нажать: из запаса она прыгает в выбранное место
// (что подсвечено), а нажатие по поставленной плитке возвращает её в запас. Корень двигают за его знак.
function renderBuild(e, box) {
  const isFrac = toks(e.f.rhs).includes("/");
  box.innerHTML = `<div class="kicker">Собери формулу · ${esc(e.f.unit.title)}</div><h2 class="task">${esc(e.f.name)}</h2>
    <div class="eqbuild" id="eq">
      <span class="f lhs"><span>${exprHTML(toks(e.f.lhs))}</span><span>=</span></span>
      <div class="fracbox">
        <div class="zone znum act" id="zNum"></div>${isFrac ? `
        <div class="fbar"></div>
        <div class="zone zden" id="zDen"></div>` : ""}
      </div>
    </div>
    <div class="zone pool" id="pool">${e.pool.map((t, i) =>
      `<span class="tile ${t === "√" ? "rt" : ""}" data-i="${i}">${t === "√" ? "√" : tokHTML(t)}</span>`).join("")}</div>`;

  const eq = $("eq"), zNum = $("zNum"), pool = $("pool");
  let active = zNum;
  const setActive = (z) => {
    active = z;
    eq.querySelectorAll(".zone").forEach((x) => x.classList.toggle("act", x === z));
  };
  const update = () => setAction("Проверить", zNum.children.length > 0 && !L.locked, check);
  const isRoot = (tile) => tile.classList.contains("rt");
  const inRoot = (el) => Boolean(el.closest && el.closest(".rt.open"));

  // корень: раскрыть (в формуле) / свернуть (в запасе, его буквы — тоже в запас)
  const backToPool = (tile) => {
    const i = +tile.dataset.i;
    const after = [...pool.children].find((c) => +c.dataset.i > i);
    pool.insertBefore(tile, after || null);
    fix(tile);
  };
  function fix(tile) {
    if (!isRoot(tile)) return;
    const open = tile.classList.contains("open");
    if (tile.parentNode === pool && open) {
      tile.querySelectorAll(".tile").forEach(backToPool);
      tile.classList.remove("open");
      tile.innerHTML = "√";
      if (!eq.contains(active)) setActive(zNum);
    } else if (tile.parentNode !== pool) {
      if (inRoot(tile.parentNode)) zNum.appendChild(tile);      // корень в корень не кладём
      if (!open) {
        tile.classList.add("open");
        tile.innerHTML = `${ROOT_SIGN}<span class="rin"><div class="zone rz"></div>${e.rootFrac ? `<div class="fbar"></div><div class="zone rz"></div>` : ""}</span>`;
        setActive(tile.querySelector(".rz"));
      }
    }
  }

  // нажатие на пустое место (числитель, знаменатель, место под корнем) — сюда пойдут следующие плитки
  eq.addEventListener("click", (ev) => {
    const z = ev.target;
    if (!L.locked && z.classList.contains("zone")) { haptic("tap"); setActive(z); }
  });

  const zoneAt = (x, y, dragged) => {
    let best = null, bestArea = Infinity;
    for (const z of [...eq.querySelectorAll(".zone"), pool]) {
      if (dragged.contains(z)) continue;
      const r = z.getBoundingClientRect();
      const pad = z.classList.contains("rz") ? 4 : 14;
      if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) {
        const area = r.width * r.height;
        if (area < bestArea) { bestArea = area; best = z; }
      }
    }
    return best;
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
      // раскрытый корень двигают только за знак √, а нажатия внутри него — для его букв и места под ними
      if (isRoot(tile) && tile.classList.contains("open") && !ev.target.closest(".rsign")) return;
      ev.stopPropagation();
      ev.preventDefault();
      const sx = ev.clientX, sy = ev.clientY;
      let ghost = null, offX = 0, offY = 0, overZ = null;
      const move = (m) => {
        if (!ghost) {
          if (Math.hypot(m.clientX - sx, m.clientY - sy) < 6) return;
          const r = tile.getBoundingClientRect();
          offX = sx - r.left; offY = sy - r.top;
          ghost = tile.cloneNode(true);
          ghost.classList.add("ghostdrag");
          ghost.style.width = r.width + "px";
          document.body.appendChild(ghost);
          tile.classList.add("dragging");
          haptic("tap");
        }
        m.preventDefault();
        ghost.style.transform = `translate(${m.clientX - offX}px, ${m.clientY - offY}px)`;
        let z = zoneAt(m.clientX, m.clientY, tile);
        if (z && isRoot(tile) && inRoot(z)) z = zNum;
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
          fix(tile);
          if (tile.parentNode !== pool && !isRoot(tile)) setActive(tile.parentNode);
        } else {                          // просто нажатие
          haptic("tap");
          if (tile.parentNode === pool) {
            let z = eq.contains(active) ? active : zNum;
            if (isRoot(tile) && inRoot(z)) z = zNum;
            z.appendChild(tile);
            fix(tile);
          } else backToPool(tile);
        }
        update();
      };
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    });
  });

  // ответ: плитки по местам; раскрытый корень — один множитель вида √(…)
  const val = (c) => {
    if (!isRoot(c)) return e.pool[+c.dataset.i];
    const zs = c.querySelectorAll(":scope > .rin > .zone");
    const get = (z) => (z ? [...z.children].map(val) : []);
    return rootKey(get(zs[0]), get(zs[1]));
  };
  L.readBuild = () => {
    const num = [...zNum.children].map(val);
    const zDen = $("zDen"), den = zDen ? [...zDen.children].map(val) : [];
    return den.length ? [...num, "/", ...den] : num;
  };
  update();
}

function check() {
  const e = L.queue[L.pos];
  let ok;
  if (e.t === "choice") ok = e.opts[L.answer].ok;
  else if (e.t === "name") ok = e.opts[L.answer] === e.f;
  else if (e.t === "build") {
    ok = cform(L.readBuild()) === cform(canon(e.f));
    $("exercise").querySelectorAll(".zone").forEach((z) => z.classList.add("lockedz"));
  }
  const correctHTML = e.t === "name" ? `<b>${esc(e.f.name)}</b>` : formulaHTML(e.f);
  L.answered += 1;
  if (ok) haptic("success");
  else {
    haptic("error");
    L.mistakes += 1;
    L.bad.add(e.f);
    if (!L.retried.has(L.pos)) {        // ошибку повторим в конце
      L.retried.add(L.queue.length);
      L.queue.push(e.t === "build" ? { ...e, pool: shuffle(e.pool) } : e);
    }
  }
  const praise = pick(["Отлично!", "Верно!", "Так держать!", "Супер!", "Мяу, правильно!"]);
  const legend = e.f.legend ? `<div class="legend">${tokHTML(e.f.legend)}</div>` : "";
  showResult(ok, ok ? praise : "Правильный ответ:", ok ? (e.t === "name" ? "" : legend) : correctHTML + legend);
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
  if (L.pos >= L.queue.length) return finishSession();
  renderExercise();
}

// ------------------------------------------------------------------ итог
function finishSession() {
  setProgress();
  const acc = L.answered ? Math.round(100 * (L.answered - L.mistakes) / L.answered) : 100;
  const bad = L.fs.filter((f) => L.bad.has(f));
  const fs = L.fs;
  $("doneTitle").textContent = bad.length ? "Повторение окончено" : "Все формулы без ошибок! 🎉";
  $("doneCount").textContent = fs.length;
  $("doneAcc").textContent = `${Math.max(0, acc)}%`;
  $("doneBad").innerHTML = bad.length
    ? `<div class="kicker" style="color:var(--red)">Стоит повторить ещё раз</div>` +
      bad.map((f) => `<div class="badf"><div class="legend">${esc(f.name)}</div>${formulaHTML(f, "small")}</div>`).join("")
    : "";
  $("againBad").classList.toggle("hidden", !bad.length);
  $("againBad").onclick = () => startSession(bad);
  $("againAll").onclick = () => startSession(fs);
  haptic("success");
  show("done");
}

function toPicker() { L = null; show("picker"); renderPicker(); }
// ✕ во время повторения: если уже что-то решено — показать итог, иначе к выбору
function quit() { if (L && L.answered && !$("lesson").classList.contains("hidden")) finishSession(); else toPicker(); }
$("toPicker").addEventListener("click", toPicker);
$("quit").addEventListener("click", quit);
if (tg && tg.BackButton) tg.BackButton.onClick(quit);

// ------------------------------------------------------------------ старт
const initial = fromQuery();
if (initial.length) { picked.clear(); initial.forEach((f) => picked.add(f.id)); }
if (initial.length) startSession(initial); else toPicker();
