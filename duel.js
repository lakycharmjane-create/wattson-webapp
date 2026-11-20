// ⚔️ Дуэли — мини-игра. Вся логика игры — в боте (module/duel_online.py); здесь только экран и кнопки.
// Связь: сокет на сервер Cloudflare (board_worker, DuelHub) → бот. Сообщения — JSON {t: "тип", …}.
"use strict";

const tg = window.Telegram ? window.Telegram.WebApp : null;
if (tg) {
  try { tg.ready(); tg.expand(); } catch (e) {}
  try { if (tg.isVersionAtLeast && tg.isVersionAtLeast("7.7")) tg.disableVerticalSwipes(); } catch (e) {}
  try { tg.setHeaderColor("#14163a"); tg.setBackgroundColor("#14163a"); } catch (e) {}
}
const Q = new URLSearchParams(location.search);
const WS_URL = Q.get("ws") || "wss://wattson-board.wattson-board.workers.dev/duel";
const INIT = tg ? tg.initData : "";
let joinId = Q.get("j");
if (joinId) { try { history.replaceState(null, "", location.pathname + "?ws=" + encodeURIComponent(WS_URL)); } catch (e) {} }

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hap = (k) => { try { if (!tg || !tg.HapticFeedback) return; if (k === "light") tg.HapticFeedback.impactOccurred("light"); else tg.HapticFeedback.notificationOccurred(k); } catch (e) {} };
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ITEM_ORDER = ["smoke", "clock", "shield", "hint"];
const ITEM_EMOJI = { smoke: "💨", clock: "⏱", shield: "🛡", hint: "💡" };

// ------------------------------------------------------------------ состояние
const S = { me: null, stake: parseInt(store.get("wd_stake", "0"), 10) || 0, invite: null, modal: null, pendingChest: null, rematch: null, screen: "" };
let D = null;                 // текущая дуэль
let endTimer = null, countTimers = [];

// ------------------------------------------------------------------ экраны
function show(name) {
  S.screen = name;
  document.querySelectorAll(".screen").forEach((el) => el.classList.toggle("on", el.id === "s-" + name));
  if (tg) {
    try { (name === "battle" || name === "vs") ? tg.enableClosingConfirmation() : tg.disableClosingConfirmation(); } catch (e) {}
  }
}
function toast(text, bad) {
  const el = $("#toast");
  el.textContent = text; el.className = "toast" + (bad ? " bad" : "");
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add("hidden"), 2800);
  if (bad) hap("error");
}
function hue(name) { let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function avatar(name, bot, cls) {
  if (bot) return `<div class="av ${cls || ""}" style="--c:#f28c28"><img src="cat.png" alt=""></div>`;
  return `<div class="av ${cls || ""}" style="--c:hsl(${hue(name)},62%,52%)">${esc(String(name || "?").trim().charAt(0).toUpperCase())}</div>`;
}
function setAv(sel, name, bot, cls) { $(sel).outerHTML = avatar(name, bot, cls).replace('class="av', `id="${sel.slice(1)}" class="av`); }
function leagueText(l, rating) { return `${l.icon} ${l.name} · ${rating}${l.next ? " / " + l.next : ""}`; }
function confetti(parent) {
  const box = document.createElement("div"); box.className = "confetti";
  const cols = ["#ffc531", "#ff5d6c", "#4f9dff", "#35d07f", "#8f66ff", "#fff"];
  for (let i = 0; i < 44; i++) {
    const p = document.createElement("i");
    p.style.cssText = `left:${Math.random() * 100}%;--c:${cols[i % cols.length]};--x:${(Math.random() - .5) * 120}px;--r:${Math.random() * 720}deg;--d:${2 + Math.random() * 2}s;--w:${Math.random() * .6}s`;
    box.appendChild(p);
  }
  parent.appendChild(box); setTimeout(() => box.remove(), 5000);
}
function countTo(el, from, to, ms) {
  const t0 = performance.now();
  (function f(t) { const k = Math.min(1, (t - t0) / ms); el.textContent = Math.round(from + (to - from) * k); if (k < 1) requestAnimationFrame(f); })(t0);
}

// ------------------------------------------------------------------ связь
let ws = null, retryT = null, pingT = null, tries = 0, gaveUp = false;
function setConn(title, text, retry) {
  $("#connTitle").textContent = title; $("#connText").textContent = text || "";
  $("#connBtn").classList.toggle("hidden", !retry);
  show("conn");
}
function net(on) {
  let el = $("#net");
  if (!el) { el = document.createElement("div"); el.id = "net"; el.className = "toast bad"; el.textContent = "📡 Связь потеряна, переподключаемся…"; $("#app").appendChild(el); }
  el.classList.toggle("hidden", !on);
}
function connect() {
  clearTimeout(retryT);
  if (!INIT) return setConn("Открой через Telegram", "Дуэли работают только внутри приложения Telegram — нажми кнопку «⚔️ Дуэли» в боте.");
  try { ws = new WebSocket(WS_URL); } catch (e) { return later(); }
  const mine = ws;
  ws.onopen = () => {
    tries = 0; net(false);
    send({ t: "auth", init: INIT, join: joinId }); joinId = null;
    clearInterval(pingT); pingT = setInterval(() => { try { mine.send("ping"); } catch (e) {} }, 25000);
  };
  ws.onmessage = (e) => { if (e.data === "pong") return; let m; try { m = JSON.parse(e.data); } catch (x) { return; } try { onMsg(m); } catch (err) { console.error(err); } };
  ws.onclose = () => { if (mine !== ws) return; clearInterval(pingT); ws = null; later(); };
  ws.onerror = () => {};
}
function later() {
  if (gaveUp) return;
  tries++;
  if (S.screen === "" || S.screen === "conn") setConn("Подключаемся…", tries > 2 ? "Связь есть не сразу — подожди пару секунд" : "");
  else net(true);
  retryT = setTimeout(connect, Math.min(800 * tries, 5000));
}
function send(m) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; } return false; }
document.addEventListener("visibilitychange", () => { if (!document.hidden && !ws) { tries = 0; connect(); } });
$("#connBtn").onclick = () => { gaveUp = false; tries = 0; connect(); };

