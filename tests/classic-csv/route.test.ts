import assert from "node:assert/strict";
import test from "node:test";
import type { AuthContext } from "../../src/server/auth/context";
import { CLASSIC_CSV_QUERIES } from "../../src/server/bitget-classic-queries";
import { parseClassicCSV } from "../../src/server/bitget-classic-policy";
import type { DbSession } from "../../src/server/db/client";
import {
  createClassicCSVCommitHandler,
  createClassicCSVImportsHandler,
  createClassicCSVPreviewHandler,
  createSpotActivitiesHandler,
  createSpotActivityPurposeHandler,
} from "../../src/server/imports/bitget-classic/http";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const auth: AuthContext = { userId: USER_ID, provider: "neon-auth", subject: "trusted-subject" };
const authProvider = { getContext: async () => auth };
const anonymous = { getContext: async () => null };

const ORDER_HEADER = "Date,Type,Order Id,Trading pair,Base Asset,Quote Asset,Direction,Price,Order amount,Executed,Average Price,Trading volume,Status";
const CSV = [
  ORDER_HEADER,
  "2025-01-05 10:00:00,Limit,700001,AAA/USDT,AAA,USDT,Buy,7.5,10,10,7.5,75,fully executed",
  "Date,Trading Price,Executed,Trading volume,Fee",
  "2025-01-05 10:00:01,7.5,10,75,0.075 USDT",
].join("\n");
const INCOMPLETE_CSV = [
  ORDER_HEADER,
  "2025-01-05 10:00:00,Limit,700009,AAA/USDT,AAA,USDT,Buy,7.5,10,6,7.5,45,partially filled",
  "Date,Trading Price,Executed,Trading volume,Fee",
  "2025-01-05 10:00:01,7.5,4,30,0.03 USDT",
].join("\n");

type Row = Record<string, unknown>;

function fakeDb() {
  const store = { imports: [] as Row[], activities: [] as Row[], executions: [] as Row[], events: [] as Row[] };
  let seq = 0;
  const uuid = () => `99999999-9999-4999-8999-${String(++seq).padStart(12, "0")}`;
  async function dispatch(text: string, values: readonly unknown[] = []): Promise<{ rows: Row[] }> {
    if (text === CLASSIC_CSV_QUERIES.lockOwner) return { rows: [{ id: values[0] }] };
    if (text === CLASSIC_CSV_QUERIES.findImport) return { rows: store.imports.filter((row) => row.user_id === values[0] && row.source_hash === values[2] && row.account_scope === values[1]) };
    if (text === CLASSIC_CSV_QUERIES.getImport) return { rows: store.imports.filter((row) => row.id === values[1] && row.user_id === values[0]) };
    if (text === CLASSIC_CSV_QUERIES.listImports) return { rows: store.imports.filter((row) => row.user_id === values[0]).slice(0, Number(values[2])) };
    if (text === CLASSIC_CSV_QUERIES.insertImport) {
      const row: Row = { id: uuid(), user_id: values[0], account_scope: values[1], source_hash: values[2], parser_version: values[3], imported_at: "" };
      store.imports.push(row);
      return { rows: [row] };
    }
    if (text === CLASSIC_CSV_QUERIES.findOrders) return { rows: store.activities.filter((row) => row.user_id === values[0] && row.account_scope === values[1] && (values[2] as string[]).includes(String(row.order_id))) };
    if (text === CLASSIC_CSV_QUERIES.getActivity) return { rows: store.activities.filter((row) => row.id === values[1] && row.user_id === values[0]) };
    if (text === CLASSIC_CSV_QUERIES.listActivities) return { rows: store.activities.filter((row) => row.user_id === values[0]).slice(0, Number(values[2])) };
    if (text === CLASSIC_CSV_QUERIES.insertActivity) {
      const row: Row = {
        id: uuid(), user_id: values[0], account_scope: values[1], order_id: values[2], identity_hash: values[3],
        base_asset: values[4], quote_asset: values[5], trading_pair: values[6], direction: values[7],
        exchange: "bitget", source_kind: "classic_spot_csv", created_at: "",
      };
      store.activities.push(row);
      return { rows: [row] };
    }
    if (text === CLASSIC_CSV_QUERIES.executions) return { rows: store.executions.filter((row) => row.user_id === values[0] && (values[1] as string[]).includes(String(row.activity_id))) };
    if (text === CLASSIC_CSV_QUERIES.insertExecution) {
      const row: Row = {
        id: uuid(), user_id: values[0], activity_id: values[1], execution_key: values[2], signature: values[3], occurrence: values[4],
        timestamp_text: values[5], timezone_status: "unknown", price: values[6], quantity: values[7], gross_volume: values[8],
        fee_amount: values[9], fee_currency: values[10], reported: JSON.parse(String(values[11])), created_at: "",
      };
      store.executions.push(row);
      return { rows: [row] };
    }
    if (text === CLASSIC_CSV_QUERIES.events) return { rows: store.events.filter((row) => row.user_id === values[0] && (values[1] as string[]).includes(String(row.activity_id))) };
    if (text === CLASSIC_CSV_QUERIES.importEvents) return { rows: store.events.filter((row) => row.user_id === values[0] && row.import_id === values[1] && row.event_type === "source_snapshot") };
    if (text === CLASSIC_CSV_QUERIES.latestPurposes) {
      const ids = values[1] as string[];
      const rows = store.events.filter((row) => row.user_id === values[0] && ids.includes(String(row.activity_id)) && row.event_type === "purpose_change").sort((a, b) => Number(b.event_version) - Number(a.event_version));
      const seen = new Set<string>();
      return { rows: rows.filter((row) => !seen.has(String(row.activity_id)) && seen.add(String(row.activity_id))) };
    }
    if (text === CLASSIC_CSV_QUERIES.insertEvent) {
      const row: Row = { id: uuid(), user_id: values[0], activity_id: values[1], import_id: values[2], event_type: values[3], event_version: values[4], data: JSON.parse(String(values[5])) };
      store.events.push(row);
      return { rows: [row] };
    }
    throw new Error(`unexpected query: ${text.slice(0, 100)}`);
  }
  const asQueryable = <T>(text: string, values?: readonly unknown[]) => dispatch(text, values) as Promise<{ rows: T[] }>;
  const db: DbSession = { query: asQueryable, transaction: (fn) => fn({ query: asQueryable }) };
  return { db, store };
}

