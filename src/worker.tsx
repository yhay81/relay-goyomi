/** @jsxImportSource hono/jsx */
import { Hono } from "hono";
import { html } from "hono/html";
import type { Child } from "hono/jsx";
import { jsxRenderer } from "hono/jsx-renderer";
import { secureHeaders } from "hono/secure-headers";

export type Bindings = {
  ASSETS: Fetcher;
  DB: D1Database;
  REPORT_HASH_KEY?: string;
};

type Variables = { requestId: string };
type Theme = "berry" | "forest" | "ink" | "sun";

type CalendarInput = {
  description: string;
  endDate: string;
  startDate: string;
  theme: Theme;
  title: string;
};

type CalendarUpdate = Pick<CalendarInput, "description" | "theme" | "title">;

type SlotInput = {
  articleTitle: string;
  articleUrl: string;
  displayName: string;
  slotDate: string;
};

type SlotUpdate = Omit<SlotInput, "slotDate">;

type CalendarRow = {
  id: string;
  payload: string;
  report_count: number;
  slug: string;
  status: "active" | "hidden";
  updated_at: number;
};

type SlotRow = {
  article_title: string;
  article_url: string;
  calendar_id: string;
  display_name: string;
  id: string;
  slot_date: string;
  updated_at: number;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const canonicalOrigin = "https://relay-goyomi.yhay81.com";
const eventLifetime = 45 * 86400;
const hiddenCalendarLifetime = 30 * 86400;
const eventNames = new Set([
  "visited",
  "calendar_created",
  "calendar_updated",
  "calendar_opened",
  "join_opened",
  "slot_reserved",
  "slot_updated",
  "slot_published",
  "slot_cancelled",
  "slot_released",
  "outbound_opened",
  "calendar_reported",
  "calendar_deleted",
  "returned",
]);
const browserEventNames = new Set([
  "visited",
  "calendar_opened",
  "join_opened",
  "outbound_opened",
  "returned",
]);
const reportReasons = new Set(["harmful", "impersonation", "other", "spam"]);
const themes = new Set<Theme>(["berry", "forest", "ink", "sun"]);
const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidPattern = sessionPattern;
const slugPattern = /^[A-Za-z0-9_-]{12}$/;
const capabilityPattern = /^[A-Za-z0-9_-]{43}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const calendarKeys = ["description", "endDate", "startDate", "theme", "title"];
const calendarUpdateKeys = ["description", "theme", "title"];
const slotKeys = ["articleTitle", "articleUrl", "displayName", "slotDate"];
const slotUpdateKeys = ["articleTitle", "articleUrl", "displayName"];

const nowSeconds = () => Math.floor(Date.now() / 1000);
const day = () => new Date().toISOString().slice(0, 10);

const containsControlCharacter = (value: string) =>
  Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });

const singleLine = (value: unknown, minimum: number, maximum: number) =>
  typeof value === "string" &&
  value === value.trim() &&
  value.length >= minimum &&
  value.length <= maximum &&
  !containsControlCharacter(value);

const plainDescription = (value: unknown) => {
  if (typeof value !== "string" || value !== value.trim() || value.length > 500) return false;
  if (containsControlCharacter(value.replaceAll("\n", ""))) return false;
  return !/(?:https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b0\d{1,4}-?\d{2,4}-?\d{3,4}\b)/iu.test(
    value,
  );
};

const validHttpsUrl = (value: unknown) => {
  if (typeof value !== "string" || value.length > 500) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443") &&
      hostname.length <= 253 &&
      hostname !== "localhost" &&
      hostname !== "0.0.0.0" &&
      hostname !== "::1" &&
      !hostname.endsWith(".local") &&
      !hostname.endsWith(".internal") &&
      !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) &&
      !hostname.includes(":")
    );
  } catch {
    return false;
  }
};

const isExactObject = (value: unknown, keys: string[]) =>
  Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("|") === [...keys].sort().join("|"),
  );

const dateNumber = (value: string) => {
  if (!datePattern.test(value)) return Number.NaN;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
    ? parsed
    : Number.NaN;
};

const inclusiveDays = (startDate: string, endDate: string) =>
  Math.floor((dateNumber(endDate) - dateNumber(startDate)) / 86400000) + 1;

const validDateRange = (startDate: unknown, endDate: unknown) => {
  if (typeof startDate !== "string" || typeof endDate !== "string") return false;
  const start = dateNumber(startDate);
  const end = dateNumber(endDate);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const count = inclusiveDays(startDate, endDate);
  const today = dateNumber(day());
  return (
    count >= 7 && count <= 31 && start >= today - 31 * 86400000 && start <= today + 366 * 86400000
  );
};

const validCalendarInput = (value: unknown): value is CalendarInput => {
  if (!isExactObject(value, calendarKeys)) return false;
  const input = value as Partial<CalendarInput>;
  return (
    singleLine(input.title, 1, 80) &&
    plainDescription(input.description) &&
    themes.has(input.theme as Theme) &&
    validDateRange(input.startDate, input.endDate)
  );
};

const validCalendarUpdate = (value: unknown): value is CalendarUpdate => {
  if (!isExactObject(value, calendarUpdateKeys)) return false;
  const input = value as Partial<CalendarUpdate>;
  return (
    singleLine(input.title, 1, 80) &&
    plainDescription(input.description) &&
    themes.has(input.theme as Theme)
  );
};