// ------------------------------------------------------------------ сообщения от бота
function onMsg(m) {
  switch (m.t) {
    case "offline": try { ws && ws.close(); } catch (e) {} ws = null; if (S.screen === "battle" || S.screen === "vs") net(true); else setConn("Бот сейчас не в сети", "Подожди немного — как только бот вернётся, дуэли заработают сами."); clearTimeout(retryT); retryT = setTimeout(connect, 4000); break;
    case "authfail": gaveUp = true; setConn("Не удалось войти", "Закрой приложение и открой снова кнопкой в боте.", true); break;
    case "unreg": gaveUp = true; setConn("Сначала знакомство", "Напиши боту /start, выбери класс и ник — и возвращайся на дуэли!"); break;
    case "replaced": gaveUp = true; setConn("Открыто в другом окне", "Дуэли открыты на другом устройстве или в другом окне.", true); break;
    case "me": onMe(m); break;
    case "queued": showQueue(m); break;
    case "idle": if (S.screen === "queue") goLobby(); break;
    case "invited": S.invite = m; showInvite(); break;
    case "match": showVS(m); break;
    case "go": startCount(m.ms); break;
    case "round": onRound(m); break;
    case "wrong": onWrong(m); break;
    case "opp": onOpp(m); break;
    case "smoke": startSmoke(m); break;
    case "clock": if (D) { D.deadline -= m.ms; flash(`⏱ ${m.by} украл у тебя ${Math.round(m.ms / 1000)} секунд!`, "warn"); hap("error"); } break;
    case "hint": if (D) { D.hint = m.text; renderStatus(); } break;
    case "toast": toast(m.text, m.bad); break;
    case "inv": onInv(m); break;
    case "score": if (D) { setScore(m.score); } break;
    case "rend": onRend(m); break;
    case "end": onEnd(m); break;
    case "emote": bubble("opp", m.e); break;
    case "opp_gone": if (D) { $(".pl.opp").classList.add("gone"); flash("Соперник вышел из приложения — ждём до минуты", "warn"); } break;
    case "opp_back": if (D) { $(".pl.opp").classList.remove("gone"); flash("Соперник вернулся", "good"); } break;
    case "rematch_wait": S.rematch = "wait"; renderRematch(); break;
    case "rematch_offer": S.rematch = { name: m.name, stake: m.stake }; renderRematch(); hap("light"); toast(`${m.name} просит реванш!`); break;
    case "top": renderTop(m); break;
  }
}

function onMe(m) {
  S.me = m;
  if (m.toast) toast(m.toast.text, m.toast.bad);
  if (m.in_duel) return;                                   // экран выберет снимок дуэли
  if (S.screen === "battle" || S.screen === "vs") { toast("Дуэль уже закончилась, пока тебя не было", true); D = null; }
  if (S.screen === "queue") clearInterval(qTimer);
  if (m.invite && m.invite_links) { S.invite = { id: m.invite.id, stake: m.invite.stake, ...m.invite_links }; if (S.screen === "conn" || S.screen === "") return showInvite(); }
  if (["conn", "", "queue", "battle", "vs"].includes(S.screen) || (S.screen === "invite" && !m.invite)) goLobby();
  else if (S.screen === "lobby") renderLobby();
  if (S.modal && S.modal !== "opening" && S.modal !== "gift") renderModal();
  if (m.opened) revealChest(m.opened);
  if (m.gift) giftModal(m.gift);
}

