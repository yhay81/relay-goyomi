import {
  capabilityFromHash,
  clear,
  copyInput,
  dateRange,
  el,
  errorText,
  fetchJson,
  jsonHeaders,
  makeSlotCard,
  markVisit,
} from "/common.js";

const root = document.querySelector("[data-root]");
const status = root.querySelector("[data-status]");
const content = root.querySelector("[data-content]");
const slug = root.dataset.value;
const invite = capabilityFromHash();
let calendarData;

const load = async () => {
  if (!invite) throw new Error("not_found");
  calendarData = await fetchJson(`/api/calendars/${slug}/public`);
  render();
  status.hidden = true;
  content.hidden = false;
  markVisit("join_opened", calendarData.calendarId);
};

const render = () => {
  clear(content);
  const heading = el("header", "workspace-heading");
  heading.append(
    el("p", "section-kicker", "CHOOSE A DATE"),
    el("h2", "", calendarData.calendar.title),
  );
  if (calendarData.calendar.description)
    heading.append(el("p", "", calendarData.calendar.description));
  const grid = el("div", `slot-grid theme-${calendarData.calendar.theme}`);
  const slots = new Map(calendarData.slots.map((slot) => [slot.slotDate, slot]));
  for (const date of dateRange(calendarData.calendar.startDate, calendarData.calendar.endDate)) {
    const slot = slots.get(date);
    const button = slot ? null : el("button", "choose-button", "この日に書く");
    if (button) {
      button.type = "button";
      button.addEventListener("click", () => showReservation(date));
    }
    grid.append(makeSlotCard(date, slot, button));
  }
  content.append(heading, grid);
};

const showReservation = (date) => {
  const panel = el("section", "reservation-panel");
  const title = el("h2", "", "日付札を予約する");
  const note = el("p", "", `${date} の枠です。記事URLは公開後に追加できます。`);
  const form = el("form", "slot-form");
  const fields = [
    ["displayName", "表示名", "山田", 40, "text"],
    ["articleTitle", "予定題", "今年つくった小さな道具", 80, "text"],
    ["articleUrl", "記事URL（後でも可）", "https://example.com/article", 500, "url"],
  ];
  for (const [name, labelText, placeholder, maxLength, type] of fields) {
    const label = el("label");
    label.append(el("span", "", labelText));
    const input = el("input");
    input.name = name;
    input.type = type;
    input.maxLength = maxLength;
    input.placeholder = placeholder;
    if (name !== "articleUrl") input.required = true;
    label.append(input);
    form.append(label);
  }
  const formState = el("p", "form-state");
  formState.setAttribute("aria-live", "polite");
  const actions = el("div", "form-actions");
  const cancel = el("button", "quiet-button", "戻る");
  cancel.type = "button";
  cancel.addEventListener("click", render);
  const submit = el("button", "primary-button", "予約する");
  submit.type = "submit";
  actions.append(cancel, submit);
  form.append(formState, actions);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    formState.textContent = "日付札を留めています…";
    const data = new FormData(form);
    try {
      const result = await fetchJson(`/api/calendars/${slug}/slots`, {
        body: JSON.stringify({
          articleTitle: String(data.get("articleTitle") || "").trim(),
          articleUrl: String(data.get("articleUrl") || "").trim(),
          displayName: String(data.get("displayName") || "").trim(),
          slotDate: date,
        }),
        headers: jsonHeaders({ "x-relay-goyomi-invite": invite }),
        method: "POST",
      });
      showResult(result.editUrl);
    } catch (error) {
      formState.textContent = errorText(error.message);
    }
  });
  panel.append(title, note, form);
  clear(content);
  content.append(panel);
};

const showResult = (editUrl) => {
  const panel = el("section", "reservation-result");
  panel.append(
    el("div", "result-date-card", "予約"),
    el("p", "section-kicker", "YOUR DATE IS HELD"),
    el("h2", "", "日付札を予約しました"),
  );
  panel.append(
    el(
      "p",
      "",
      "枠編集URLは、記事URLの追加や予約取消に使います。再発行できないため保存してください。",
    ),
  );
  const label = el("label");
  label.append(el("span", "", "枠編集URL"));
  const row = el("div", "copy-row");
  const input = el("input");
  input.readOnly = true;
  input.value = editUrl;
  const copy = el("button", "", "コピー");
  copy.type = "button";
  copy.addEventListener("click", () => void copyInput(input, copy));
  row.append(input, copy);
  label.append(row);
  const actions = el("div", "result-actions");
  const edit = el("a", "primary-button", "枠編集画面へ");
  edit.href = editUrl;
  const publicLink = el("a", "quiet-button", "公開ページを見る");
  publicLink.href = `/c/${slug}`;
  actions.append(publicLink, edit);
  panel.append(
    label,
    el("p", "key-warning", "このURLを失くすと、記事の追加や予約取消ができません。"),
    actions,
  );
  clear(content);
  content.append(panel);
};

load().catch((error) => {
  status.textContent = errorText(error.message);
  status.classList.add("error");
});