const validSlotContent = (value: Partial<SlotUpdate>) =>
  singleLine(value.displayName, 1, 40) &&
  singleLine(value.articleTitle, 1, 80) &&
  !/(?:https?:\/\/|www\.|@)/iu.test(value.displayName as string) &&
  (value.articleUrl === "" || validHttpsUrl(value.articleUrl));

const validSlotInput = (value: unknown): value is SlotInput => {
  if (!isExactObject(value, slotKeys)) return false;
  const input = value as Partial<SlotInput>;
  return (
    typeof input.slotDate === "string" &&
    Number.isFinite(dateNumber(input.slotDate)) &&
    validSlotContent(input)
  );
};

const validSlotUpdate = (value: unknown): value is SlotUpdate =>
  isExactObject(value, slotUpdateKeys) && validSlotContent(value as Partial<SlotUpdate>);

const parseJson = async (request: Request, maximum: number): Promise<unknown> => {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maximum) throw new Error("body_too_large");
  return JSON.parse(raw);
};

const validRequestBoundary = (request: Request, maximum: number) => {
  const origin = request.headers.get("origin");
  const requestOrigin = new URL(request.url).origin;
  const contentType = request.headers.get("content-type") ?? "";
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  return (
    (!origin || origin === requestOrigin) &&
    contentType.toLowerCase().startsWith("application/json") &&
    Number.isFinite(contentLength) &&
    contentLength <= maximum
  );
};

const randomBase64Url = (bytes: number) => {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const value of data) binary += String.fromCharCode(value);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const reportFingerprint = async (
  request: Request,
  secret: string | undefined,
  calendarId: string,
  sessionId: string,
) => {
  if (!secret || secret.length < 32) return "";
  const hostname = new URL(request.url).hostname;
  const network =
    request.headers.get("cf-connecting-ip")?.trim() ||
    (hostname === "localhost" || hostname === "127.0.0.1" ? `local:${sessionId}` : "");
  if (!network || network.length > 64) return "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${calendarId}\u0000${network}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const sessionFrom = (request: Request) => {
  const session = request.headers.get("x-relay-goyomi-session") ?? "";
  return sessionPattern.test(session) ? session.toLowerCase() : "";
};

const qaFrom = (request: Request) => (request.headers.get("x-relay-goyomi-qa") === "1" ? 1 : 0);

const insertEvent = (
  database: D1Database,
  name: string,
  sessionId: string,
  calendarId: string,
  isQa: number,
) =>
  database
    .prepare(
      `INSERT INTO product_events (name, session_id, calendar_id, day, created_at, is_qa)
       VALUES (?, ?, NULLIF(?, ''), ?, ?, ?)`,
    )
    .bind(name, sessionId, calendarId, day(), nowSeconds(), isQa)
    .run();

const findCalendar = (database: D1Database, slug: string, activeOnly = false) =>
  database
    .prepare(
      `SELECT id, slug, payload, status, report_count, updated_at
       FROM calendars WHERE slug = ?${activeOnly ? " AND status = 'active'" : ""}`,
    )
    .bind(slug)
    .first<CalendarRow>();

const slotsFor = (database: D1Database, calendarId: string) =>
  database
    .prepare(
      `SELECT id, calendar_id, slot_date, display_name, article_title, article_url, updated_at
       FROM slots WHERE calendar_id = ? ORDER BY slot_date`,
    )
    .bind(calendarId)
    .all<SlotRow>();

const authorizedCalendar = async (
  request: Request,
  database: D1Database,
  slug: string,
  kind: "invite" | "organizer",
) => {
  const capability = request.headers.get(`x-relay-goyomi-${kind}`) ?? "";
  if (!capabilityPattern.test(capability)) return null;
  const hash = await sha256(capability);
  const column = kind === "invite" ? "invite_hash" : "organizer_hash";
  return database
    .prepare(
      `SELECT id, slug, payload, status, report_count, updated_at
       FROM calendars WHERE slug = ? AND ${column} = ?`,
    )
    .bind(slug, hash)
    .first<CalendarRow>();
};

const authorizedSlot = async (request: Request, database: D1Database, id: string) => {
  const capability = request.headers.get("x-relay-goyomi-entry") ?? "";
  if (!capabilityPattern.test(capability) || !uuidPattern.test(id)) return null;
  const hash = await sha256(capability);
  return database
    .prepare(
      `SELECT id, calendar_id, slot_date, display_name, article_title, article_url, updated_at
       FROM slots WHERE id = ? AND participant_hash = ?`,
    )
    .bind(id, hash)
    .first<SlotRow>();
};

const parseCalendar = (row: CalendarRow) => JSON.parse(row.payload) as CalendarInput;
const calendarJson = async (database: D1Database, row: CalendarRow) => ({
  calendar: parseCalendar(row),
  calendarId: row.id,
  reportCount: row.report_count,
  slots: (await slotsFor(database, row.id)).results.map(slotJson),
  status: row.status,
  updatedAt: row.updated_at,
});
const slotJson = (slot: SlotRow) => ({
  articleTitle: slot.article_title,
  articleUrl: slot.article_url,
  displayName: slot.display_name,
  id: slot.id,
  slotDate: slot.slot_date,
  updatedAt: slot.updated_at,
});
const hostOrigin = (request: Request) => new URL(request.url).origin;

const Logo = () => (
  <span class="logo-mark" aria-hidden="true">
    <i></i>
    <i></i>
    <i></i>
  </span>
);

