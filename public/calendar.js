import { jsonHeaders, markVisit, sendEvent } from "/common.js";

const root = document.querySelector("[data-public-root]");
const calendarId = root.dataset.calendarId;
const slug = root.dataset.slug;

for (const link of root.querySelectorAll("[data-outbound]")) {
  link.addEventListener("click", () => void sendEvent("outbound_opened", calendarId));
}

const reportForm = root.querySelector("[data-report-form]");
reportForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const state = reportForm.querySelector("[data-report-state]");
  state.textContent = "報告を送っています…";
  const reason = String(new FormData(reportForm).get("reason") || "");
  try {
    const response = await fetch(`/api/calendars/${slug}/report`, {
      body: JSON.stringify({ reason }),
      headers: jsonHeaders(),
      method: "POST",
    });
    if (!response.ok) throw new Error();
    state.textContent = "報告を受け付けました。";
    reportForm.querySelector("button").disabled = true;
  } catch {
    state.textContent = "報告を送れませんでした。時間を置いてお試しください。";
  }
});

markVisit("calendar_opened", calendarId);
