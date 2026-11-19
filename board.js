// «Решаем вместе» — бесконечная общая доска (как Miro) для двоих, Telegram Mini App.
// Адрес: board.html?room=<id>&ws=<wss-адрес сервера>&b=<имя бота>  (их подставляет бот).
// Объекты доски: stroke (штрих), image (картинка), text (текст). Координаты — «мировые», камера: cam {x, y, z}.
//   экран = (мир − cam) · z      мир = экран / z + cam

const tg = window.Telegram ? window.Telegram.WebApp : null;
if (tg) { tg.ready(); tg.expand(); try { if (tg.isVersionAtLeast && tg.isVersionAtLeast("7.7")) tg.disableVerticalSwipes(); } catch (e) {} }
const $ = (id) => document.getElementById(id);

const Q = new URLSearchParams(location.search);
const startParam = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || "";
const rnd = (n) => Array.from({ length: n }, () => "abcdefghjkmnpqrstuvwxyz23456789"[Math.floor(Math.random() * 31)]).join("");
let ROOM = Q.get("room") || (/^room_[a-z0-9]{6,16}$/.test(startParam) ? startParam.slice(5) : "") || rnd(8);
const WS_URL = Q.get("ws") || "";
const BOT = Q.get("b") || "";
try { history.replaceState(null, "", `?room=${ROOM}${WS_URL ? "&ws=" + encodeURIComponent(WS_URL) : ""}${BOT ? "&b=" + BOT : ""}`); } catch (e) {}

function showMsg(text) { const m = $("msg"); m.textContent = text; m.style.display = text ? "flex" : "none"; }
function toast(text, ms = 2200) { const t = $("toast"); t.textContent = text; t.classList.add("show"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("show"), ms); }

// ---------------------------------------------------------------- состояние
const cv = $("cv"), ctx = cv.getContext("2d");
let dpr = 1, VW = 0, VH = 0;
const cam = { x: -200, y: -150, z: 1 };
const objs = new Map();                       // id → объект (порядок = порядок наложения)
let selected = null;                          // id выделенного объекта
let tool = "select", color = "#222222", brush = 4;
let hist = [], redo = [];                     // история моих действий {op:"add"|"del", obj}
const cursors = new Map();                    // who → {x, y, c, t}
let dirty = true;
// 🐱 Ваттсон — ИИ-помощник: «живой» курсор-кот (мировые координаты), реплика-облачко, настроение
const catImg = new Image(); catImg.src = "cat.png"; catImg.onload = () => { dirty = true; };
const ai = { lead: "", on: false, x: 0, y: 0, tx: 0, ty: 0, k: 4.5, mood: "chill", text: "", shown: 0, pause: 0, doneAt: 0, resolve: null, thinking: false, busy: false, nextIdle: 0, last: 0 };
const invalidate = () => { dirty = true; };

const screenToWorld = (sx, sy) => [sx / cam.z + cam.x, sy / cam.z + cam.y];
const worldToScreen = (wx, wy) => [(wx - cam.x) * cam.z, (wy - cam.y) * cam.z];
const newId = () => rnd(10);

// ---------------------------------------------------------------- связь
let fails = 0;
let curCode = "", variant = [], solved = new Set();            // текущая задача ФИПИ, общий «вариант», решённые мной
let ws = null, online = false, wantOpen = true, myName = "Гость", firstState = true;
const send = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };

function connect() {
  if (!WS_URL) { showMsg("Сервер доски не подключён. Открой доску через бота: команда /together."); return; }
  const user = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
  if (user) myName = user.first_name;
  ws = new WebSocket(`${WS_URL}${WS_URL.includes("?") ? "&" : "?"}room=${ROOM}`);
  ws.onopen = () => send({ t: "hello", name: myName, init: (tg && tg.initData) || "" });
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    switch (m.t) {
      case "state":
        online = true; fails = 0; showMsg("");
        variant = m.variant || [];
        objs.clear(); m.objs.forEach((o) => objs.set(o.id, o));
        if (firstState && m.objs.length) fitAll();
        firstState = false;
        invalidate(); break;
      case "seg": {
        let s = objs.get(m.id);
        if (!s) { s = { id: m.id, type: "stroke", c: m.c, w: m.w, p: [] }; objs.set(m.id, s); }
        s.p.push(...m.p); invalidate(); break;
      }
      case "add": objs.set(m.o.id, m.o); if (m.o.fipi) setCur(m.o.fipi); if (m.focus) focusOn(m.o); invalidate(); break;
      case "checked":
        if (m.ok === null) toast(`Для задачи ${m.code} нет эталонного ответа`);
        else { toast(`${m.ok ? "✅" : "❌"} ${m.who}: ${m.ok ? "верно!" : "неверно, попробуй ещё"}${m.v === -1 ? " (ответ в базе ФИПИ не подтвердил — возможна ошибка в эталоне)" : ""}`, m.v === -1 ? 6000 : 3500); if (m.ok && m.who === myName) { solved.add(m.code); if (TASKS) renderTasks(); } if (ai.on && !ai.busy && !ai.thinking) { if (!m.ok && m.who === myName) aiErrOffer(); else aiRun(() => aiReact(m.ok ? "happy" : "oops", m.ok ? "Есть! Так держать 😺" : "Хм, не сходится. Хочешь, разберём вместе? Напиши мне.")); } }
        break;
      case "revealed": toast(`Ответ к ${m.code}: ${m.answer}  (${m.v === 1 ? "подтверждён ФИПИ ✔" : m.v === -1 ? "ФИПИ НЕ подтвердил — сомнительный" : "эталон от ИИ, не официальный"})`, 9000); break;
      case "ai_join": aiJoin(); if (m.who === myName) aiHello(); else aiLog("sys", "🐱 Ваттсон на доске"); break;
      case "ai_q": aiLog("me", m.who === myName ? m.text : `${m.who}: ${m.text}`); break;
      case "ai_think": aiThink(); break;
      case "cat_lead":                                   // сервер назначил ведущего игрока: рядом с ним кот
        ai.lead = m.who; if (m.x != null) ai.lastPos = [m.x, m.y];
        if (aiLeader()) { ai.sx = undefined; ai.home = null; ai.nextSwitch = performance.now() + 40000 + Math.random() * 50000; }
        else if (ai.on && m.x != null) { ai.tx = m.x; ai.ty = m.y; ai.k = 6; }
        invalidate(); break;
      case "cat": if (!aiLeader()) { ai.lastPos = [m.x, m.y]; ai.tx = m.x; ai.ty = m.y; ai.k = 6; invalidate(); } break;
      case "cat_doodle": if (ai.on && !aiLeader()) aiRun(() => aiDoodleShow(m)); break;
      case "diary": renderDiary(m); break;
      case "ai_wait": aiLog("sys", m.n === 1 && m.now ? `Ваттсон отвечает ${m.now} — ты следующий ✋` : `Твой вопрос в очереди, впереди: ${m.n} ⏳`); break;
      case "ai_act": aiRun(() => aiAct(m)); break;
      case "ai_err": aiFail(m.why, m.who); break;
      case "ai_left": aiLeft = m.n; aiLog("sys", m.n > 0 ? `Осталось пробных запросов: ${m.n}` : "Это был последний пробный запрос. Дальше — со своим ключом 🔑"); break;
      case "focusobj": { const o = objs.get(m.id); if (o) { focusOn(o); selected = o.id; invalidate(); } break; }
      case "sol_err": toast(`Для задачи ${m.code} нет готового решения`); break;
      case "variant": variant = m.codes || []; tsec = "__variant"; if (TASKS) renderTasks(); break;
      case "upd": { const o = objs.get(m.id); if (o) { Object.assign(o, m); delete o.t; invalidate(); } break; }
      case "mv": { const o = objs.get(m.id); if (o && o.p) { o.p = o.p.map(([x, y]) => [x + m.dx, y + m.dy]); invalidate(); } break; }
      case "del": objs.delete(m.id); if (selected === m.id) selected = null; invalidate(); break;
      case "clear": objs.clear(); selected = null; hist = []; redo = []; syncButtons(); invalidate(); toast("Доску очистили"); break;
      case "cur": cursors.set(m.who, { x: m.x, y: m.y, c: m.c, t: Date.now() }); invalidate(); break;
      case "peers": setPeers(m.n, m.names); break;
      case "fipi_err": toast(`Задача с кодом ${m.code || "…"} не найдена 🙈`); break;
      case "full": wantOpen = false; showMsg("В этой комнате уже сидят четверо. Создай новую через бота."); break;
      case "denied": wantOpen = false; showMsg("Не удалось проверить, что ты из Telegram. Открой доску через бота."); break;
    }
  };
  ws.onclose = () => { if (!online) fails++; online = false; setPeers(0, []); if (wantOpen) setTimeout(connect, 1500); };
  ws.onerror = () => {};
}
function setPeers(n, names) {
  const p = $("peers");
  p.classList.toggle("on", n >= 2);
  const others = names.filter((x, i) => !(x === myName && names.indexOf(x) === i));
  p.textContent = !online ? (fails >= 3 ? "нет связи — сеть может блокировать сервер, попробуй VPN" : "нет связи…") : n >= 2 ? `👥 ${others.join(", ") || "друг"} на доске` : "ты один — позови друга";
}

