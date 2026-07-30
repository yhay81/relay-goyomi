import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  app,
  eventNames,
  scheduled,
  validCalendarInput,
  validCalendarUpdate,
  validSlotInput,
  validSlotUpdate,
  type Bindings,
} from "../src/worker";

const pathOf = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const migrationPath = pathOf("../migrations/0001_relay.sql");
const workerPath = pathOf("../src/worker.tsx");
const stylesPath = pathOf("../public/styles.css");
const commonPath = pathOf("../public/common.js");
const appPath = pathOf("../public/app.js");
const joinPath = pathOf("../public/join.js");
const managePath = pathOf("../public/manage.js");
const entryPath = pathOf("../public/entry.js");
const calendarPath = pathOf("../public/calendar.js");
const serviceWorkerPath = pathOf("../public/sw.js");
const manifestPath = pathOf("../public/manifest.webmanifest");
const sitemapPath = pathOf("../public/sitemap.xml");
const robotsPath = pathOf("../public/robots.txt");
const ogPath = pathOf("../public/og.png");
const metricsPath = pathOf("../ops/product-metrics.sql");
const origin = "https://relay-goyomi.yhay81.com";
const requestOrigin = "http://localhost";
const primarySession = "a2d0e2f2-66fd-4fd4-8e87-b0ef67ad194a";

const session = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const plusDays = (date: string, count: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10);

const baseStart = tomorrow();
const calendar = {
  description: "毎日ひとりずつ、今年つくったものを紹介します。",
  endDate: plusDays(baseStart, 24),
  startDate: baseStart,
  theme: "berry" as const,
  title: "冬のものづくりリレー",
};
const slot = {
  articleTitle: "小さな工房の冬支度",
  articleUrl: "",
  displayName: "山田",
  slotDate: plusDays(baseStart, 2),
};

let miniflare: Miniflare;
let bindings: Bindings;

type RequestOptions = {
  capability?: { kind: "entry" | "invite" | "organizer"; value: string };
  contentLength?: number;
  contentType?: string;
  method?: string;
  origin?: string;
  qa?: boolean;
  reporterIp?: string;
  session?: string;
};

const jsonRequest = (body: unknown, options: RequestOptions = {}): RequestInit => {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const headers: Record<string, string> = {
    "content-length": String(options.contentLength ?? new TextEncoder().encode(raw).byteLength),
    "content-type": options.contentType ?? "application/json",
    origin: options.origin ?? requestOrigin,
    "x-relay-goyomi-qa": options.qa ? "1" : "0",
    "x-relay-goyomi-session": options.session ?? primarySession,
  };
  if (options.capability) {
    headers[`x-relay-goyomi-${options.capability.kind}`] = options.capability.value;
  }
  if (options.reporterIp) headers["cf-connecting-ip"] = options.reporterIp;
  return { body: raw, headers, method: options.method ?? "POST" };
};

const capabilityRequest = (
  kind: "entry" | "invite" | "organizer",
  value: string,
  options: Pick<RequestOptions, "method" | "qa" | "session"> = {},
): RequestInit => ({
  headers: {
    [`x-relay-goyomi-${kind}`]: value,
    "x-relay-goyomi-qa": options.qa ? "1" : "0",
    "x-relay-goyomi-session": options.session ?? primarySession,
  },
  method: options.method ?? "GET",
});

const createCalendar = async (
  options: { input?: typeof calendar; qa?: boolean; session?: string } = {},
) => {
  const response = await app.request(
    "/api/calendars",
    jsonRequest(options.input ?? calendar, { qa: options.qa, session: options.session }),
    bindings,
  );
  expect(response.status, await response.clone().text()).toBe(201);
  const payload = await response.json<{
    calendarId: string;
    inviteUrl: string;
    organizerUrl: string;
    publicUrl: string;
    slug: string;
  }>();
  return {
    id: payload.calendarId,
    invite: new URL(payload.inviteUrl).hash.slice(1),
    organizer: new URL(payload.organizerUrl).hash.slice(1),
    payload,
    slug: payload.slug,
  };
};

const reserveSlot = async (
  created: Awaited<ReturnType<typeof createCalendar>>,
  options: { input?: typeof slot; qa?: boolean; session?: string } = {},
) => {
  const response = await app.request(
    `/api/calendars/${created.slug}/slots`,
    jsonRequest(options.input ?? slot, {
      capability: { kind: "invite", value: created.invite },
      qa: options.qa,
      session: options.session,
    }),
    bindings,
  );
  expect(response.status, await response.clone().text()).toBe(201);
  const payload = await response.json<{ editUrl: string; slotId: string }>();
  return {
    capability: new URL(payload.editUrl).hash.slice(1),
    id: payload.slotId,
    payload,
  };
};