// ------------------------------------------------------------------ лобби
function goLobby() { S.rematch = null; D = null; closeModal(); renderLobby(); show("lobby"); }
function renderLobby() {
  const me = S.me; if (!me) return;
  $("#lbAv").outerHTML = avatar(me.name, false).replace('class="av', 'id="lbAv" class="av');
  $("#lbName").textContent = me.name;
  $("#lbLeague").textContent = leagueText(me.league, me.rating);
  const lg = me.league, pct = lg.next ? Math.max(4, Math.min(100, (me.rating - lg.lo) / (lg.next - lg.lo) * 100)) : 100;
  $("#lbBar").style.width = pct + "%";
  $("#lbCoins").textContent = "🪙 " + me.coins;
  const st = $("#lbStreak"); st.classList.toggle("hidden", !me.streak); st.textContent = "🔥 " + me.streak;
  if (me.coins < S.stake) S.stake = 0;
  $("#stakes").innerHTML = me.stakes.map((s) => `<button class="stake ${s === S.stake ? "on" : ""}" data-stake="${s}" ${me.coins < s ? "disabled" : ""}>${s ? s + " 🪙" : "Без ставки"}</button>`).join("");
  $("#playHint").textContent = S.stake ? `Ставка ${S.stake} 🪙 с каждого: победитель забирает банк (10% сгорает). Если никого нет — тренировка без ставки.` : "Подберём соперника. Не найдём за 20 секунд — поиграешь с Ваттсоном";
  $("#bag").innerHTML = ITEM_ORDER.map((k) => `<span>${ITEM_EMOJI[k]} ${me.inv[k] || 0}</span>`).join("");
  const n = me.chests.length; const b = $("#chestBadge"); b.classList.toggle("hidden", !n); b.textContent = n;
  const lines = [];
  if (me.first_win) lines.push("🎁 Первая победа дня — золотой сундук!");
  if (me.streak >= 1) lines.push(`🔥 Серия побед: ${me.streak}. Каждая третья подряд — золотой сундук!`);
  if (me.bot_left > 0) lines.push(`😺 За победу над Ваттсоном — монетки (ещё ${me.bot_left} раз сегодня)`);
  $("#dailyHint").innerHTML = lines.map(esc).join("<br>");
}
$("#stakes").onclick = (e) => { const b = e.target.closest("[data-stake]"); if (!b || b.disabled) return; S.stake = +b.dataset.stake; store.set("wd_stake", S.stake); renderLobby(); hap("light"); };
$("#playBtn").onclick = () => { hap("light"); send({ t: "queue", stake: S.stake }); };
$("#trainBtn").onclick = () => send({ t: "train" });
$("#inviteBtn").onclick = () => send({ t: "invite", stake: S.stake });
$("#chestsBtn").onclick = () => openModal("chests");
$("#shopBtn").onclick = () => openModal("shop");
$("#topBtn").onclick = () => { openModal("top"); send({ t: "top" }); };
$("#rulesBtn").onclick = () => openModal("rules");

// ------------------------------------------------------------------ поиск и вызов друга
let qTimer = null;
function showQueue(m) {
  show("queue");
  const t0 = Date.now(); clearInterval(qTimer);
  const upd = () => { const s = Math.floor((Date.now() - t0) / 1000); $("#qText").textContent = `Ждём уже ${s} с · Ваттсон выйдет через ${Math.max(0, m.wait - s)} с` + (m.stake ? " (без ставки)" : ""); };
  upd(); qTimer = setInterval(upd, 500);
}
$("#qCancel").onclick = () => { clearInterval(qTimer); send({ t: "unqueue" }); goLobby(); };
function showInvite() {
  const iv = S.invite; if (!iv) return;
  $("#invLink").textContent = iv.link;
  $("#invText").textContent = "Отправь ссылку другу — дуэль начнётся, как только он зайдёт." + (iv.stake ? ` Ставка: ${iv.stake} 🪙 с каждого.` : "");
  show("invite");
}
$("#invShare").onclick = () => { const u = S.invite && S.invite.share; if (!u) return; if (tg && tg.openTelegramLink) tg.openTelegramLink(u); else window.open(u, "_blank"); };
$("#invCopy").onclick = async () => {
  const link = S.invite && S.invite.link; if (!link) return;
  try { await navigator.clipboard.writeText(link); } catch (e) { const t = document.createElement("textarea"); t.value = link; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); } catch (x) {} t.remove(); }
  toast("Ссылка скопирована");
};
$("#invCancel").onclick = () => { send({ t: "cancel_invite" }); S.invite = null; goLobby(); };

