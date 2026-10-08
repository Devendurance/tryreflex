import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { RepositoryError } from "./db/repositories";
import { decimalUnits, formatDecimal, sumSignedDecimals } from "./review-policy";

export const CLASSIC_CSV_VERSION = "bitget_classic_spot_order_history.v1";
export const CLASSIC_CSV_MAX_BYTES = 2 * 1024 * 1024;
export const CLASSIC_CSV_MAX_ROWS = 20000;
export const CLASSIC_CSV_MAX_ORDERS = 1000;
export const CLASSIC_CSV_MAX_EXECUTIONS = 10000;
export const activityPurposeSchema = z.enum(["speculative_trade", "payment_conversion", "other_nontrading", "unknown"]);
export type ActivityPurpose = z.infer<typeof activityPurposeSchema>;
export const accountScopeSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
export const ORDER_HEADER = ["Date", "Type", "Order Id", "Trading pair", "Base Asset", "Quote Asset", "Direction", "Price", "Order amount", "Executed", "Average Price", "Trading volume", "Status"] as const;
export const EXECUTION_HEADER = ["Date", "Trading Price", "Executed", "Trading volume", "Fee"] as const;
const ZERO = BigInt(0);
const SCALE = BigInt("1000000000000");
const ASSET = /^[A-Z0-9][A-Z0-9._-]{0,29}$/;
const DECIMAL = /^\d{1,18}(?:\.\d{1,12})?$/;
const TYPES = new Set(["GTC", "IOC", "FOK", "Post Only", "Post only", "Market", "Limit"]);
const STATUSES = new Set(["fully executed", "partially executed", "partially filled", "filled", "cancelled", "canceled", "unfilled", "open"]);
export const classicHash = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");

export interface ClassicExecution {
  executionKey: string;
  signature: string;
  occurrence: number;
  dateText: string;
  timezoneStatus: "unknown";
  price: string;
  quantity: string;
  grossVolume: string;
  feeAmount: string;
  feeCurrency: string;
  sourceRow: number;
  reportedRecord: string[];
}
export interface ClassicOrder {
  orderId: string;
  originalOrderId: string;
  identityHash: string;
  dateText: string;
  timezoneStatus: "unknown";
  type: string;
  tradingPair: string;
  baseAsset: string;
  quoteAsset: string;
  direction: "buy" | "sell";
  orderPrice: string;
  orderAmount: string;
  orderAmountUnit: "base_asset" | "quote_asset";
  executedQuantity: string;
  averagePrice: string;
  tradingVolume: string;
  status: string;
  sourceRow: number;
  reportedRecord: string[];
  executions: ClassicExecution[];
  complete: boolean;
  warnings: string[];
  purpose: "unknown";
}
export interface ParsedClassicCSV {
  policyVersion: typeof CLASSIC_CSV_VERSION;
  sourceHash: string;
  orders: ClassicOrder[];
  summary: ReturnType<typeof summarizeClassicOrders>;
  importEligible: boolean;
  warnings: string[];
  missingData: string[];
}

function invalid(): never {
  throw new RepositoryError("CSV is malformed, ambiguous, or outside the supported Bitget Classic export format", "INVALID_INPUT");
}

function records(text: string): { cells: string[]; line: number }[] {
  const result: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  let physicalLine = 1;
  let startLine = 1;
  const emitField = () => { cells.push(field); field = ""; closed = false; if (cells.length > 13) invalid(); };
  const emitRow = () => {
    emitField();
    if (!cells.every((value) => value === "")) result.push({ cells, line: startLine });
    if (result.length > CLASSIC_CSV_MAX_ROWS) invalid();
    cells = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else { quoted = false; closed = true; }
      } else {
        field += char;
        if (char === "\n") physicalLine += 1;
      }
    } else if (char === '"') {
      if (field !== "" || closed) invalid();
      quoted = true;
    } else if (char === ",") {
      emitField();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      emitRow();
      physicalLine += 1;
      startLine = physicalLine;
    } else {
      if (closed) invalid();
      field += char;
    }
  }
  if (quoted) invalid();
  if (field !== "" || cells.length > 0 || closed) emitRow();
  return result;
}