// ---------------------------------------------------------------- рисование на холсте
function resize() {
  dpr = window.devicePixelRatio || 1;
  VW = window.innerWidth; VH = window.innerHeight;
  cv.width = Math.round(VW * dpr); cv.height = Math.round(VH * dpr);
  invalidate();
}
const imgCache = new Map();
function imageOf(o) {
  let im = imgCache.get(o.id);
  if (!im || im.srcKey !== o.src) {
    im = new Image(); im.srcKey = o.src; im.onload = invalidate; im.src = o.src; imgCache.set(o.id, im);
  }
  return im;
}
// ---- «красивые формулы»: p_нас, v_0, E_k, t^2, 10^-3, x_{max} рисуются настоящими индексами и степенями (на доске, в чате и в облачке)
function richRuns(text) {
  const out = []; let buf = "", i = 0;
  const flush = () => { if (buf) out.push({ s: buf, m: 0 }); buf = ""; };
  const isD = (c) => c >= "0" && c <= "9", isW = (c) => /[0-9A-Za-zА-Яа-яЁё]/.test(c || "");
  while (i < text.length) {
    const c = text[i];
    if ((c === "_" || c === "^") && i + 1 < text.length) {
      const m = c === "_" ? 1 : 2; let j = i + 1, sub = "";
      if (text[j] === "{") { const e = text.indexOf("}", j); if (e > j) { sub = text.slice(j + 1, e); j = e + 1; } }
      else if (m === 1) { if (isD(text[j])) { while (isD(text[j])) sub += text[j++]; } else while (isW(text[j]) && !isD(text[j])) sub += text[j++]; }
      else { if (text[j] && "+-−".includes(text[j])) sub += text[j++]; while (isD(text[j])) sub += text[j++]; if (!sub && isW(text[j])) sub += text[j++]; }
      if (sub.trim()) { flush(); out.push({ s: sub, m }); i = j; continue; }
    }
    buf += c; i++;
  }
  flush(); return out;
}
const escHtml = (t) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const richHTML = (text) => richRuns(text).map((r) => (r.m === 1 ? `<sub>${escHtml(r.s)}</sub>` : r.m === 2 ? `<sup>${escHtml(r.s)}</sup>` : escHtml(r.s))).join("");
function richMeasure(line, size) {                       // ширина строки с индексами (шрифт уже выставлен)
  let w = 0; const f = ctx.font;
  for (const r of richRuns(line)) { ctx.font = r.m ? f.replace(/[0-9.]+px/, size * 0.7 + "px") : f; w += ctx.measureText(r.s).width; }
  ctx.font = f; return w;
}
function richDraw(line, x, y, size) {                    // y — верх строки (textBaseline = top)
  let cx = x; const f = ctx.font;
  for (const r of richRuns(line)) {
    if (!r.m) { ctx.fillText(r.s, cx, y); cx += ctx.measureText(r.s).width; continue; }
    ctx.font = f.replace(/[0-9.]+px/, size * 0.7 + "px");
    ctx.fillText(r.s, cx, y + (r.m === 1 ? size * 0.3 : -size * 0.1)); cx += ctx.measureText(r.s).width; ctx.font = f;
  }
}
const otext = (o) => (o.ai ? texify(o.text || "") : o.text || "");   // текст кота может прийти с LaTeX — приводим к обычному
const textFont = (o) => `${o.size}px system-ui, "Segoe UI", Roboto, sans-serif`;
function textBox(o) {
  ctx.save(); ctx.font = textFont(o);
  const lines = otext(o).split("\n");
  const w = Math.max(...lines.map((l) => richMeasure(l, o.size)), o.size * 0.6);
  ctx.restore();
  return { x: o.x, y: o.y, w, h: lines.length * o.size * 1.2, lines };
}
function bbox(o) {
  if (o.type === "image") return { x: o.x, y: o.y, w: o.w, h: o.h };
  if (o.type === "text") return textBox(o);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of o.p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const r = o.w / 2;
  return { x: x0 - r, y: y0 - r, w: x1 - x0 + o.w, h: y1 - y0 + o.w };
}

function drawStroke(o) {
  const p = o._n === undefined ? o.p : o.p.slice(0, o._n); if (!p.length) return;
  ctx.strokeStyle = ctx.fillStyle = o.c; ctx.lineWidth = o.w; ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (p.length < 3) {
    if (p.length === 1 || (p[0][0] === p[1][0] && p[0][1] === p[1][1])) { ctx.beginPath(); ctx.arc(p[0][0], p[0][1], o.w / 2, 0, 7); ctx.fill(); return; }
    ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); ctx.lineTo(p[1][0], p[1][1]); ctx.stroke(); return;
  }
  ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < p.length - 1; i++) {            // сглаживание: кривые через середины отрезков
    const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
    ctx.quadraticCurveTo(p[i][0], p[i][1], mx, my);
  }
  ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
  ctx.stroke();
}

function draw() {
  dirty = false;
  const dark = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = dark ? "#262a31" : "#ffffff"; ctx.fillRect(0, 0, cv.width, cv.height);
  const k = cam.z * dpr;
  ctx.setTransform(k, 0, 0, k, -cam.x * k, -cam.y * k);

  // точечная сетка, как в Miro
  let step = 40; while (step * cam.z < 16) step *= 5;
  ctx.fillStyle = dark ? "#3a3f48" : "#d3d7de";
  const x0 = Math.floor(cam.x / step) * step, y0 = Math.floor(cam.y / step) * step;
  const d = Math.max(1.4 / cam.z, 1);
  for (let x = x0; x < cam.x + VW / cam.z; x += step) for (let y = y0; y < cam.y + VH / cam.z; y += step) ctx.fillRect(x - d / 2, y - d / 2, d, d);

  const vx0 = cam.x - 50, vy0 = cam.y - 50, vx1 = cam.x + VW / cam.z + 50, vy1 = cam.y + VH / cam.z + 50;
  objs.forEach((o) => {
    if (o.type === "stroke") {
      const b = bbox(o); if (b.x > vx1 || b.y > vy1 || b.x + b.w < vx0 || b.y + b.h < vy0) return;
      drawStroke(o);
    } else if (o.type === "image") {
      if (o.x > vx1 || o.y > vy1 || o.x + o.w < vx0 || o.y + o.h < vy0) return;
      const im = imageOf(o);
      if (im.complete && im.naturalWidth) ctx.drawImage(im, o.x, o.y, o.w, o.h);
      else { ctx.fillStyle = "#e9ecf0"; ctx.fillRect(o.x, o.y, o.w, o.h); }
    } else if (o.type === "text") {
      ctx.fillStyle = o.c; ctx.font = textFont(o); ctx.textBaseline = "top";
      otext(o).split("\n").forEach((l, i) => richDraw(l, o.x, o.y + i * o.size * 1.2, o.size));
    }
  });

  // выделение
  const so = selected && objs.get(selected);
  if (so) {
    const b = bbox(so), pad = 6 / cam.z;
    ctx.strokeStyle = "#1c8ef6"; ctx.lineWidth = 2 / cam.z; ctx.setLineDash([6 / cam.z, 4 / cam.z]);
    ctx.strokeRect(b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad); ctx.setLineDash([]);
    if (so.type !== "stroke") {
      const r = 7 / cam.z;
      ctx.fillStyle = "#fff"; ctx.strokeStyle = "#1c8ef6"; ctx.lineWidth = 2 / cam.z;
      ctx.beginPath(); ctx.rect(b.x + b.w + pad - r, b.y + b.h + pad - r, 2 * r, 2 * r); ctx.fill(); ctx.stroke();
    }
  }

  // курсоры друзей — в экранных координатах
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const now = Date.now();
  cursors.forEach((c, who) => {
    if (now - c.t > 3500) { cursors.delete(who); return; }
    const [sx, sy] = worldToScreen(c.x, c.y);
    ctx.fillStyle = c.c;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 5, sy + 17); ctx.lineTo(sx + 9, sy + 11); ctx.lineTo(sx + 16, sy + 9); ctx.closePath(); ctx.fill();
    ctx.font = "700 12px system-ui"; ctx.textBaseline = "middle";
    const w = ctx.measureText(who).width + 12;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(sx + 14, sy + 14, w, 20, 6) : ctx.rect(sx + 14, sy + 14, w, 20); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.fillText(who, sx + 20, sy + 24);
    dirty = true;                               // пока курсор виден — перерисовываем, чтобы он исчез вовремя
  });
  if (ai.on) drawCat();
  $("zv").textContent = Math.round(cam.z * 100) + "%";
}
(function loop(now) { if (ai.on) aiTick(now || performance.now()); if (dirty) draw(); requestAnimationFrame(loop); })();

// ---------------------------------------------------------------- камера
function zoomAt(sx, sy, f) {
  const z = Math.min(8, Math.max(0.05, cam.z * f));
  const [wx, wy] = screenToWorld(sx, sy);
  cam.z = z; cam.x = wx - sx / z; cam.y = wy - sy / z; invalidate();
}
function fitBox(b, animate) {
  const pad = 90, z = Math.min(1.5, Math.max(0.05, Math.min((VW - 2 * pad - 70) / b.w, (VH - 2 * pad) / b.h)));
  cam.z = z; cam.x = b.x + b.w / 2 - VW / 2 / z; cam.y = b.y + b.h / 2 - VH / 2 / z; invalidate();
}
function fitAll() {
  if (!objs.size) { cam.z = 1; cam.x = -200; cam.y = -150; invalidate(); return; }
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  objs.forEach((o) => { const b = bbox(o); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
  fitBox({ x: x0, y: y0, w: Math.max(x1 - x0, 50), h: Math.max(y1 - y0, 50) });
}
function focusOn(o) { const b = bbox(o); fitBox(b); }
$("zin").onclick = () => zoomAt(VW / 2, VH / 2, 1.25);
$("zout").onclick = () => zoomAt(VW / 2, VH / 2, 0.8);
$("zv").onclick = () => zoomAt(VW / 2, VH / 2, 1 / cam.z);
$("fit").onclick = () => fitAll();

cv.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));             // щипок на тачпаде / Ctrl+колесо
  else if (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40 && e.deltaMode === 0) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0012));   // колесо мыши
  else { cam.x += e.deltaX / cam.z; cam.y += e.deltaY / cam.z; invalidate(); }                      // два пальца на тачпаде
}, { passive: false });

// ---------------------------------------------------------------- история (отмена / повтор)
function syncButtons() { $("undo").disabled = !hist.length; $("redo").disabled = !redo.length; }
function record(op, obj) { hist.push({ op, obj }); if (hist.length > 200) hist.shift(); redo = []; syncButtons(); }
function addObj(o, rec = true) {
  objs.set(o.id, o); send({ t: "add", o }); if (rec) record("add", o); invalidate();
}
function delObj(id, rec = true) {
  const o = objs.get(id); if (!o) return;
  objs.delete(id); send({ t: "del", id }); if (selected === id) selected = null;
  if (rec) record("del", o); invalidate();
}
function undo() {
  const h = hist.pop(); if (!h) return;
  if (h.op === "add") { objs.delete(h.obj.id); send({ t: "del", id: h.obj.id }); if (selected === h.obj.id) selected = null; }
  else { objs.set(h.obj.id, h.obj); send({ t: "add", o: h.obj }); }
  redo.push(h); syncButtons(); invalidate();
}
function redoIt() {
  const h = redo.pop(); if (!h) return;
  if (h.op === "add") { objs.set(h.obj.id, h.obj); send({ t: "add", o: h.obj }); }
  else { objs.delete(h.obj.id); send({ t: "del", id: h.obj.id }); if (selected === h.obj.id) selected = null; }
  hist.push(h); syncButtons(); invalidate();
}
$("undo").onclick = undo; $("redo").onclick = redoIt;
$("clear").onclick = () => {
  if (!objs.size) return;
  const go = () => { objs.clear(); selected = null; hist = []; redo = []; syncButtons(); send({ t: "clear" }); invalidate(); };
  if (tg && tg.showConfirm) tg.showConfirm("Очистить всю доску у обоих?", (ok) => ok && go());
  else if (confirm("Очистить всю доску у обоих?")) go();
};

// ---------------------------------------------------------------- инструменты
const tbs = document.querySelectorAll("#tools [data-tool]");
function setTool(t) {
  tool = t; tbs.forEach((b) => b.classList.toggle("on", b.dataset.tool === t));
  if (t !== "select") { selected = null; invalidate(); }
  cv.style.cursor = { select: "default", hand: "grab", pen: "crosshair", eraser: "cell", text: "text" }[t] || "default";
}
tbs.forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));
const PALETTE = [...document.querySelectorAll("#tools .sw[data-c]")].map((x) => x.dataset.c);
function setColor(c) {
  color = c;
  document.querySelectorAll("#tools .sw[data-c]").forEach((x) => x.classList.toggle("on", x.dataset.c === c));
  $("custom").classList.toggle("on", !PALETTE.includes(c));
  const so = selected && objs.get(selected);
  if (so && so.type === "text") { so.c = c; send({ t: "upd", id: so.id, c }); invalidate(); }
}
document.querySelectorAll("#tools .sw[data-c]").forEach((s) => s.addEventListener("click", () => setColor(s.dataset.c)));