const reportCalendar = (
  slug: string,
  reporterSession: string,
  options: { qa?: boolean; reason?: string; reporterIp?: string } = {},
) =>
  app.request(
    `/api/calendars/${slug}/report`,
    jsonRequest(
      { reason: options.reason ?? "spam" },
      {
        qa: options.qa,
        reporterIp:
          options.reporterIp ?? `203.0.113.${Math.max(1, Number(reporterSession.slice(-3)) % 255)}`,
        session: reporterSession,
      },
    ),
    bindings,
  );

beforeEach(async () => {
  miniflare = new Miniflare({
    d1Databases: { DB: "relay-goyomi-test" },
    modules: true,
    script: "export default { fetch() { return new Response('test') } }",
  });
  const database = await miniflare.getD1Database("DB");
  const migration = await readFile(migrationPath, "utf8");
  for (const statement of migration
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)) {
    await database.prepare(statement).run();
  }
  bindings = {
    ASSETS: { fetch: async () => new Response("asset", { status: 200 }) } as unknown as Fetcher,
    DB: database as unknown as D1Database,
    REPORT_HASH_KEY: "test-report-hmac-key-000000000000000000000000000000000000",
  };
});

afterEach(async () => {
  await miniflare.dispose();
});

describe("public pages", () => {
  it.each([
    ["/", 'class="relay-scene"', `${origin}/`],
    ["/guide", "3つの入口を使い分ける", `${origin}/guide`],
    ["/privacy", "鍵はURLの末尾にだけ", `${origin}/privacy`],
  ])("%s は製品固有の画面を返す", async (path, marker, canonical) => {
    const response = await app.request(path, undefined, bindings);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain(marker);
    expect(body).toContain(`href="${canonical}" rel="canonical"`);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("content-security-policy")).toContain("style-src 'self'");
    expect(response.headers.get("content-security-policy")).not.toContain("unsafe-inline");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body).not.toMatch(/成功条件|市場スコア|公開実験|収益性|技術選定/);
  });

  it("空き・予約・公開の日付札をリボンでつなぐ", async () => {
    const body = await (await app.request("/", undefined, bindings)).text();
    for (const marker of [
      'class="date-card scene-open"',
      'class="date-card scene-held"',
      'class="date-card scene-live"',
      'class="relay-ribbon ribbon-one"',
      'class="demo-board theme-berry"',
    ]) {
      expect(body).toContain(marker);
    }
    expect(body).toContain("日付を選ぶ。書く。記事を結ぶ。");
    expect(body).toContain('src="/app.js" type="module"');
  });

  it.each([
    ["/join/AbcdEfgh_123", "JOIN THE RELAY", "/join.js"],
    ["/manage/AbcdEfgh_123", "HOST DESK", "/manage.js"],
    ["/entry/00000000-0000-4000-8000-000000000001", "YOUR DATE CARD", "/entry.js"],
  ])("%s はnoindexの専用画面を返す", async (path, marker, script) => {
    const response = await app.request(path, undefined, bindings);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain(marker);
    expect(body).toContain(`src="${script}"`);
    expect(body).toContain('content="noindex,nofollow" name="robots"');
  });

  it("不正な専用URLと未知の画面は製品固有404", async () => {
    expect((await app.request("/join/short", undefined, bindings)).status).toBe(404);
    const response = await app.request("/missing", undefined, bindings);
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("その日付札は、見つかりません");
  });

  it("healthは報告機能の状態を示しキャッシュしない", async () => {
    const response = await app.request("/health", undefined, bindings);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, reporting: true });
  });
});