function multipart(fields: Record<string, string | string[]>, file?: { content: string | Uint8Array; type?: string; name?: string }): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) form.append(key, item);
  }
  if (file) {
    const content: BlobPart = typeof file.content === "string" ? file.content : file.content.slice().buffer as ArrayBuffer;
    form.append("file", new Blob([content], { type: file.type ?? "text/csv" }), file.name ?? "orders.csv");
  }
  return new Request("http://localhost/api/imports/bitget-classic/preview", { method: "POST", body: form });
}

function commitRequest(csv: string = CSV, overrides: Record<string, string | string[]> = {}, file: { content: string | Uint8Array; name?: string } = { content: csv }): Request {
  const hash = parseClassicCSV(new TextEncoder().encode(csv)).sourceHash;
  const purposes = parseClassicCSV(new TextEncoder().encode(csv)).orders.map((order) => ({ orderId: order.orderId, purpose: "payment_conversion" }));
  return multipart({ accountScope: "main", previewHash: hash, confirmed: "true", purposes: JSON.stringify(purposes), ...overrides }, file);
}

test("preview accepts a multipart CSV and returns the parser result", async () => {
  const { db } = fakeDb();
  const handler = createClassicCSVPreviewHandler({ db, authProvider });
  const response = await handler(multipart({ accountScope: "main" }, { content: CSV }));
  assert.equal(response.status, 200);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.accountScope, "main");
  assert.equal(body.accountScopeBasis, "user_declared_unverified");
  const preview = body.preview as Record<string, unknown>;
  assert.equal(preview.policyVersion, "bitget_classic_spot_order_history.v1");
  assert.equal((preview.orders as Row[]).length, 1);
});