// ---------------------------------------------------------------- цветовой круг (HSV)
const wheel = $("wheel"), wctx = wheel.getContext("2d");
let hsv = { h: 0, s: 1, v: 1 };
function hsv2hex(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return "#" + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}
function drawWheel() {                                  // оттенок — по углу, насыщенность — по радиусу
  const R = wheel.width / 2, img = wctx.createImageData(wheel.width, wheel.height);
  for (let y = 0; y < wheel.height; y++) for (let x = 0; x < wheel.width; x++) {
    const dx = x - R, dy = y - R, r = Math.hypot(dx, dy), i = (y * wheel.width + x) * 4;
    if (r > R) { img.data[i + 3] = 0; continue; }
    const hex = hsv2hex((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, r / R, hsv.v);
    img.data[i] = parseInt(hex.slice(1, 3), 16); img.data[i + 1] = parseInt(hex.slice(3, 5), 16); img.data[i + 2] = parseInt(hex.slice(5, 7), 16); img.data[i + 3] = 255;
  }
  wctx.putImageData(img, 0, 0);
  const a = hsv.h * Math.PI / 180, px = R + Math.cos(a) * hsv.s * R, py = R + Math.sin(a) * hsv.s * R;   // кружок-маркер
  wctx.strokeStyle = "#fff"; wctx.lineWidth = 3; wctx.beginPath(); wctx.arc(px, py, 7, 0, 7); wctx.stroke();
  wctx.strokeStyle = "#0006"; wctx.lineWidth = 1; wctx.beginPath(); wctx.arc(px, py, 8.5, 0, 7); wctx.stroke();
}
function pickColor() {
  const hex = hsv2hex(hsv.h, hsv.s, hsv.v);
  $("custom").style.background = hex; $("cprev").style.background = hex; $("chex").textContent = hex;
  setColor(hex); drawWheel();
}
function wheelPoint(e) {
  const r = wheel.getBoundingClientRect(), R = r.width / 2, dx = e.clientX - r.left - R, dy = e.clientY - r.top - R;
  hsv.h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360; hsv.s = Math.min(1, Math.hypot(dx, dy) / R); pickColor();
}
let wheelDown = false;
wheel.addEventListener("pointerdown", (e) => { wheelDown = true; wheel.setPointerCapture(e.pointerId); wheelPoint(e); });
wheel.addEventListener("pointermove", (e) => { if (wheelDown) wheelPoint(e); });
wheel.addEventListener("pointerup", () => { wheelDown = false; });
$("val").addEventListener("input", () => { hsv.v = $("val").value / 100; pickColor(); });
const toggleCp = (on) => { const p = $("cp"); p.style.display = (on ?? p.style.display === "none") ? "flex" : "none"; if (p.style.display === "flex") { $("tasks").style.display = "none"; drawWheel(); } };
$("custom").addEventListener("click", () => toggleCp());
$("cpok").onclick = () => toggleCp(false);
function setBrush(w) { brush = w; document.querySelectorAll("#wd i").forEach((x) => x.classList.toggle("on", +x.dataset.w === w)); }
document.querySelectorAll("#wd i").forEach((i) => i.addEventListener("click", () => setBrush(+i.dataset.w)));

// ---------------------------------------------------------------- указатель
const ptrs = new Map();                       // активные касания/мышь: id → {x, y}
let gesture = null;                           // щипок двумя пальцами
let action = null;                            // текущее действие одним указателем
let spaceDown = false, lastCur = 0;

const distSeg = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
function strokeHit(s, wx, wy, r) {
  const p = s.p, rr = r + s.w / 2;
  if (p.length === 1) return Math.hypot(wx - p[0][0], wy - p[0][1]) <= rr;
  for (let i = 1; i < p.length; i++) if (distSeg(wx, wy, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]) <= rr) return true;
  return false;
}
function hitTest(wx, wy) {
  const r = 6 / cam.z, arr = [...objs.values()];
  for (let i = arr.length - 1; i >= 0; i--) {
    const o = arr[i];
    if (o.type === "stroke") { if (strokeHit(o, wx, wy, r)) return o; }
    else { const b = bbox(o); if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) return o; }
  }
  return null;
}
function onHandle(wx, wy) {
  const so = selected && objs.get(selected); if (!so || so.type === "stroke") return false;
  const b = bbox(so), pad = 6 / cam.z, r = 12 / cam.z;
  return Math.abs(wx - (b.x + b.w + pad)) <= r && Math.abs(wy - (b.y + b.h + pad)) <= r;
}
function eraseAt(wx, wy) {
  const r = 9 / cam.z;
  [...objs.values()].forEach((o) => { if (o.type === "stroke" && strokeHit(o, wx, wy, r)) delObj(o.id); });
}

function startGesture() {
  const [a, b] = [...ptrs.values()];
  gesture = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
}
cv.addEventListener("pointerdown", (e) => {
  if (e.button > 0 && e.button !== 1) return;
  e.preventDefault(); cv.setPointerCapture(e.pointerId);
  if (editing && tool !== "text") commitText();
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 2) {                       // второй палец: отменяем начатое рисование и переходим к щипку
    if (action && action.kind === "pen") { cancelStroke(); }
    action = null; startGesture(); return;
  }
  if (ptrs.size > 2) return;
  if (!online && tool !== "hand") { /* без связи тоже даём смотреть доску */ }
  const [wx, wy] = screenToWorld(e.clientX, e.clientY);
  const pan = tool === "hand" || spaceDown || e.button === 1;
  if (pan) { action = { kind: "pan", sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y }; cv.style.cursor = "grabbing"; return; }

  if (tool === "pen") {
    if (!online) { toast("Нет связи с сервером"); return; }
    const o = { id: newId(), type: "stroke", c: color, w: Math.max(0.5, +(brush / cam.z).toFixed(2)), p: [[+wx.toFixed(1), +wy.toFixed(1)]] };
    objs.set(o.id, o);
    action = { kind: "pen", o, buf: [o.p[0]], timer: setInterval(flushPen, 60) };
    invalidate();
  } else if (tool === "eraser") {
    action = { kind: "erase", lx: e.clientX, ly: e.clientY }; eraseAt(wx, wy);
  } else if (tool === "text") {
    const hit = hitTest(wx, wy);
    if (hit && hit.type === "text") editText(hit); else editText(null, wx, wy);
    action = null;
  } else {                                     // select
    if (onHandle(wx, wy)) {
      const o = objs.get(selected), b = bbox(o);
      action = { kind: "resize", o, b0: b, o0: { ...o }, ratio: b.w / b.h };
      return;
    }
    const hit = hitTest(wx, wy);
    if (hit) {
      selected = hit.id; if (hit.fipi) setCur(hit.fipi);
      action = { kind: "move", o: hit, lx: wx, ly: wy, acc: [0, 0], last: 0, moved: false };
      if (hit.type === "text" && e.detail === 2) { action = null; editText(hit); }
    } else { selected = null; action = { kind: "pan", sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y }; }
    invalidate();
  }
});
function flushPen() {
  if (!action || action.kind !== "pen" || !action.buf.length) return;
  send({ t: "seg", id: action.o.id, c: action.o.c, w: action.o.w, p: action.buf }); action.buf = [];
}
function cancelStroke() {
  if (!action || action.kind !== "pen") return;
  clearInterval(action.timer); flushPen();
  delObj(action.o.id, false); action = null;
}
cv.addEventListener("pointermove", (e) => {
  const p = ptrs.get(e.pointerId);
  const [wx, wy] = screenToWorld(e.clientX, e.clientY);
  const now = Date.now();
  if (online && now - lastCur > 70) { lastCur = now; send({ t: "cur", x: +wx.toFixed(1), y: +wy.toFixed(1), c: color }); }
  if (!p) return;
  p.x = e.clientX; p.y = e.clientY;
  if (gesture && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    cam.x -= (cx - gesture.cx) / cam.z; cam.y -= (cy - gesture.cy) / cam.z;
    if (gesture.d > 0) zoomAt(cx, cy, d / gesture.d);
    gesture = { d, cx, cy }; invalidate(); return;
  }
  if (!action) return;
  e.preventDefault();
  switch (action.kind) {
    case "pan": cam.x = action.cx - (e.clientX - action.sx) / cam.z; cam.y = action.cy - (e.clientY - action.sy) / cam.z; invalidate(); break;
    case "pen": {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of (evs.length ? evs : [e])) {
        const [x, y] = screenToWorld(ev.clientX, ev.clientY), pt = [+x.toFixed(1), +y.toFixed(1)];
        action.o.p.push(pt); action.buf.push(pt);
      }
      invalidate(); break;
    }
    case "erase": {
      const dx = e.clientX - action.lx, dy = e.clientY - action.ly, n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 6));
      for (let i = 1; i <= n; i++) { const [x, y] = screenToWorld(action.lx + dx * i / n, action.ly + dy * i / n); eraseAt(x, y); }
      action.lx = e.clientX; action.ly = e.clientY; break;
    }
    case "move": {
      const ddx = wx - action.lx, ddy = wy - action.ly; action.lx = wx; action.ly = wy;
      const o = action.o; action.moved = true;
      if (o.type === "stroke") { o.p = o.p.map(([x, y]) => [x + ddx, y + ddy]); action.acc[0] += ddx; action.acc[1] += ddy; }
      else { o.x += ddx; o.y += ddy; }
      if (now - action.last > 50) flushMove(); invalidate(); break;
    }
    case "resize": {
      const o = action.o, b0 = action.b0;
      const nw = Math.max(40, wx - b0.x);
      if (o.type === "image") { o.w = nw; o.h = nw / action.ratio; }
      else { o.size = Math.max(8, action.o0.size * nw / Math.max(20, b0.w)); }
      if (now - action.last > 60) { action.last = now; sendProps(o); }
      invalidate(); break;
    }
  }
});
function flushMove() {
  if (!action || action.kind !== "move") return;
  const o = action.o; action.last = Date.now();
  if (o.type === "stroke") { if (action.acc[0] || action.acc[1]) { send({ t: "mv", id: o.id, dx: +action.acc[0].toFixed(1), dy: +action.acc[1].toFixed(1) }); action.acc = [0, 0]; } }
  else send({ t: "upd", id: o.id, x: +o.x.toFixed(1), y: +o.y.toFixed(1) });
}
function sendProps(o) {
  if (o.type === "image") send({ t: "upd", id: o.id, x: o.x, y: o.y, w: +o.w.toFixed(1), h: +o.h.toFixed(1) });
  else send({ t: "upd", id: o.id, size: +o.size.toFixed(1) });
}
function endPointer(e) {
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) gesture = null;
  if (!action) return;
  if (action.kind === "pen") {
    clearInterval(action.timer); flushPen();
    if (online) record("add", action.o); else objs.delete(action.o.id);
  } else if (action.kind === "move") flushMove();
  else if (action.kind === "resize") sendProps(action.o);
  else if (action.kind === "pan") cv.style.cursor = tool === "hand" ? "grab" : tool === "select" ? "default" : cv.style.cursor;
  action = null; invalidate();
}
cv.addEventListener("pointerup", endPointer);
cv.addEventListener("pointercancel", endPointer);
cv.addEventListener("dblclick", (e) => {
  const [wx, wy] = screenToWorld(e.clientX, e.clientY), hit = hitTest(wx, wy);
  if (hit && hit.type === "text") editText(hit);
  else if (!hit && tool === "select") editText(null, wx, wy);
});