function decimal(value: string, positive = false): string {
  const input = value.trim();
  if (!DECIMAL.test(input)) invalid();
  const units = decimalUnits(input);
  if (units < ZERO || (positive && units === ZERO)) invalid();
  return formatDecimal(units);
}

function timestamp(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(value)) invalid();
  const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[- :]/).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) invalid();
  return value;
}

function sameHeader(cells: readonly string[], header: readonly string[]): boolean {
  return cells.length >= header.length && header.every((value, index) => cells[index] === value) && cells.slice(header.length).every((value) => value === "");
}

export function summarizeClassicOrders(orders: readonly ClassicOrder[]) {
  const groups = new Map<string, { baseAsset: string; quoteAsset: string; direction: "buy" | "sell"; executions: ClassicExecution[]; complete: boolean }>();
  for (const order of orders) {
    const key = JSON.stringify([order.baseAsset, order.quoteAsset, order.direction]);
    const group = groups.get(key) ?? { baseAsset: order.baseAsset, quoteAsset: order.quoteAsset, direction: order.direction, executions: [], complete: true };
    group.executions.push(...order.executions);
    group.complete = group.complete && order.complete;
    groups.set(key, group);
  }
  return {
    totalOrders: orders.length,
    totalExecutionRows: orders.reduce((count, order) => count + order.executions.length, 0),
    uniqueTradingPairs: [...new Set(orders.map((order) => order.tradingPair))].sort(),
    buys: orders.filter((order) => order.direction === "buy").length,
    sells: orders.filter((order) => order.direction === "sell").length,
    timezoneStatus: "unknown" as const,
    financialGroups: [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, group]) => {
      const fees = new Map<string, string[]>();
      for (const execution of group.executions) {
        const amounts = fees.get(execution.feeCurrency) ?? [];
        amounts.push(execution.feeAmount);
        fees.set(execution.feeCurrency, amounts);
      }
      const reportedFees = [...fees.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amounts]) => ({ currency, amount: sumSignedDecimals(amounts) }));
      const grossVolume = sumSignedDecimals(group.executions.map((execution) => execution.grossVolume));
      const quoteFeesOnly = reportedFees.every((fee) => fee.currency === group.quoteAsset);
      const netUnits = group.executions.reduce((sum, execution) => sum + decimalUnits(execution.grossVolume) - decimalUnits(execution.feeAmount), ZERO);
      return {
        baseAsset: group.baseAsset, quoteAsset: group.quoteAsset, direction: group.direction,
        filledQuantity: sumSignedDecimals(group.executions.map((execution) => execution.quantity)),
        grossVolume, reportedFees,
        netProceeds: group.direction === "sell" && group.complete && quoteFeesOnly && netUnits >= ZERO ? formatDecimal(netUnits) : null,
        netProceedsCurrency: group.direction === "sell" && group.complete && quoteFeesOnly && netUnits >= ZERO ? group.quoteAsset : null,
        metricBasis: "reported_execution_rows" as const,
        executionDetailsComplete: group.complete,
        costBasis: null, realizedPnl: null, investmentReturn: null, holdingDuration: null,
      };
    }),
  };
}

export function parseClassicExecutionRecord(cells: readonly string[]) {
  if (cells.length < 5 || cells.length > 13 || cells.slice(5).some((value) => value !== "")) invalid();
  const fee = /^(\d{1,18}(?:\.\d{1,12})?)\s*([A-Z][A-Z0-9._-]{0,29})$/.exec(cells[4].trim());
  if (!fee) invalid();
  return {
    dateText: timestamp(cells[0]), timezoneStatus: "unknown" as const,
    price: decimal(cells[1], true), quantity: decimal(cells[2], true), grossVolume: decimal(cells[3], true),
    feeAmount: decimal(fee[1]), feeCurrency: fee[2],
  };
}