test("preview requires authentication and rejects wrong media types exactly", async () => {
  const { db } = fakeDb();
  const anonymousHandler = createClassicCSVPreviewHandler({ db, authProvider: anonymous });
  assert.equal((await anonymousHandler(multipart({}, { content: CSV }))).status, 401);
  const handler = createClassicCSVPreviewHandler({ db, authProvider });
  const json = new Request("http://localhost/api/imports/bitget-classic/preview", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal((await handler(json)).status, 415);
  const prefixed = new Request("http://localhost/api/imports/bitget-classic/preview", { method: "POST", headers: { "content-type": "multipart/form-data-extra; boundary=x" }, body: "x" });
  assert.equal((await handler(prefixed)).status, 415);
  assert.equal((await handler(multipart({}))).status, 400);
});

test("oversized uploads are rejected with 413 regardless of declared length", async () => {
  const { db } = fakeDb();
  const handler = createClassicCSVPreviewHandler({ db, authProvider });
  const oversized = new Uint8Array(2 * 1024 * 1024 + 64 * 1024 + 1);
  const request = new Request("http://localhost/api/imports/bitget-classic/preview", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=x", "content-length": "10" },
    body: oversized,
  });
  assert.equal((await handler(request)).status, 413);
  const inside = new FormData();
  inside.append("file", new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: "text/csv" }), "big.csv");
  const response = await handler(new Request("http://localhost/api/imports/bitget-classic/preview", { method: "POST", body: inside }));
  assert.equal(response.status, 413);
});

test("duplicate and unknown multipart keys are rejected", async () => {
  const { db } = fakeDb();
  const handler = createClassicCSVPreviewHandler({ db, authProvider });
  assert.equal((await handler(multipart({ accountScope: ["main", "alt"] }, { content: CSV }))).status, 400);
  assert.equal((await handler(multipart({ bogus: "x" }, { content: CSV }))).status, 400);
  const twoFiles = new FormData();
  twoFiles.append("file", new Blob([CSV], { type: "text/csv" }), "a.csv");
  twoFiles.append("file", new Blob([CSV], { type: "text/csv" }), "b.csv");
  const response = await handler(new Request("http://localhost/api/imports/bitget-classic/preview", { method: "POST", body: twoFiles }));
  assert.equal(response.status, 400);
});

test("invalid UTF-8 and malformed CSV content are rejected", async () => {
  const { db } = fakeDb();
  const handler = createClassicCSVPreviewHandler({ db, authProvider });
  assert.equal((await handler(multipart({}, { content: new Uint8Array([0xff, 0xfe, 0x41]) }))).status, 400);
  assert.equal((await handler(multipart({}, { content: "a,b,c\n1,2,3" }))).status, 400);
});

test("cross-origin posts are rejected with 403", async () => {
  const { db } = fakeDb();
  const handler = createClassicCSVPreviewHandler({ db, authProvider });
  const form = new FormData();
  form.append("file", new Blob([CSV], { type: "text/csv" }), "orders.csv");
  const crossSite = new Request("http://localhost/api/imports/bitget-classic/preview", {
    method: "POST",
    body: form,
    headers: { "sec-fetch-site": "cross-site" },
  });
  assert.equal((await handler(crossSite)).status, 403);
  const foreignOrigin = new Request("http://localhost/api/imports/bitget-classic/preview", {
    method: "POST",
    body: (() => {
      const again = new FormData();
      again.append("file", new Blob([CSV], { type: "text/csv" }), "orders.csv");
      return again;
    })(),
    headers: { origin: "https://evil.example" },
  });
  assert.equal((await handler(foreignOrigin)).status, 403);
});

test("incomplete previews return 200 ineligible and cannot be committed", async () => {
  const { db } = fakeDb();
  const preview = createClassicCSVPreviewHandler({ db, authProvider });
  const response = await preview(multipart({}, { content: INCOMPLETE_CSV }));
  assert.equal(response.status, 200);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal((body.preview as Row).importEligible, false);
  const commit = createClassicCSVCommitHandler({ db, authProvider });
  assert.equal((await commit(commitRequest(INCOMPLETE_CSV))).status, 400);
});

test("commit enforces confirmed=true, matching hash, and valid purposes", async () => {
  const { db, store } = fakeDb();
  const handler = createClassicCSVCommitHandler({ db, authProvider });
  const hash = parseClassicCSV(new TextEncoder().encode(CSV)).sourceHash;
  const purposes = JSON.stringify([{ orderId: "700001", purpose: "payment_conversion" }]);
  const unconfirmed = multipart({ accountScope: "main", previewHash: hash, confirmed: "false", purposes }, { content: CSV });
  assert.equal((await handler(unconfirmed)).status, 400);
  const badHash = multipart({ accountScope: "main", previewHash: "0".repeat(64), confirmed: "true", purposes }, { content: CSV });
  assert.equal((await handler(badHash)).status, 400);
  const duplicatePurpose = multipart(
    { accountScope: "main", previewHash: hash, confirmed: "true", purposes: JSON.stringify([{ orderId: "700001", purpose: "payment_conversion" }, { orderId: "700001", purpose: "unknown" }]) },
    { content: CSV },
  );
  assert.equal((await handler(duplicatePurpose)).status, 400);
  const missingPurpose = multipart(
    { accountScope: "main", previewHash: hash, confirmed: "true", purposes: "[]" },
    { content: CSV },
  );
  assert.equal((await handler(missingPurpose)).status, 400);
  const unknownPurpose = multipart(
    { accountScope: "main", previewHash: hash, confirmed: "true", purposes: JSON.stringify([{ orderId: "700001", purpose: "day_trade" }]) },
    { content: CSV },
  );
  assert.equal((await handler(unknownPurpose)).status, 400);
  const ok = multipart({ accountScope: "main", previewHash: hash, confirmed: "true", purposes }, { content: CSV });
  const response = await handler(ok);
  assert.equal(response.status, 200);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.insertedOrderCount, 1);
  assert.equal(body.repeatedFile, false);
  assert.equal(store.activities.length, 1);
});

