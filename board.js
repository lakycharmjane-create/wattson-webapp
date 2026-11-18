// «Решаем вместе» — общая доска для двоих (Telegram Mini App).
// Адрес: board.html?room=<id>&ws=<wss-адрес сервера>&b=<имя бота>  (их подставляет бот).
// Штрихи хранятся в нормированных координатах 0..1, поэтому на экранах разного размера доска выглядит одинаково.

const tg = window.Telegram ? window.Telegram.WebApp : null;
if (tg) { tg.ready(); tg.expand(); try { if (tg.isVersionAtLeast && tg.isVersionAtLeast("7.7")) tg.disableVerticalSwipes(); } catch (e) {} }
const $ = (id) => document.getElementById(id);

const Q = new URLSearchParams(location.search);
const startParam = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || "";
let ROOM = Q.get("room") || (/^room_[a-z0-9]{6,16}$/.test(startParam) ? startParam.slice(5) : "");
const WS_URL = Q.get("ws") || "";
const BOT = Q.get("b") || "";
const ASPECT = 3 / 4;                         // ширина / высота доски

const rnd = (n) => Array.from({ length: n }, () => "abcdefghjkmnpqrstuvwxyz23456789"[Math.floor(Math.random() * 31)]).join("");
if (!ROOM) ROOM = rnd(8);
try { history.replaceState(null, "", `?room=${ROOM}${WS_URL ? "&ws=" + encodeURIComponent(WS_URL) : ""}${BOT ? "&b=" + BOT : ""}`); } catch (e) {}

function showMsg(text) { const m = $("msg"); m.textContent = text; m.style.display = text ? "flex" : "none"; }
function toast(text) { const t = $("toast"); t.textContent = text; t.classList.add("show"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("show"), 1800); }

// ---------------------------------------------------------------- холст
const cv = $("cv"), ctx = cv.getContext("2d"), wrap = $("wrap"), stage = $("stage");
let strokes = new Map();                      // id → { c, w, p:[[x,y]...] }
let W = 0, H = 0;

function fit() {
  const aw = stage.clientWidth - 16, ah = stage.clientHeight - 16;
  let w = aw, h = aw / ASPECT;
  if (h > ah) { h = ah; w = ah * ASPECT; }
  wrap.style.width = w + "px"; wrap.style.height = h + "px";
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  W = cv.width; H = cv.height;
  redraw();
}
function line(s, from) {
  const p = s.p; if (!p.length) return;
  ctx.strokeStyle = s.c; ctx.fillStyle = s.c; ctx.lineWidth = s.w * (W / 1000) * 1.0; ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (p.length === 1) { ctx.beginPath(); ctx.arc(p[0][0] * W, p[0][1] * H, ctx.lineWidth / 2, 0, 7); ctx.fill(); return; }
  ctx.beginPath();
  const i0 = Math.max(0, from - 1);
  ctx.moveTo(p[i0][0] * W, p[i0][1] * H);
  for (let i = i0 + 1; i < p.length; i++) ctx.lineTo(p[i][0] * W, p[i][1] * H);
  ctx.stroke();
}
function redraw() { ctx.clearRect(0, 0, W, H); strokes.forEach((s) => line(s, 0)); }
function addPoints(id, c, w, pts) {
  let s = strokes.get(id);
  if (!s) { s = { c, w, p: [] }; strokes.set(id, s); }
  const from = s.p.length; s.p.push(...pts);
  line(s, from);
  return s;
}

// ---------------------------------------------------------------- связь
let ws = null, myName = "", online = false, wantOpen = true;
const myId = () => rnd(10);

function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

function connect() {
  if (!WS_URL) { showMsg("Сервер доски не подключён. Попроси того, кто настраивает бота, указать адрес сервера (BOARD_WS в config.py)."); return; }
  const user = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
  ws = new WebSocket(`${WS_URL}${WS_URL.includes("?") ? "&" : "?"}room=${ROOM}`);
  ws.onopen = () => send({ t: "hello", name: user ? user.first_name : "Гость", init: (tg && tg.initData) || "" });
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.t === "state") {
      online = true; showMsg("");
      strokes = new Map(); m.strokes.forEach((s) => strokes.set(s.id, { c: s.c, w: s.w, p: s.p }));
      redraw();
      if (document.activeElement !== $("task")) $("task").value = m.task || "";
    } else if (m.t === "seg") addPoints(m.id, m.c, m.w, m.p);
    else if (m.t === "del") { strokes.delete(m.id); redraw(); }
    else if (m.t === "clear") { strokes.clear(); redraw(); toast("Доску очистили"); }
    else if (m.t === "task") { if (document.activeElement !== $("task")) $("task").value = m.text; else pendingTask = m.text; }
    else if (m.t === "peers") setPeers(m.n, m.names);
    else if (m.t === "cur") showCursor(m);
    else if (m.t === "full") { wantOpen = false; showMsg("В этой комнате уже сидят четверо. Создай новую через бота."); }
    else if (m.t === "denied") { wantOpen = false; showMsg("Не удалось проверить, что ты из Telegram. Открой доску через бота."); }
  };
  ws.onclose = () => {
    online = false; setPeers(0, []);
    if (wantOpen) setTimeout(connect, 1500);
  };
  ws.onerror = () => {};
}
let pendingTask = null;