const RelayScene = () => (
  <div class="relay-scene" aria-label="日付札を赤いリボンが順番につなぐ記事リレー">
    <span class="pin pin-one"></span>
    <span class="pin pin-two"></span>
    <span class="pin pin-three"></span>
    <span class="relay-ribbon ribbon-one"></span>
    <span class="relay-ribbon ribbon-two"></span>
    <span class="date-card scene-open">
      <small>12/01</small>
      <b>空き</b>
    </span>
    <span class="date-card scene-held">
      <small>12/02</small>
      <b>予約</b>
    </span>
    <span class="date-card scene-live">
      <small>12/03</small>
      <b>公開</b>
    </span>
    <span class="reader-card">
      <i></i>
      <i></i>
      <i></i>
      <b>READ</b>
    </span>
  </div>
);

const Layout = (props: {
  children: Child;
  description: string;
  noindex?: boolean;
  path?: string;
  title: string;
}) => {
  const url = `${canonicalOrigin}${props.path ?? "/"}`;
  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <meta content="#f4efe4" name="theme-color" />
        <meta content={props.description} name="description" />
        {props.noindex && <meta content="noindex,nofollow" name="robots" />}
        <meta content="website" property="og:type" />
        <meta content={props.title} property="og:title" />
        <meta content={props.description} property="og:description" />
        <meta content={`${canonicalOrigin}/og.png`} property="og:image" />
        <meta
          content="日付札を赤いリボンが順番につなぐ記事リレーのカレンダー"
          property="og:image:alt"
        />
        <meta content={url} property="og:url" />
        <meta content="リレー暦" property="og:site_name" />
        <meta content="summary_large_image" name="twitter:card" />
        <link href={url} rel="canonical" />
        <link href="/favicon.png" rel="icon" type="image/png" />
        <link href="/manifest.webmanifest" rel="manifest" />
        <link href="/styles.css" rel="stylesheet" />
        <title>{props.title}</title>
      </head>
      <body>
        <a class="skip-link" href="#main">
          本文へ移動
        </a>
        <header class="site-header">
          <a class="brand" href="/" aria-label="リレー暦 ホーム">
            <Logo />
            <span>リレー暦</span>
          </a>
          <nav aria-label="ページ">
            <a href="/guide">使い方</a>
            <a href="/privacy">安全と保存</a>
          </nav>
        </header>
        {props.children}
        <footer>
          <a class="brand" href="/">
            <Logo />
            <span>リレー暦</span>
          </a>
          <p>一日ずつ、次の書き手へ。</p>
          <nav aria-label="フッター">
            <a href="/guide">使い方</a>
            <a href="/privacy">安全と保存</a>
            <a href="https://github.com/yhay81/relay-goyomi">GitHub</a>
          </nav>
        </footer>
      </body>
    </html>
  );
};

const ThemeOptions = () => (
  <>
    <option value="berry">木苺のリボン</option>
    <option value="forest">森のリボン</option>
    <option value="ink">青墨のリボン</option>
    <option value="sun">陽だまりのリボン</option>
  </>
);

const CalendarForm = (props: { editing?: boolean }) => (
  <form class="calendar-form" data-calendar-form>
    <label class="span-two">
      <span>リレー名</span>
      <input maxLength={80} name="title" required placeholder="冬のものづくりリレー" />
    </label>
    {!props.editing && (
      <>
        <label>
          <span>開始日</span>
          <input name="startDate" required type="date" />
        </label>
        <label>
          <span>終了日</span>
          <input name="endDate" required type="date" />
        </label>
      </>
    )}
    <label class={props.editing ? "span-two" : ""}>
      <span>リボン</span>
      <select name="theme">
        <ThemeOptions />
      </select>
    </label>
    <label class="span-two">
      <span>案内</span>
      <textarea
        maxLength={500}
        name="description"
        rows={4}
        placeholder="毎日ひとりずつ、今年つくったものを紹介します。"
      ></textarea>
    </label>
    <p class="form-state span-two" data-form-state aria-live="polite"></p>
    <div class="span-two form-actions">
      <button class="primary-button" type="submit">
        {props.editing ? "変更を公開する" : "リレーを始める"}
      </button>
    </div>
  </form>
);

const DemoBoard = () => (
  <div class="demo-board theme-berry" aria-label="公開状態が一目でわかる記事リレーの例">
    <div class="demo-head">
      <span>DECEMBER</span>
      <b>書き手から書き手へ</b>
    </div>
    <ol>
      <li class="published">
        <time>01</time>
        <span>
          <b>公開</b>
          <small>道具を直して使う</small>
        </span>
      </li>
      <li class="reserved">
        <time>02</time>
        <span>
          <b>予約</b>
          <small>ミナト</small>
        </span>
      </li>
      <li class="open">
        <time>03</time>
        <span>
          <b>空き</b>
          <small>この日を選べます</small>
        </span>
      </li>
      <li class="published">
        <time>04</time>
        <span>
          <b>公開</b>
          <small>小さな工房の冬支度</small>
        </span>
      </li>
    </ol>
  </div>
);