// ------------------------------------------------------------------ «VS» и отсчёт
function newDuel(m) {
  return { did: m.did, you: m.you, opp: m.opp, stake: m.stake, rounds: m.rounds, need: m.need, total: m.seconds, score: [0, 0], round: 0,
           deadline: 0, results: [], inv: null, att: 2, gapUntil: 0, shield: false, ans: "", lockUntil: 0, smoke: null, hint: null,
           roundActive: false, sentAt: 0, rendNext: 0, oppWrong: 0, ended: false };
}
function showVS(m) {
  clearTimeout(endTimer); closeModal();
  const keep = D && D.did === m.did;
  D = keep ? Object.assign(D, { you: m.you, opp: m.opp }) : newDuel(m);
  S.rematch = null;
  const side = (p) => `${avatar(p.name, p.bot, "xl")}<div class="n">${esc(p.name)}</div><div class="l">${p.bot ? "тренер" : esc(p.league.icon + " " + p.league.name + " · " + p.rating)}</div>`;
  $("#vsYou").innerHTML = side(m.you); $("#vsOpp").innerHTML = side(m.opp);
  $("#vsStake").textContent = m.stake ? `Ставка ${m.stake} 🪙 · банк ${2 * m.stake}` : "Без ставки";
  $("#vsCount").textContent = "";
  show("vs"); hap("light");
  buildBattleHeader();
}
function startCount(ms) {
  countTimers.forEach(clearTimeout); countTimers = [];
  const el = $("#vsCount"); let n = Math.max(1, Math.round(ms / 1000));
  const step = () => { el.textContent = n > 0 ? n : "⚔️"; el.classList.remove("tick"); void el.offsetWidth; el.classList.add("tick"); hap("light"); if (n-- > 0) countTimers.push(setTimeout(step, 1000)); };
  step();
}
function buildBattleHeader() {
  setAv("#hYouAv", D.you.name, false, "sm"); setAv("#hOppAv", D.opp.name, D.opp.bot, "sm");
  $("#hYouName").textContent = D.you.name; $("#hOppName").textContent = D.opp.name;
  $(".pl.opp").classList.remove("gone");
  setScore(D.score);
}