// ---------------------------------------------------------------- текст
const txt = $("txt");
let editing = null;                           // {o|null, wx, wy}
function editText(o, wx, wy) {
  if (editing) commitText();
  editing = { o, wx: o ? o.x : wx, wy: o ? o.y : wy, size: o ? o.size : Math.max(8, Math.round(26 / cam.z)) };
  if (o) { o._hidden = true; }
  const [sx, sy] = worldToScreen(editing.wx, editing.wy);
  const fs = editing.size * cam.z;
  Object.assign(txt.style, { display: "block", left: sx + "px", top: sy + "px", fontSize: fs + "px", color: o ? o.c : color, minWidth: Math.max(120, fs * 6) + "px", height: fs * 1.3 + "px" });
  txt.value = o ? o.text : "";
  fitTxt(); txt.focus(); txt.select();
  if (o) { const keep = o.text; o.text = ""; editing.keep = keep; invalidate(); }
}
function fitTxt() { txt.style.height = "auto"; txt.style.height = txt.scrollHeight + "px"; txt.style.width = Math.max(parseFloat(txt.style.minWidth), 40) + "px"; }
txt.addEventListener("input", fitTxt);
txt.addEventListener("keydown", (e) => { if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); commitText(); } e.stopPropagation(); });
txt.addEventListener("blur", () => setTimeout(commitText, 0));
function commitText() {
  if (!editing) return;
  const ed = editing; editing = null; txt.style.display = "none";
  const value = txt.value.replace(/\s+$/, "");
  if (ed.o) {
    const o = ed.o; delete o._hidden;
    if (!value) { o.text = ed.keep; delObj(o.id); }
    else { o.text = value; if (value !== ed.keep) send({ t: "upd", id: o.id, text: value }); }
  } else if (value) {
    addObj({ id: newId(), type: "text", x: ed.wx, y: ed.wy, text: value, size: ed.size, c: color });
  }
  invalidate();
}

// ---------------------------------------------------------------- картинки
function placeImage(dataUrl, nw, nh, at) {
  const maxW = Math.min(nw, (VW * 0.6) / cam.z), w = Math.max(60, maxW), h = w * nh / nw;
  const [cx, cy] = at || screenToWorld(VW / 2, VH / 2);
  const o = { id: newId(), type: "image", x: +(cx - w / 2).toFixed(1), y: +(cy - h / 2).toFixed(1), w: +w.toFixed(1), h: +h.toFixed(1), src: dataUrl };
  addObj(o); selected = o.id; setTool("select"); selected = o.id; invalidate();
}
function addImageFile(file, at) {
  if (!file || !file.type.startsWith("image/")) return;
  if (!online) { toast("Нет связи с сервером"); return; }
  const url = URL.createObjectURL(file), im = new Image();
  im.onload = () => {
    let max = 1600, q = 0.85, data;
    for (let i = 0; i < 8; i++) {
      const sc = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * sc); c.height = Math.round(im.naturalHeight * sc);
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
      data = c.toDataURL("image/jpeg", q);
      if (data.length < 950_000) { placeImage(data, c.width, c.height, at); break; }
      max = Math.round(max * 0.7); q -= 0.08;
    }
    URL.revokeObjectURL(url);
  };
  im.onerror = () => { URL.revokeObjectURL(url); toast("Не удалось открыть картинку"); };
  im.src = url;
}
$("imgBtn").onclick = () => $("file").click();
$("file").onchange = (e) => { [...e.target.files].forEach((f) => addImageFile(f)); e.target.value = ""; };
window.addEventListener("paste", (e) => {
  if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  const f = [...(e.clipboardData ? e.clipboardData.files : [])].find((x) => x.type.startsWith("image/"));
  if (f) { e.preventDefault(); addImageFile(f); }
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  [...(e.dataTransfer ? e.dataTransfer.files : [])].forEach((f) => addImageFile(f, screenToWorld(e.clientX, e.clientY)));
});

// ---------------------------------------------------------------- код ФИПИ
function loadCode(code) {
  if (!online) { toast("Нет связи с сервером"); return; }
  const [cx, cy] = screenToWorld(VW / 2, VH / 2);
  send({ t: "fipi", code, x: +cx.toFixed(1), y: +cy.toFixed(1) });
  toast(`Загружаю задачу ${code.toUpperCase()}…`, 1500);
}
function loadFipi() {
  const code = $("code").value.trim();
  if (!code) { $("code").focus(); return; }
  loadCode(code); $("code").value = ""; $("code").blur();
}
$("load").onclick = loadFipi;
$("code").addEventListener("keydown", (e) => { if (e.key === "Enter") loadFipi(); if (e.key === "Escape") $("code").blur(); e.stopPropagation(); });

// ---------------------------------------------------------------- проверка ответа
function setCur(code) { curCode = code; try { refreshChips(); } catch (e) {} $("ans").style.display = code ? "flex" : "none"; $("ansCode").textContent = code ? "Задача " + code : ""; }
function checkAnswer() {
  const a = $("ansIn").value.trim();
  if (!curCode || !a) { $("ansIn").focus(); return; }
  if (!online) { toast("Нет связи с сервером"); return; }
  send({ t: "check", code: curCode, answer: a, uid: UID }); lastAns = a; $("ansIn").value = "";
}
$("ansGo").onclick = checkAnswer;
$("ansIn").addEventListener("keydown", (e) => { if (e.key === "Enter") checkAnswer(); if (e.key === "Escape") $("ansIn").blur(); e.stopPropagation(); });
$("ansShow").onclick = () => { if (curCode && confirm("Показать эталонный ответ обоим? Лучше сначала попробовать решить.")) send({ t: "reveal", code: curCode }); };

$("ansSol").onclick = () => {
  if (!curCode) return;
  if (!online) { toast("Нет связи с сервером"); return; }
  if (!confirm("Показать верное решение обоим? Лучше сначала попробовать решить.")) return;
  const [cx, cy] = screenToWorld(VW / 2, VH / 2);
  send({ t: "solution", code: curCode, x: +cx.toFixed(1), y: +cy.toFixed(1) });
};

// ---------------------------------------------------------------- список задач (поиск, разделы, случайная)
let TASKS = null, tsec = "";
const httpBase = () => WS_URL.replace(/^ws/, "http").replace(/\/ws.*$/, "");
function renderTasks() {
  const q = $("tq").value.trim().toLowerCase();
  const secs = [...new Set(TASKS.map((t) => t.s).filter(Boolean))];
  const chips = [["", "Все"], ...(variant.length ? [["__variant", `Вариант (${variant.length})`]] : []), ...secs.map((s) => [s, s])];
  $("chips").innerHTML = chips.map(([s, l]) => `<i class="${s === tsec ? "on" : ""}" data-s="${s}">${l}</i>`).join("");
  $("chips").querySelectorAll("i").forEach((i) => i.addEventListener("click", () => { tsec = i.dataset.s; renderTasks(); }));
  const byCode = new Map(TASKS.map((t) => [t.c, t]));
  const base = tsec === "__variant" ? variant.map((c) => byCode.get(c)).filter(Boolean) : TASKS;
  const list = base.filter((t) => (tsec === "__variant" || !tsec || t.s === tsec) && (!q || t.c.toLowerCase().includes(q) || t.t.toLowerCase().includes(q) || (t.k || "").toLowerCase().includes(q)));
  $("tcount").textContent = `${list.length} из ${TASKS.length}`;
  $("tlist").innerHTML = list.slice(0, 150).map((t) => `<div class="ti ${solved.has(t.c) ? "done" : ""}" data-c="${t.c}"><b>${tsec === "__variant" ? (base.indexOf(t) + 1) + ". " : ""}${t.c}${solved.has(t.c) ? " ✅" : ""}${t.v === -1 ? " ⚠️" : ""}</b>${t.t.replace(/</g, "&lt;")}<small>${(t.k || t.s || "").replace(/</g, "&lt;")}</small></div>`).join("") || "<div class='ti'>Ничего не найдено</div>";
  $("tlist").querySelectorAll(".ti[data-c]").forEach((d) => d.addEventListener("click", () => loadCode(d.dataset.c)));
}
async function toggleTasks(on) {
  const p = $("tasks"), show = on ?? p.style.display === "none";
  p.style.display = show ? "flex" : "none";
  if (!show) return;
  toggleCp(false); $("diary").style.display = "none";
  if (!TASKS) {
    $("tlist").innerHTML = "<div class='ti'>Загружаю список…</div>";
    try { TASKS = await (await fetch(httpBase() + "/tasks")).json(); } catch (e) { $("tlist").innerHTML = "<div class='ti'>Не удалось загрузить список задач</div>"; return; }
  }
  renderTasks(); $("tq").focus();
}
$("tasksBtn").onclick = () => toggleTasks();
$("tclose").onclick = () => toggleTasks(false);
$("tq").addEventListener("input", () => TASKS && renderTasks());
$("tq").addEventListener("keydown", (e) => { if (e.key === "Escape") toggleTasks(false); e.stopPropagation(); });
// «Вариант»: ученик сам выбирает, сколько задач из каждого раздела. Номера задач в базе не сохранились, поэтому — по разделам.
const DEFAULT_Q = { "Механика": 7, "Молекулярная физика": 5, "Электродинамика": 6, "Квантовая физика": 3, "Оптика": 1 };
let vq = { ...DEFAULT_Q };
try { Object.assign(vq, JSON.parse(localStorage.getItem("wf_vq") || "{}")); } catch (e) {}
function vSum() { const n = [...document.querySelectorAll("#vrows input")].reduce((s, i) => s + (+i.value || 0), 0); $("vsum").textContent = `Всего: ${n}`; return n; }
function openVForm() {
  if (!TASKS) return;
  const have = {}; TASKS.filter((t) => t.v !== -1).forEach((t) => { have[t.s] = (have[t.s] || 0) + 1; });
  $("vrows").innerHTML = Object.keys(have).sort((x, y) => (DEFAULT_Q[y] ? 1 : 0) - (DEFAULT_Q[x] ? 1 : 0)).map((s) =>
    `<div class="vr"><span>${s} <small>(есть ${have[s]})</small></span><input type="number" min="0" max="${have[s]}" value="${Math.min(vq[s] || 0, have[s])}" data-s="${s}"></div>`).join("");
  $("vrows").querySelectorAll("input").forEach((i) => i.addEventListener("input", vSum));
  vSum(); $("vform").style.display = "block"; $("tlist").style.display = "none"; $("chips").style.display = "none";
}
function closeVForm() { $("vform").style.display = "none"; $("tlist").style.display = ""; $("chips").style.display = ""; }
$("tvariant").onclick = openVForm;
$("vcancel").onclick = closeVForm;
$("vgo").onclick = () => {
  if (!online) { toast("Нет связи с сервером"); return; }
  const codes = []; vq = {};
  document.querySelectorAll("#vrows input").forEach((i) => {
    const n = Math.max(0, Math.min(+i.value || 0, +i.max)); vq[i.dataset.s] = n;
    codes.push(...TASKS.filter((t) => t.s === i.dataset.s && t.v !== -1).sort(() => Math.random() - 0.5).slice(0, n).map((t) => t.c));
  });
  if (!codes.length) { toast("Выбери хотя бы одну задачу"); return; }
  try { localStorage.setItem("wf_vq", JSON.stringify(vq)); } catch (e) {}
  send({ t: "variant", codes }); variant = codes; tsec = "__variant"; solved = new Set(); closeVForm(); renderTasks();
  toast(`Вариант из ${codes.length} задач собран — выбирай задачи из списка по порядку`);
};
$("trandom").onclick = () => {
  const pool = TASKS ? TASKS.filter((t) => t.v !== -1 && (!tsec || tsec === "__variant" || t.s === tsec)) : [];
  if (pool.length) loadCode(pool[Math.floor(Math.random() * pool.length)].c);
};