export function validateClassicOrderSnapshot(value: unknown): ClassicOrder {
  const wire = z.looseObject({
    sourceRow: z.number().int().min(2).max(CLASSIC_CSV_MAX_ROWS * 14),
    reportedRecord: z.array(z.string().max(512)).length(13),
    executions: z.array(z.looseObject({
      sourceRow: z.number().int().min(3).max(CLASSIC_CSV_MAX_ROWS * 14),
      reportedRecord: z.array(z.string().max(512)).min(5).max(13),
    })).max(CLASSIC_CSV_MAX_EXECUTIONS),
  }).safeParse(value);
  if (!wire.success) invalid();
  const quote = (cell: string) => `"${cell.replace(/"/g, '""')}"`;
  const lines = [ORDER_HEADER.join(","), wire.data.reportedRecord.map(quote).join(","), EXECUTION_HEADER.join(","), ...wire.data.executions.map((execution) => execution.reportedRecord.map(quote).join(","))];
  const reconstructed = parseClassicCSV(new TextEncoder().encode(lines.join("\n"))).orders[0];
  reconstructed.sourceRow = wire.data.sourceRow;
  let previousRow = reconstructed.sourceRow;
  for (const [index, execution] of reconstructed.executions.entries()) {
    const sourceRow = wire.data.executions[index].sourceRow;
    if (sourceRow <= previousRow) invalid();
    execution.sourceRow = sourceRow;
    previousRow = sourceRow;
  }
  if (!isDeepStrictEqual(reconstructed, value)) invalid();
  return reconstructed;
}