const Home = () => (
  <Layout
    description="仲間で日付を予約し、記事ができたらリンクを結ぶ、登録不要の記事リレーカレンダー。"
    title="リレー暦｜一日ずつ、次の書き手へ"
  >
    <main id="main">
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">ARTICLE RELAY CALENDAR</p>
          <h1>一日ずつ、次の書き手へ。</h1>
          <p>
            日付を選ぶ。書く。記事を結ぶ。空き・予約・公開がひと目でわかる、仲間のための記事リレーです。
          </p>
          <a class="primary-button" href="#make">
            リレーを始める
          </a>
          <ul class="trust-row">
            <li>登録なし</li>
            <li>公開と参加を分離</li>
            <li>31日まで</li>
          </ul>
        </div>
        <RelayScene />
      </section>
      <section class="maker" id="make">
        <header class="maker-heading">
          <div>
            <p class="section-kicker">PASS THE RIBBON</p>
            <h2>最初の日付札を置く</h2>
            <p>7〜31日の日程を決めると、空き枠をつないだ参加URLができます。</p>
          </div>
          <div class="ribbon-key" aria-hidden="true">
            <i></i>
            <span>HOST</span>
          </div>
        </header>
        <div class="maker-grid">
          <CalendarForm />
          <DemoBoard />
        </div>
      </section>
    </main>
    <dialog class="result-dialog" data-result-dialog>
      <div class="result-ribbon" aria-hidden="true">
        <i></i>
        <i></i>
        <i></i>
      </div>
      <p class="section-kicker">RELAY IS READY</p>
      <h2>3つの入口ができました</h2>
      <p>見る人、書く人、主催者で入口が違います。色ごとに必要な相手へ渡してください。</p>
      <div class="url-card public-url">
        <b>公開URL</b>
        <small>読む人へ</small>
        <div class="copy-row">
          <input data-public-url readonly />
          <button data-copy="public" type="button">
            コピー
          </button>
        </div>
      </div>
      <div class="url-card invite-url">
        <b>参加URL</b>
        <small>書く仲間だけへ</small>
        <div class="copy-row">
          <input data-invite-url readonly />
          <button data-copy="invite" type="button">
            コピー
          </button>
        </div>
      </div>
      <div class="url-card organizer-url">
        <b>主催者URL</b>
        <small>自分だけで保管</small>
        <div class="copy-row">
          <input data-organizer-url readonly />
          <button data-copy="organizer" type="button">
            コピー
          </button>
        </div>
      </div>
      <p class="key-warning">
        参加URLと主催者URLは再発行できません。まず安全な場所へ保存してください。
      </p>
      <div class="result-actions">
        <a class="quiet-button" data-open-public target="_blank" rel="noopener noreferrer">
          公開ページを見る
        </a>
        <a class="primary-button" data-open-organizer>
          主催者画面へ
        </a>
      </div>
    </dialog>
    <script src="/app.js" type="module"></script>
  </Layout>
);

const ShellPage = (props: {
  description: string;
  eyebrow: string;
  kind: "entry" | "join" | "manage";
  script: string;
  slugOrId: string;
  text: string;
  title: string;
}) => (
  <Layout
    description={props.description}
    noindex
    path={`/${props.kind}/${props.slugOrId}`}
    title={`${props.title}｜リレー暦`}
  >
    <main
      class={`workspace-page ${props.kind}-page`}
      data-root
      data-value={props.slugOrId}
      id="main"
    >
      <header class="page-intro">
        <div class={`page-symbol ${props.kind}`} aria-hidden="true">
          <i></i>
          <i></i>
          <i></i>
        </div>
        <div>
          <p class="eyebrow">{props.eyebrow}</p>
          <h1>{props.title}</h1>
          <p>{props.text}</p>
        </div>
      </header>
      <div class="workspace-status" data-status aria-live="polite">
        専用の入口を確かめています…
      </div>
      <section data-content hidden></section>
    </main>
    <script src={props.script} type="module"></script>
  </Layout>
);

const datesBetween = (startDate: string, endDate: string) =>
  Array.from({ length: inclusiveDays(startDate, endDate) }, (_, index) => {
    const date = new Date(dateNumber(startDate) + index * 86400000);
    return date.toISOString().slice(0, 10);
  });

const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    weekday: "short",
  }).format(new Date(`${value}T00:00:00Z`));

const PublicCalendar = (props: { input: CalendarInput; row: CalendarRow; slots: SlotRow[] }) => {
  const occupied = new Map(props.slots.map((slot) => [slot.slot_date, slot]));
  const published = props.slots.filter((slot) => Boolean(slot.article_url)).length;
  return (
    <Layout
      description={`${props.input.title}の記事リレーカレンダー。空き・予約・公開を日付順に表示します。`}
      noindex
      path={`/c/${props.row.slug}`}
      title={`${props.input.title}｜リレー暦`}
    >
      <main
        class={`public-page theme-${props.input.theme}`}
        data-calendar-id={props.row.id}
        data-public-root
        data-slug={props.row.slug}
        id="main"
      >
        <header class="calendar-hero">
          <div>
            <p class="eyebrow">ARTICLE RELAY</p>
            <h1>{props.input.title}</h1>
            <p>{props.input.description || "一日ずつ、書き手から書き手へ記事をつなぎます。"}</p>
          </div>
          <dl class="calendar-summary">
            <div>
              <dt>期間</dt>
              <dd>
                {dateLabel(props.input.startDate)} — {dateLabel(props.input.endDate)}
              </dd>
            </div>
            <div>
              <dt>公開</dt>
              <dd>
                {published} / {datesBetween(props.input.startDate, props.input.endDate).length}
              </dd>
            </div>
          </dl>
        </header>
        <ol class="calendar-board">
          {datesBetween(props.input.startDate, props.input.endDate).map((date, index) => {
            const slot = occupied.get(date);
            const state = slot?.article_url ? "published" : slot ? "reserved" : "open";
            return (
              <li class={state}>
                <div class="date-stamp">
                  <small>DAY {String(index + 1).padStart(2, "0")}</small>
                  <time datetime={date}>{dateLabel(date)}</time>
                </div>
                <div class="slot-copy">
                  <b>{state === "published" ? "公開" : state === "reserved" ? "予約" : "空き"}</b>
                  {slot ? (
                    <>
                      <strong>{slot.article_title}</strong>
                      <span>{slot.display_name}</span>
                    </>
                  ) : (
                    <>
                      <strong>次の書き手を待っています</strong>
                      <span>参加URLから予約できます</span>
                    </>
                  )}
                </div>
                {slot?.article_url && (
                  <a
                    class="read-link"
                    data-outbound
                    href={slot.article_url}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    記事を読む <span aria-hidden="true">↗</span>
                  </a>
                )}
              </li>
            );
          })}
        </ol>
        <section class="report-panel">
          <details>
            <summary>このカレンダーを報告</summary>
            <form data-report-form>
              <label>
                <span>理由</span>
                <select name="reason">
                  <option value="spam">迷惑行為</option>
                  <option value="impersonation">なりすまし</option>
                  <option value="harmful">有害な内容</option>
                  <option value="other">その他</option>
                </select>
              </label>
              <button class="quiet-button small" type="submit">
                報告する
              </button>
              <p data-report-state aria-live="polite"></p>
            </form>
          </details>
        </section>
      </main>
      <script src="/calendar.js" type="module"></script>
    </Layout>
  );
};