// ---------------------------------------------------------------- 🐱 Ваттсон (ИИ-помощник)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// запасной «переводчик» LaTeX в обычный текст — на случай, если модель всё же напишет $\frac{a}{b}$
const SUP = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "+": "⁺", "-": "⁻", "−": "⁻", n: "ⁿ" };
const SUB = { 0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉", a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ" };
const GREEK = { Delta: "Δ", delta: "δ", rho: "ρ", nu: "ν", lambda: "λ", mu: "μ", omega: "ω", Omega: "Ω", alpha: "α", beta: "β", gamma: "γ", varepsilon: "ε", epsilon: "ε", eta: "η", pi: "π", sigma: "σ", tau: "τ", varphi: "φ", phi: "φ", theta: "θ", cdot: "·", times: "×", approx: "≈", leq: "≤", geq: "≥", neq: "≠", pm: "±", to: "→", rightarrow: "→", circ: "°" };
function texify(s) {
  s = String(s);
  if (!/[\u005c$^_]/.test(s)) return s;
  const map = (str, tbl) => { const o = [...str].map((c) => tbl[c]); return o.every(Boolean) ? o.join("") : null; };
  s = s.replace(/\$+/g, "").replace(/\u005c[()[\]]/g, "").replace(/\u005c(?:left|right|,|;|!|:)/g, "");
  s = s.replace(/\u005c(?:text|mathrm|mathit|mathbf|operatorname)\s*\{([^{}]*)\}/g, "$1");
  for (let i = 0; i < 3; i++) s = s.replace(/\u005c[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_, a, b) => `(${a})/(${b})`);
  s = s.replace(/\u005csqrt\s*\{([^{}]*)\}/g, "√($1)").replace(/\u005csqrt\s*(\w)/g, "√$1");
  s = s.replace(/\u005c([A-Za-z]+)/g, (m, w) => GREEK[w] || m);
  return s;
}
let aiQ = Promise.resolve(), aiBusyTimer = 0;
const aiRun = (fn) => (aiQ = aiQ.then(() => Promise.race([fn(), sleep(30000)])).catch(() => {}));   // очередь не должна зависать навсегда
function aiLog(cls, text) {
  if (cls === "cat") text = texify(text);
  const d = document.createElement("div"); d.className = cls; if (cls === "cat") d.innerHTML = richHTML(text); else d.textContent = text;
  const lg = $("ailog"); lg.appendChild(d); lg.scrollTop = lg.scrollHeight; return d;
}
// ---- кот всегда рядом с каким-нибудь игроком: держится в радиусе от него с небольшим отставанием, а со временем (или когда спросит другой) переходит к другому
const ptr = { x: 0, y: 0, t: 0 };                      // где у меня на доске указатель
window.addEventListener("pointermove", (e) => { const r = cv.getBoundingClientRect(); const [wx, wy] = screenToWorld(e.clientX - r.left, e.clientY - r.top); ptr.x = wx; ptr.y = wy; ptr.t = performance.now(); }, { passive: true });
function aiOn(x, y) { const [sx, sy] = worldToScreen(x, y); return sx > -20 && sy > -20 && sx < VW + 20 && sy < VH + 20; }   // точка сейчас на моём экране?
function aiLeader() { return !ai.lead || ai.lead === myName; }          // кота сейчас веду я (он рядом со мной)?
function aiPlayerPos() {                                // где сейчас решает игрок: указатель, иначе центр экрана
  if (performance.now() - ptr.t < 60000 && aiOn(ptr.x, ptr.y)) return [ptr.x, ptr.y];
  return [cam.x + VW / 2 / cam.z, cam.y + VH / 2 / cam.z];
}
function aiClamp(x, y) {                                // кот всегда остаётся на видимой части доски (с отступом от краёв)
  const z = cam.z; return [Math.min(cam.x + VW / z - 80 / z, Math.max(cam.x + 80 / z, x)), Math.min(cam.y + VH / z - 90 / z, Math.max(cam.y + 90 / z, y))];
}
function aiAnchor() {                                   // «дом» кота — примерное место, где работает игрок; кот стоит там и чуть шевелится, а за курсором не бегает
  if (!ai.home) { const [px, py] = aiPlayerPos(); ai.home = aiClamp(px + 140 / cam.z, py - 30 / cam.z); }
  return ai.home;
}
function aiRehome(now, force) {                         // игрок ушёл далеко от «дома» — переносим дом к нему (не сразу, чтобы кот не дёргался от случайного движения мыши)
  const [px, py] = aiPlayerPos(), [hx, hy] = aiAnchor(), z = cam.z, d = Math.hypot(px - hx, py - hy) * z;
  if (d <= Math.max(650, VW * 0.6)) { ai.farSince = 0; return; }
  if (!ai.farSince) ai.farSince = now;
  if (force || now - ai.farSince > 3500) { ai.home = aiClamp(px + 140 / z, py - 30 / z); ai.farSince = 0; ai.nextIdle = 0; }
}
function aiSwitchFollow(now) {                         // пора передать кота следующему игроку — решает сервер
  ai.nextSwitch = now + 40000 + Math.random() * 50000;
  send({ t: "cat_next" });
}
function aiJoin() {                                     // кот прилетает на доску справа и плавно садится рядом с игроком (у остальных — туда, где его ведёт ведущий)
  if (ai.on) return;
  const z = cam.z; ai.on = true;
  const [ax, ay] = aiAnchor(), mine = aiLeader() || !ai.lastPos;
  const [tx, ty] = mine ? aiClamp(ax + 110 / z, ay - 60 / z) : ai.lastPos;
  ai.x = cam.x + VW / z + 40 / z; ai.y = Math.min(cam.y + VH / z * 0.9, Math.max(cam.y + VH / z * 0.1, ty));
  ai.tx = ai.x; ai.ty = ai.y; ai.k = 2.6;
  ai.enterUntil = performance.now() + 2800;               // пока летит, «домашние» передвижения не вмешиваются
  ai.nextIdle = ai.enterUntil + 1500; ai.nextSwitch = performance.now() + 40000 + Math.random() * 50000;
  aiMoveTo(tx, ty, 2.6); invalidate();
}
function aiHello() { aiRun(async () => { await aiMoveTo(ai.tx, ai.ty, 2.6); ai.mood = "happy"; const t = "Мяу! Я Ваттсон 😺 Что решаем? Пиши, что у тебя не получается."; aiLog("cat", t); await aiSay(t); ai.mood = "chill"; }); }
const aiMoveTo = (x, y, k = 4.5) => new Promise((res) => {
  ai.tx = x; ai.ty = y; ai.k = k * (0.8 + Math.random() * 0.5); const t0 = performance.now();
  (function w() { if (Math.hypot(ai.x - ai.tx, ai.y - ai.ty) * cam.z < 8 || performance.now() - t0 > 3000) res(); else setTimeout(w, 40); })();
});
function aiSay(text) {
  text = texify(text);
  if (ai.resolve) ai.resolve();
  ai.text = text; ai.shown = 0; ai.pause = 0.3; ai.doneAt = 0; invalidate();
  return new Promise((r) => { ai.resolve = r; });
}
function aiLook() {                                    // игрок задал вопрос: кот остаётся на месте; переезжает, только если игрок убежал очень далеко
  if (aiLeader()) aiRehome(performance.now(), true);
}
function aiThink() { aiJoin(); ai.thinking = true; ai.busy = true; ai.mood = "think"; ai.text = ""; aiLook(); invalidate(); }
function aiFail(why, who) {
  if (/^(badkey|quota)$/.test(why) && who && who !== myName) why = "fail";   // чужой ключ — не моё дело
  aiBusyDone(); ai.thinking = false; ai.busy = false; ai.mood = "oops";
  const t = { fast: "Не так быстро, я не успеваю мурлыкать 😼", limit: "На сегодня пробные запросы закончились. Подключи свой ключ или приходи завтра!", nokey: "Меня ещё не подключили на сервере 🙈",
    fail: "Мяу, что-то заглючило. Спроси ещё раз.", busy: "Твой вопрос уже в очереди — подожди ответа 😺", full: "Ко мне очередь из пяти человек 🙀 Подожди немного и спроси ещё раз.", badkey: "Ключ не подошёл 🙈 Проверь, что скопировал его целиком, и вставь заново.", quota: "У твоего ключа сейчас кончился лимит запросов 😿 Подожди минутку (или до завтра) и спроси ещё раз.", trial_over: "Пять пробных запросов закончились 😺 Дальше — со своим ключом, это две минуты!", setup: "Это уже вопрос для ИИ 🧠 Нужен твой ключ или пробные запросы. А формулы, единицы, калькулятор и подсказки к задачам работают и так 😺" }[why] || "Мяу, что-то пошло не так.";
  aiLog("cat", t); aiRun(() => aiSay(t));
  if (why === "setup") showSetup("Для этого вопроса нужен ИИ — подключи ключ или возьми пробные запросы.");
  else if (why === "badkey") { keySave(""); showSetup("Ключ не подошёл — вставь его заново."); }
  else if (why === "trial_over") { aiTrial = false; aiLeft = 0; lsSet("wt", ""); lsSet("wtd", "1"); showSetup("Пробные запросы закончились."); }
}
function aiReact(mood, text) { ai.mood = mood; aiLog("cat", text); return aiSay(text); }
async function aiAct(m) {
  aiBusyDone(); ai.thinking = false; ai.busy = true; ai.mood = m.mood || "chill";
  aiLog("cat", m.say);
  const marks = (m.marks || []).filter((o) => o && o.p && o.p.length);
  marks.forEach((o) => { o._n = 0; objs.set(o.id, o); });
  (m.texts || []).forEach((o) => { if (o && o.id) objs.set(o.id, o); });          // надписи кота появляются сразу
  if (m.focus && m.from === myName) {                                              // нарисовал за краем экрана — показываем это место тому, кто просил
    const [sx, sy] = worldToScreen(m.focus[0], m.focus[1]);
    if (sx < 40 || sy < 40 || sx > VW - 40 || sy > VH - 40) { cam.x = m.focus[0] - VW / 2 / cam.z; cam.y = m.focus[1] - VH / 2 / cam.z; }
  }
  invalidate();
  if (aiLeader() && m.at && aiOn(m.at[0], m.at[1])) await aiMoveTo(m.at[0], m.at[1], 3.6);          // показывает лапой, только если место на экране
  await sleep(250 + Math.random() * 300);
  const talk = aiSay(m.say);
  for (const o of marks) {
    if (aiLeader() && aiOn(o.p[0][0], o.p[0][1])) { await aiMoveTo(o.p[0][0], o.p[0][1], 6); await sleep(150); }
    await aiReveal(o); await sleep(250);
  }
  await talk;
  ai.busy = false; ai.mood = "chill"; ai.lastAct = performance.now();
}
function aiReveal(o) {
  return new Promise((res) => {
    const n = o.p.length, dur = Math.max(500, n * 18), t0 = performance.now();
    (function f() {
      const q = Math.min(1, (performance.now() - t0) / dur); o._n = Math.max(1, Math.ceil(q * n));
      const p = o.p[Math.min(n - 1, o._n - 1)]; if (aiLeader() && aiOn(p[0], p[1])) { ai.x = ai.tx = p[0]; ai.y = ai.ty = p[1]; } invalidate();
      if (q < 1) requestAnimationFrame(f); else { delete o._n; res(); }
    })();
  });
}
function aiIdlePick(now) {                            // чуть-чуть бродит возле «дома» (радиус ~100 px); если оттащило далеко — возвращается
  if (now < (ai.enterUntil || 0)) { ai.nextIdle = ai.enterUntil; return; }
  const z = cam.z, [ax, ay] = aiAnchor(), d = Math.hypot(ai.x - ax, ai.y - ay) * z, far = d > 260;
  const ang = Math.random() * 6.283, rad = (far ? 60 : 40 + Math.random() * 70) / z;
  [ai.tx, ai.ty] = aiClamp(ax + Math.cos(ang) * rad, ay + Math.sin(ang) * rad * 0.7);
  ai.k = far ? (d > 1200 ? 5 : 2.4) : 1.1 + Math.random() * 0.6;
  ai.lastPick = now; ai.nextIdle = now + 3500 + Math.random() * 5000;
}
// ---- кот сам проявляет инициативу: ученик давно молчит → спрашивает «тебе подсказать?» или рисует рядом (рисунки временные, видны только у тебя)
const poly = (n, f) => Array.from({ length: n + 1 }, (_, i) => f(i / n));
const circ = (cx, cy, r) => poly(24, (t) => [cx + Math.cos(t * 6.283) * r, cy + Math.sin(t * 6.283) * r]);
const DOODLES = [
  () => [poly(5, (t) => { const a = -Math.PI / 2 + t * 5 * 4 * Math.PI / 5; return [Math.cos(a), Math.sin(a)]; })],                                  // звезда
  () => [poly(40, (t) => { const a = t * 6.283; return [16 * Math.sin(a) ** 3 / 17, -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 17]; })],   // сердце
  () => [circ(0, 0, 1), circ(-0.35, -0.25, 0.09), circ(0.35, -0.25, 0.09), poly(12, (t) => { const a = Math.PI * (0.2 + t * 0.6); return [Math.cos(a) * 0.55, Math.sin(a) * 0.5]; })],   // смайлик
  () => [circ(0, 0.05, 0.85), [[-0.8, -0.3], [-0.75, -1.05], [-0.25, -0.75]], [[0.8, -0.3], [0.75, -1.05], [0.25, -0.75]], circ(-0.3, -0.1, 0.07), circ(0.3, -0.1, 0.07), [[-0.1, 0.15], [0.1, 0.15], [0, 0.27], [-0.1, 0.15]],
         [[-0.35, 0.3], [-1.05, 0.2]], [[-0.35, 0.4], [-1.05, 0.5]], [[0.35, 0.3], [1.05, 0.2]], [[0.35, 0.4], [1.05, 0.5]]],                                   // котик
  () => [circ(0, 0, 0.45), ...Array.from({ length: 8 }, (_, k) => { const a = k * Math.PI / 4; return [[Math.cos(a) * 0.65, Math.sin(a) * 0.65], [Math.cos(a) * 1.0, Math.sin(a) * 1.0]]; })],   // солнышко
  () => [circ(0, -0.35, 0.18), ...Array.from({ length: 5 }, (_, k) => { const a = k * Math.PI * 2 / 5 - Math.PI / 2; return circ(Math.cos(a) * 0.38, -0.35 + Math.sin(a) * 0.38, 0.22); }), [[0, -0.1], [0, 1]], [[0, 0.6], [0.35, 0.45], [0.2, 0.7], [0, 0.6]]],   // цветочек
  () => [poly(24, (t) => { const a = t * 2 * Math.PI; return [Math.cos(a) * 0.8 - 0.1, Math.sin(a) * 0.45]; }), [[0.6, 0], [1, -0.4], [1, 0.4], [0.6, 0]], circ(-0.5, -0.1, 0.06), [[-0.1, -0.4], [0.2, 0], [-0.1, 0.4]]],   // рыбка
  () => [poly(40, (t) => [-1 + t * 2, Math.sin(t * 6 * Math.PI) * 0.3]), [[0.75, -0.35], [1, 0], [0.75, 0.35]]],   // волна со стрелкой
];
function aiFocusBox() {                                // где сейчас работает ученик: его записи, иначе условие задачи
  const mine = [...objs.values()].filter((o) => !o.ai && o.type === "stroke").slice(-40);
  if (mine.length) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; mine.forEach((o) => { const q = bbox(o); x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x + q.w); y1 = Math.max(y1, q.y + q.h); }); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; }
  const t = [...objs.values()].reverse().find((o) => o.fipi); return t ? bbox(t) : null;
}
function aiSpot() {                                    // свободное место рядом с игроком, в пределах экрана
  const z = cam.z, S = 55 / z, [ax, ay] = aiAnchor();
  return { S, x: Math.min(cam.x + VW / z - 90 / z, Math.max(cam.x + 90 / z, ax + 190 / z)), y: Math.min(cam.y + VH / z - 90 / z, Math.max(cam.y + 110 / z, ay - 20 / z)) };
}
async function aiDoodle() {
  ai.busy = true; ai.mood = "happy";
  const sp = aiSpot(), shapes = DOODLES[Math.floor(Math.random() * DOODLES.length)]();
  const strokes = shapes.map((pts) => ({ id: "a" + newId(), type: "stroke", c: "#c7742e", w: +Math.max(1.5, 3 / cam.z).toFixed(2), p: pts.map(([x, y]) => [+(sp.x + x * sp.S).toFixed(1), +(sp.y + y * sp.S).toFixed(1)]), ai: 1, tmp: 1, _n: 0 }));
  const t = ["Это тебе 😺", "Заскучал и порисовал 🐾", "Рисую, пока ты думаешь ✨"][Math.floor(Math.random() * 3)];
  send({ t: "cat_doodle", say: t, strokes: strokes.map((o) => ({ c: o.c, w: o.w, p: o.p })) });
  strokes.forEach((o) => objs.set(o.id, o));
  for (const o of strokes) { await aiMoveTo(o.p[0][0], o.p[0][1], 5); await aiReveal(o); }
  aiLog("cat", t); const talk = aiSay(t);
  setTimeout(() => { strokes.forEach((o) => objs.delete(o.id)); invalidate(); }, 25000);
  await talk; ai.busy = false; ai.mood = "chill";
}
async function aiDoodleShow(m) {                      // чужие каракули кота: рисуются у меня тем же образом, но кота не двигают (его позиция приходит от ведущего)
  const strokes = (m.strokes || []).filter((o) => o && Array.isArray(o.p) && o.p.length > 1).map((o) => ({ id: "a" + newId(), type: "stroke", c: o.c, w: o.w, p: o.p, ai: 1, tmp: 1, _n: 0 }));
  if (!strokes.length) return;
  ai.busy = true; ai.mood = "happy";
  strokes.forEach((o) => objs.set(o.id, o));
  for (const o of strokes) await aiReveal(o);
  if (m.say) { aiLog("cat", m.say); await aiSay(m.say); }
  setTimeout(() => { strokes.forEach((o) => objs.delete(o.id)); invalidate(); }, 25000);
  ai.busy = false; ai.mood = "chill";
}
async function aiOffer() {
  ai.busy = true; ai.mood = "think"; aiLook();
  const t = ["Тебе подсказать? 😺", "Ты тут? Если застрял — скажи, подскажу 🐱", "Давно тишина… Подсказать, с чего начать?", "Хм, думаешь? Могу подсказать, если хочешь 😺"][Math.floor(Math.random() * 4)];
  aiLog("cat", t);
  if ($("aip").style.display === "flex" && !aiSetup && (aiKey || aiTrial)) {
    const row = document.createElement("div"); row.className = "offer";
    const mk = (label, fn) => { const b = document.createElement("button"); b.className = "btn ghost"; b.textContent = label; b.onclick = () => { row.remove(); fn(); }; row.appendChild(b); };
    mk("Да, подскажи", () => aiAsk("Подскажи, с чего начать и на что обратить внимание?"));
    mk("Я сам", () => { const r = "Ок, я рядом 😺"; aiLog("cat", r); aiRun(() => aiSay(r)); });
    $("ailog").appendChild(row); $("ailog").scrollTop = $("ailog").scrollHeight;
    setTimeout(() => row.remove(), 60000);
  }
  await sleep(500); await aiSay(t); ai.busy = false; ai.mood = "chill";
}
const nudgeGap = () => 110000 + Math.random() * (900000 - 110000);   // пауза до следующей инициативы кота: от 110 секунд до 15 минут, случайно
function aiNudge() {
  ai.nudges = (ai.nudges || 0) + 1;
  aiRun(() => (ai.nudges === 1 || Math.random() < 0.5 ? aiOffer() : aiDoodle()));
}
["pointerdown", "keydown"].forEach((ev) => window.addEventListener(ev, () => { ai.lastAct = performance.now(); }, { capture: true, passive: true }));

