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
const ai = { on: false, x: 0, y: 0, tx: 0, ty: 0, k: 4.5, mood: "chill", text: "", shown: 0, pause: 0, doneAt: 0, resolve: null, thinking: false, busy: false, nextIdle: 0, last: 0 };
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
        else { toast(`${m.ok ? "✅" : "❌"} ${m.who}: ${m.ok ? "верно!" : "неверно, попробуй ещё"}${m.v === -1 ? " (ответ в базе ФИПИ не подтвердил — возможна ошибка в эталоне)" : ""}`, m.v === -1 ? 6000 : 3500); if (m.ok && m.who === myName) { solved.add(m.code); if (TASKS) renderTasks(); } if (ai.on && !ai.busy && !ai.thinking) aiRun(() => aiReact(m.ok ? "happy" : "oops", m.ok ? "Есть! Так держать 😺" : "Хм, не сходится. Хочешь, разберём вместе? Напиши мне.")); }
        break;
      case "revealed": toast(`Ответ к ${m.code}: ${m.answer}  (${m.v === 1 ? "подтверждён ФИПИ ✔" : m.v === -1 ? "ФИПИ НЕ подтвердил — сомнительный" : "эталон от ИИ, не официальный"})`, 9000); break;
      case "ai_join": aiJoin(); if (m.who === myName) aiHello(); else aiLog("sys", "🐱 Ваттсон на доске"); break;
      case "ai_q": aiLog("me", m.who === myName ? m.text : `${m.who}: ${m.text}`); break;
      case "ai_think": aiThink(); break;
      case "ai_act": aiRun(() => aiAct(m)); break;
      case "ai_err": aiFail(m.why); break;
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
const textFont = (o) => `${o.size}px system-ui, "Segoe UI", Roboto, sans-serif`;
function textBox(o) {
  ctx.save(); ctx.font = textFont(o);
  const lines = (o.text || "").split("\n");
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width), o.size * 0.6);
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
      (o.text || "").split("\n").forEach((l, i) => ctx.fillText(l, o.x, o.y + i * o.size * 1.2));
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
function setCur(code) { curCode = code; $("ans").style.display = code ? "flex" : "none"; $("ansCode").textContent = code ? "Задача " + code : ""; }
function checkAnswer() {
  const a = $("ansIn").value.trim();
  if (!curCode || !a) { $("ansIn").focus(); return; }
  if (!online) { toast("Нет связи с сервером"); return; }
  send({ t: "check", code: curCode, answer: a }); $("ansIn").value = "";
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
  toggleCp(false);
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
let aiQ = Promise.resolve(), aiBusyTimer = 0, aiVoiceEl = null, rec = null;
const aiRun = (fn) => (aiQ = aiQ.then(fn).catch(() => {}));
function aiLog(cls, text) {
  const d = document.createElement("div"); d.className = cls; d.textContent = text;
  const lg = $("ailog"); lg.appendChild(d); lg.scrollTop = lg.scrollHeight; return d;
}
function aiJoin() {
  if (ai.on) return;
  const z = cam.z; ai.on = true;
  ai.x = ai.tx = cam.x + VW / z + 40 / z; ai.y = ai.ty = cam.y + VH / z * 0.2; ai.nextIdle = performance.now() + 2500;
  aiMoveTo(cam.x + VW / z * 0.8, cam.y + VH / z * 0.22, 2.6); invalidate();
}
function aiHello() { aiRun(async () => { await aiMoveTo(ai.tx, ai.ty, 2.6); ai.mood = "happy"; const t = "Мяу! Я Ваттсон 😺 Что решаем? Пиши или жми 🎤."; aiLog("cat", t); await aiSay(t); ai.mood = "chill"; }); }
const aiMoveTo = (x, y, k = 4.5) => new Promise((res) => {
  ai.tx = x; ai.ty = y; ai.k = k * (0.8 + Math.random() * 0.5); const t0 = performance.now();
  (function w() { if (Math.hypot(ai.x - ai.tx, ai.y - ai.ty) * cam.z < 8 || performance.now() - t0 > 3000) res(); else setTimeout(w, 40); })();
});
function aiSay(text) {
  if (ai.resolve) ai.resolve();
  ai.text = text; ai.shown = 0; ai.pause = 0.3; ai.doneAt = 0; invalidate();
  return new Promise((r) => { ai.resolve = r; });
}
function aiLook() {                                   // «читает» то, что ученик сейчас написал, иначе — условие
  const mine = [...objs.values()].filter((o) => !o.ai && o.type === "stroke").slice(-40);
  let b = null;
  if (mine.length) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; mine.forEach((o) => { const q = bbox(o); x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x + q.w); y1 = Math.max(y1, q.y + q.h); }); b = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; }
  else { const t = [...objs.values()].reverse().find((o) => o.fipi); if (t) b = bbox(t); }
  if (b) aiMoveTo(b.x + b.w * (0.3 + Math.random() * 0.4), b.y + b.h * (0.3 + Math.random() * 0.4), 2.8);
}
function aiThink() { aiJoin(); ai.thinking = true; ai.busy = true; ai.mood = "think"; ai.text = ""; aiLook(); invalidate(); }
function aiFail(why) {
  aiBusyDone(); ai.thinking = false; ai.busy = false; ai.mood = "oops";
  const t = { fast: "Не так быстро, я не успеваю мурлыкать 😼", limit: "На сегодня я наработался. Приходи завтра!", nokey: "Меня ещё не подключили на сервере 🙈", fail: "Мяу, что-то заглючило. Спроси ещё раз." }[why] || "Мяу, что-то пошло не так.";
  aiLog("cat", t); aiRun(() => aiSay(t));
}
function aiReact(mood, text) { ai.mood = mood; aiLog("cat", text); return aiSay(text); }
async function aiAct(m) {
  aiBusyDone(); ai.thinking = false; ai.busy = true; ai.mood = m.mood || "chill";
  aiLog("cat", m.say);
  if (m.heard) { if (aiVoiceEl) { aiVoiceEl.textContent = "🎤 " + m.heard; aiVoiceEl = null; } else aiLog("me", `${m.from}: 🎤 ${m.heard}`); }
  const marks = (m.marks || []).filter((o) => o && o.p && o.p.length);
  marks.forEach((o) => { o._n = 0; objs.set(o.id, o); });
  if (m.at) await aiMoveTo(m.at[0], m.at[1], 3.6);
  await sleep(250 + Math.random() * 300);
  const talk = aiSay(m.say);
  for (const o of marks) {
    await aiMoveTo(o.p[0][0], o.p[0][1], 6); await sleep(150);
    await aiReveal(o); await sleep(250);
  }
  await talk;
  if (marks.length) { const l = marks[marks.length - 1].p, e = l[l.length - 1]; aiMoveTo(e[0] + 90 / cam.z, e[1] + 60 / cam.z, 2.4); }
  ai.busy = false; ai.mood = "chill";
}
function aiReveal(o) {
  return new Promise((res) => {
    const n = o.p.length, dur = Math.max(500, n * 18), t0 = performance.now();
    (function f() {
      const q = Math.min(1, (performance.now() - t0) / dur); o._n = Math.max(1, Math.ceil(q * n));
      const p = o.p[Math.min(n - 1, o._n - 1)]; ai.x = ai.tx = p[0]; ai.y = ai.ty = p[1]; invalidate();
      if (q < 1) requestAnimationFrame(f); else { delete o._n; res(); }
    })();
  });
}
function aiIdlePick(now) {                            // поведение «от нечего делать»: глазеет на курсор ученика, на условие, просто бродит
  const z = cam.z, r = Math.random(), cs = [...cursors.values()].filter((c) => now - c.t < 3000);
  const task = [...objs.values()].reverse().find((o) => o.fipi);
  if (cs.length && r < 0.5) { ai.tx = cs[0].x + 70 / z; ai.ty = cs[0].y + 40 / z; ai.k = 2.2; }
  else if (task && r < 0.8) { ai.tx = task.x + Math.random() * task.w; ai.ty = task.y + Math.random() * task.h; ai.k = 2.5; }
  else { ai.tx += (Math.random() - 0.5) * 160 / z; ai.ty += (Math.random() - 0.5) * 120 / z; ai.k = 2; }
  ai.nextIdle = now + 2500 + Math.random() * 4500;
}
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
  if (ai.thinking) dirty = true;
  if (!ai.busy && !ai.thinking && now > ai.nextIdle) aiIdlePick(now);
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
  bub.textContent = txt; bub.style.display = "block";
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
  if (show) { if (!ai.on) send({ t: "ai_join" }); if (!online) toast("Нет связи с сервером"); setTimeout(() => $("aiIn").focus(), 50); }
}
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
function aiAsk(text, audio) {
  if (!online) { toast("Нет связи с сервером"); return; }
  if (aiBusyTimer) { toast("Ваттсон ещё думает 😼"); return; }
  if (!ai.on) send({ t: "ai_join" });
  aiBusyTimer = setTimeout(() => { aiBusyTimer = 0; if (ai.thinking) aiFail("fail"); }, 45000);
  if (audio) aiVoiceEl = aiLog("me", "🎤 …");
  send({ t: "ai", text, audio: audio || "", img: snapshot(), view: { x: cam.x, y: cam.y, z: cam.z, w: VW, h: VH }, code: curCode });
}
function aiSend() { const t = $("aiIn").value.trim(); if (!t) return; $("aiIn").value = ""; aiAsk(t, ""); }
$("aiGo").onclick = aiSend;
$("aiIn").addEventListener("keydown", (e) => { if (e.key === "Enter") aiSend(); if (e.key === "Escape") $("aiIn").blur(); e.stopPropagation(); });