// ------------------------------------------------------------------ бой
function setScore(sc) {
  D.score = sc; $("#hYouScore").textContent = sc[0]; $("#hOppScore").textContent = sc[1];
  const pips = []; for (let i = 0; i < D.rounds; i++) pips.push(`<i class="${D.results[i] || ""} ${i === D.round - 1 && D.roundActive ? "cur" : ""}"></i>`);
  $("#pips").innerHTML = pips.join("");
}
function onRound(m) {
  countTimers.forEach(clearTimeout);
  if (!D) D = newDuel({ did: "", you: { name: S.me ? S.me.name : "Ты" }, opp: { name: "Соперник" }, stake: 0, rounds: m.of, need: 2, seconds: 240 });
  D.round = m.n; D.deadline = performance.now() + m.ms; D.roundActive = true; D.ans = ""; D.lockUntil = 0; D.smoke = null; D.hint = null; D.oppWrong = 0;
  while (D.results.length < m.n - 1) D.results.push("");
  D.results.length = m.n - 1;
  $("#roundEnd").classList.add("hidden"); $("#emotes").classList.add("hidden");
  const cw = $("#cardwrap"); cw.className = "cardwrap"; $("#scr").scrollTop = 0;
  $("#taskImg").src = m.img;
  setScore(m.score);
  renderItems(); updateAnswer(); renderStatus();
  show("battle");
  flash(`Раунд ${m.n} из ${m.of}`, "info");
  tick();
}
function canAnswer() { return D && D.roundActive && performance.now() >= D.lockUntil && performance.now() < D.deadline; }
function updateAnswer() {
  const t = $("#ansText"); t.textContent = D && D.ans ? D.ans.replace("-", "−") : "ответ"; t.className = D && D.ans ? "" : "ph";
  const ok = canAnswer(); $("#pad").classList.toggle("off", !ok); $("#answer").classList.toggle("off", !ok);
}
function pressKey(k) {
  if (!canAnswer()) return;
  if (k === "⌫") D.ans = D.ans.slice(0, -1);
  else if (k === "OK") { submitAnswer(); return; }
  else if (D.ans.length < 12) { if (k === "-" && D.ans.length) return; if (k === "," && (D.ans.includes(",") || !D.ans)) { if (!D.ans) D.ans = "0"; else return; } D.ans += k; }
  hap("light"); updateAnswer();
}
function submitAnswer() {
  if (!D.ans || performance.now() - D.sentAt < 700) return;
  D.sentAt = performance.now(); send({ t: "answer", text: D.ans });
  flash("Проверяем…", "info");
}
$("#pad").onclick = (e) => { const b = e.target.closest("[data-k]"); if (b) pressKey(b.dataset.k); };
document.addEventListener("keydown", (e) => {
  if (S.screen !== "battle" || !D) return;
  if (/^[0-9]$/.test(e.key)) pressKey(e.key); else if (e.key === "," || e.key === ".") pressKey(","); else if (e.key === "-") pressKey("-");
  else if (e.key === "Backspace") pressKey("⌫"); else if (e.key === "Enter") pressKey("OK");
});
function onWrong(m) {
  if (!D) return;
  D.lockUntil = performance.now() + m.ms; if (!m.quiet) { D.ans = ""; $("#answer").classList.add("bad"); setTimeout(() => $("#answer").classList.remove("bad"), 450); hap("error"); }
  $("#status").querySelectorAll("[data-f]").forEach((x) => x.remove());
  updateAnswer(); tick();
}
function onOpp(m) {
  if (!D) return;
  if (m.ev === "wrong") { D.oppWrong++; const el = $(".pl.opp"); el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake"); flash("Соперник ошибся 😏", "good"); }
}
function flash(text, cls) {
  const st = $("#status"); const c = document.createElement("span"); c.className = "chip " + (cls || ""); c.textContent = text; c.dataset.f = "1";
  st.querySelectorAll("[data-f]").forEach((x) => x.remove());
  st.appendChild(c); setTimeout(() => c.remove(), 2600);
}
function renderStatus() {
  const st = $("#status"); st.querySelectorAll("[data-h]").forEach((x) => x.remove());
  if (D && D.hint) { const c = document.createElement("span"); c.className = "chip info"; c.dataset.h = "1"; c.textContent = "💡 " + D.hint; st.prepend(c); }
}
function renderItems() {
  if (!D) return;
  const inv = D.inv || (S.me && S.me.inv) || {}, now = performance.now();
  const att = (k) => (k === "smoke" || k === "clock");
  const html = ITEM_ORDER.map((k) => {
    const n = inv[k] || 0;
    const cls = (n ? "" : "empty ") + (att(k) && (D.att <= 0 || D.gapUntil > now) ? "cd " : "") + (k === "shield" && D.shield ? "on" : "");
    return `<button class="it ${cls}" data-item="${k}">${ITEM_EMOJI[k]}<small>${n}</small></button>`;
  }).join("") + `<button class="it" data-act="emote">😼</button><button class="it" data-act="quit">🏳️</button>`;
  $("#items").innerHTML = html;
}
function onInv(m) {
  if (!D) { if (S.me) { S.me.inv = m.inv; S.me.coins = m.coins; } return; }
  D.inv = m.inv; D.att = m.att; D.shield = m.shield; D.gapUntil = performance.now() + (m.gap || 0);
  renderItems();
  if (m.gap) setTimeout(renderItems, m.gap + 50);
}
$("#items").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.item) { send({ t: "item", item: b.dataset.item }); hap("light"); }
  else if (b.dataset.act === "quit") send({ t: "quit" });
  else if (b.dataset.act === "emote") {
    const box = $("#emotes");
    if (box.classList.contains("hidden")) { box.innerHTML = ((S.me && S.me.emotes) || ["😼", "🔥", "😱", "👏", "🤔", "😂"]).map((x) => `<button data-e="${x}">${x}</button>`).join(""); box.classList.remove("hidden"); }
    else box.classList.add("hidden");
  }
};
$("#emotes").onclick = (e) => { const b = e.target.closest("[data-e]"); if (!b) return; send({ t: "emote", e: b.dataset.e }); bubble("you", b.dataset.e); $("#emotes").classList.add("hidden"); };
function bubble(who, e) {
  const el = $(`.pl.${who} .bubble`); if (!el) return;
  el.textContent = e; el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 2500);      // иначе при возврате на экран эмоция «проигралась» бы снова
  if (who === "opp") hap("light");
}

// таймер, пауза после ошибки, дым, обратный отсчёт до следующего раунда
function tick() {
  if (S.screen !== "battle" || !D) return;
  const now = performance.now();
  if (D.roundActive) {
    const rem = Math.max(0, (D.deadline - now) / 1000);
    $("#timer").textContent = `${Math.floor(rem / 60)}:${String(Math.floor(rem % 60)).padStart(2, "0")}`;
    $("#timer").classList.toggle("low", rem < 30); $(".tbar").classList.toggle("low", rem < 30);
    $("#tbar").style.transform = `scaleX(${Math.min(1, rem / D.total)})`;
    const locked = now < D.lockUntil, lm = $("#lockMask");
    lm.classList.toggle("hidden", !(locked || rem <= 0));
    $("#lockText").textContent = rem <= 0 ? "⏰ Твоё время вышло — ждём соперника" : `❌ Неверно! Подожди ${Math.ceil((D.lockUntil - now) / 1000)} с`;
    updateAnswer();
    if (D.smoke) smokeStep(now);
  } else $("#lockMask").classList.add("hidden");
  const rn = $("#rNext"); if (rn) rn.textContent = Math.max(0, Math.ceil((D.rendNext - now) / 1000));
}
setInterval(tick, 250);

