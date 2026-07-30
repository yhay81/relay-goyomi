const storageKey = "relay-goyomi-session";
const visitKey = "relay-goyomi-visited";

const fallbackUuid = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const sessionId = (() => {
  const saved = localStorage.getItem(storageKey);
  if (saved) return saved;
  const created = crypto.randomUUID ? crypto.randomUUID() : fallbackUuid();
  localStorage.setItem(storageKey, created);
  return created;
})();

export const isQa = new URLSearchParams(location.search).get("qa") === "1";

export const jsonHeaders = (extra = {}) => ({
  "content-type": "application/json",
  "x-relay-goyomi-session": sessionId,
  ...(isQa ? { "x-relay-goyomi-qa": "1" } : {}),
  ...extra,
});

export const capabilityFromHash = () => {
  const capability = location.hash.slice(1);
  return /^[A-Za-z0-9_-]{43}$/.test(capability) ? capability : "";
};

export const el = (tag, className = "", text = "") => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
};

export const clear = (element) => {
  while (element.firstChild) element.firstChild.remove();
};

export const formatDate = (value) =>
  new Intl.DateTimeFormat("ja-JP", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    weekday: "short",
  }).format(new Date(`${value}T00:00:00Z`));

export const sendEvent = (name, calendarId = "") =>
  fetch("/api/events", {
    body: JSON.stringify({ calendarId, name }),
    headers: jsonHeaders(),
    method: "POST",
  }).catch(() => undefined);

export const markVisit = (name = "visited", calendarId = "") => {
  void sendEvent(name, calendarId);
  if (localStorage.getItem(visitKey)) void sendEvent("returned", calendarId);
  localStorage.setItem(visitKey, new Date().toISOString().slice(0, 10));
};

export const copyInput = async (input, button) => {
  await navigator.clipboard.writeText(input.value);
  const prior = button.textContent;
  button.textContent = "コピー済み";
  setTimeout(() => {
    button.textContent = prior;
  }, 1500);
};

export const errorText = (code) =>
  ({
    daily_limit: "今日は3件まで作れます。続きは明日お試しください。",
    invalid_calendar: "入力を確かめてください。期間は7〜31日、URLや連絡先は案内欄に書けません。",
    invalid_date: "この日付はリレー期間の外です。",
    invalid_slot: "表示名、予定題、記事URLを確かめてください。",
    not_found: "専用URLの鍵が一致しないか、すでに削除されています。",
    slot_taken: "その日は先に予約されました。別の日を選んでください。",
  })[code] || "うまく保存できませんでした。少し待ってもう一度お試しください。";

export const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "request_failed");
  return data;
};

export const makeSlotCard = (date, slot, action) => {
  const state = slot?.articleUrl ? "published" : slot ? "reserved" : "open";
  const card = el("article", `slot-card ${state}`);
  const dateBlock = el("div", "slot-date");
  dateBlock.append(el("small", "", date), el("strong", "", formatDate(date)));
  const copy = el("div", "slot-card-copy");
  copy.append(
    el("b", "", state === "published" ? "公開" : state === "reserved" ? "予約" : "空き"),
    el("strong", "", slot?.articleTitle || "次の書き手を待っています"),
    el("span", "", slot?.displayName || "この日を選べます"),
  );
  card.append(dateBlock, copy);
  if (action) card.append(action);
  return card;
};

export const dateRange = (startDate, endDate) => {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const output = [];
  for (let value = start; value <= end; value += 86400000) {
    output.push(new Date(value).toISOString().slice(0, 10));
  }
  return output;
};