describe("input validation", () => {
  it("7〜31日のカレンダーと安全な更新を許可する", () => {
    expect(validCalendarInput(calendar)).toBe(true);
    expect(validCalendarInput({ ...calendar, endDate: plusDays(baseStart, 6) })).toBe(true);
    expect(validCalendarInput({ ...calendar, endDate: plusDays(baseStart, 30) })).toBe(true);
    expect(validCalendarUpdate({ description: "", theme: "forest", title: "更新" })).toBe(true);
  });

  it.each([
    ["余分なキー", { ...calendar, secret: "x" }],
    ["短すぎる期間", { ...calendar, endDate: plusDays(baseStart, 5) }],
    ["長すぎる期間", { ...calendar, endDate: plusDays(baseStart, 31) }],
    ["不正日付", { ...calendar, startDate: "2026-02-30" }],
    ["長い名前", { ...calendar, title: "名".repeat(81) }],
    ["URL入り案内", { ...calendar, description: "https://example.com" }],
    ["メール入り案内", { ...calendar, description: "me@example.com" }],
    ["電話入り案内", { ...calendar, description: "090-1234-5678" }],
    ["未知の色", { ...calendar, theme: "rainbow" }],
  ])("%s を拒否する", (_label, input) => {
    expect(validCalendarInput(input)).toBe(false);
  });

  it("予約と後からの記事公開を許可する", () => {
    expect(validSlotInput(slot)).toBe(true);
    expect(validSlotInput({ ...slot, articleUrl: "https://example.com/article" })).toBe(true);
    expect(
      validSlotUpdate({
        articleTitle: slot.articleTitle,
        articleUrl: "https://example.com/article",
        displayName: slot.displayName,
      }),
    ).toBe(true);
  });

  it.each([
    ["余分なキー", { ...slot, note: "x" }],
    ["長い表示名", { ...slot, displayName: "名".repeat(41) }],
    ["表示名のURL", { ...slot, displayName: "https://example.com" }],
    ["http URL", { ...slot, articleUrl: "http://example.com" }],
    ["認証情報", { ...slot, articleUrl: "https://name:secret@example.com" }],
    ["非標準ポート", { ...slot, articleUrl: "https://example.com:8443" }],
    ["localhost", { ...slot, articleUrl: "https://localhost/path" }],
    ["IPv4", { ...slot, articleUrl: "https://192.168.1.1/path" }],
    ["IPv6", { ...slot, articleUrl: "https://[::1]/path" }],
    [".local", { ...slot, articleUrl: "https://printer.local/path" }],
  ])("%s を拒否する", (_label, input) => {
    expect(validSlotInput(input)).toBe(false);
  });
});

describe("calendar lifecycle", () => {
  it("3つの能力URLを発行し平文鍵を保存しない", async () => {
    const created = await createCalendar();
    expect(created.slug).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(created.organizer).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.invite).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.organizer).not.toBe(created.invite);
    expect(created.payload.publicUrl).toBe(`${requestOrigin}/c/${created.slug}`);
    expect(created.payload.publicUrl).not.toContain("#");

    const row = await bindings.DB.prepare(
      "SELECT organizer_hash, invite_hash, payload, status FROM calendars WHERE id = ?",
    )
      .bind(created.id)
      .first<{ invite_hash: string; organizer_hash: string; payload: string; status: string }>();
    expect(row?.organizer_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.invite_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.payload).not.toContain(created.organizer);
    expect(row?.payload).not.toContain(created.invite);
    expect(row?.status).toBe("active");
  });

  it("公開ページをnoindex・no-storeで表示し入力をエスケープする", async () => {
    const created = await createCalendar({
      input: {
        ...calendar,
        description: "タグではなく文字です",
        title: "<script>alert(1)</script>",
      },
    });
    const response = await app.request(`/c/${created.slug}`, undefined, bindings);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain('class="calendar-board"');
    expect(body).toContain('src="/calendar.js"');
  });

  it("公開APIは能力鍵なしで予約状況を読むが一覧は持たない", async () => {
    const created = await createCalendar();
    const response = await app.request(
      `/api/calendars/${created.slug}/public`,
      undefined,
      bindings,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      calendar,
      calendarId: created.id,
      slots: [],
      status: "active",
    });
    expect((await app.request("/api/calendars", undefined, bindings)).status).toBe(404);
  });

  it("主催者鍵だけが管理内容を読み更新できる", async () => {
    const created = await createCalendar();
    const good = await app.request(
      `/api/calendars/${created.slug}/manage`,
      capabilityRequest("organizer", created.organizer),
      bindings,
    );
    expect(good.status).toBe(200);
    expect(await good.json()).toMatchObject({
      calendar,
      publicUrl: `${requestOrigin}/c/${created.slug}`,
    });
    expect(
      (
        await app.request(
          `/api/calendars/${created.slug}/manage`,
          capabilityRequest("invite", created.invite),
          bindings,
        )
      ).status,
    ).toBe(404);

    const update = { description: "案内を更新しました。", theme: "forest", title: "新しいリレー" };
    const response = await app.request(
      `/api/calendars/${created.slug}`,
      jsonRequest(update, {
        capability: { kind: "organizer", value: created.organizer },
        method: "PUT",
      }),
      bindings,
    );
    expect(response.status).toBe(200);
    const row = await bindings.DB.prepare("SELECT payload FROM calendars WHERE id = ?")
      .bind(created.id)
      .first<{ payload: string }>();
    expect(JSON.parse(row?.payload ?? "{}")).toEqual({ ...calendar, ...update });
  });

  it("主催者鍵で全体を削除する", async () => {
    const created = await createCalendar();
    const response = await app.request(
      `/api/calendars/${created.slug}`,
      capabilityRequest("organizer", created.organizer, { method: "DELETE" }),
      bindings,
    );
    expect(response.status).toBe(204);
    expect((await app.request(`/c/${created.slug}`, undefined, bindings)).status).toBe(404);
  });

  it("同じブラウザーからは1日3件まで作れる", async () => {
    await createCalendar();
    await createCalendar();
    await createCalendar();
    const response = await app.request("/api/calendars", jsonRequest(calendar), bindings);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "daily_limit" });
  });

  it.each([
    ["他Origin", jsonRequest(calendar, { origin: "https://evil.example" })],
    ["不正なUUID", jsonRequest(calendar, { session: "not-a-uuid" })],
    ["不正JSON", jsonRequest("{")],
    ["異なるContent-Type", jsonRequest(calendar, { contentType: "text/plain" })],
    ["大きいContent-Length", jsonRequest(calendar, { contentLength: 9000 })],
    ["余分なフィールド", jsonRequest({ ...calendar, privateNote: "secret" })],
  ])("作成時に%sを拒否する", async (_label, request) => {
    const response = await app.request("/api/calendars", request, bindings);
    expect(response.status).toBe(400);
  });
});