// 💨 дымовая шашка: условие перемешано (по зерну от бота), поверх дым; через стадии становится читаемее
function mulberry(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function startSmoke(m) {
  if (!D) return;
  D.smoke = { start: performance.now() - (m.total - m.ms), total: m.total, seed: m.seed, stage: -1 };
  flash(`💨 ${m.by || "Соперник"} бросил дымовую шашку!`, "warn"); hap("error");
  smokeStep(performance.now());
}
function smokeStep(now) {
  const s = D.smoke, el = (now - s.start) / s.total, cw = $("#cardwrap");
  if (el >= 1) { D.smoke = null; cw.classList.remove("smoking"); cw.classList.add("fade"); setTimeout(() => cw.classList.remove("fade"), 900); flash("🌬 Дым рассеялся", "good"); return; }
  const stage = el >= 0.83 ? 2 : el >= 0.5 ? 1 : 0;
  cw.classList.add("smoking"); cw.classList.remove("fade");
  if (stage !== s.stage) { s.stage = stage; drawSmoke(stage, s.seed); }
}
function drawSmoke(stage, seed) {
  const img = $("#taskImg"), cv = $("#smokeCv");
  if (!img.naturalWidth) { img.onload = () => D && D.smoke && drawSmoke(stage, seed); return; }
  const w = Math.min(img.naturalWidth, 900), h = Math.round(img.naturalHeight * w / img.naturalWidth);
  cv.width = w; cv.height = h; const ctx = cv.getContext("2d"), rnd = mulberry(seed);
  const cols = 3, rows = 4, n = cols * rows, order = [...Array(n).keys()];
  if (stage === 0) { for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } }
  else if (stage === 1) { for (let k = 0; k < 3; k++) { const i = Math.floor(rnd() * n); let j = Math.floor(rnd() * n); if (j === i) j = (j + 1) % n; [order[i], order[j]] = [order[j], order[i]]; } }
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  const tw = w / cols, th = h / rows, sw = img.naturalWidth / cols, sh = img.naturalHeight / rows;
  for (let d = 0; d < n; d++) { const s = order[d]; ctx.drawImage(img, (s % cols) * sw, Math.floor(s / cols) * sh, sw, sh, (d % cols) * tw, Math.floor(d / cols) * th, tw + 1, th + 1); }
  const alpha = [0.62, 0.45, 0.27][stage], clouds = [9, 7, 5][stage];
  for (let i = 0; i < clouds; i++) {
    const rx = w * (0.12 + rnd() * 0.25), ry = h * (0.1 + rnd() * 0.22), cx = rnd() * w, cy = rnd() * h;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx); g.addColorStop(0, `rgba(110,110,125,${alpha})`); g.addColorStop(1, "rgba(110,110,125,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  cv.style.filter = `blur(${[3, 2, 1][stage]}px)`;
}

// итог раунда
function onRend(m) {
  if (!D) return;
  D.roundActive = false; D.smoke = null; $("#cardwrap").classList.remove("smoking");
  D.results[m.n - 1] = m.winner === "you" ? "w" : m.winner === "opp" ? "l" : "d";
  setScore(m.score); D.rendNext = performance.now() + (m.next || 0);
  const w = m.winner, last = Math.max(...m.score) >= D.need;
  $("#rCard").innerHTML = `<div class="big ${w}">${w === "you" ? "🏆 Ты первый!" : w === "opp" ? "😿 Соперник раньше" : "⏰ Время вышло"}</div>
    <div class="sc">${m.score[0]} : ${m.score[1]}</div><div class="ans">Верный ответ: <b>${esc(m.answer)}</b></div>
    ${last ? "" : `<div class="muted">Следующий раунд через <b id="rNext">${Math.ceil((m.next || 0) / 1000)}</b> с</div>`}`;
  $("#roundEnd").classList.remove("hidden"); $("#emotes").classList.add("hidden");
  if (w === "you") { hap("success"); confetti($("#s-battle")); } else hap("error");
}

// ------------------------------------------------------------------ итог дуэли
function onEnd(m) {
  clearTimeout(endTimer);
  const go = () => { showResult(m); };
  endTimer = setTimeout(go, S.screen === "battle" && !$("#roundEnd").classList.contains("hidden") ? 2600 : 300);
  if (D) { D.ended = true; D.roundActive = false; }
}
function showResult(m) {
  const sc = $("#s-result"), r = m.result;
  const title = { win: "ПОБЕДА!", loss: "Поражение", draw: "Ничья", void: "Не засчитана" }[r] || "Конец";
  const sub = r === "void" ? esc(m.why || "") : m.why === "opp_quit" ? "Соперник сдался" : m.why === "me_quit" ? "Ты сдался" : `против ${esc(m.opp)}`;
  let rows = "";
  if (m.rating) {
    const d = m.rating.new - m.rating.old, up = m.rating.league_new.name !== m.rating.league_old.name;
    rows += `<div class="stat"><span>⭐ Рейтинг</span><b><span id="rNow">${m.rating.old}</span> <span class="${d >= 0 ? "up" : "down"}">${d >= 0 ? "+" : "−"}${Math.abs(d)}</span></b></div>`;
    if (up) rows += `<div class="stat"><span>${d > 0 ? "🎉 Новая лига!" : "Лига изменилась"}</span><b>${esc(m.rating.league_new.icon + " " + m.rating.league_new.name)}</b></div>`;
  }
  if (m.coins && m.coins.delta) rows += `<div class="stat"><span>🪙 Монетки</span><b class="${m.coins.delta > 0 ? "up" : "down"}">${m.coins.delta > 0 ? "+" : "−"}${Math.abs(m.coins.delta)}</b></div>`;
  if (r === "win" && m.streak >= 2) rows += `<div class="stat"><span>🔥 Серия побед</span><b>${m.streak}</b></div>`;
  if (m.note) rows += `<p class="hint">${esc(m.note)}</p>`;
  if (m.chest) {
    const g = m.chest.kind === "gold";
    rows += `<div class="chestDrop"><span class="ico">${g ? "🎁" : "📦"}</span><div class="grow"><b>${g ? "Золотой сундук!" : "Сундучок!"}</b><br><small>${m.chest.first ? "Первая победа дня" : m.chest.streak_bonus ? "Три победы подряд" : "За победу в дуэли"}</small></div><button class="btn gold" data-open="${m.chest.id}">Открыть</button></div>`;
  }
  if (m.chest_note) rows += `<p class="hint">${esc(m.chest_note)}</p>`;
  sc.innerHTML = `<div class="banner ${r}">${title}</div><div class="muted">${sub}</div>
    ${r === "void" ? "" : `<div class="big">${m.score[0]} : ${m.score[1]}</div>`}<div class="cardrow">${rows}</div>
    <div class="btns">${m.can_rematch ? `<button class="btn red" id="rematchBtn">🔁 Реванш</button>` : ""}<button class="btn ghost" id="toLobby">В лобби</button></div>`;
  S.rematch = null; renderRematch();
  show("result");
  if (r === "win") { confetti(sc); hap("success"); } else hap(r === "loss" ? "error" : "light");
  if (m.rating) countTo($("#rNow"), m.rating.old, m.rating.new, 900);
  if (S.me) { S.me.coins = m.coins ? m.coins.total : S.me.coins; }
  tg && tg.disableClosingConfirmation && tg.disableClosingConfirmation();
}
function renderRematch() {
  const b = $("#rematchBtn"); if (!b) return;
  const r = S.rematch;
  b.disabled = r === "wait";
  b.textContent = r === "wait" ? "Ждём ответа…" : r ? `⚔️ Принять реванш от ${r.name}` : "🔁 Реванш";
  b.classList.toggle("pulse", !!r && r !== "wait");
}
$("#s-result").onclick = (e) => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.id === "toLobby") { send({ t: "me" }); goLobby(); }
  else if (t.id === "rematchBtn") send({ t: "rematch" });
  else if (t.dataset.open) { S.pendingChest = true; openChest(+t.dataset.open, t.closest(".chestDrop").querySelector("b").textContent.includes("Золот") ? "gold" : "wood"); t.closest(".chestDrop").remove(); }
};

