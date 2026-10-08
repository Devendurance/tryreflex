import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import type { AuthContext } from "../../src/server/auth/context";
import { CLASSIC_CSV_QUERIES } from "../../src/server/bitget-classic-queries";
import { CLASSIC_CSV_VERSION, parseClassicCSV, summarizeClassicOrders, type ActivityPurpose } from "../../src/server/bitget-classic-policy";
import type { DbSession } from "../../src/server/db/client";
import { PersistenceError, RepositoryError } from "../../src/server/db/repositories";
import { createClassicCsvRepository } from "../../src/server/imports/bitget-classic/repository";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const FOREIGN = "22222222-2222-4222-8222-222222222222";
const auth: AuthContext = { userId: USER_ID, provider: "neon-auth", subject: "trusted-subject" };
const foreignAuth: AuthContext = { userId: FOREIGN, provider: "neon-auth", subject: "foreign-subject" };

type Row = Record<string, unknown>;

const ORDER_HEADER = "Date,Type,Order Id,Trading pair,Base Asset,Quote Asset,Direction,Price,Order amount,Executed,Average Price,Trading volume,Status";
const EXECUTION_HEADER = "Date,Trading Price,Executed,Trading volume,Fee";

const encode = (text: string) => new TextEncoder().encode(text);

function csvText(orderId = "700001", fills: string[] = ["2025-01-05 10:00:01,7.5,10,75,0.075 USDT"], order: { executed?: string; volume?: string; status?: string; average?: string; amount?: string } = {}): string {
  const executed = order.executed ?? "10";
  const volume = order.volume ?? "75";
  const status = order.status ?? "fully executed";
  const average = order.average ?? "7.5";
  const amount = order.amount ?? "10";
  return [
    ORDER_HEADER,
    `2025-01-05 10:00:00,Limit,${orderId},AAA/USDT,AAA,USDT,Buy,7.5,${amount},${executed},${average},${volume},${status}`,
    EXECUTION_HEADER,
    ...fills,
  ].join("\n");
}

const uuid = (n: number) => `99999999-9999-4999-8999-${String(n).padStart(12, "0")}`;

interface FakeState {
  imports: Row[];
  activities: Row[];
  executions: Row[];
  events: Row[];
}

const cloneState = (store: FakeState): FakeState => JSON.parse(JSON.stringify(store)) as FakeState;

interface FakeOptions {
  leak?: boolean;
  failOn?: (text: string, values: readonly unknown[]) => boolean;
}