const Guide = () => (
  <Layout
    description="リレー暦で記事リレーを作り、日付を予約し、公開記事を結ぶ手順。"
    path="/guide"
    title="使い方｜リレー暦"
  >
    <main class="prose-page" id="main">
      <header class="page-intro">
        <div class="page-symbol guide" aria-hidden="true">
          <i></i>
          <i></i>
          <i></i>
        </div>
        <div>
          <p class="eyebrow">HOW TO RELAY</p>
          <h1>3つの入口を使い分ける</h1>
          <p>公開・参加・主催者の入口を分けると、登録なしでも役割が混ざりません。</p>
        </div>
      </header>
      <ol class="steps">
        <li>
          <span>1</span>
          <div>
            <h2>主催者が日程を作る</h2>
            <p>7〜31日の期間、リレー名、案内を入力します。主催者URLは自分だけで保存します。</p>
          </div>
        </li>
        <li>
          <span>2</span>
          <div>
            <h2>参加URLを仲間へ渡す</h2>
            <p>
              参加者は空いている日を選び、表示名と予定題を登録します。記事URLは後からでも構いません。
            </p>
          </div>
        </li>
        <li>
          <span>3</span>
          <div>
            <h2>記事を公開したら結ぶ</h2>
            <p>
              予約時に発行された枠編集URLからHTTPSの記事URLを追加します。公開カレンダーに「記事を読む」が現れます。
            </p>
          </div>
        </li>
      </ol>
    </main>
  </Layout>
);

const Privacy = () => (
  <Layout
    description="リレー暦が保存する情報、能力URL、安全対策、保持期間。"
    path="/privacy"
    title="安全と保存｜リレー暦"
  >
    <main class="prose-page" id="main">
      <header class="page-intro">
        <div class="page-symbol privacy" aria-hidden="true">
          <i></i>
          <i></i>
          <i></i>
        </div>
        <div>
          <p class="eyebrow">SAFETY & STORAGE</p>
          <h1>鍵はURLの末尾にだけ</h1>
          <p>ログイン情報を集めず、役割ごとのランダムな鍵で変更を限定します。</p>
        </div>
      </header>
      <div class="prose-grid">
        <section>
          <h2>保存する内容</h2>
          <p>
            カレンダー、予約枠、表示名、予定題、記事URLをD1へ保存します。画像、本文、メール、電話番号は扱いません。
          </p>
        </section>
        <section>
          <h2>保存しない鍵</h2>
          <p>
            主催者・参加・枠編集の鍵は256-bit乱数です。平文はURLフラグメントにだけ置き、D1にはSHA-256ハッシュだけを保存します。
          </p>
        </section>
        <section>
          <h2>報告の重複防止</h2>
          <p>
            接続元IPは保存しません。秘密鍵付きHMACへ変換し、同じ接続元からの重複だけを抑えます。
          </p>
        </section>
        <section>
          <h2>保持期間</h2>
          <p>
            匿名の操作ログは45日後、報告で非表示になったカレンダーは30日後に削除します。主催者と参加者はいつでも削除できます。
          </p>
        </section>
      </div>
    </main>
  </Layout>
);

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      baseUri: ["'none'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      upgradeInsecureRequests: [],
    },
    crossOriginEmbedderPolicy: false,
    permissionsPolicy: {
      camera: [],
      geolocation: [],
      microphone: [],
      payment: [],
    },
    referrerPolicy: "no-referrer",
  }),
);

app.use("*", async (c, next) => {
  c.set("requestId", crypto.randomUUID());
  c.header("X-Request-Id", c.get("requestId"));
  c.header("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=()");
  await next();
});

app.use(
  "*",
  jsxRenderer(({ children }) => html`${children}`),
);