function setPeers(n, names) {
  const p = $("peers");
  p.classList.toggle("on", n >= 2);
  p.textContent = !online && !n ? "нет связи…" : n >= 2 ? `👥 ${n} · ${names.filter((x) => x !== myName).join(", ") || "друг"} здесь` : "ты один — позови друга";
}

// ---------------------------------------------------------------- рисование
let color = "#222222", width = 4, tool = "pen";
const tools = $("tools");
tools.querySelectorAll(".sw").forEach((b) => b.addEventListener("click", () => {
  tools.querySelectorAll(".sw").forEach((x) => x.classList.remove("on")); b.classList.add("on");
  color = b.dataset.c; if (tool === "eraser") selectWidth(tools.querySelector(".tool[data-w='4']"));
}));
function selectWidth(b) {
  tools.querySelectorAll(".tool[data-w]").forEach((x) => x.classList.remove("on")); b.classList.add("on");
  width = +b.dataset.w; tool = b.id === "eraser" ? "eraser" : "pen";
}
tools.querySelectorAll(".tool[data-w]").forEach((b) => b.addEventListener("click", () => selectWidth(b)));
$("undo").addEventListener("click", () => send({ t: "undo" }));
$("clear").addEventListener("click", () => {
  if (!strokes.size) return;
  if (tg && tg.showConfirm) tg.showConfirm("Очистить доску у обоих?", (ok) => ok && send({ t: "clear" }));
  else if (confirm("Очистить доску у обоих?")) send({ t: "clear" });
});

let cur = null, buf = [], flushT = 0, lastCur = 0;
const pos = (e) => {
  const r = cv.getBoundingClientRect();
  return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
};
function flush() {
  if (!cur || !buf.length) return;
  send({ t: "seg", id: cur.id, c: cur.c, w: cur.w, p: buf }); buf = [];
}
cv.addEventListener("pointerdown", (e) => {
  if (e.button > 0 || !online) return;
  e.preventDefault(); cv.setPointerCapture(e.pointerId);
  const c = tool === "eraser" ? "#ffffff" : color;
  cur = { id: myId(), c, w: width };
  const p = pos(e); buf = [p]; addPoints(cur.id, c, width, [p]);
  flushT = setInterval(flush, 60);
});
cv.addEventListener("pointermove", (e) => {
  if (!cur) return;
  e.preventDefault();
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  const pts = (evs.length ? evs : [e]).map(pos);
  buf.push(...pts); addPoints(cur.id, cur.c, cur.w, pts);
  const now = Date.now();
  if (now - lastCur > 80) { lastCur = now; send({ t: "cur", x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] }); }
});
const end = () => { if (!cur) return; clearInterval(flushT); flush(); cur = null; };
cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);

// курсор друга
const curEls = new Map();
function showCursor(m) {
  let el = curEls.get(m.who);
  if (!el) { el = document.createElement("div"); el.className = "cur"; el.innerHTML = `<i></i>`; el.firstChild.textContent = m.who; wrap.appendChild(el); curEls.set(m.who, el); }
  el.style.left = m.x * 100 + "%"; el.style.top = m.y * 100 + "%"; el.style.display = "block";
  clearTimeout(el.h); el.h = setTimeout(() => { el.style.display = "none"; }, 1800);
}

// условие задачи
let taskT = 0;
$("task").addEventListener("input", () => { clearTimeout(taskT); taskT = setTimeout(() => send({ t: "task", text: $("task").value }), 300); });
$("task").addEventListener("blur", () => { if (pendingTask !== null) { $("task").value = pendingTask; pendingTask = null; } });

// приглашение
function inviteLink() { return BOT ? `https://t.me/${BOT}?start=room_${ROOM}` : location.href; }
$("invite").addEventListener("click", () => {
  const link = inviteLink();
  if (tg && tg.openTelegramLink) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Давай решать задачи по физике вместе! 🧠")}`);
  else if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => toast("Ссылка скопирована"));
  else prompt("Ссылка для друга:", link);
});

window.addEventListener("resize", fit);
new ResizeObserver(fit).observe(stage);
fit();
try { myName = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.first_name) || "Гость"; } catch (e) {}
setPeers(0, []);
connect();