function fakeDb(state: Partial<FakeState> = {}, options: FakeOptions = {}) {
  const { leak = false, failOn } = options;
  const calls: { text: string; values: readonly unknown[] }[] = [];
  const store: FakeState = { imports: [...(state.imports ?? [])], activities: [...(state.activities ?? [])], executions: [...(state.executions ?? [])], events: [...(state.events ?? [])] };
  let seq = 100;
  let active = store;
  let tail: Promise<void> = Promise.resolve();

  async function dispatch(text: string, values: readonly unknown[] = []): Promise<{ rows: Row[] }> {
    calls.push({ text, values });
    if (failOn?.(text, values)) throw new PersistenceError();
    if (text === CLASSIC_CSV_QUERIES.lockOwner) return { rows: [{ id: values[0] }] };
    if (text === CLASSIC_CSV_QUERIES.findImport) {
      return { rows: active.imports.filter((row) => row.user_id === values[0] && row.account_scope === values[1] && row.source_hash === values[2]) };
    }
    if (text === CLASSIC_CSV_QUERIES.getImport) {
      return { rows: active.imports.filter((row) => row.id === values[1] && row.user_id === values[0]) };
    }
    if (text === CLASSIC_CSV_QUERIES.listImports) {
      const sorted = [...active.imports].filter((row) => row.user_id === values[0]).sort((a, b) => String(b.id).localeCompare(String(a.id)));
      const cursor = values[1] as string | null;
      const start = cursor ? sorted.findIndex((row) => row.id === cursor) + 1 : 0;
      return { rows: sorted.slice(start < 0 ? 0 : start, (start < 0 ? 0 : start) + Number(values[2])) };
    }
    if (text === CLASSIC_CSV_QUERIES.insertImport) {
      seq += 1;
      const row: Row = {
        id: uuid(seq), user_id: values[0], account_scope: values[1], source_hash: values[2], parser_version: values[3],
        source_filename: values[4], order_count: values[5], execution_count: values[6], warnings: JSON.parse(String(values[7])),
        imported_at: "2026-11-01T00:00:00.000Z",
      };
      active.imports.push(row);
      return { rows: [row] };
    }
    if (text === CLASSIC_CSV_QUERIES.findOrders) {
      const ids = values[2] as string[];
      return { rows: active.activities.filter((row) => (leak || row.user_id === values[0]) && row.account_scope === values[1] && ids.includes(String(row.order_id))) };
    }
    if (text === CLASSIC_CSV_QUERIES.getActivity) {
      return { rows: active.activities.filter((row) => row.id === values[1] && (leak || row.user_id === values[0])) };
    }
    if (text === CLASSIC_CSV_QUERIES.listActivities) {
      const sorted = [...active.activities].filter((row) => row.user_id === values[0]).sort((a, b) => String(b.id).localeCompare(String(a.id)));
      const cursor = values[1] as string | null;
      const start = cursor ? sorted.findIndex((row) => row.id === cursor) + 1 : 0;
      return { rows: sorted.slice(start < 0 ? 0 : start, (start < 0 ? 0 : start) + Number(values[2])) };
    }
    if (text === CLASSIC_CSV_QUERIES.insertActivity) {
      seq += 1;
      const row: Row = {
        id: uuid(seq), user_id: values[0], account_scope: values[1], exchange: "bitget", source_kind: "classic_spot_csv",
        order_id: values[2], identity_hash: values[3], base_asset: values[4], quote_asset: values[5], trading_pair: values[6],
        direction: values[7], created_at: "2026-11-01T00:00:00.000Z",
      };
      active.activities.push(row);
      return { rows: [row] };
    }
    if (text === CLASSIC_CSV_QUERIES.executions) {
      const ids = values[1] as string[];
      return { rows: active.executions.filter((row) => (leak || row.user_id === values[0]) && ids.includes(String(row.activity_id))) };
    }
    if (text === CLASSIC_CSV_QUERIES.insertExecution) {
      seq += 1;
      const row: Row = {
        id: uuid(seq), user_id: values[0], activity_id: values[1], execution_key: values[2], signature: values[3], occurrence: values[4],
        timestamp_text: values[5], timezone_status: "unknown", price: values[6], quantity: values[7], gross_volume: values[8],
        fee_amount: values[9], fee_currency: values[10], reported: JSON.parse(String(values[11])), created_at: "2026-11-01T00:00:00.000Z",
      };
      active.executions.push(row);
      return { rows: [row] };
    }
    if (text === CLASSIC_CSV_QUERIES.events) {
      const ids = values[1] as string[];
      return { rows: active.events.filter((row) => (leak || row.user_id === values[0]) && ids.includes(String(row.activity_id))) };
    }
    if (text === CLASSIC_CSV_QUERIES.importEvents) {
      return { rows: active.events.filter((row) => row.user_id === values[0] && row.import_id === values[1] && row.event_type === "source_snapshot") };
    }
    if (text === CLASSIC_CSV_QUERIES.latestPurposes) {
      const ids = values[1] as string[];
      const rows = active.events
        .filter((row) => row.user_id === values[0] && ids.includes(String(row.activity_id)) && row.event_type === "purpose_change")
        .sort((a, b) => Number(b.event_version) - Number(a.event_version));
      const seen = new Set<string>();
      return { rows: rows.filter((row) => !seen.has(String(row.activity_id)) && seen.add(String(row.activity_id))) };
    }
    if (text === CLASSIC_CSV_QUERIES.insertEvent) {
      seq += 1;
      const row: Row = {
        id: uuid(seq), user_id: values[0], activity_id: values[1], import_id: values[2], event_type: values[3],
        event_version: values[4], data: JSON.parse(String(values[5])), created_at: "2026-11-01T00:00:00.000Z",
      };
      active.events.push(row);
      return { rows: [row] };
    }
    throw new Error(`unexpected query: ${text.slice(0, 120)}`);
  }

  const asQueryable = <T>(text: string, values?: readonly unknown[]) => dispatch(text, values) as Promise<{ rows: T[] }>;
  const db: DbSession = {
    query: asQueryable,
    transaction: (fn) => {
      const run = tail.then(async () => {
        const tx = cloneState(store);
        active = tx;
        try {
          const result = await fn({ query: asQueryable });
          store.imports = tx.imports;
          store.activities = tx.activities;
          store.executions = tx.executions;
          store.events = tx.events;
          return result;
        } finally {
          active = store;
        }
      });
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
  return { db, calls, state: store };
}

const PURPOSE: ActivityPurpose = "payment_conversion";

async function commitCsv(repo: ReturnType<typeof createClassicCsvRepository>, text: string, purpose: ActivityPurpose = PURPOSE, scope = "main", filename: string | null = "orders.csv") {
  const bytes = encode(text);
  const parsed = parseClassicCSV(bytes);
  const purposes = parsed.orders.map((order) => ({ orderId: order.orderId, purpose }));
  return repo.commit(scope, bytes, { previewHash: parsed.sourceHash, confirmed: true, purposes, filename });
}

test("commit imports a new CSV with source snapshot and initial purpose", async () => {
  const { db, state, calls } = fakeDb();
  const repo = createClassicCsvRepository(db, auth);
  const parsed = parseClassicCSV(encode(csvText()));
  const result = await commitCsv(repo, csvText());
  assert.equal(result.status, 200);
  const body = result.body as Record<string, unknown>;
  assert.equal(body.repeatedFile, false);
  assert.equal(body.insertedOrderCount, 1);
  assert.equal(body.insertedExecutionCount, 1);
  assert.equal(state.imports.length, 1);
  assert.equal(state.activities.length, 1);
  assert.equal(state.executions.length, 1);
  const snapshots = state.events.filter((row) => row.event_type === "source_snapshot");
  assert.equal(snapshots.length, 1);
  assert.equal((snapshots[0].data as Row).parserVersion, CLASSIC_CSV_VERSION);
  const purposeEvents = state.events.filter((row) => row.event_type === "purpose_change");
  assert.equal(purposeEvents.length, 1);
  assert.equal(purposeEvents[0].event_version, 1);
  assert.equal((purposeEvents[0].data as Row).purpose, "payment_conversion");
  const activity = (body.activities as Row[])[0];
  assert.equal((activity.purpose as Row).value, "payment_conversion");
  assert.equal((activity.safety as Row).tradingIntelligenceEligible, false);
  assert.deepEqual(activity.order, parsed.orders[0]);
  assert.deepEqual(activity.metrics, summarizeClassicOrders([parsed.orders[0]]));
  assert.ok(calls.some((call) => call.text === CLASSIC_CSV_QUERIES.lockOwner));
});

test("repeating the same file returns existing counts, ignores new purposes, and appends nothing", async () => {
  const { db, state } = fakeDb();
  const repo = createClassicCsvRepository(db, auth);
  await commitCsv(repo, csvText());
  const second = await commitCsv(repo, csvText(), "speculative_trade");
  const body = second.body as Record<string, unknown>;
  assert.equal(body.repeatedFile, true);
  assert.equal(body.existingPurposesAuthoritative, true);
  assert.equal(body.insertedOrderCount, 0);
  assert.equal(body.existingOrderCount, 1);
  assert.equal(state.activities.length, 1);
  assert.equal(state.events.filter((row) => row.event_type === "purpose_change").length, 1);
  const activity = (body.activities as Row[])[0];
  assert.equal((activity.purpose as Row).value, "payment_conversion");
});

test("commit requires confirmation, matching preview hash, and complete parses", async () => {
  const { db } = fakeDb();
  const repo = createClassicCsvRepository(db, auth);
  const bytes = encode(csvText());
  const parsed = parseClassicCSV(bytes);
  const purposes = [{ orderId: "700001", purpose: PURPOSE }];
  await assert.rejects(
    () => repo.commit("main", bytes, { previewHash: parsed.sourceHash, confirmed: false, purposes, filename: null }),
    (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT",
  );
  await assert.rejects(
    () => repo.commit("main", bytes, { previewHash: "0".repeat(64), confirmed: true, purposes, filename: null }),
    (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT",
  );
  await assert.rejects(
    () => repo.commit("main", bytes, { previewHash: parsed.sourceHash, confirmed: true, purposes: [], filename: null }),
    (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT",
  );
  await assert.rejects(
    () =>
      repo.commit("main", bytes, {
        previewHash: parsed.sourceHash,
        confirmed: true,
        purposes: [
          { orderId: "700001", purpose: PURPOSE },
          { orderId: "700001", purpose: "unknown" },
        ],
        filename: null,
      }),
    (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT",
  );
  const incomplete = [
    ORDER_HEADER,
    "2025-01-05 10:00:00,Limit,700009,AAA/USDT,AAA,USDT,Buy,7.5,10,6,7.5,45,partially filled",
    EXECUTION_HEADER,
    "2025-01-05 10:00:01,7.5,4,30,0.03 USDT",
  ].join("\n");
  const incompleteBytes = encode(incomplete);
  const incompleteParsed = parseClassicCSV(incompleteBytes);
  assert.equal(incompleteParsed.importEligible, false);
  await assert.rejects(
    () =>
      repo.commit("main", incompleteBytes, {
        previewHash: incompleteParsed.sourceHash,
        confirmed: true,
        purposes: [{ orderId: "700009", purpose: PURPOSE }],
        filename: null,
      }),
    (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT",
  );
});

test("overlapping files may add fills but conflicting signatures conflict", async () => {
  const { db, state } = fakeDb();
  const repo = createClassicCsvRepository(db, auth);
  const first = csvText("700050", ["2025-01-05 10:00:01,7.5,6,45,0.045 USDT"], { executed: "6", volume: "45", status: "partially filled" });
  await commitCsv(repo, first);
  const wider = csvText("700050", ["2025-01-05 10:00:01,7.5,6,45,0.045 USDT", "2025-01-05 10:00:02,7.5,4,30,0.03 USDT"]);
  const parsed = parseClassicCSV(encode(wider));
  const second = await repo.commit("main", encode(wider), {
    previewHash: parsed.sourceHash,
    confirmed: true,
    purposes: [{ orderId: "700050", purpose: PURPOSE }],
    filename: null,
  });
  const body = second.body as Record<string, unknown>;
  assert.equal(body.insertedOrderCount, 0);
  assert.equal(body.existingOrderCount, 1);
  assert.equal(body.insertedExecutionCount, 1);
  assert.equal(state.executions.length, 2);
  const conflicting = csvText("700050", ["2025-01-05 11:00:01,7.4,10,74,0.074 USDT"], { volume: "74", average: "7.4" });
  const conflictingParsed = parseClassicCSV(encode(conflicting));
  await assert.rejects(
    () =>
      repo.commit("main", encode(conflicting), {
        previewHash: conflictingParsed.sourceHash,
        confirmed: true,
        purposes: [{ orderId: "700050", purpose: PURPOSE }],
        filename: null,
      }),
    (error: unknown) => error instanceof RepositoryError && error.code === "CONFLICT",
  );
  assert.equal(state.executions.length, 2);
});

test("identical fills in a wider export become a distinct second occurrence, and an older one-copy file cannot remove it", async () => {
  const { db, state } = fakeDb();
  const repo = createClassicCsvRepository(db, auth);
  const fill = "2025-01-05 10:00:01,7.5,10,75,0.075 USDT";
  const oneCopy = csvText("700080", [fill], { executed: "10", volume: "75", status: "partially filled", amount: "20" });
  await commitCsv(repo, oneCopy);
  const twoCopies = csvText("700080", [fill, fill], { executed: "20", volume: "150", status: "fully executed", amount: "20" });
  const parsed = parseClassicCSV(encode(twoCopies));
  assert.equal(parsed.orders[0].executions.length, 2);
  assert.equal(parsed.orders[0].executions[0].occurrence, 1);
  assert.equal(parsed.orders[0].executions[1].occurrence, 2);
  const second = await repo.commit("main", encode(twoCopies), {
    previewHash: parsed.sourceHash,
    confirmed: true,
    purposes: [{ orderId: "700080", purpose: PURPOSE }],
    filename: null,
  });
  assert.equal((second.body as Row).insertedExecutionCount, 1);
  assert.equal(state.executions.length, 2);
  const occurrences = state.executions.map((row) => row.occurrence).sort();
  assert.deepEqual(occurrences, [1, 2]);
  const olderVariant = oneCopy.split("\n").join("\r\n");
  const olderParsed = parseClassicCSV(encode(olderVariant));
  const older = await repo.commit("main", encode(olderVariant), {
    previewHash: olderParsed.sourceHash,
    confirmed: true,
    purposes: [{ orderId: "700080", purpose: PURPOSE }],
    filename: null,
  });
  const olderBody = older.body as Row;
  assert.equal(olderBody.insertedExecutionCount, 0);
  assert.equal(state.executions.length, 2);
  assert.equal(state.events.filter((row) => row.event_type === "source_snapshot").length, 3);
  const read = (await repo.getActivity(String(state.activities[0].id))) as Row;
  assert.equal((read.executions as Row[]).length, 2);
});

test("equivalent overlapping file with different filename and line endings inserts no executions", async () => {
  const { db, state } = fakeDb();
  const repo = createClassicCsvRepository(db, auth);
  await commitCsv(repo, csvText());
  const crlf = csvText().split("\n").join("\r\n");
  const parsed = parseClassicCSV(encode(crlf));
  const second = await repo.commit("main", encode(crlf), {
    previewHash: parsed.sourceHash,
    confirmed: true,
    purposes: [{ orderId: "700001", purpose: PURPOSE }],
    filename: "renamed.csv",
  });
  const body = second.body as Row;
  assert.equal(body.repeatedFile, false);
  assert.equal(body.insertedExecutionCount, 0);
  assert.equal(body.existingExecutionCount, 1);
  assert.equal(state.imports.length, 2);
  assert.equal(state.executions.length, 1);
  assert.equal(state.events.filter((row) => row.event_type === "source_snapshot").length, 2);
});

test("separate owners and account scopes never coalesce activities", async () => {
  const { db, state } = fakeDb();
  const repo = createClassicCsvRepository(db, auth);
  const foreignRepo = createClassicCsvRepository(db, foreignAuth);
  await commitCsv(repo, csvText());
  await commitCsv(foreignRepo, csvText());
  await commitCsv(repo, csvText(), PURPOSE, "secondary");
  assert.equal(state.activities.length, 3);
  const mine = state.activities.filter((row) => row.user_id === USER_ID);
  assert.equal(mine.length, 2);
  assert.equal(state.imports.length, 3);
  const listed = (await repo.listActivities(50, null)) as Row;
  assert.equal((listed.activities as Row[]).length, 2);
});

test("the same order id under a different asset pair conflicts", async () => {
  const { db, state } = fakeDb();
  const repo = createClassicCsvRepository(db, auth);
  await commitCsv(repo, csvText("700090"));
  const differentAssets = [
    ORDER_HEADER,
    "2025-01-05 10:00:00,Limit,700090,BBB/USDT,BBB,USDT,Buy,7.5,10,10,7.5,75,fully executed",
    EXECUTION_HEADER,
    "2025-01-05 10:00:01,7.5,10,75,0.075 USDT",
  ].join("\n");
  const parsed = parseClassicCSV(encode(differentAssets));
  await assert.rejects(
    () =>
      repo.commit("main", encode(differentAssets), {
        previewHash: parsed.sourceHash,
        confirmed: true,
        purposes: [{ orderId: "700090", purpose: PURPOSE }],
        filename: null,
      }),
    (error: unknown) => error instanceof RepositoryError && error.code === "CONFLICT",
  );
  assert.equal(state.executions.length, 1);
});

test("an injected failure mid-commit rolls back the whole batch atomically", async () => {
  const twoOrders = [
    ORDER_HEADER,
    "2025-01-05 10:00:00,Limit,700101,AAA/USDT,AAA,USDT,Buy,7.5,10,10,7.5,75,fully executed",
    EXECUTION_HEADER,
    "2025-01-05 10:00:01,7.5,10,75,0.075 USDT",
    "2025-01-05 10:10:00,Limit,700102,AAA/USDT,AAA,USDT,Sell,7.6,10,10,7.6,76,fully executed",
    EXECUTION_HEADER,
    "2025-01-05 10:10:01,7.6,10,76,0.076 USDT",
  ].join("\n");
  let executions = 0;
  const { db, state } = fakeDb({}, {
    failOn: (text) => {
      if (text === CLASSIC_CSV_QUERIES.insertExecution) {
        executions += 1;
        return executions === 2;
      }
      return false;
    },
  });
  const repo = createClassicCsvRepository(db, auth);
  await assert.rejects(
    () => commitCsv(repo, twoOrders),
    (error: unknown) => error instanceof PersistenceError,
  );
  assert.equal(state.imports.length, 0);
  assert.equal(state.activities.length, 0);
  assert.equal(state.executions.length, 0);
  assert.equal(state.events.length, 0);
});

test("two concurrent commits serialize and persist both files", async () => {
  const { db, state } = fakeDb();
  const repo = createClassicCsvRepository(db, auth);
  const first = commitCsv(repo, csvText("700201"));
  const second = commitCsv(repo, csvText("700202"));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(state.imports.length, 2);
  assert.equal(state.activities.length, 2);
  assert.equal(state.executions.length, 2);
  assert.equal(state.events.filter((row) => row.event_type === "purpose_change").length, 2);
});

test("two concurrent commits of the same file share one receipt and one batch of rows", async () => {
  const { db, state } = fakeDb();
  const repo = createClassicCsvRepository(db, auth);
  const [a, b] = await Promise.all([commitCsv(repo, csvText()), commitCsv(repo, csvText())]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const bodyA = a.body as Row;
  const bodyB = b.body as Row;
  assert.equal((bodyA.import as Row).id, (bodyB.import as Row).id);
  const counts = [
    { inserted: bodyA.insertedOrderCount, existing: bodyA.existingOrderCount, repeated: bodyA.repeatedFile },
    { inserted: bodyB.insertedOrderCount, existing: bodyB.existingOrderCount, repeated: bodyB.repeatedFile },
  ].sort((x, y) => Number(y.inserted) - Number(x.inserted));
  assert.deepEqual(counts, [
    { inserted: 1, existing: 0, repeated: false },
    { inserted: 0, existing: 1, repeated: true },
  ]);
  assert.equal(state.imports.length, 1);
  assert.equal(state.activities.length, 1);
  assert.equal(state.executions.length, 1);
  assert.equal(state.events.filter((row) => row.event_type === "source_snapshot").length, 1);
  assert.equal(state.events.filter((row) => row.event_type === "purpose_change").length, 1);
});

test("concurrent conflicting purpose changes allow exactly one winner", async () => {
  const { db, state } = fakeDb();
  const repo = createClassicCsvRepository(db, auth);
  await commitCsv(repo, csvText());
  const activityId = String(state.activities[0].id);
  const results = await Promise.allSettled([
    repo.setPurpose(activityId, { purpose: "speculative_trade", expectedVersion: 1 }),
    repo.setPurpose(activityId, { purpose: "other_nontrading", expectedVersion: 1 }),
  ]);
  const succeeded = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(succeeded.length, 1);
  assert.equal(rejected.length, 1);
  const reason = (rejected[0] as PromiseRejectedResult).reason;
  assert.ok(reason instanceof RepositoryError && reason.code === "CONFLICT");
  const versions = state.events.filter((row) => row.event_type === "purpose_change").map((row) => row.event_version);
  assert.deepEqual(versions.sort(), [1, 2]);
});

test("a wider export adds fills while an earlier export's raw formatting differences are preserved", async () => {
  const { db, state } = fakeDb();
  const repo = createClassicCsvRepository(db, auth);
  const padded = [
    ORDER_HEADER,
    "2025-01-05 10:00:00,Limit,700070,AAA/USDT,AAA,USDT,Buy,7.5,10,6,7.50,45,partially filled",
    EXECUTION_HEADER,
    "2025-01-05 10:00:01,7.50,6,45,0.045 USDT,,,,,,,,",
  ].join("\n");
  await commitCsv(repo, padded);
  const storedReported = state.executions[0].reported as string[];
  assert.equal(storedReported.length, 13);
  assert.equal(storedReported[1], "7.50");
  const wider = [
    ORDER_HEADER,
    "2025-01-05 10:00:00,Limit,700070,AAA/USDT,AAA,USDT,Buy,7.5,10,10,7.5,75,fully executed",
    EXECUTION_HEADER,
    "2025-01-05 10:00:01,7.5,6,45,0.045 USDT",
    "2025-01-05 10:00:02,7.5,4,30,0.03 USDT",
  ].join("\n");
  const parsed = parseClassicCSV(encode(wider));
  const second = await repo.commit("main", encode(wider), {
    previewHash: parsed.sourceHash,
    confirmed: true,
    purposes: [{ orderId: "700070", purpose: PURPOSE }],
    filename: null,
  });
  const body = second.body as Row;
  assert.equal(body.insertedExecutionCount, 1);
  assert.equal(state.executions.length, 2);
  assert.deepEqual(state.executions[0].reported, storedReported);
  const read = (await repo.getActivity(String(state.activities[0].id))) as Row;
  assert.equal((read.executions as Row[]).length, 2);
  assert.deepEqual(((read.executions as Row[])[0].reported as string[])[1], "7.50");
});

test("an existing order with a different declared purpose conflicts", async () => {
  const { db } = fakeDb();
  const repo = createClassicCsvRepository(db, auth);
  const otherFile = csvText("700060", ["2025-01-05 10:00:01,7.5,6,45,0.045 USDT", "2025-01-05 10:00:02,7.5,4,30,0.03 USDT"]);
  await commitCsv(repo, csvText("700060"), PURPOSE);
  const parsed = parseClassicCSV(encode(otherFile));
  await assert.rejects(
    () =>
      repo.commit("main", encode(otherFile), {
        previewHash: parsed.sourceHash,
        confirmed: true,
        purposes: [{ orderId: "700060", purpose: "speculative_trade" }],
        filename: null,
      }),
    (error: unknown) => error instanceof RepositoryError && error.code === "CONFLICT",
  );
});

test("purpose reclassification is versioned and audited, and a stale same-purpose retry is a no-op", async () => {
  const { db, state } = fakeDb();
  const repo = createClassicCsvRepository(db, auth);
  await commitCsv(repo, csvText());
  const activityId = String(state.activities[0].id);
  const changed = (await repo.setPurpose(activityId, { purpose: "speculative_trade", expectedVersion: 1, reason: "it was a punt" })) as Record<string, unknown>;
  assert.equal((changed.purpose as Row).value, "speculative_trade");
  assert.equal((changed.purpose as Row).version, 2);
  const audit = changed.purposeAudit as Row[];
  assert.equal(audit.length, 2);
  const staleRetry = (await repo.setPurpose(activityId, { purpose: "speculative_trade", expectedVersion: 1 })) as Record<string, unknown>;
  assert.equal((staleRetry.purpose as Row).version, 2);
  assert.equal(state.events.filter((row) => row.event_type === "purpose_change").length, 2);
  const noOp = (await repo.setPurpose(activityId, { purpose: "speculative_trade", expectedVersion: 2 })) as Record<string, unknown>;
  assert.equal((noOp.purpose as Row).version, 2);
  assert.equal(state.events.filter((row) => row.event_type === "purpose_change").length, 2);
  await assert.rejects(
    () => repo.setPurpose(activityId, { purpose: "other_nontrading", expectedVersion: 1 }),
    (error: unknown) => error instanceof RepositoryError && error.code === "CONFLICT",
  );
  await assert.rejects(
    () => repo.setPurpose("not-a-uuid", { purpose: "unknown", expectedVersion: 1 }),
    (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT",
  );
});

test("imports and activities list with bounded cursor pagination and reject invalid cursors", async () => {
  const { db } = fakeDb();
  const repo = createClassicCsvRepository(db, auth);
  const empty = (await repo.listImports(50, null)) as Record<string, unknown>;
  assert.deepEqual(empty.imports, []);
  assert.equal(empty.nextCursor, null);
  await commitCsv(repo, csvText());
  const listed = (await repo.listImports(50, null)) as Record<string, unknown>;
  assert.equal((listed.imports as Row[]).length, 1);
  const activities = (await repo.listActivities(50, null)) as Record<string, unknown>;
  assert.equal((activities.activities as Row[]).length, 1);
  await assert.rejects(
    () => repo.listActivities(50, "not-a-uuid"),
    (error: unknown) => error instanceof z.ZodError || (error instanceof RepositoryError && error.code === "INVALID_INPUT"),
  );
});

test("tampered stored snapshots and purpose events fail closed", async () => {
  const { db, state } = fakeDb();
  const repo = createClassicCsvRepository(db, auth);
  await commitCsv(repo, csvText());
  const activityId = String(state.activities[0].id);
  const snapshot = state.events.find((row) => row.event_type === "source_snapshot")!;
  const tampered = JSON.parse(JSON.stringify(snapshot.data)) as Row;
  (tampered.order as Row).status = "forged";
  snapshot.data = tampered;
  await assert.rejects(
    () => repo.getActivity(activityId),
    (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT",
  );
});

test("missing purpose audit fails closed instead of empty metrics", async () => {
  const { db, state } = fakeDb();
  const repo = createClassicCsvRepository(db, auth);
  await commitCsv(repo, csvText());
  state.events = state.events.filter((row) => row.event_type !== "purpose_change");
  await assert.rejects(
    () => repo.getActivity(String(state.activities[0].id)),
    (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT",
  );
});

test("metrics aggregate by currency without fabricated P&L", async () => {
  const { db, state } = fakeDb();
  const repo = createClassicCsvRepository(db, auth);
  const mixedFee = csvText("700300", ["2025-01-05 10:00:01,7.5,10,75,0.01 AAA"]);
  await commitCsv(repo, mixedFee);
  const read = (await repo.getActivity(String(state.activities[0].id))) as Row;
  const metrics = read.metrics as ReturnType<typeof summarizeClassicOrders>;
  const group = metrics.financialGroups[0];
  assert.equal(group.baseAsset, "AAA");
  assert.equal(group.quoteAsset, "USDT");
  assert.equal(group.direction, "buy");
  assert.deepEqual(group.reportedFees, [{ currency: "AAA", amount: "0.01" }]);
  assert.equal(group.realizedPnl, null);
  assert.equal(group.costBasis, null);
  assert.equal(group.netProceeds, null);
  assert.equal(group.metricBasis, "reported_execution_rows");
});

test("foreign-owned rows fail closed everywhere", async () => {
  const foreignActivity: Row = { id: uuid(1), user_id: FOREIGN, account_scope: "main", order_id: "700001" };
  const scoped = createClassicCsvRepository(fakeDb({ activities: [foreignActivity] }).db, auth);
  await assert.rejects(
    () => scoped.getActivity(uuid(1)),
    (error: unknown) => error instanceof RepositoryError && error.code === "NOT_FOUND",
  );
  const leaking = createClassicCsvRepository(fakeDb({ activities: [foreignActivity] }, { leak: true }).db, auth);
  const parsed = parseClassicCSV(encode(csvText()));
  await assert.rejects(
    () =>
      leaking.commit("main", encode(csvText()), {
        previewHash: parsed.sourceHash,
        confirmed: true,
        purposes: [{ orderId: "700001", purpose: PURPOSE }],
        filename: null,
      }),
    (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT",
  );
  await assert.rejects(
    () => leaking.getActivity(uuid(1)),
    (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT",
  );
});

test("preview reports duplicate candidates without writing", async () => {
  const { db, calls } = fakeDb();
  const repo = createClassicCsvRepository(db, auth);
  const first = (await repo.preview("main", encode(csvText()))) as Record<string, unknown>;
  assert.equal(first.accountScopeBasis, "user_declared_unverified");
  assert.deepEqual(first.duplicateCandidates, []);
  await commitCsv(repo, csvText());
  calls.length = 0;
  const second = (await repo.preview("main", encode(csvText()))) as Record<string, unknown>;
  const candidates = second.duplicateCandidates as Row[];
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].orderId, "700001");
  assert.equal((candidates[0].existingExecutionKeys as string[]).length, 1);
  assert.ok(!calls.some((call) => call.text.startsWith("INSERT")));
});

test("import detail returns owned activities with source snapshots", async () => {
  const { db, state } = fakeDb();
  const repo = createClassicCsvRepository(db, auth);
  await commitCsv(repo, csvText());
  const importId = String(state.imports[0].id);
  const detail = (await repo.getImport(importId)) as Record<string, unknown>;
  const activities = detail.activities as Row[];
  assert.equal(activities.length, 1);
  assert.equal((activities[0].sourceSnapshots as Row[]).length, 1);
  await assert.rejects(
    () => repo.getImport(uuid(999)),
    (error: unknown) => error instanceof RepositoryError && error.code === "NOT_FOUND",
  );
});
