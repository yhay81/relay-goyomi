import { copyInput, errorText, fetchJson, jsonHeaders, markVisit } from "/common.js";

const form = document.querySelector("[data-calendar-form]");
const state = form.querySelector("[data-form-state]");
const dialog = document.querySelector("[data-result-dialog]");
const startInput = form.elements.startDate;
const endInput = form.elements.endDate;

const nextRelayDates = () => {
  const now = new Date();
  const year =
    now.getUTCMonth() >= 11 && now.getUTCDate() > 1
      ? now.getUTCFullYear() + 1
      : now.getUTCFullYear();
  return [`${year}-12-01`, `${year}-12-25`];
};

const [defaultStart, defaultEnd] = nextRelayDates();
startInput.value = defaultStart;
endInput.value = defaultEnd;
startInput.min = new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10);
startInput.max = new Date(Date.now() + 366 * 86400000).toISOString().slice(0, 10);
endInput.min = startInput.min;
endInput.max = new Date(Date.now() + 397 * 86400000).toISOString().slice(0, 10);

startInput.addEventListener("change", () => {
  const start = Date.parse(`${startInput.value}T00:00:00Z`);
  if (!Number.isFinite(start)) return;
  endInput.min = new Date(start + 6 * 86400000).toISOString().slice(0, 10);
  endInput.max = new Date(start + 30 * 86400000).toISOString().slice(0, 10);
  const end = Date.parse(`${endInput.value}T00:00:00Z`);
  if (end < start + 6 * 86400000 || end > start + 30 * 86400000) {
    endInput.value = new Date(start + 24 * 86400000).toISOString().slice(0, 10);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  state.textContent = "日付札を並べています…";
  const data = new FormData(form);
  const input = {
    description: String(data.get("description") || "").trim(),
    endDate: String(data.get("endDate") || ""),
    startDate: String(data.get("startDate") || ""),
    theme: String(data.get("theme") || ""),
    title: String(data.get("title") || "").trim(),
  };
  try {
    const result = await fetchJson("/api/calendars", {
      body: JSON.stringify(input),
      headers: jsonHeaders(),
      method: "POST",
    });
    const values = {
      invite: result.inviteUrl,
      organizer: result.organizerUrl,
      public: result.publicUrl,
    };
    for (const [kind, value] of Object.entries(values)) {
      dialog.querySelector(`[data-${kind}-url]`).value = value;
    }
    dialog.querySelector("[data-open-public]").href = result.publicUrl;
    dialog.querySelector("[data-open-organizer]").href = result.organizerUrl;
    state.textContent = "";
    dialog.showModal();
  } catch (error) {
    state.textContent = errorText(error.message);
  }
});

for (const button of dialog.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", () => {
    const input = dialog.querySelector(`[data-${button.dataset.copy}-url]`);
    void copyInput(input, button);
  });
}

dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");
markVisit();