function aiTick(now) {
  const dt = Math.min(0.05, Math.max(0, (now - (ai.last || now)) / 1000)); ai.last = now;
  const ox = ai.x, oy = ai.y, f = 1 - Math.exp(-dt * ai.k);
  ai.x += (ai.tx - ai.x) * f; ai.y += (ai.ty - ai.y) * f;
  if (Math.hypot(ai.x - ox, ai.y - oy) * cam.z > 0.05) dirty = true;
  if (ai.text && ai.shown < ai.text.length) {          // печатает по буквам, на знаках препинания «задумывается»
    if (ai.pause > 0) ai.pause -= dt;
    else {
      const b = Math.floor(ai.shown); ai.shown = Math.min(ai.text.length, ai.shown + dt * 34); const a = Math.floor(ai.shown);
      if (a > b) { const ch = ai.text[a - 1]; if (/[.!?…]/.test(ch)) ai.pause = 0.35; else if (/[,;:]/.test(ch)) ai.pause = 0.15; }
      if (ai.shown >= ai.text.length) { ai.doneAt = now; if (ai.resolve) { ai.resolve(); ai.resolve = null; } }
    }
    dirty = true;
  }
  if (ai.text && ai.doneAt && now - ai.doneAt > 15000) { ai.text = ""; ai.doneAt = 0; dirty = true; }
  if (!ai.text && ai.resolve) { ai.resolve(); ai.resolve = null; }   // реплику стёрли, пока печаталась, — не держим очередь
  if (ai.thinking) dirty = true;
  if (aiLeader()) {
    if (!ai.lastAct) { ai.lastAct = now; ai.idleAt = nudgeGap(); }
    if (!ai.busy && !ai.thinking && !aiBusyTimer && !document.hidden && (ai.nudges || 0) < 4 && now - ai.lastAct > ai.idleAt) { ai.lastAct = now; ai.idleAt = nudgeGap(); aiNudge(); }
    if (!ai.busy && !ai.thinking) {
      aiRehome(now, false);
      const [ax, ay] = aiAnchor();
      if (now > ai.nextIdle || (Math.hypot(ai.x - ax, ai.y - ay) > 260 / cam.z && now - (ai.lastPick || 0) > 600)) aiIdlePick(now);
    }
    if (now > (ai.nextSwitch || 0) && ai.nextSwitch) aiSwitchFollow(now);
    if (now - (ai.sentAt || 0) > 120 && (Math.abs(ai.x - (ai.sx ?? 1e9)) + Math.abs(ai.y - (ai.sy ?? 1e9))) * cam.z > 2) {   // кот сдвинулся — рассказываем остальным
      ai.sentAt = now; ai.sx = ai.x; ai.sy = ai.y; send({ t: "cat", x: +ai.x.toFixed(1), y: +ai.y.toFixed(1) });
    }
  }
}
function drawCat() {
  const [sx, sy] = worldToScreen(ai.x, ai.y), now = performance.now();
  const h = 32, w = catImg.naturalWidth ? h * catImg.naturalWidth / catImg.naturalHeight : 54, bob = Math.sin(now / 420) * 1.2;
  if (catImg.complete && catImg.naturalWidth) ctx.drawImage(catImg, sx - w / 2, sy - h * 0.55 + bob, w, h);
  ctx.font = "700 12px system-ui"; ctx.textBaseline = "middle";
  const name = "Ваттсон", tw = ctx.measureText(name).width + 12;
  ctx.fillStyle = "#c7742e"; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(sx - tw / 2, sy + h * 0.5, tw, 18, 6) : ctx.rect(sx - tw / 2, sy + h * 0.5, tw, 18); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.fillText(name, sx, sy + h * 0.5 + 9); ctx.textAlign = "left";
  const em = ai.thinking ? "💭" : { think: "🤔", happy: "✨", oops: "❗" }[ai.mood] || "";
  if (em && (ai.thinking || ai.busy)) { ctx.font = "16px system-ui"; ctx.fillText(em, sx + w / 2 - 6, sy - h * 0.55 - 4 + bob); }
  const bub = $("aib");
  const txt = ai.thinking ? ".".repeat(1 + Math.floor(now / 380) % 3) : ai.text.slice(0, Math.floor(ai.shown));
  if (!txt) { bub.style.display = "none"; return; }
  bub.innerHTML = richHTML(txt); bub.style.display = "block";
  const bw = bub.offsetWidth, bh = bub.offsetHeight;
  let bx = sx + 26, by = sy - bh - 6;
  if (bx + bw > VW - 8) bx = sx - 26 - bw;
  bx = Math.max(8, bx); by = Math.max(8, Math.min(by, VH - bh - 8));
  bub.style.left = bx + "px"; bub.style.top = by + "px";
}