app.get("/", (c) => c.render(<Home />));
app.get("/guide", (c) => c.render(<Guide />));
app.get("/privacy", (c) => c.render(<Privacy />));
app.get("/join/:slug", (c) =>
  slugPattern.test(c.req.param("slug"))
    ? c.render(
        <ShellPage
          description="リレー暦の空いている日を予約します。"
          eyebrow="JOIN THE RELAY"
          kind="join"
          script="/join.js"
          slugOrId={c.req.param("slug")}
          text="赤い参加鍵で、空いている日付札を選びます。"
          title="書く日を選ぶ"
        />,
      )
    : c.notFound(),
);
app.get("/manage/:slug", (c) =>
  slugPattern.test(c.req.param("slug"))
    ? c.render(
        <ShellPage
          description="記事リレーの案内と予約枠を主催者として管理します。"
          eyebrow="HOST DESK"
          kind="manage"
          script="/manage.js"
          slugOrId={c.req.param("slug")}
          text="リレーの案内を整え、すべての日付札を見守ります。"
          title="リレーを管理する"
        />,
      )
    : c.notFound(),
);
app.get("/entry/:id", (c) =>
  uuidPattern.test(c.req.param("id"))
    ? c.render(
        <ShellPage
          description="予約した日付の予定題と記事URLを編集します。"
          eyebrow="YOUR DATE CARD"
          kind="entry"
          script="/entry.js"
          slugOrId={c.req.param("id")}
          text="予約時の枠編集鍵で、記事を公開カレンダーへ結びます。"
          title="予約枠を整える"
        />,
      )
    : c.notFound(),
);

app.get("/c/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!slugPattern.test(slug)) return c.notFound();
  const row = await findCalendar(c.env.DB, slug, true);
  if (!row) return c.notFound();
  const input = parseCalendar(row);
  const slots = (await slotsFor(c.env.DB, row.id)).results;
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex, nofollow");
  return c.render(<PublicCalendar input={input} row={row} slots={slots} />);
});

app.get("/health", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({
    ok: true,
    reporting: Boolean(c.env.REPORT_HASH_KEY?.length && c.env.REPORT_HASH_KEY.length >= 32),
  });
});

app.post("/api/calendars", async (c) => {
  if (!validRequestBoundary(c.req.raw, 8192)) return c.json({ error: "invalid_request" }, 400);
  const sessionId = sessionFrom(c.req.raw);
  if (!sessionId) return c.json({ error: "invalid_request" }, 400);
  try {
    const input = await parseJson(c.req.raw, 8192);
    if (!validCalendarInput(input)) return c.json({ error: "invalid_calendar" }, 400);
    const createdToday = await c.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM product_events
       WHERE name = 'calendar_created' AND session_id = ? AND day = ?`,
    )
      .bind(sessionId, day())
      .first<{ count: number }>();
    if ((createdToday?.count ?? 0) >= 3) return c.json({ error: "daily_limit" }, 429);
    const id = crypto.randomUUID();
    const slug = randomBase64Url(9);
    const organizer = randomBase64Url(32);
    const invite = randomBase64Url(32);
    const timestamp = nowSeconds();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO calendars
           (id, slug, organizer_hash, invite_hash, payload, status, report_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?)`,
      ).bind(
        id,
        slug,
        await sha256(organizer),
        await sha256(invite),
        JSON.stringify(input),
        timestamp,
        timestamp,
      ),
      c.env.DB.prepare(
        `INSERT INTO product_events (name, session_id, calendar_id, day, created_at, is_qa)
           VALUES ('calendar_created', ?, ?, ?, ?, ?)`,
      ).bind(sessionId, id, day(), timestamp, qaFrom(c.req.raw)),
    ]);
    const origin = hostOrigin(c.req.raw);
    c.header("Cache-Control", "no-store");
    return c.json(
      {
        calendarId: id,
        inviteUrl: `${origin}/join/${slug}#${invite}`,
        organizerUrl: `${origin}/manage/${slug}#${organizer}`,
        publicUrl: `${origin}/c/${slug}`,
        slug,
      },
      201,
    );
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
});

app.get("/api/calendars/:slug/public", async (c) => {
  const slug = c.req.param("slug");
  if (!slugPattern.test(slug)) return c.json({ error: "not_found" }, 404);
  const row = await findCalendar(c.env.DB, slug, true);
  if (!row) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", "no-store");
  return c.json(await calendarJson(c.env.DB, row));
});

app.get("/api/calendars/:slug/manage", async (c) => {
  const slug = c.req.param("slug");
  const row = slugPattern.test(slug)
    ? await authorizedCalendar(c.req.raw, c.env.DB, slug, "organizer")
    : null;
  if (!row) return c.json({ error: "not_found" }, 404);
  const origin = hostOrigin(c.req.raw);
  c.header("Cache-Control", "no-store");
  return c.json({ ...(await calendarJson(c.env.DB, row)), publicUrl: `${origin}/c/${slug}` });
});