describe("slot lifecycle", () => {
  it("参加鍵で日付を予約し平文の枠編集鍵を保存しない", async () => {
    const created = await createCalendar();
    const reserved = await reserveSlot(created);
    expect(reserved.capability).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await bindings.DB.prepare(
      "SELECT participant_hash, article_url FROM slots WHERE id = ?",
    )
      .bind(reserved.id)
      .first<{ article_url: string; participant_hash: string }>();
    expect(row?.participant_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.participant_hash).not.toBe(reserved.capability);
    expect(row?.article_url).toBe("");
  });

  it("公開ページに予約、公開記事、外部リンクを安全に表示する", async () => {
    const created = await createCalendar();
    const reserved = await reserveSlot(created, {
      input: {
        ...slot,
        articleTitle: "<img src=x onerror=alert(1)>",
        articleUrl: "https://example.com/article",
      },
    });
    const response = await app.request(`/c/${created.slug}`, undefined, bindings);
    const body = await response.text();
    expect(body).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(body).not.toContain("<img src=x onerror=alert(1)>");
    expect(body).toContain('href="https://example.com/article"');
    expect(body).toContain('rel="noopener noreferrer"');
    expect(reserved.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("同じ日付の二重予約と期間外を拒否する", async () => {
    const created = await createCalendar();
    await reserveSlot(created);
    const duplicate = await app.request(
      `/api/calendars/${created.slug}/slots`,
      jsonRequest(slot, { capability: { kind: "invite", value: created.invite } }),
      bindings,
    );
    expect(duplicate.status).toBe(409);
    const outside = await app.request(
      `/api/calendars/${created.slug}/slots`,
      jsonRequest(
        { ...slot, slotDate: plusDays(calendar.endDate, 1) },
        { capability: { kind: "invite", value: created.invite } },
      ),
      bindings,
    );
    expect(outside.status).toBe(400);
  });

  it("公開URLや主催者鍵では予約できない", async () => {
    const created = await createCalendar();
    expect(
      (
        await app.request(
          `/api/calendars/${created.slug}/slots`,
          jsonRequest(slot, { capability: { kind: "organizer", value: created.organizer } }),
          bindings,
        )
      ).status,
    ).toBe(404);
    expect(
      (await app.request(`/api/calendars/${created.slug}/slots`, jsonRequest(slot), bindings))
        .status,
    ).toBe(404);
  });

  it("枠編集鍵で記事を公開し、初回だけpublishを記録する", async () => {
    const created = await createCalendar();
    const reserved = await reserveSlot(created);
    const published = {
      articleTitle: slot.articleTitle,
      articleUrl: "https://example.com/article",
      displayName: slot.displayName,
    };
    const response = await app.request(
      `/api/slots/${reserved.id}`,
      jsonRequest(published, {
        capability: { kind: "entry", value: reserved.capability },
        method: "PUT",
      }),
      bindings,
    );
    expect(response.status).toBe(200);
    const first = await bindings.DB.prepare(
      "SELECT name FROM product_events WHERE calendar_id = ? ORDER BY id DESC LIMIT 1",
    )
      .bind(created.id)
      .first<{ name: string }>();
    expect(first?.name).toBe("slot_published");

    await app.request(
      `/api/slots/${reserved.id}`,
      jsonRequest(
        { ...published, articleTitle: "更新題" },
        {
          capability: { kind: "entry", value: reserved.capability },
          method: "PUT",
        },
      ),
      bindings,
    );
    const second = await bindings.DB.prepare(
      "SELECT name FROM product_events WHERE calendar_id = ? ORDER BY id DESC LIMIT 1",
    )
      .bind(created.id)
      .first<{ name: string }>();
    expect(second?.name).toBe("slot_updated");
  });

  it("枠編集鍵で予約を取り消せる", async () => {
    const created = await createCalendar();
    const reserved = await reserveSlot(created);
    const response = await app.request(
      `/api/slots/${reserved.id}`,
      capabilityRequest("entry", reserved.capability, { method: "DELETE" }),
      bindings,
    );
    expect(response.status).toBe(204);
    expect(
      (
        await app.request(
          `/api/slots/${reserved.id}`,
          capabilityRequest("entry", reserved.capability),
          bindings,
        )
      ).status,
    ).toBe(404);
  });

  it("主催者鍵で任意の予約を解放する", async () => {
    const created = await createCalendar();
    const reserved = await reserveSlot(created);
    const response = await app.request(
      `/api/calendars/${created.slug}/slots/${reserved.id}`,
      capabilityRequest("organizer", created.organizer, { method: "DELETE" }),
      bindings,
    );
    expect(response.status).toBe(204);
    const count = await bindings.DB.prepare("SELECT COUNT(*) AS count FROM slots WHERE id = ?")
      .bind(reserved.id)
      .first<{ count: number }>();
    expect(count?.count).toBe(0);
  });
});

describe("reporting", () => {
  it("異なる3セッション・接続元の報告で非表示にする", async () => {
    const created = await createCalendar();
    expect((await reportCalendar(created.slug, session(1))).status).toBe(202);
    expect((await reportCalendar(created.slug, session(2))).status).toBe(202);
    const third = await reportCalendar(created.slug, session(3));
    expect(third.status).toBe(202);
    expect(await third.json()).toEqual({ hidden: true, ok: true });
    expect((await app.request(`/c/${created.slug}`, undefined, bindings)).status).toBe(404);
    const row = await bindings.DB.prepare("SELECT report_count, status FROM calendars WHERE id = ?")
      .bind(created.id)
      .first<{ report_count: number; status: string }>();
    expect(row).toEqual({ report_count: 3, status: "hidden" });
  });

  it("同じセッションまたは同じ接続元は一度だけ数える", async () => {
    const first = await createCalendar();
    await reportCalendar(first.slug, session(1), { reporterIp: "203.0.113.90" });
    await reportCalendar(first.slug, session(1), { reporterIp: "203.0.113.91" });
    await reportCalendar(first.slug, session(2), { reporterIp: "203.0.113.90" });
    const count = await bindings.DB.prepare(
      "SELECT COUNT(*) AS count FROM calendar_reports WHERE calendar_id = ?",
    )
      .bind(first.id)
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("QA報告は自動非表示に使わない", async () => {
    const created = await createCalendar({ qa: true });
    for (let index = 1; index <= 4; index += 1) {
      const response = await reportCalendar(created.slug, session(index), { qa: true });
      expect(response.status).toBe(202);
      expect((await response.json<{ hidden: boolean }>()).hidden).toBe(false);
    }
    expect((await app.request(`/c/${created.slug}`, undefined, bindings)).status).toBe(200);
  });

  it("主催者の修正保存で報告履歴を消し再公開する", async () => {
    const created = await createCalendar();
    await reportCalendar(created.slug, session(1));
    await reportCalendar(created.slug, session(2));
    await reportCalendar(created.slug, session(3));
    const response = await app.request(
      `/api/calendars/${created.slug}`,
      jsonRequest(
        { description: "内容を見直しました。", theme: "berry", title: calendar.title },
        { capability: { kind: "organizer", value: created.organizer }, method: "PUT" },
      ),
      bindings,
    );
    expect(response.status).toBe(200);
    const row = await bindings.DB.prepare(
      `SELECT c.report_count, c.status,
       (SELECT COUNT(*) FROM calendar_reports r WHERE r.calendar_id = c.id) AS reports
       FROM calendars c WHERE c.id = ?`,
    )
      .bind(created.id)
      .first<{ report_count: number; reports: number; status: string }>();
    expect(row).toEqual({ report_count: 0, reports: 0, status: "active" });
    expect((await app.request(`/c/${created.slug}`, undefined, bindings)).status).toBe(200);
  });

  it.each([
    ["未知の理由", { reason: "copyright" }],
    ["余分な項目", { note: "secret", reason: "spam" }],
  ])("%sを拒否する", async (_label, body) => {
    const created = await createCalendar();
    const response = await app.request(
      `/api/calendars/${created.slug}/report`,
      jsonRequest(body, { session: session(1) }),
      bindings,
    );
    expect(response.status).toBe(400);
  });
});

describe("anonymous events", () => {
  it.each(["visited", "calendar_opened", "join_opened", "outbound_opened", "returned"])(
    "%s を許可する",
    async (name) => {
      const response = await app.request(
        "/api/events",
        jsonRequest({ calendarId: "", name }),
        bindings,
      );
      expect(response.status, await response.clone().text()).toBe(202);
      const row = await bindings.DB.prepare(
        "SELECT name, calendar_id, session_id, is_qa FROM product_events ORDER BY id DESC LIMIT 1",
      ).first<{
        calendar_id: string | null;
        is_qa: number;
        name: string;
        session_id: string;
      }>();
      expect(row).toEqual({
        calendar_id: null,
        is_qa: 0,
        name,
        session_id: primarySession,
      });
    },
  );

  it("有効なカレンダーIDとQA区分を記録する", async () => {
    const created = await createCalendar({ qa: true });
    const response = await app.request(
      "/api/events",
      jsonRequest(
        { calendarId: created.id, name: "calendar_opened" },
        { qa: true, session: session(9) },
      ),
      bindings,
    );
    expect(response.status).toBe(202);
    const row = await bindings.DB.prepare(
      "SELECT is_qa, calendar_id FROM product_events ORDER BY id DESC LIMIT 1",
    ).first<{ calendar_id: string; is_qa: number }>();
    expect(row).toEqual({ calendar_id: created.id, is_qa: 1 });
  });

  it.each([
    ["サーバー操作名", { calendarId: "", name: "calendar_created" }],
    ["未知の名前", { calendarId: "", name: "page_scrolled" }],
    ["余分なフィールド", { calendarId: "", name: "visited", url: "secret" }],
    ["ID欠落", { name: "visited" }],
    ["不正ID", { calendarId: "not-a-uuid", name: "calendar_opened" }],
  ])("%s を拒否する", async (_label, body) => {
    const response = await app.request("/api/events", jsonRequest(body), bindings);
    expect(response.status).toBe(400);
  });

  it("イベント契約には14種類だけがある", () => {
    expect([...eventNames].sort()).toEqual(
      [
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
      ].sort(),
    );
  });
});

describe("retention", () => {
  it("45日超のイベントと30日超の非表示カレンダーだけを削除する", async () => {
    const now = Math.floor(Date.now() / 1000);
    const hidden = await createCalendar({ session: session(21) });
    const active = await createCalendar({ session: session(22) });
    await bindings.DB.prepare("UPDATE calendars SET status = 'hidden', updated_at = ? WHERE id = ?")
      .bind(now - 31 * 86400, hidden.id)
      .run();
    await bindings.DB.prepare("UPDATE calendars SET updated_at = ? WHERE id = ?")
      .bind(now - 90 * 86400, active.id)
      .run();
    await bindings.DB.prepare(
      `INSERT INTO product_events
       (name, session_id, calendar_id, day, created_at, is_qa)
       VALUES ('visited', ?, NULL, '2026-01-01', ?, 0)`,
    )
      .bind(session(23), now - 46 * 86400)
      .run();

    await scheduled({} as ScheduledController, bindings, {} as ExecutionContext);

    const rows = await bindings.DB.prepare("SELECT id, status FROM calendars ORDER BY id").all<{
      id: string;
      status: string;
    }>();
    expect(rows.results).toEqual([{ id: active.id, status: "active" }]);
    const oldEvent = await bindings.DB.prepare(
      "SELECT COUNT(*) AS count FROM product_events WHERE session_id = ?",
    )
      .bind(session(23))
      .first<{ count: number }>();
    expect(oldEvent?.count).toBe(0);
  });
});

describe("release contract", () => {
  it("ブラウザーは同一Originの製品APIだけを呼ぶ", async () => {
    const sources = (
      await Promise.all(
        [commonPath, appPath, joinPath, managePath, entryPath, calendarPath].map((path) =>
          readFile(path, "utf8"),
        ),
      )
    ).join("\n");
    expect(sources).toContain('fetch("/api/events"');
    expect(sources).toContain("fetchJson(`/api/calendars/${slug}/slots`");
    expect(sources).toContain("fetchJson(`/api/calendars/${slug}/manage`");
    expect(sources).toContain("fetchJson(`/api/slots/${id}`");
    expect(sources).not.toMatch(/fetch\(\s*["']https?:\/\//);
    expect(sources).not.toMatch(/innerHTML|eval\(|new Function/);
  });

  it("テレメトリ表に内容や能力鍵の列を持たない", async () => {
    const migration = await readFile(migrationPath, "utf8");
    const eventTable = migration.split("CREATE TABLE product_events")[1];
    expect(eventTable).toContain("CHECK(name IN");
    expect(eventTable).toContain("is_qa");
    expect(eventTable).not.toMatch(
      /\b(display_name|description|article_title|article_url|capability|email|phone|user_agent|ip_address|referrer)\b/i,
    );
  });

  it("計測SQLはQAを除外し利用の深さを判定する", async () => {
    const source = await readFile(metricsPath, "utf8");
    expect(source).toContain("WHERE is_qa = 0");
    expect(source).toContain("reservers >= 5");
    expect(source).toContain("published_slots >= 3");
    expect(source).toContain("outbound_readers >= 2");
    expect(source).toContain("updated_day > created_day");
  });

  it("Service Workerは共有・能力ページをキャッシュしない", async () => {
    const source = await readFile(serviceWorkerPath, "utf8");
    expect(source).toContain('const cacheName = "relay-goyomi-v1"');
    expect(source).toContain('"/common.js"');
    expect(source).toContain("cacheablePaths.has(url.pathname)");
    expect(source).not.toContain('"/c/"');
    expect(source).not.toContain('"/join/"');
    expect(source).not.toContain('"/manage/"');
    expect(source).not.toContain('"/entry/"');
  });

  it("見出しを32px以下に保つ", async () => {
    const source = await readFile(stylesPath, "utf8");
    expect(source).toContain("clamp(1.75rem, 3.2vw, 2rem)");
    expect(source).not.toMatch(/h1\s*\{[^}]*font-size:\s*(?:[4-9]\d|[1-9]\d{2})px/s);
  });

  it("PWAと検索向けメタデータが製品固有", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const sitemap = await readFile(sitemapPath, "utf8");
    const robots = await readFile(robotsPath, "utf8");
    expect(manifest.name).toBe("リレー暦");
    expect(manifest.description).toContain("記事リレー");
    expect(sitemap.match(/<url>/g)).toHaveLength(3);
    expect(sitemap).toContain(origin);
    expect(robots).toContain(`${origin}/sitemap.xml`);
    expect(robots).not.toContain("Disallow:");
  });

  it("OGは用途を絵で示す十分なラスター画像", async () => {
    const source = await readFile(ogPath);
    expect(source.byteLength).toBeGreaterThan(50000);
    expect(source.subarray(1, 4).toString("ascii")).toBe("PNG");
  });

  it("ワーカーは厳格なCSPと保持期限を持つ", async () => {
    const source = await readFile(workerPath, "utf8");
    expect(source).toContain("styleSrc: [\"'self'\"]");
    expect(source).not.toContain("'unsafe-inline'");
    expect(source).not.toMatch(/style=\{/);
    expect(source).toContain("45 * 86400");
    expect(source).toContain("30 * 86400");
    expect(source).toContain("DELETE FROM product_events WHERE created_at <= ?");
  });
});