// окно общения
function toggleAi(on) {
  const p = $("aip"), show = on ?? p.style.display !== "flex";
  p.style.display = show ? "flex" : "none";
  if (show) {
    $("diary").style.display = "none";
    if (!ai.on) send({ t: "ai_join" }); if (!online) toast("Нет связи с сервером");
    if (!aiKey && !aiTrial && !aiFree) showSetup(); else { aiSetup = false; aiGate(); setTimeout(() => $("aiIn").focus(), 50); }
  }
}

// ключ ученика (бесплатный Gemini): хранится в его Telegram (CloudStorage) и в браузере, на сервер уходит только с вопросом
const lsGet = (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
const lsSet = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} };
const cloud = tg && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast("6.9") ? tg.CloudStorage : null;
const tgUser = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
let UID = tgUser ? "t" + tgUser.id : lsGet("wdid"); if (!UID) { UID = "d" + rnd(14); lsSet("wdid", UID); }
let aiFree = lsGet("wf") === "1", aiKey = lsGet("wk"), aiTrial = lsGet("wt") === "1", aiLeft = lsGet("wtd") ? 0 : null, aiSetup = false;
function keySave(v) { aiKey = v; lsSet("wk", v); if (cloud) { try { v ? cloud.setItem("wk", v, () => {}) : cloud.removeItem("wk", () => {}); } catch (e) {} } }
if (cloud) { try { cloud.getItem("wk", (err, v) => { if (!err && v && !aiKey) { aiKey = v; lsSet("wk", v); if ($("aip").style.display === "flex") { aiSetup = false; aiGate(); } } }); } catch (e) {} }
const KEY_OK = /^[\w.\-]{16,200}$/;
function aiGate() { $("aip").classList.toggle("setup", aiSetup); }
function showSetup(msg) {
  aiSetup = true; aiGate(); $("aip").style.display = "flex";
  $("aiKeyIn").value = ""; $("aiKeyMsg").textContent = msg || "";
  $("aiKeyDel").style.display = aiKey ? "" : "none";
  $("aiTrial").style.display = aiLeft === 0 ? "none" : "";
  $("aiTrial").textContent = aiLeft > 0 && aiLeft < 5 ? `Продолжить пробные запросы (осталось ${aiLeft})` : "Попробовать 5 запросов без своего ключа";
  stTab(true);
}
function stTab(key) { $("stKey").classList.toggle("on", key); $("stTut").classList.toggle("on", !key); $("stKeyBox").style.display = key ? "" : "none"; $("stTutBox").style.display = key ? "none" : ""; }
$("stKey").onclick = () => stTab(true); $("stTut").onclick = () => stTab(false);
$("aiKeyBtn").onclick = () => (aiSetup ? (aiKey || aiTrial ? (aiSetup = false, aiGate()) : 0) : showSetup());
$("aiKeySave").onclick = () => {
  const v = $("aiKeyIn").value.trim();
  if (!KEY_OK.test(v)) { $("aiKeyMsg").textContent = "Не похоже на ключ — скопируй его целиком (без пробелов)."; return; }
  keySave(v); aiSetup = false; aiGate(); aiLog("sys", "🔑 Ключ сохранён — спрашивай!"); toast("Ключ сохранён ✅"); setTimeout(() => $("aiIn").focus(), 50);
};
$("aiKeyDel").onclick = () => { keySave(""); showSetup("Ключ удалён."); };
$("aiFree").onclick = () => { aiFree = true; lsSet("wf", "1"); aiSetup = false; aiGate(); aiLog("sys", "Без ИИ: подсказки к задачам, формулы, калькулятор, единицы и постоянные работают без ключа"); setTimeout(() => $("aiIn").focus(), 50); };
$("aiTrial").onclick = () => { aiTrial = true; lsSet("wt", "1"); aiSetup = false; aiGate(); aiLog("sys", "Пробный режим: 5 запросов без ключа"); setTimeout(() => $("aiIn").focus(), 50); };
$("aisetup").addEventListener("click", (e) => { const a = e.target.closest("a[data-url]"); if (!a) return; e.preventDefault(); const u = a.dataset.url; if (tg && tg.openLink) tg.openLink(u); else window.open(u, "_blank", "noopener"); });
$("aiKeyIn").addEventListener("keydown", (e) => { if (e.key === "Enter") $("aiKeySave").click(); e.stopPropagation(); });
$("aiBtn").onclick = () => toggleAi();
$("aiClose").onclick = () => toggleAi(false);
$("aiClean").onclick = () => { const ids = [...objs.values()].filter((o) => o.ai).map((o) => o.id); ids.forEach((id) => delObj(id, false)); toast(ids.length ? "Пометки Ваттсона стёрты" : "Пометок нет"); };
function aiBusyDone() { clearTimeout(aiBusyTimer); aiBusyTimer = 0; }
function snapshot() {
  draw();
  const k = Math.min(1, 1280 / cv.width), c = document.createElement("canvas");
  c.width = Math.round(cv.width * k); c.height = Math.round(cv.height * k);
  c.getContext("2d").drawImage(cv, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.72);
}
function aiAsk(text, mode, answer) {
  if (!online) { toast("Нет связи с сервером"); return; }
  if (!aiKey && !aiTrial && !aiFree) { showSetup(); return; }
  if (aiBusyTimer) { toast("Ваттсон ещё думает 😼"); return; }
  if (!ai.on) send({ t: "ai_join" });
  ai.nudges = 0; ai.lastAct = performance.now();
  aiBusyTimer = setTimeout(() => { aiBusyTimer = 0; if (ai.thinking) aiFail("fail"); }, 120000);
  send({ t: "ai", text, img: snapshot(), view: { x: cam.x, y: cam.y, z: cam.z, w: VW, h: VH }, code: curCode, key: aiKey, trial: aiTrial ? 1 : 0, uid: UID, mode: mode || "", answer: answer || "" });
}
// быстрые кнопки над строкой ввода: проверка решения, «что дано», формула, единицы и подсказка по нарастающей (1 → 2 → 3)
const hintLv = {};
const nextHint = () => Math.min(3, (hintLv[curCode || ""] || 0) + 1);
function refreshChips() { const b = $("qHint"); if (b) b.textContent = `💡 Подсказка ${nextHint()}`; }
$("qCheck").onclick = () => aiAsk("🔍 Проверь моё решение", "check");
$("qGiven").onclick = () => aiAsk("📋 Что дано?", "given");
$("qFormula").onclick = () => aiAsk("🧮 Какая формула?", "formula");
$("qUnits").onclick = () => aiAsk("📏 Проверь единицы", "units");
$("qScheme").onclick = () => aiAsk("🖼 Схема к задаче", "scheme");
$("qForces").onclick = () => aiAsk("➡ Проверь силы", "forces");
$("qFormat").onclick = () => aiAsk("📐 Оформление как на ЕГЭ", "format");
$("qHint").onclick = () => { const lv = nextHint(); hintLv[curCode || ""] = lv; aiAsk(`💡 Подсказка ${lv}`, "hint" + lv); refreshChips(); };
refreshChips();
// после неверного ответа кот предлагает найти ошибку (тип ошибки + наводящий вопрос)
let lastAns = "";
function aiErrOffer() {
  const t = "Не сошлось 😿 Хочешь, найдём, где ошибка?";
  aiLog("cat", t); aiRun(() => aiReact("oops", t));
  if ($("aip").style.display === "flex" && !aiSetup && (aiKey || aiTrial)) {
    const row = document.createElement("div"); row.className = "offer";
    const mk = (label, fn) => { const b = document.createElement("button"); b.className = "btn ghost"; b.textContent = label; b.onclick = () => { row.remove(); fn(); }; row.appendChild(b); };
    mk("Да, найдём", () => aiAsk("🔎 Разбери мою ошибку", "error", lastAns));
    mk("Сам", () => { const r = "Хорошо, пробуй ещё 😺"; aiLog("cat", r); aiRun(() => aiSay(r)); });
    $("ailog").appendChild(row); $("ailog").scrollTop = $("ailog").scrollHeight;
    setTimeout(() => row.remove(), 90000);
  }
}
function aiSend() { const t = $("aiIn").value.trim(); if (!t) return; $("aiIn").value = ""; aiAsk(t); }
$("aiGo").onclick = aiSend;
$("aiIn").addEventListener("keydown", (e) => { if (e.key === "Enter") aiSend(); if (e.key === "Escape") $("aiIn").blur(); e.stopPropagation(); });

