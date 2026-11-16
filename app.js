// Объект Telegram Mini App. Внутри Telegram он есть, в обычном браузере — почти пустой.
const tg = window.Telegram ? window.Telegram.WebApp : null;
const inTelegram = Boolean(tg && tg.initData);

if (tg) {
  tg.ready();   // сообщаем Telegram, что страница загрузилась
  tg.expand();  // раскрываем приложение на весь экран
}

// Имя пользователя, который открыл приложение
const user = inTelegram ? tg.initDataUnsafe.user : null;
document.getElementById("hello").textContent =
  user ? `Привет, ${user.first_name}!` : "Привет!";

if (!inTelegram) {
  document.getElementById("outside").classList.remove("hidden");
}

// Простой счётчик нажатий
let count = 0;
document.getElementById("btn").addEventListener("click", () => {
  count += 1;
  document.getElementById("count").textContent = count;
  // лёгкая вибрация телефона (работает только в Telegram)
  if (inTelegram && tg.HapticFeedback) tg.HapticFeedback.impactOccurred("light");
});