app.put("/api/calendars/:slug", async (c) => {
  if (!validRequestBoundary(c.req.raw, 4096)) return c.json({ error: "invalid_request" }, 400);
  const sessionId = sessionFrom(c.req.raw);
  const slug = c.req.param("slug");
  if (!sessionId || !slugPattern.test(slug)) return c.json({ error: "invalid_request" }, 400);
  const row = await authorizedCalendar(c.req.raw, c.env.DB, slug, "organizer");
  if (!row) return c.json({ error: "not_found" }, 404);
  try {
    const update = await parseJson(c.req.raw, 4096);
    if (!validCalendarUpdate(update)) return c.json({ error: "invalid_calendar" }, 400);
    const prior = parseCalendar(row);
    const payload: CalendarInput = { ...prior, ...update };
    const timestamp = nowSeconds();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE calendars SET payload = ?, status = 'active', report_count = 0, updated_at = ? WHERE id = ?`,
      ).bind(JSON.stringify(payload), timestamp, row.id),
      c.env.DB.prepare("DELETE FROM calendar_reports WHERE calendar_id = ?").bind(row.id),
      c.env.DB.prepare(
        `INSERT INTO product_events (name, session_id, calendar_id, day, created_at, is_qa)
         VALUES ('calendar_updated', ?, ?, ?, ?, ?)`,
      ).bind(sessionId, row.id, day(), timestamp, qaFrom(c.req.raw)),
    ]);
    c.header("Cache-Control", "no-store");
    return c.json({ ok: true });
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
});

app.delete("/api/calendars/:slug", async (c) => {
  const sessionId = sessionFrom(c.req.raw);
  const slug = c.req.param("slug");
  const row =
    sessionId && slugPattern.test(slug)
      ? await authorizedCalendar(c.req.raw, c.env.DB, slug, "organizer")
      : null;
  if (!row) return c.json({ error: "not_found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM calendars WHERE id = ?").bind(row.id),
    c.env.DB.prepare(
      `INSERT INTO product_events (name, session_id, calendar_id, day, created_at, is_qa)
       VALUES ('calendar_deleted', ?, ?, ?, ?, ?)`,
    ).bind(sessionId, row.id, day(), nowSeconds(), qaFrom(c.req.raw)),
  ]);
  return c.body(null, 204);
});

app.post("/api/calendars/:slug/slots", async (c) => {
  if (!validRequestBoundary(c.req.raw, 4096)) return c.json({ error: "invalid_request" }, 400);
  const sessionId = sessionFrom(c.req.raw);
  const slug = c.req.param("slug");
  if (!sessionId || !slugPattern.test(slug)) return c.json({ error: "invalid_request" }, 400);
  const row = await authorizedCalendar(c.req.raw, c.env.DB, slug, "invite");
  if (!row || row.status !== "active") return c.json({ error: "not_found" }, 404);
  try {
    const input = await parseJson(c.req.raw, 4096);
    if (!validSlotInput(input)) return c.json({ error: "invalid_slot" }, 400);
    const calendar = parseCalendar(row);
    if (input.slotDate < calendar.startDate || input.slotDate > calendar.endDate) {
      return c.json({ error: "invalid_date" }, 400);
    }
    const id = crypto.randomUUID();
    const capability = randomBase64Url(32);
    const timestamp = nowSeconds();
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO slots
           (id, calendar_id, slot_date, participant_hash, display_name, article_title, article_url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          id,
          row.id,
          input.slotDate,
          await sha256(capability),
          input.displayName,
          input.articleTitle,
          input.articleUrl,
          timestamp,
          timestamp,
        ),
        c.env.DB.prepare(
          `INSERT INTO product_events (name, session_id, calendar_id, day, created_at, is_qa)
           VALUES ('slot_reserved', ?, ?, ?, ?, ?)`,
        ).bind(sessionId, row.id, day(), timestamp, qaFrom(c.req.raw)),
      ]);
    } catch {
      return c.json({ error: "slot_taken" }, 409);
    }
    c.header("Cache-Control", "no-store");
    return c.json(
      { editUrl: `${hostOrigin(c.req.raw)}/entry/${id}#${capability}`, slotId: id },
      201,
    );
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
});

app.get("/api/slots/:id", async (c) => {
  const slot = await authorizedSlot(c.req.raw, c.env.DB, c.req.param("id"));
  if (!slot) return c.json({ error: "not_found" }, 404);
  const calendar = await c.env.DB.prepare(
    "SELECT id, slug, payload, status, report_count, updated_at FROM calendars WHERE id = ?",
  )
    .bind(slot.calendar_id)
    .first<CalendarRow>();
  if (!calendar) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", "no-store");
  return c.json({
    calendar: parseCalendar(calendar),
    publicUrl: `${hostOrigin(c.req.raw)}/c/${calendar.slug}`,
    slot: slotJson(slot),
  });
});

app.put("/api/slots/:id", async (c) => {
  if (!validRequestBoundary(c.req.raw, 2048)) return c.json({ error: "invalid_request" }, 400);
  const sessionId = sessionFrom(c.req.raw);
  if (!sessionId) return c.json({ error: "invalid_request" }, 400);
  const slot = await authorizedSlot(c.req.raw, c.env.DB, c.req.param("id"));
  if (!slot) return c.json({ error: "not_found" }, 404);
  try {
    const input = await parseJson(c.req.raw, 2048);
    if (!validSlotUpdate(input)) return c.json({ error: "invalid_slot" }, 400);
    const eventName = !slot.article_url && input.articleUrl ? "slot_published" : "slot_updated";
    const timestamp = nowSeconds();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE slots SET display_name = ?, article_title = ?, article_url = ?, updated_at = ? WHERE id = ?`,
      ).bind(input.displayName, input.articleTitle, input.articleUrl, timestamp, slot.id),
      c.env.DB.prepare(
        `INSERT INTO product_events (name, session_id, calendar_id, day, created_at, is_qa)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(eventName, sessionId, slot.calendar_id, day(), timestamp, qaFrom(c.req.raw)),
    ]);
    c.header("Cache-Control", "no-store");
    return c.json({ ok: true });
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
});

app.delete("/api/slots/:id", async (c) => {
  const sessionId = sessionFrom(c.req.raw);
  const slot = sessionId ? await authorizedSlot(c.req.raw, c.env.DB, c.req.param("id")) : null;
  if (!slot) return c.json({ error: "not_found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM slots WHERE id = ?").bind(slot.id),
    c.env.DB.prepare(
      `INSERT INTO product_events (name, session_id, calendar_id, day, created_at, is_qa)
       VALUES ('slot_cancelled', ?, ?, ?, ?, ?)`,
    ).bind(sessionId, slot.calendar_id, day(), nowSeconds(), qaFrom(c.req.raw)),
  ]);
  return c.body(null, 204);
});

