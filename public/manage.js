import {
  capabilityFromHash,
  clear,
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
const organizer = capabilityFromHash();
let data;

const headers = () => jsonHeaders({ "x-relay-goyomi-organizer": organizer });
const load = async () => {
  if (!organizer) throw new Error("not_found");
  data = await fetchJson(`/api/calendars/${slug}/manage`, { headers: headers() });
  render();
  status.hidden = true;
  content.hidden = false;
  markVisit("returned", data.calendarId);
};

const makeUrlCard = (kind, label, note, value) => {
  const card = el("article", `url-card ${kind}`);
  card.append(el("b", "", label), el("small", "", note));
  const row = el("div", "copy-row");
  const input = el("input");
  input.readOnly = true;
  input.value = value;
  const copy = el("button", "", "コピー");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(input.value);
    copy.textContent = "コピー済み";
  });
  row.append(input, copy);
  card.append(row);
  return card;
};

const render = () => {
  clear(content);
  const urls = el("div", "manage-urls");
  urls.append(makeUrlCard("public-url", "公開URL", "読む人へ", data.publicUrl));
  const inviteNotice = el(
    "p",
    "notice",
    "参加鍵は作成時の参加URLだけに含まれます。保存したURLを仲間へ共有してください。",
  );
  const editSection = el("section", "manage-card");
  editSection.append(el("p", "section-kicker", "CALENDAR DETAILS"), el("h2", "", "案内を整える"));
  const form = el("form", "calendar-form");
  const titleLabel = el("label", "span-two");
  titleLabel.append(el("span", "", "リレー名"));
  const titleInput = el("input");
  titleInput.name = "title";
  titleInput.required = true;
  titleInput.maxLength = 80;
  titleInput.value = data.calendar.title;
  titleLabel.append(titleInput);
  const themeLabel = el("label");
  themeLabel.append(el("span", "", "リボン"));
  const theme = el("select");
  theme.name = "theme";
  for (const [value, label] of [
    ["berry", "木苺"],
    ["forest", "森"],
    ["ink", "青墨"],
    ["sun", "陽だまり"],
  ]) {
    const option = el("option", "", label);
    option.value = value;
    option.selected = value === data.calendar.theme;
    theme.append(option);
  }
  themeLabel.append(theme);
  const descriptionLabel = el("label", "span-two");
  descriptionLabel.append(el("span", "", "案内"));
  const description = el("textarea");
  description.name = "description";
  description.maxLength = 500;
  description.rows = 4;
  description.value = data.calendar.description;
  descriptionLabel.append(description);
  const formState = el("p", "form-state span-two");
  formState.setAttribute("aria-live", "polite");
  const actions = el("div", "form-actions span-two");
  const save = el("button", "primary-button", "変更を公開する");
  save.type = "submit";
  actions.append(save);
  form.append(titleLabel, themeLabel, descriptionLabel, formState, actions);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    formState.textContent = "案内を更新しています…";
    const values = new FormData(form);
    try {
      await fetchJson(`/api/calendars/${slug}`, {
        body: JSON.stringify({
          description: String(values.get("description") || "").trim(),
          theme: String(values.get("theme") || ""),
          title: String(values.get("title") || "").trim(),
        }),
        headers: headers(),
        method: "PUT",
      });
      formState.textContent = "公開ページへ反映しました。";
      data = await fetchJson(`/api/calendars/${slug}/manage`, { headers: headers() });
      renderSlots();
    } catch (error) {
      formState.textContent = errorText(error.message);
    }
  });
  editSection.append(form);
  const slotSection = el("section", "manage-card");
  slotSection.dataset.slotSection = "";
  const danger = el("section", "danger-zone");
  const dangerCopy = el("div");
  dangerCopy.append(
    el("strong", "", "リレーを削除"),
    el("span", "", "予約枠を含めて削除し、元に戻せません。"),
  );
  const remove = el("button", "danger-button", "削除する");
  remove.type = "button";
  remove.addEventListener("click", deleteCalendar);
  danger.append(dangerCopy, remove);
  content.append(urls, inviteNotice, editSection, slotSection, danger);
  renderSlots();
};

const renderSlots = () => {
  const section = content.querySelector("[data-slot-section]");
  clear(section);
  section.append(el("p", "section-kicker", "DATE CARDS"), el("h2", "", "日付札を見守る"));
  const grid = el("div", `slot-grid compact theme-${data.calendar.theme}`);
  const slots = new Map(data.slots.map((slot) => [slot.slotDate, slot]));
  for (const date of dateRange(data.calendar.startDate, data.calendar.endDate)) {
    const slot = slots.get(date);
    let action = null;
    if (slot) {
      action = el("button", "release-button", "枠を解放");
      action.type = "button";
      action.addEventListener("click", () => releaseSlot(slot.id));
    }
    grid.append(makeSlotCard(date, slot, action));
  }
  section.append(grid);
};

const releaseSlot = async (id) => {
  if (!confirm("この予約を取り消して、日付を空きに戻しますか？")) return;
  try {
    await fetchJson(`/api/calendars/${slug}/slots/${id}`, { headers: headers(), method: "DELETE" });
    data = await fetchJson(`/api/calendars/${slug}/manage`, { headers: headers() });
    renderSlots();
  } catch (error) {
    status.hidden = false;
    status.textContent = errorText(error.message);
  }
};

const deleteCalendar = async () => {
  if (!confirm("リレーとすべての予約を削除します。元に戻せません。続けますか？")) return;
  try {
    await fetchJson(`/api/calendars/${slug}`, { headers: headers(), method: "DELETE" });
    clear(content);
    content.append(el("section", "reservation-result", "リレーを削除しました。"));
  } catch (error) {
    status.hidden = false;
    status.textContent = errorText(error.message);
  }
};

load().catch((error) => {
  status.textContent = errorText(error.message);
  status.classList.add("error");
});