export function parseClassicCSV(bytes: Uint8Array): ParsedClassicCSV {
  if (bytes.byteLength === 0 || bytes.byteLength > CLASSIC_CSV_MAX_BYTES) invalid();
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return invalid(); }
  if (text.startsWith("\uFEFF")) text = text.slice(1);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) invalid();
  const rows = records(text);
  if (rows.length === 0 || rows[0].cells.length !== ORDER_HEADER.length || !sameHeader(rows[0].cells, ORDER_HEADER)) invalid();
  const orders: ClassicOrder[] = [];
  const ids = new Set<string>();
  let current: ClassicOrder | undefined;
  let executionSection = false;
  let executionCount = 0;
  let occurrences = new Map<string, number>();
  for (const row of rows.slice(1)) {
    const cells = row.cells;
    if (sameHeader(cells, EXECUTION_HEADER)) {
      if (!current || executionSection) invalid();
      executionSection = true;
      continue;
    }
    const orderRow = cells.length === 13 && cells[2].trim().match(/^\d{1,80}$/) !== null && (cells[6] === "Buy" || cells[6] === "Sell");
    if (orderRow) {
      if (orders.length >= CLASSIC_CSV_MAX_ORDERS) invalid();
      const orderId = cells[2].trim();
      if (ids.has(orderId) || !TYPES.has(cells[1]) || !ASSET.test(cells[4]) || !ASSET.test(cells[5]) || cells[4] === cells[5] || cells[3] !== `${cells[4]}/${cells[5]}` || !STATUSES.has(cells[12])) invalid();
      ids.add(orderId);
      const direction = cells[6] === "Buy" ? "buy" : "sell";
      current = {
        orderId, originalOrderId: cells[2],
        identityHash: classicHash(JSON.stringify([CLASSIC_CSV_VERSION, orderId, cells[3], cells[4], cells[5], direction])),
        dateText: timestamp(cells[0]), timezoneStatus: "unknown", type: cells[1],
        tradingPair: cells[3], baseAsset: cells[4], quoteAsset: cells[5], direction,
        orderPrice: decimal(cells[7]), orderAmount: decimal(cells[8], true), orderAmountUnit: cells[1] === "Market" && direction === "buy" ? "quote_asset" : "base_asset", executedQuantity: decimal(cells[9]),
        averagePrice: decimal(cells[10]), tradingVolume: decimal(cells[11]), status: cells[12], sourceRow: row.line,
        reportedRecord: [...cells], executions: [], complete: false, warnings: [], purpose: "unknown",
      };
      if (current.orderAmountUnit === "base_asset" && decimalUnits(current.executedQuantity) > decimalUnits(current.orderAmount)) invalid();
      if (current.orderAmountUnit === "quote_asset" && decimalUnits(current.tradingVolume) > decimalUnits(current.orderAmount)) invalid();
      if (current.orderAmountUnit === "base_asset" && ["fully executed", "filled"].includes(current.status) && current.executedQuantity !== current.orderAmount) invalid();
      if (decimalUnits(current.executedQuantity) > ZERO && decimalUnits(current.averagePrice) === ZERO) invalid();
      if (decimalUnits(current.executedQuantity) === ZERO && decimalUnits(current.tradingVolume) !== ZERO) invalid();
      orders.push(current);
      executionSection = false;
      occurrences = new Map();
      continue;
    }
    if (!current || !executionSection || cells.length < 5 || cells.slice(5).some((value) => value !== "")) invalid();
    if (++executionCount > CLASSIC_CSV_MAX_EXECUTIONS) invalid();
    const execution = { ...parseClassicExecutionRecord(cells), sourceRow: row.line, reportedRecord: [...cells] };
    const signature = classicHash(JSON.stringify([CLASSIC_CSV_VERSION, execution.dateText, execution.price, execution.quantity, execution.grossVolume, execution.feeAmount, execution.feeCurrency]));
    const occurrence = (occurrences.get(signature) ?? 0) + 1;
    occurrences.set(signature, occurrence);
    current.executions.push({ ...execution, signature, occurrence, executionKey: classicHash(JSON.stringify([signature, occurrence])) });
  }
  if (orders.length === 0) invalid();
  for (const order of orders) {
    const quantity = sumSignedDecimals(order.executions.map((execution) => execution.quantity));
    const volume = sumSignedDecimals(order.executions.map((execution) => execution.grossVolume));
    if (order.executions.reduce((sum, execution) => sum + decimalUnits(execution.quantity), ZERO) > decimalUnits(order.executedQuantity) || order.executions.reduce((sum, execution) => sum + decimalUnits(execution.grossVolume), ZERO) > decimalUnits(order.tradingVolume)) invalid();
    if (quantity !== order.executedQuantity || volume !== order.tradingVolume) order.warnings.push("INCOMPLETE_EXECUTION_DETAILS");
    if (order.executions.some((execution) => decimalUnits(execution.price) * decimalUnits(execution.quantity) !== decimalUnits(execution.grossVolume) * SCALE)) order.warnings.push("REPORTED_EXECUTION_PRICE_VOLUME_MISMATCH");
    if (order.executions.some((execution) => execution.feeCurrency === order.quoteAsset && decimalUnits(execution.feeAmount) > decimalUnits(execution.grossVolume))) order.warnings.push("REPORTED_QUOTE_FEE_EXCEEDS_VOLUME");
    if (decimalUnits(order.averagePrice) * decimalUnits(order.executedQuantity) !== decimalUnits(order.tradingVolume) * SCALE) order.warnings.push("REPORTED_AVERAGE_PRICE_DIFFERS_FROM_EXACT_VOLUME_RATIO");
    order.complete = !order.warnings.some((warning) => warning !== "REPORTED_AVERAGE_PRICE_DIFFERS_FROM_EXACT_VOLUME_RATIO");
  }
  const warnings = [...new Set(["TIMEZONE_NOT_DECLARED", "ACCOUNT_IDENTITY_NOT_PRESENT", "PURPOSE_REQUIRES_USER_CLASSIFICATION", ...orders.flatMap((order) => order.warnings)])];
  return {
    policyVersion: CLASSIC_CSV_VERSION, sourceHash: classicHash(bytes), orders,
    summary: summarizeClassicOrders(orders), importEligible: orders.every((order) => order.complete), warnings,
    missingData: ["timezone", "verified_exchange_account_identity", "execution_ids", "cost_basis", "realized_pnl", "trading_rationale", "buy_sell_pairing", "holding_duration"],
  };
}