// ---------------------------------------------------------------- 📓 Дневник ошибок: слабые темы, похожие задачи, повторение формул, итоги варианта
const FORMULA_UNITS = new Set(["1.1", "1.2", "1.3", "1.4", "1.5", "2.1", "2.2", "3.1", "3.2"]);   // темы, для которых есть «Повторение формул»
function openFormulas(u) { const url = new URL("index.html?r=" + u, location.href).href; if (tg && tg.openLink) tg.openLink(url); else window.open(url, "_blank", "noopener"); }
function toggleDiary(on) {
  const p = $("diary"), show = on ?? p.style.display === "none";
  p.style.display = show ? "flex" : "none";
  if (!show) return;
  toggleCp(false); toggleTasks(false); toggleAi(false);
  $("dbody").textContent = "Загружаю…"; send({ t: "diary_get", uid: UID, codes: variant });
}
$("diaryBtn").onclick = () => toggleDiary(); $("dclose").onclick = () => toggleDiary(false);
function renderDiary(m) {
  const box = $("dbody"); box.textContent = "";
  const add = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; box.appendChild(e); return e; };
  const btn = (parent, label, fn, cls = "btn ghost") => { const b = document.createElement("button"); b.className = cls; b.textContent = label; b.onclick = fn; parent.appendChild(b); return b; };
  const t = m.totals || { tries: 0, wrong: 0, solved: 0 };
  if (!t.tries) add("div", "dnote", "Пока пусто. Проверь ответ на любой задаче (поле «Твой ответ») — и здесь появятся слабые темы и подборка задач для повторения.");
  else add("div", "dnote", `Попыток: ${t.tries} · решено задач: ${t.solved} · ошибок: ${t.wrong}`);
  if ((m.map || []).length) {                           // карта освоения: каждая клетка — тема кодификатора; зелёное = решено верно, красное = ошибки, серое = не тронуто
    add("div", "dh", "Карта освоения");
    const info = document.createElement("div"); info.className = "dmapinfo"; info.textContent = "Нажми на клетку — покажу тему и предложу задачу.";
    add("div", "dnote", "🟩 решено верно · 🟥 были ошибки · ⬜ не тронуто"); box.appendChild(info);
    for (const sec of m.map) {
      const pct = sec.total ? Math.round(100 * sec.ok / sec.total) : 0;
      add("div", "dsec", `${sec.s} · решено ${sec.ok} из ${sec.total} (${pct}%)`);
      const grid = add("div", "dgrid");
      for (const t of sec.topics) {
        const b = document.createElement("button"), a = 100 * t.ok / t.total, w = 100 * (t.ok + t.wrong) / t.total;
        b.className = "dcell"; b.textContent = t.k || "·"; b.title = `${t.name}: верно ${t.ok}, с ошибками ${t.wrong}, не тронуто ${t.total - t.ok - t.wrong}`;
        b.style.background = `linear-gradient(to right, #58cc02 ${a}%, #ff6b6b ${a}% ${w}%, var(--line) ${w}%)`;
        b.onclick = () => {
          info.textContent = ""; const l = document.createElement("div"); l.textContent = `${t.k} ${t.name}: верно ${t.ok}, с ошибками ${t.wrong}, не тронуто ${t.total - t.ok - t.wrong} (всего ${t.total})`; info.appendChild(l);
          const acts = document.createElement("div"); acts.className = "da"; info.appendChild(acts);
          const pool = t.wrongC.length ? t.wrongC : t.noneC;
          if (pool.length) btn(acts, t.wrongC.length ? "🔁 Повторить ошибочную" : "🎯 Решить новую", () => { loadCode(pool[Math.floor(Math.random() * pool.length)]); toggleDiary(false); });
          if (FORMULA_UNITS.has(t.u)) btn(acts, "📖 Формулы", () => openFormulas(t.u));
        };
        grid.appendChild(b);
      }
    }
  }
  if ((m.topics || []).length) {
    add("div", "dh", "Где чаще всего ошибаешься");
    for (const tp of m.topics) {
      const row = add("div", "drow"); const l = document.createElement("div"); l.className = "dl"; l.textContent = `${tp.name} · ошибок: ${tp.wrong}`; row.appendChild(l);
      const acts = document.createElement("div"); acts.className = "da"; row.appendChild(acts);
      const sg = (m.suggest || []).find((x) => x.name === tp.name);
      if (sg) btn(acts, "🎯 Похожая задача", () => { loadCode(sg.c); toggleDiary(false); });
      if (FORMULA_UNITS.has(tp.u)) btn(acts, "📖 Формулы", () => openFormulas(tp.u));
    }
  }
  if (variant.length) {
    add("div", "dh", "Вариант");
    const chips = add("div", "dchips");
    for (const c of variant) {
      const st = (m.stats || {})[c] || {}; const b = document.createElement("button");
      b.className = "dchip " + (st.ok ? "ok" : st.wrong ? "bad" : ""); b.textContent = (st.ok ? "✅ " : st.wrong ? "❌ " : "· ") + c; b.onclick = () => { loadCode(c); toggleDiary(false); }; chips.appendChild(b);
    }
    const b = btn(box, "📊 Пусть кот разберёт мой вариант", () => { toggleDiary(false); toggleAi(true); aiAsk("📊 Разбери мой вариант", "variant"); }, "btn");
    if (!t.tries) b.disabled = true;
  }
}

// ---------------------------------------------------------------- приглашение, помощь
const inviteLink = () => (BOT ? `https://t.me/${BOT}?start=room_${ROOM}` : location.href);
$("invite").onclick = () => {
  const link = inviteLink();
  if (tg && tg.openTelegramLink) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Давай решать задачи по физике вместе! 🧠")}`);
  else if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => toast("Ссылка скопирована"));
  else prompt("Ссылка для друга:", link);
};
const toggleHelp = (on) => { $("help").style.display = on ?? $("help").style.display !== "flex" ? "flex" : "none"; };
$("helpBtn").onclick = () => toggleHelp();

// после клика кнопка не должна держать фокус — иначе пробел «нажмёт» её снова
document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest("button"); if (b) b.blur(); });

// ---------------------------------------------------------------- горячие клавиши
window.addEventListener("keydown", (e) => {
  const tag = document.activeElement && document.activeElement.tagName;
  if (/INPUT|TEXTAREA/.test(tag)) return;
  // горячие клавиши работают в любой раскладке (на русской e.key = «з», «у»…), поэтому буквы и знаки берём по физической клавише
  const byCode = { BracketLeft: "[", BracketRight: "]", Equal: "=", Minus: "-", NumpadAdd: "+", NumpadSubtract: "-" };
  const k = (/^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : byCode[e.code]) || e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if (e.code === "Space") { if (!spaceDown) { spaceDown = true; cv.style.cursor = "grab"; } e.preventDefault(); return; }
  if (ctrl && k === "z") { e.preventDefault(); e.shiftKey ? redoIt() : undo(); return; }
  if (ctrl && k === "y") { e.preventDefault(); redoIt(); return; }
  if (ctrl || e.altKey) return;
  const map = { v: "select", h: "hand", p: "pen", e: "eraser", t: "text" };
  if (map[k] && !e.shiftKey) { setTool(map[k]); e.preventDefault(); return; }
  if (k === "i") { $("file").click(); return; }
  if (k === "f") { e.preventDefault(); $("code").focus(); return; }
  if (k === "?" || (e.code === "Slash" && e.shiftKey) || e.key === "F1") { e.preventDefault(); toggleHelp(); return; }
  if (k === "escape") { toggleDiary(false); toggleHelp(false); toggleCp(false); toggleTasks(false); toggleAi(false); selected = null; invalidate(); return; }
  if (k === "delete" || k === "backspace") { if (selected) { e.preventDefault(); delObj(selected); } return; }
  if (e.code === "Digit1" && e.shiftKey) { e.preventDefault(); fitAll(); return; }
  if (/^[1-7]$/.test(k)) { setColor(PALETTE[+k - 1]); return; }
  if (k === "c") { toggleCp(); return; }
  if (k === "g") { toggleTasks(); return; }
  if (k === "0") { zoomAt(VW / 2, VH / 2, 1 / cam.z); return; }
  if (k === "+" || k === "=") { zoomAt(VW / 2, VH / 2, 1.25); return; }
  if (k === "-" || k === "_") { zoomAt(VW / 2, VH / 2, 0.8); return; }
  if (k === "[" || k === "]") { const ws_ = [2, 4, 9], i = ws_.indexOf(brush) + (k === "]" ? 1 : -1); setBrush(ws_[Math.min(2, Math.max(0, i))]); return; }
  const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
  if (arrows[k]) { e.preventDefault(); const s = (e.shiftKey ? 400 : 100) / cam.z; cam.x += arrows[k][0] * s; cam.y += arrows[k][1] * s; invalidate(); }
});
window.addEventListener("keyup", (e) => { if (e.code === "Space") { spaceDown = false; setTool(tool); } });
window.addEventListener("blur", () => { spaceDown = false; });

window.addEventListener("resize", resize);
resize(); syncButtons(); setTool("select"); setPeers(0, []);
connect();