// ------------------------------------------------------------------ окна: сундуки, магазин, топ, правила
function openModal(name) { S.modal = name; renderModal(); $("#modal").classList.remove("hidden"); }
function closeModal() { S.modal = null; $("#modal").classList.add("hidden"); }
$("#modal").onclick = (e) => { if (e.target.id === "modal" || e.target.closest(".x")) closeModal(); };
function sheet(title, body) { $("#sheet").innerHTML = `<h2><span>${title}</span><button class="x">✕</button></h2>${body}`; }
function renderModal() {
  const me = S.me; if (!me) return;
  if (S.modal === "shop") {
    sheet("🛒 Магазин", `<p>У тебя 🪙 <b>${me.coins}</b>. Предметы тратятся в дуэлях.</p>` + me.shop.map((it) =>
      `<div class="shopRow"><span class="ico">${it.emoji}</span><div class="t"><b>${esc(it.name)}</b><small>В рюкзаке: ${me.inv[it.key] || 0}. ${esc(it.desc)}</small></div>
       <button class="btn gold" data-buy="${it.key}" ${me.coins < it.price ? "disabled" : ""}>${it.price} 🪙</button></div>`).join("") +
      `<p class="hint">Монетки зарабатываются решением задач в боте и на общей доске, а ещё — сундуками за победы.</p>`);
  } else if (S.modal === "chests") {
    const ch = me.chests;
    sheet("🎁 Сундуки", ch.length ? `<div class="chestGrid">${ch.map((c) => `<div class="chestCell ${c.kind}" data-chest="${c.id}" data-kind="${c.kind}"><span class="ico">${c.kind === "gold" ? "🎁" : "📦"}</span><b>${c.kind === "gold" ? "Золотой" : "Обычный"}</b></div>`).join("")}</div><p class="hint">Нажми на сундук, чтобы открыть.</p>`
      : `<div class="empty">Сундуков пока нет.<br>Побеждай в дуэлях — за победу над человеком дают сундук!</div>`);
    $("#sheet").insertAdjacentHTML("beforeend", `<p class="hint">Сегодня можно получить ещё сундуков: ${me.chests_left}. ${me.first_win ? "Первая победа дня — золотой сундук!" : ""}</p>`);
  } else if (S.modal === "rules") {
    sheet("❓ Как играть", `<ol class="rules"><li>Вам с соперником дают <b>одну задачу из банка ФИПИ</b>. Кто первым введёт верный ответ — берёт раунд.</li><li>Всего 3 раунда, для победы нужно выиграть <b>два</b>.</li><li>Ошиблся — пауза 8 секунд.</li>
      <li><b>Предметы</b>: 💨 дымовая шашка перемешивает условие у соперника, ⏱ часики отнимают у него 15 секунд, 🛡 щит гасит атаку, 💡 подсказка даёт «коридор» для ответа. В дуэли не больше 2 атак.</li>
      <li>Победа над человеком меняет <b>рейтинг</b> и приносит <b>сундук</b> (до 5 в день). Первая победа дня и каждая третья подряд — золотой сундук.</li>
      <li>Ставка: победитель забирает банк, 10% сгорает. Дуэль, брошенную до конца первого раунда, не засчитываем.</li><li>Ваттсон — тренер: рейтинг не меняется, но за победу дают монетки.</li></ol>`);
  } else if (S.modal === "top") {
    sheet("🏆 Лучшие дуэлянты", `<div id="topBody" class="empty">Загружаем…</div>`);
  }
}
$("#sheet").onclick = (e) => {
  const buy = e.target.closest("[data-buy]"); if (buy) { send({ t: "buy", item: buy.dataset.buy }); hap("light"); return; }
  const ch = e.target.closest("[data-chest]"); if (ch) openChest(+ch.dataset.chest, ch.dataset.kind);
  if (e.target.closest("[data-close]")) closeModal();
};
function renderTop(m) {
  if (S.modal !== "top") return;
  const body = $("#topBody"); if (!body) return;
  body.className = "";
  body.innerHTML = m.top.length ? m.top.map((r, i) => `<div class="topRow ${r.me ? "me" : ""}"><span class="rk">${i + 1}</span>${avatar(r.name, false, "sm")}<span class="tn">${esc(r.name)}</span><span>${r.icon} <b>${r.rating}</b></span></div>`).join("")
    + `<p class="hint">${m.place ? `Ты на ${m.place} месте из ${m.total}` : "Сыграй первую дуэль с человеком — и попадёшь в таблицу!"}</p>` : `<div class="empty">Пока никто не сыграл. Будь первым!</div>`;
}
function openChest(id, kind) {
  S.modal = "opening"; $("#modal").classList.remove("hidden");
  sheet("", `<div class="openAnim"><div class="box shake">${kind === "gold" ? "🎁" : "📦"}</div><p>Открываем…</p></div>`);
  S.pendingChest = { t0: Date.now() };
  send({ t: "chest", id });
}
async function revealChest(res) {
  const wait = S.pendingChest ? Math.max(0, 900 - (Date.now() - S.pendingChest.t0)) : 0;
  await sleep(wait); S.pendingChest = null;
  const loot = [];
  if (res.coins) loot.push(`<span>🪙 +${res.coins}</span>`);
  (res.items || []).forEach((k) => loot.push(`<span>${ITEM_EMOJI[k] || "🎁"} +1</span>`));
  S.modal = "opening"; $("#modal").classList.remove("hidden");
  sheet("", `<div class="openAnim"><div class="box">${res.kind === "gold" ? "✨" : "🎉"}</div><div class="loot">${loot.join("")}</div><button class="btn gold" data-close="1">Круто!</button></div>`);
  hap("success"); confetti($("#modal"));
}
function giftModal(g) {
  S.modal = "gift";
  sheet("🎁 Стартовый набор", `<p>Добро пожаловать на дуэли! Мы положили тебе в рюкзак: ${Object.keys(g).map((k) => `${ITEM_EMOJI[k]} ×${g[k]}`).join(", ")}.</p><button class="btn gold" data-close="1">Поехали!</button>`);
  $("#modal").classList.remove("hidden");
}

connect();