test("commit rejects overlong or NUL-containing filenames", async () => {
  const { db, store } = fakeDb();
  const handler = createClassicCSVCommitHandler({ db, authProvider });
  assert.equal((await handler(commitRequest(CSV, {}, { content: CSV, name: `${"a".repeat(256)}.csv` }))).status, 400);
  assert.equal((await handler(commitRequest(CSV, {}, { content: CSV, name: "evil\0name.csv" }))).status, 400);
  const ok = await handler(commitRequest(CSV, {}, { content: CSV, name: `${"b".repeat(251)}.csv` }));
  assert.equal(ok.status, 200);
  assert.equal(String(store.imports[0].source_filename ?? "").length <= 255, true);
});

test("list endpoints allow only limit and cursor query keys and reject invalid cursors", async () => {
  const { db } = fakeDb();
  const imports = createClassicCSVImportsHandler({ db, authProvider });
  const response = await imports(new Request("http://localhost/api/imports/bitget-classic"));
  assert.equal(response.status, 200);
  assert.deepEqual(((await response.json()) as Record<string, unknown>).imports, []);
  assert.equal((await imports(new Request("http://localhost/api/imports/bitget-classic?bogus=1"))).status, 400);
  assert.equal((await imports(new Request("http://localhost/api/imports/bitget-classic?cursor=not-a-uuid"))).status, 400);
  const activities = createSpotActivitiesHandler({ db, authProvider });
  assert.equal((await activities(new Request("http://localhost/api/activities?limit=10"))).status, 200);
  assert.equal((await activities(new Request("http://localhost/api/activities?limit=10&extra=1"))).status, 400);
  assert.equal((await activities(new Request("http://localhost/api/activities?cursor=bogus"))).status, 400);
  const anonymousImports = createClassicCSVImportsHandler({ db, authProvider: anonymous });
  assert.equal((await anonymousImports(new Request("http://localhost/api/imports/bitget-classic"))).status, 401);
});

test("purpose endpoint validates a strict versioned body", async () => {
  const { db, store } = fakeDb();
  const commit = createClassicCSVCommitHandler({ db, authProvider });
  const ok = await commit(commitRequest(CSV, { purposes: JSON.stringify([{ orderId: "700001", purpose: "unknown" }]) }));
  assert.equal(ok.status, 200);
  const activityId = String(store.activities[0].id);
  const purpose = createSpotActivityPurposeHandler({ db, authProvider });
  const request = (body: unknown) => new Request("http://localhost/api/activities/x/purpose", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await purpose(request({ purpose: "speculative_trade", expectedVersion: 1, extra: true }), { id: activityId })).status, 400);
  assert.equal((await purpose(request({ purpose: "bogus", expectedVersion: 1 }), { id: activityId })).status, 400);
  assert.equal((await purpose(request({ expectedVersion: 1 }), { id: activityId })).status, 400);
  const accepted = await purpose(request({ purpose: "speculative_trade", expectedVersion: 1 }), { id: activityId });
  assert.equal(accepted.status, 200);
  const body = (await accepted.json()) as Record<string, unknown>;
  assert.equal((body.purpose as Row).value, "speculative_trade");
  const staleDifferent = await purpose(request({ purpose: "other_nontrading", expectedVersion: 1 }), { id: activityId });
  assert.equal(staleDifferent.status, 409);
  const staleSame = await purpose(request({ purpose: "speculative_trade", expectedVersion: 1 }), { id: activityId });
  assert.equal(staleSame.status, 200);
});