// голос: запись → моно WAV 16 кГц (его понимает Gemini в любом браузере)
async function toWav(buf) {
  const AC = window.AudioContext || window.webkitAudioContext, ac = new AC();
  const dec = await new Promise((res, rej) => ac.decodeAudioData(buf, res, rej)); if (ac.close) ac.close();
  const sr = 16000, oc = new OfflineAudioContext(1, Math.max(1, Math.ceil(dec.duration * sr)), sr), src = oc.createBufferSource();
  src.buffer = dec; src.connect(oc.destination); src.start();
  const pcm = (await oc.startRendering()).getChannelData(0), dv = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o, s) => [...s].forEach((ch, i) => dv.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF"); dv.setUint32(4, 36 + pcm.length * 2, true); str(8, "WAVEfmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, "data"); dv.setUint32(40, pcm.length * 2, true);
  pcm.forEach((v, i) => dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  const u8 = new Uint8Array(dv.buffer); let bin = ""; for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
  return { b64: btoa(bin), sec: dec.duration };
}
$("aiMic").onclick = async () => {
  if (rec) { rec.stop(); return; }
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder)) { toast("Микрофон тут недоступен — напиши текстом"); return; }
  let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { toast("Нет доступа к микрофону — напиши текстом"); return; }
  const chunks = [], mr = new MediaRecorder(stream); rec = mr; $("aiMic").classList.add("rec"); toast("Говори… нажми 🎤 ещё раз, когда закончишь", 2500);
  const timer = setTimeout(() => mr.state === "recording" && mr.stop(), 25000);
  mr.ondataavailable = (e) => chunks.push(e.data);
  mr.onstop = async () => {
    clearTimeout(timer); stream.getTracks().forEach((t) => t.stop()); rec = null; $("aiMic").classList.remove("rec");
    try { const w = await toWav(await new Blob(chunks).arrayBuffer()); if (w.sec < 0.5) { toast("Слишком коротко"); return; } aiAsk("", w.b64); }
    catch (e) { toast("Не получилось обработать запись — напиши текстом"); }
  };
  mr.start();
};

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
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if (e.code === "Space") { if (!spaceDown) { spaceDown = true; cv.style.cursor = "grab"; } e.preventDefault(); return; }
  if (ctrl && k === "z") { e.preventDefault(); e.shiftKey ? redoIt() : undo(); return; }
  if (ctrl && k === "y") { e.preventDefault(); redoIt(); return; }
  if (ctrl || e.altKey) return;
  const map = { v: "select", h: "hand", p: "pen", e: "eraser", t: "text" };
  if (map[k] && !e.shiftKey) { setTool(map[k]); e.preventDefault(); return; }
  if (k === "i") { $("file").click(); return; }
  if (k === "f") { e.preventDefault(); $("code").focus(); return; }
  if (k === "?" || (e.code === "Slash" && e.shiftKey) || e.key === "F1") { e.preventDefault(); toggleHelp(); return; }
  if (k === "escape") { toggleHelp(false); toggleCp(false); toggleTasks(false); toggleAi(false); selected = null; invalidate(); return; }
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
