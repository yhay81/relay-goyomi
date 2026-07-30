import {
  capabilityFromHash,
  clear,
  el,
  errorText,
  fetchJson,
  jsonHeaders,
  markVisit,
} from "/common.js";

const root = document.querySelector("[data-root]");
const status = root.querySelector("[data-status]");
const content = root.querySelector("[data-content]");
const id = root.dataset.value;
const entry = capabilityFromHash();
let data;
const headers = () => jsonHeaders({ "x-relay-goyomi-entry": entry });

const load = async () => {
  if (!entry) throw new Error("not_found");
  data = await fetchJson(`/api/slots/${id}`, { headers: headers() });
  render();
  status.hidden = true;
  content.hidden = false;
  markVisit("returned");
};

const render = () => {
  clear(content);
  const card = el("section", "entry-card");
  const stamp = el("div", "entry-stamp");
  stamp.append(el("small", "", data.slot.slotDate), el("strong", "", "予約"));
  const heading = el("div", "entry-heading");
  heading.append(
    el("p", "section-kicker", "YOUR DATE CARD"),
    el("h2", "", data.calendar.title),
    el("p", "", `${data.slot.slotDate} の日付札です。`),
  );
  card.append(stamp, heading);
  const form = el("form", "slot-form");
  const fields = [
    ["displayName", "表示名", "text", 40, data.slot.displayName, true],
    ["articleTitle", "予定題", "text", 80, data.slot.articleTitle, true],
    ["articleUrl", "記事URL（HTTPS）", "url", 500, data.slot.articleUrl, false],
  ];
  for (const [name, labelText, type, maxLength, value, required] of fields) {
    const label = el("label");
    label.append(el("span", "", labelText));
    const input = el("input");
    input.name = name;
    input.type = type;
    input.maxLength = maxLength;
    input.value = value;
    input.required = required;
    label.append(input);
    form.append(label);
  }
  const formState = el("p", "form-state");
  formState.setAttribute("aria-live", "polite");
  const actions = el("div", "form-actions");
  const publicLink = el("a", "quiet-button", "公開ページを見る");
  publicLink.href = data.publicUrl;
  publicLink.target = "_blank";
  publicLink.rel = "noopener noreferrer";
  const save = el(
    "button",
    "primary-button",
    data.slot.articleUrl ? "変更を保存する" : "記事を公開する",
  );
  save.type = "submit";
  actions.append(publicLink, save);
  form.append(formState, actions);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    formState.textContent = "日付札を更新しています…";
    const values = new FormData(form);
    try {
      await fetchJson(`/api/slots/${id}`, {
        body: JSON.stringify({
          articleTitle: String(values.get("articleTitle") || "").trim(),
          articleUrl: String(values.get("articleUrl") || "").trim(),
          displayName: String(values.get("displayName") || "").trim(),
        }),
        headers: headers(),
        method: "PUT",
      });
      data = await fetchJson(`/api/slots/${id}`, { headers: headers() });
      formState.textContent = data.slot.articleUrl
        ? "記事を公開カレンダーへ結びました。"
        : "変更を保存しました。";
      save.textContent = data.slot.articleUrl ? "変更を保存する" : "記事を公開する";
    } catch (error) {
      formState.textContent = errorText(error.message);
    }
  });
  const danger = el("div", "danger-zone");
  const dangerCopy = el("div");
  dangerCopy.append(
    el("strong", "", "予約を取り消す"),
    el("span", "", "日付を空きに戻します。元に戻せません。"),
  );
  const remove = el("button", "danger-button", "取り消す");
  remove.type = "button";
  remove.addEventListener("click", deleteSlot);
  danger.append(dangerCopy, remove);
  content.append(card, form, danger);
};

const deleteSlot = async () => {
  if (!confirm("予約を取り消して日付を空きに戻しますか？")) return;
  try {
    await fetchJson(`/api/slots/${id}`, { headers: headers(), method: "DELETE" });
    clear(content);
    content.append(el("section", "reservation-result", "予約を取り消しました。"));
  } catch (error) {
    status.hidden = false;
    status.textContent = errorText(error.message);
  }
};

load().catch((error) => {
  status.textContent = errorText(error.message);
  status.classList.add("error");
});