app.delete("/api/calendars/:slug/slots/:id", async (c) => {
  const sessionId = sessionFrom(c.req.raw);
  const slug = c.req.param("slug");
  const row =
    sessionId && slugPattern.test(slug)
      ? await authorizedCalendar(c.req.raw, c.env.DB, slug, "organizer")
      : null;
  if (!row || !uuidPattern.test(c.req.param("id"))) return c.json({ error: "not_found" }, 404);
  const result = await c.env.DB.prepare("DELETE FROM slots WHERE id = ? AND calendar_id = ?")
    .bind(c.req.param("id"), row.id)
    .run();
  if (!result.meta.changes) return c.json({ error: "not_found" }, 404);
  await insertEvent(c.env.DB, "slot_released", sessionId, row.id, qaFrom(c.req.raw));
  return c.body(null, 204);
});

app.post("/api/calendars/:slug/report", async (c) => {
  if (!validRequestBoundary(c.req.raw, 512)) return c.json({ error: "invalid_request" }, 400);
  const sessionId = sessionFrom(c.req.raw);
  const slug = c.req.param("slug");
  if (!sessionId || !slugPattern.test(slug)) return c.json({ error: "invalid_request" }, 400);
  const row = await findCalendar(c.env.DB, slug, true);
  if (!row) return c.json({ error: "not_found" }, 404);
  try {
    const input = await parseJson(c.req.raw, 512);
    if (
      !isExactObject(input, ["reason"]) ||
      !reportReasons.has(String((input as { reason?: unknown }).reason))
    ) {
      return c.json({ error: "invalid_report" }, 400);
    }
    const fingerprint = await reportFingerprint(
      c.req.raw,
      c.env.REPORT_HASH_KEY,
      row.id,
      sessionId,
    );
    if (!fingerprint) return c.json({ error: "reporting_unavailable" }, 503);
    const timestamp = nowSeconds();
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO calendar_reports
       (calendar_id, session_id, reporter_hash, reason, created_at, is_qa)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        row.id,
        sessionId,
        fingerprint,
        (input as { reason: string }).reason,
        timestamp,
        qaFrom(c.req.raw),
      )
      .run();
    const reports = await c.env.DB.prepare(
      `SELECT COUNT(DISTINCT session_id) AS count FROM calendar_reports
       WHERE calendar_id = ? AND is_qa = 0`,
    )
      .bind(row.id)
      .first<{ count: number }>();
    const hidden = (reports?.count ?? 0) >= 3;
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE calendars SET report_count = ?, status = CASE WHEN ? THEN 'hidden' ELSE status END,
         updated_at = CASE WHEN ? THEN ? ELSE updated_at END WHERE id = ?`,
      ).bind(reports?.count ?? 0, hidden ? 1 : 0, hidden ? 1 : 0, timestamp, row.id),
      c.env.DB.prepare(
        `INSERT INTO product_events (name, session_id, calendar_id, day, created_at, is_qa)
         VALUES ('calendar_reported', ?, ?, ?, ?, ?)`,
      ).bind(sessionId, row.id, day(), timestamp, qaFrom(c.req.raw)),
    ]);
    c.header("Cache-Control", "no-store");
    return c.json({ hidden, ok: true }, 202);
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
});

app.post("/api/events", async (c) => {
  if (!validRequestBoundary(c.req.raw, 512)) return c.json({ error: "invalid_request" }, 400);
  const sessionId = sessionFrom(c.req.raw);
  if (!sessionId) return c.json({ error: "invalid_request" }, 400);
  try {
    const input = await parseJson(c.req.raw, 512);
    if (!isExactObject(input, ["calendarId", "name"]))
      return c.json({ error: "invalid_event" }, 400);
    const { calendarId, name } = input as { calendarId: unknown; name: unknown };
    if (
      typeof name !== "string" ||
      !browserEventNames.has(name) ||
      typeof calendarId !== "string" ||
      (calendarId !== "" && !uuidPattern.test(calendarId))
    ) {
      return c.json({ error: "invalid_event" }, 400);
    }
    await insertEvent(c.env.DB, name, sessionId, calendarId, qaFrom(c.req.raw));
    c.header("Cache-Control", "no-store");
    return c.json({ ok: true }, 202);
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
});

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: "not_found" }, 404);
  c.status(404);
  return c.render(
    <Layout
      description="指定された日付札は見つかりません。"
      noindex
      title="見つかりません｜リレー暦"
    >
      <main class="not-found" id="main">
        <div class="fallen-card" aria-hidden="true">
          <i></i>
          <span>404</span>
        </div>
        <p class="eyebrow">THE RIBBON ENDS HERE</p>
        <h1>その日付札は、見つかりません</h1>
        <p>URLを確かめるか、リレー暦の最初のページへ戻ってください。</p>
        <a class="primary-button" href="/">
          最初のページへ
        </a>
      </main>
    </Layout>,
  );
});

const scheduled: ExportedHandlerScheduledHandler<Bindings> = async (_event, env) => {
  const now = nowSeconds();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM product_events WHERE created_at <= ?").bind(now - eventLifetime),
    env.DB.prepare("DELETE FROM calendars WHERE status = 'hidden' AND updated_at <= ?").bind(
      now - hiddenCalendarLifetime,
    ),
  ]);
};

export {
  app,
  eventNames,
  scheduled,
  validCalendarInput,
  validCalendarUpdate,
  validHttpsUrl,
  validSlotInput,
  validSlotUpdate,
};

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Bindings>;
