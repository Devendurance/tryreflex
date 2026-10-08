import assert from "node:assert/strict";
import test from "node:test";
import { RepositoryError } from "../../src/server/db/repositories";
import { CLASSIC_CSV_VERSION, parseClassicCSV, summarizeClassicOrders } from "../../src/server/bitget-classic-policy";

const ORDER_HEADER = "Date,Type,Order Id,Trading pair,Base Asset,Quote Asset,Direction,Price,Order amount,Executed,Average Price,Trading volume,Status";
const EXECUTION_HEADER = "Date,Trading Price,Executed,Trading volume,Fee";

const encode = (text: string) => new TextEncoder().encode(text);

function singleFillCsv(overrides: { orderId?: string; direction?: string; executed?: string; amount?: string; status?: string; fills?: string[] } = {}): string {
  const orderId = overrides.orderId ?? "700001";
  const direction = overrides.direction ?? "Buy";
  const executed = overrides.executed ?? "10";
  const amount = overrides.amount ?? "10";
  const status = overrides.status ?? "fully executed";
  const fills = overrides.fills ?? ["2025-01-05 10:00:01,7.5,10,75,0.075 USDT"];
  return [
    ORDER_HEADER,
    `2025-01-05 10:00:00,Limit,${orderId},AAA/USDT,AAA,USDT,${direction},7.5,${amount},${executed},7.5,75,${status}`,
    EXECUTION_HEADER,
    ...fills,
  ].join("\n");
}

test("parses a filled buy order with its execution rows", () => {
  const parsed = parseClassicCSV(encode(singleFillCsv()));
  assert.equal(parsed.policyVersion, CLASSIC_CSV_VERSION);
  assert.match(parsed.sourceHash, /^[0-9a-f]{64}$/);
  assert.equal(parsed.orders.length, 1);
  const order = parsed.orders[0];
  assert.equal(order.orderId, "700001");
  assert.equal(order.direction, "buy");
  assert.equal(order.tradingPair, "AAA/USDT");
  assert.equal(order.status, "fully executed");
  assert.equal(order.timezoneStatus, "unknown");
  assert.equal(order.purpose, "unknown");
  assert.equal(order.complete, true);
  assert.equal(order.executions.length, 1);
  const execution = order.executions[0];
  assert.equal(execution.price, "7.5");
  assert.equal(execution.quantity, "10");
  assert.equal(execution.feeCurrency, "USDT");
  assert.match(execution.executionKey, /^[0-9a-f]{64}$/);
  assert.equal(parsed.importEligible, true);
  assert.ok(parsed.warnings.includes("TIMEZONE_NOT_DECLARED"));
  assert.ok(parsed.missingData.includes("realized_pnl"));
});

test("multi-fill orders derive occurrence-numbered keys", () => {
  const parsed = parseClassicCSV(
    encode(singleFillCsv({ fills: ["2025-01-05 10:00:01,7.5,6,45,0.045 USDT", "2025-01-05 10:00:02,7.5,4,30,0.03 USDT"] })),
  );
  assert.equal(parsed.orders[0].executions.length, 2);
  assert.deepEqual(
    parsed.orders[0].executions.map((row) => row.occurrence),
    [1, 1],
  );
  assert.notEqual(parsed.orders[0].executions[0].signature, parsed.orders[0].executions[1].signature);
});

test("identical execution rows produce incrementing occurrences", () => {
  const fill = "2025-01-05 10:00:01,7.5,5,37.5,0.0375 USDT";
  const parsed = parseClassicCSV(encode(singleFillCsv({ fills: [fill, fill] })));
  const [first, second] = parsed.orders[0].executions;
  assert.equal(first.signature, second.signature);
  assert.equal(first.occurrence, 1);
  assert.equal(second.occurrence, 2);
  assert.notEqual(first.executionKey, second.executionKey);
});

test("sell orders report quote fees and net proceeds only when complete", () => {
  const parsed = parseClassicCSV(encode(singleFillCsv({ direction: "Sell" })));
  const group = parsed.summary.financialGroups[0];
  assert.equal(group.direction, "sell");
  assert.equal(group.netProceeds, "74.925");
  assert.equal(group.costBasis, null);
  assert.equal(group.realizedPnl, null);
  assert.equal(group.investmentReturn, null);
});

test("incomplete execution detail marks the order and blocks import eligibility", () => {
  const parsed = parseClassicCSV(
    encode(singleFillCsv({ status: "partially filled", executed: "6", amount: "10", fills: ["2025-01-05 10:00:01,7.5,4,30,0.03 USDT"] })),
  );
  assert.equal(parsed.orders[0].complete, false);
  assert.ok(parsed.orders[0].warnings.includes("INCOMPLETE_EXECUTION_DETAILS"));
  assert.equal(parsed.importEligible, false);
});

test("malformed files fail closed", () => {
  assert.throws(() => parseClassicCSV(encode("")), (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT");
  assert.throws(() => parseClassicCSV(encode("a,b,c\n1,2,3")), (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT");
  assert.throws(() => parseClassicCSV(encode("Date,Type,Order Id,Trading pair,Base Asset,Quote Asset,Direction,Price,Order amount,Executed,Average Price,Trading volume,Status")), (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT");
  assert.throws(() => parseClassicCSV(new Uint8Array([0xff, 0xfe, 0x41])), (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT");
});

test("quoted cells and empty order amounts are rejected or preserved exactly", () => {
  const quoted = singleFillCsv({ fills: ['"2025-01-05 10:00:01",7.5,10,75,0.075 USDT'] });
  const parsed = parseClassicCSV(encode(quoted));
  assert.equal(parsed.orders[0].executions[0].dateText, "2025-01-05 10:00:01");
});

test("rejects mismatched trading pair components and unknown statuses", () => {
  const bad = `${ORDER_HEADER}\n2025-01-05 10:00:00,Limit,700002,AAA/USDT,AAA,BTC,Buy,7.5,10,10,7.5,75,fully executed`;
  assert.throws(() => parseClassicCSV(encode(bad)), (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT");
  const badStatus = `${ORDER_HEADER}\n2025-01-05 10:00:00,Limit,700002,AAA/USDT,AAA,USDT,Buy,7.5,10,10,7.5,75,closed`;
  assert.throws(() => parseClassicCSV(encode(badStatus)), (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT");
});

test("summarizeClassicOrders never invents profit metrics", () => {
  const parsed = parseClassicCSV(encode(singleFillCsv()));
  const summary = summarizeClassicOrders(parsed.orders);
  assert.equal(summary.totalOrders, 1);
  assert.equal(summary.totalExecutionRows, 1);
  for (const group of summary.financialGroups) {
    assert.equal(group.costBasis, null);
    assert.equal(group.realizedPnl, null);
    assert.equal(group.holdingDuration, null);
  }
});

test("long numeric order ids with leading tabs parse and preserve the raw id", () => {
  const longId = `\t${"9".repeat(79)}`;
  const parsed = parseClassicCSV(encode(singleFillCsv({ orderId: longId })));
  const order = parsed.orders[0];
  assert.equal(order.originalOrderId, longId);
  assert.equal(order.orderId, longId.trim());
  assert.equal(order.orderId.length, 79);
  assert.equal(order.reportedRecord[2], longId);
});

test("order price differing from fill prices is preserved, not recomputed", () => {
  const parsed = parseClassicCSV(
    encode([
      ORDER_HEADER,
      "2025-01-05 10:00:00,Limit,700010,AAA/USDT,AAA,USDT,Buy,7.4,10,10,7.407,74.07,fully executed",
      EXECUTION_HEADER,
      "2025-01-05 10:00:01,7.407,10,74.07,0.07407 USDT",
    ].join("\n")),
  );
  const order = parsed.orders[0];
  assert.equal(order.orderPrice, "7.4");
  assert.equal(order.executions[0].price, "7.407");
});

test("BOM prefixes and nested order sections across pairs parse", () => {
  const csv = [
    ORDER_HEADER,
    "2025-01-05 10:00:00,Limit,700020,AAA/USDT,AAA,USDT,Buy,7.5,10,10,7.5,75,fully executed",
    EXECUTION_HEADER,
    "2025-01-05 10:00:01,7.5,10,75,0.075 USDT",
    "2025-01-05 11:00:00,Limit,700021,BBB/USDT,BBB,USDT,Sell,0.1,100,100,0.1,10,fully executed",
    EXECUTION_HEADER,
    "2025-01-05 11:00:01,0.1,100,10,0.01 USDT",
  ].join("\n");
  const parsed = parseClassicCSV(encode(`\uFEFF${csv}`));
  assert.equal(parsed.orders.length, 2);
  assert.equal(parsed.orders[0].tradingPair, "AAA/USDT");
  assert.equal(parsed.orders[1].tradingPair, "BBB/USDT");
  assert.equal(parsed.orders[1].direction, "sell");
});

test("invalid dates and excess decimal precision are rejected", () => {
  assert.throws(
    () => parseClassicCSV(encode([ORDER_HEADER, "2025-02-30 10:00:00,Limit,700030,AAA/USDT,AAA,USDT,Buy,7.5,10,10,7.5,75,fully executed"].join("\n"))),
    (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT",
  );
  assert.throws(
    () =>
      parseClassicCSV(
        encode(singleFillCsv({ fills: ["2025-01-05 10:00:01,7.1234567890123,10,75,0.075 USDT"] })),
      ),
    (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT",
  );
});

test("corrupted quoting is rejected", () => {
  assert.throws(
    () => parseClassicCSV(encode(`${ORDER_HEADER}\n"2025-01-05 10:00:00,Limit,700031,AAA/USDT,AAA,USDT,Buy,7.5,10,10,7.5,75,fully executed`)),
    (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT",
  );
  assert.throws(
    () => parseClassicCSV(encode(singleFillCsv({ fills: ['"2025-01-05 10:00:01"x,7.5,10,75,0.075 USDT'] }))),
    (error: unknown) => error instanceof RepositoryError && error.code === "INVALID_INPUT",
  );
});

test("fees in a non-quote currency keep net proceeds null", () => {
  const parsed = parseClassicCSV(encode(singleFillCsv({ direction: "Sell", fills: ["2025-01-05 10:00:01,7.5,10,75,0.01 AAA"] })));
  const group = parsed.summary.financialGroups[0];
  assert.deepEqual(group.reportedFees, [{ currency: "AAA", amount: "0.01" }]);
  assert.equal(group.netProceeds, null);
  assert.equal(group.netProceedsCurrency, null);
});

test("a rounded average price is a warning only and still importable", () => {
  const parsed = parseClassicCSV(
    encode([
      ORDER_HEADER,
      "2025-01-05 10:00:00,Limit,700040,AAA/USDT,AAA,USDT,Buy,7.5,10,10,7.51,75,fully executed",
      EXECUTION_HEADER,
      "2025-01-05 10:00:01,7.5,10,75,0.075 USDT",
    ].join("\n")),
  );
  const order = parsed.orders[0];
  assert.ok(order.warnings.includes("REPORTED_AVERAGE_PRICE_DIFFERS_FROM_EXACT_VOLUME_RATIO"));
  assert.equal(order.complete, true);
  assert.equal(parsed.importEligible, true);
});

test("execution price times quantity must equal reported volume or the order is ineligible", () => {
  const parsed = parseClassicCSV(
    encode([
      ORDER_HEADER,
      "2025-01-05 10:00:00,Limit,700041,AAA/USDT,AAA,USDT,Buy,7.5,10,10,7.5,76,fully executed",
      EXECUTION_HEADER,
      "2025-01-05 10:00:01,7.5,10,76,0.075 USDT",
    ].join("\n")),
  );
  assert.equal(parsed.orders[0].complete, false);
  assert.ok(parsed.orders[0].warnings.includes("REPORTED_EXECUTION_PRICE_VOLUME_MISMATCH"));
  assert.equal(parsed.importEligible, false);
});

test("market buys carry a quote-asset order amount distinct from base quantity", () => {
  const parsed = parseClassicCSV(
    encode([
      ORDER_HEADER,
      "2025-01-05 10:00:00,Market,700050,AAA/USDT,AAA,USDT,Buy,0,10,100,0.1,10,fully executed",
      EXECUTION_HEADER,
      "2025-01-05 10:00:01,0.1,100,10,0.01 USDT",
    ].join("\n")),
  );
  const order = parsed.orders[0];
  assert.equal(order.orderAmountUnit, "quote_asset");
  assert.equal(order.orderAmount, "10");
  assert.equal(order.executedQuantity, "100");
  assert.equal(order.complete, true);
});
