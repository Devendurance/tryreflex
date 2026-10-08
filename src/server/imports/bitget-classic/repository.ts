import { z } from "zod";
import { validateAuthContext, type AuthContext } from "../../auth/context";
import { CLASSIC_CSV_QUERIES } from "../../bitget-classic-queries";
import {
  CLASSIC_CSV_VERSION,
  accountScopeSchema,
  parseClassicCSV,
  parseClassicExecutionRecord,
  summarizeClassicOrders,
  validateClassicOrderSnapshot,
  activityPurposeSchema,
  type ActivityPurpose,
  type ClassicOrder,
  type ParsedClassicCSV,
} from "../../bitget-classic-policy";
import type { DbSession, Queryable } from "../../db/client";
import { mapPersistenceError, RepositoryError } from "../../db/repositories";
import { decimalUnits } from "../../review-policy";

type Row = Record<string, unknown>;

const uuidSchema = z.string().uuid();
const limitSchema = z.number().int().min(1).max(100);
const cursorSchema = uuidSchema.nullable();
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);

const purposeDataSchema = z.strictObject({
  purpose: activityPurposeSchema,
  basis: z.literal("user_declared"),
  reason: z.string().max(500).nullable(),
});

const snapshotEnvelopeSchema = z.strictObject({
  parserVersion: z.literal(CLASSIC_CSV_VERSION),
  sourceHash: hashSchema,
  order: z.unknown(),
  executionKeys: z.array(hashSchema),
});

export const classicCommitPurposesSchema = z
  .array(z.strictObject({ orderId: z.string().regex(/^\d{1,80}$/), purpose: activityPurposeSchema }))
  .max(1000);

export const purposeChangeSchema = z.strictObject({
  purpose: activityPurposeSchema,
  expectedVersion: z.number().int().min(1),
  reason: z.string().max(500).optional(),
});
export type PurposeChangeInput = z.infer<typeof purposeChangeSchema>;

function malformed(message: string): never {
  throw new RepositoryError(message, "INVALID_INPUT");
}

function conflict(message: string): never {
  throw new RepositoryError(message, "CONFLICT");
}

function owned(row: Row | undefined, userId: string, what: string): Row {
  if (!row) throw new RepositoryError(`${what} not found`, "NOT_FOUND");
  if (String(row.user_id) !== userId) malformed(`${what} is not owned by the authenticated user`);
  return row;
}

function eventData(event: Row): Record<string, unknown> {
  const data = event.data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) malformed("activity event payload is malformed");
  return data as Record<string, unknown>;
}

interface ValidatedSnapshot {
  event: Row;
  order: ClassicOrder;
  executionKeys: string[];
}

function validateSnapshotEvent(event: Row, activity: Row): ValidatedSnapshot {
  if (String(event.event_type) !== "source_snapshot") malformed("source snapshot event has a foreign type");
  if (!uuidSchema.safeParse(event.import_id).success) malformed("source snapshot is not linked to an import");
  if (event.event_version !== null) malformed("source snapshot must not carry a version");
  const envelope = snapshotEnvelopeSchema.safeParse(eventData(event));
  if (!envelope.success) malformed("source snapshot is malformed");
  const order = validateClassicOrderSnapshot(envelope.data.order);
  if (String(event.activity_id) !== String(activity.id)) malformed("source snapshot is not linked to this activity");
  if (
    order.orderId !== String(activity.order_id) ||
    order.identityHash !== String(activity.identity_hash) ||
    order.baseAsset !== String(activity.base_asset) ||
    order.quoteAsset !== String(activity.quote_asset) ||
    order.tradingPair !== String(activity.trading_pair) ||
    order.direction !== String(activity.direction)
  ) {
    malformed("source snapshot does not match the stored activity identity");
  }
  const keys = envelope.data.executionKeys;
  const orderKeys = order.executions.map((execution) => execution.executionKey);
  if (new Set(keys).size !== keys.length || new Set(orderKeys).size !== orderKeys.length || keys.length !== orderKeys.length || !keys.every((key, index) => key === orderKeys[index])) {
    malformed("source snapshot execution keys do not match its order");
  }
  return { event, order, executionKeys: keys };
}

function validatePurposeEvent(event: Row): z.infer<typeof purposeDataSchema> & { version: number } {
  if (String(event.event_type) !== "purpose_change") malformed("purpose audit contains a foreign event");
  if (event.import_id !== null) malformed("purpose event must not reference an import");
  if (!Number.isInteger(event.event_version) || Number(event.event_version) < 1) malformed("purpose audit version is malformed");
  const parsed = purposeDataSchema.safeParse(eventData(event));
  if (!parsed.success) malformed("purpose event payload is malformed");
  return { ...parsed.data, version: Number(event.event_version) };
}

function sameDecimal(a: unknown, b: string): boolean {
  if (typeof a !== "string") return false;
  try {
    return decimalUnits(a) === decimalUnits(b);
  } catch {
    return false;
  }
}

function validateActivityHeader(activity: Row): void {
  if (String(activity.exchange) !== "bitget" || String(activity.source_kind) !== "classic_spot_csv") {
    malformed("activity has a foreign source");
  }
  if (!accountScopeSchema.safeParse(activity.account_scope).success) malformed("activity scope is malformed");
  if (!/^\d{1,80}$/.test(String(activity.order_id))) malformed("activity order id is malformed");
  if (String(activity.direction) !== "buy" && String(activity.direction) !== "sell") malformed("activity direction is malformed");
  if (!hashSchema.safeParse(activity.identity_hash).success) malformed("activity identity hash is malformed");
}

function sameReportedExecution(reported: unknown, expected: { dateText: string; timezoneStatus: "unknown"; price: string; quantity: string; grossVolume: string; feeAmount: string; feeCurrency: string }): boolean {
  if (!Array.isArray(reported) || reported.some((cell) => typeof cell !== "string")) return false;
  try {
    const normalized = parseClassicExecutionRecord(reported as string[]);
    return (
      normalized.dateText === expected.dateText &&
      normalized.timezoneStatus === expected.timezoneStatus &&
      normalized.price === expected.price &&
      normalized.quantity === expected.quantity &&
      normalized.grossVolume === expected.grossVolume &&
      normalized.feeAmount === expected.feeAmount &&
      normalized.feeCurrency === expected.feeCurrency
    );
  } catch {
    return false;
  }
}

export function createClassicCsvRepository(db: DbSession, auth: AuthContext) {
  const userId = validateAuthContext(auth).userId;

  async function findExistingOrders(q: Queryable, scope: string, orderIds: string[]): Promise<Map<string, Row>> {
    if (orderIds.length === 0) return new Map();
    const rows = (await q.query<Row>(CLASSIC_CSV_QUERIES.findOrders, [userId, scope, orderIds]).catch(mapPersistenceError)).rows;
    const map = new Map<string, Row>();
    for (const row of rows) {
      owned(row, userId, "spot activity");
      if (String(row.account_scope) !== scope) malformed("spot activity scope mismatch");
      map.set(String(row.order_id), row);
    }
    return map;
  }

  async function latestPurposeMap(q: Queryable, activityIds: string[]): Promise<Map<string, { purpose: string; version: number }>> {
    const map = new Map<string, { purpose: string; version: number }>();
    if (activityIds.length === 0) return map;
    const rows = (await q.query<Row>(CLASSIC_CSV_QUERIES.latestPurposes, [userId, activityIds]).catch(mapPersistenceError)).rows;
    for (const row of rows) {
      owned(row, userId, "activity event");
      if (!activityIds.includes(String(row.activity_id))) malformed("latest purpose returned an unexpected activity");
      const parsed = validatePurposeEvent(row);
      map.set(String(row.activity_id), { purpose: parsed.purpose, version: parsed.version });
    }
    return map;
  }

  function activityRead(activity: Row, executions: Row[], events: Row[]): Record<string, unknown> {
    validateActivityHeader(activity);
    const snapshots: ValidatedSnapshot[] = [];
    const audit: { version: number; purpose: string; reason: string | null; eventId: unknown; createdAt: unknown }[] = [];
    for (const event of events) {
      if (String(event.activity_id) !== String(activity.id)) malformed("activity event is not linked to this activity");
      owned(event, userId, "activity event");
      if (event.event_type === "source_snapshot") {
        snapshots.push(validateSnapshotEvent(event, activity));
      } else if (event.event_type === "purpose_change") {
        const parsed = validatePurposeEvent(event);
        audit.push({ version: parsed.version, purpose: parsed.purpose, reason: parsed.reason, eventId: event.id, createdAt: event.created_at });
      } else {
        malformed("activity event has an unknown type");
      }
    }
    audit.sort((a, b) => a.version - b.version);
    if (audit.length === 0 || audit[0].version !== 1) malformed("activity is missing its initial declared purpose");
    for (let index = 1; index < audit.length; index += 1) {
      if (audit[index].version !== audit[index - 1].version + 1) malformed("purpose audit is not contiguous");
    }
    const storedKeys = new Set(executions.map((row) => String(row.execution_key)));
    if (storedKeys.size !== executions.length) malformed("stored execution keys are not unique");
    for (const snapshot of snapshots) {
      if (!snapshot.order.complete) malformed("a stored source snapshot is incomplete");
      if (!snapshot.executionKeys.every((key) => storedKeys.has(key))) malformed("a stored source snapshot references unknown executions");
    }
    const canonical = snapshots
      .filter((snapshot) => snapshot.executionKeys.length === storedKeys.size && snapshot.executionKeys.every((key) => storedKeys.has(key)))
      .sort((a, b) => b.executionKeys.length - a.executionKeys.length)[0];
    if (!canonical) malformed("no complete source snapshot matches the stored execution evidence");
    const canonicalByKey = new Map(canonical.order.executions.map((execution) => [execution.executionKey, execution]));
    for (const row of executions) {
      owned(row, userId, "spot execution");
      if (String(row.activity_id) !== String(activity.id)) malformed("execution is not linked to this activity");
      const expected = canonicalByKey.get(String(row.execution_key));
      if (!expected) malformed("stored execution has no canonical source row");
      if (
        String(row.signature) !== expected.signature ||
        Number(row.occurrence) !== expected.occurrence ||
        String(row.timestamp_text) !== expected.dateText ||
        String(row.timezone_status) !== expected.timezoneStatus ||
        !sameDecimal(row.price, expected.price) ||
        !sameDecimal(row.quantity, expected.quantity) ||
        !sameDecimal(row.gross_volume, expected.grossVolume) ||
        !sameDecimal(row.fee_amount, expected.feeAmount) ||
        String(row.fee_currency) !== expected.feeCurrency ||
        !sameReportedExecution(row.reported, expected)
      ) {
        malformed("stored execution does not match its canonical source record");
      }
    }
    const latest = audit[audit.length - 1];
    return {
      id: activity.id,
      accountScope: activity.account_scope,
      accountScopeBasis: "user_declared_unverified",
      exchange: activity.exchange,
      sourceKind: activity.source_kind,
      orderId: activity.order_id,
      identityHash: activity.identity_hash,
      tradingPair: activity.trading_pair,
      baseAsset: activity.base_asset,
      quoteAsset: activity.quote_asset,
      direction: activity.direction,
      createdAt: activity.created_at,
      order: canonical.order,
      executions: executions.map((row) => ({
        id: row.id,
        executionKey: row.execution_key,
        signature: row.signature,
        occurrence: row.occurrence,
        timestampText: row.timestamp_text,
        timezoneStatus: row.timezone_status,
        price: row.price,
        quantity: row.quantity,
        grossVolume: row.gross_volume,
        feeAmount: row.fee_amount,
        feeCurrency: row.fee_currency,
        reported: row.reported,
      })),
      purpose: { value: latest.purpose, version: latest.version, basis: "user_declared" },
      purposeAudit: audit.map(({ version, purpose, reason, eventId, createdAt }) => ({ version, purpose, reason, eventId, createdAt })),
      sourceSnapshots: snapshots.map((snapshot) => ({ id: snapshot.event.id, importId: snapshot.event.import_id, sourceHash: snapshot.event.data ? (snapshot.event.data as Record<string, unknown>).sourceHash : null, createdAt: snapshot.event.created_at, order: snapshot.order })),
      metrics: summarizeClassicOrders([canonical.order]),
      safety: { tradingIntelligenceEligible: false, decisionLinked: false },
    };
  }

  async function loadActivityRead(q: Queryable, activity: Row): Promise<Record<string, unknown>> {
    const id = String(activity.id);
    const executions = (await q.query<Row>(CLASSIC_CSV_QUERIES.executions, [userId, [id]]).catch(mapPersistenceError)).rows;
    const events = (await q.query<Row>(CLASSIC_CSV_QUERIES.events, [userId, [id]]).catch(mapPersistenceError)).rows;
    return activityRead(activity, executions, events);
  }

  function signatureCounts(executions: { signature: string }[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const execution of executions) counts.set(execution.signature, (counts.get(execution.signature) ?? 0) + 1);
    return counts;
  }

  function isNested(a: Map<string, number>, b: Map<string, number>): boolean {
    const subset = [...a.entries()].every(([key, count]) => (b.get(key) ?? 0) >= count);
    const superset = [...b.entries()].every(([key, count]) => (a.get(key) ?? 0) >= count);
    return subset || superset;
  }

  function validateFilename(filename: string | null): void {
    if (filename !== null && (typeof filename !== "string" || filename.length > 255 || filename.includes("\0"))) {
      malformed("source filename is out of bounds");
    }
  }

  async function preview(scope: string, bytes: Uint8Array): Promise<Record<string, unknown>> {
    const parsedScope = accountScopeSchema.parse(scope);
    const parsed = parseClassicCSV(bytes);
    return db.transaction(async (q) => {
      const existing = await findExistingOrders(q, parsedScope, parsed.orders.map((order) => order.orderId));
      const activityIds = [...existing.values()].map((row) => String(row.id));
      const executions =
        activityIds.length === 0
          ? []
          : (await q.query<Row>(CLASSIC_CSV_QUERIES.executions, [userId, activityIds]).catch(mapPersistenceError)).rows;
      for (const row of executions) owned(row, userId, "spot execution");
      const signaturesByActivity = new Map<string, Map<string, number>>();
      const keysByActivity = new Map<string, string[]>();
      for (const row of executions) {
        const key = String(row.activity_id);
        const counts = signaturesByActivity.get(key) ?? new Map<string, number>();
        counts.set(String(row.signature), (counts.get(String(row.signature)) ?? 0) + 1);
        signaturesByActivity.set(key, counts);
        keysByActivity.set(key, [...(keysByActivity.get(key) ?? []), String(row.execution_key)]);
      }
      const duplicateCandidates = parsed.orders
        .filter((order) => existing.has(order.orderId))
        .map((order) => {
          const prior = existing.get(order.orderId)!;
          const conflict = String(prior.identity_hash) !== order.identityHash
            ? "identity_mismatch"
            : isNested(signatureCounts(order.executions), signaturesByActivity.get(String(prior.id)) ?? new Map())
              ? null
              : "execution_conflict";
          return {
            orderId: order.orderId,
            activityId: String(prior.id),
            existingExecutionKeys: (keysByActivity.get(String(prior.id)) ?? []).sort(),
            existingExecutionCount: (keysByActivity.get(String(prior.id)) ?? []).length,
            conflict,
          };
        });
      return {
        policyVersion: CLASSIC_CSV_VERSION,
        accountScope: parsedScope,
        accountScopeBasis: "user_declared_unverified",
        preview: parsed,
        duplicateCandidates,
      };
    }).catch(mapPersistenceError);
  }

  async function commit(
    scope: string,
    bytes: Uint8Array,
    input: { previewHash: string; confirmed: boolean; purposes: { orderId: string; purpose: ActivityPurpose }[]; filename: string | null },
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const parsedScope = accountScopeSchema.parse(scope);
    const parsed: ParsedClassicCSV = parseClassicCSV(bytes);
    const purposes = classicCommitPurposesSchema.parse(input.purposes);
    validateFilename(input.filename);
    if (!input.confirmed) malformed("import requires explicit confirmation");
    if (parsed.sourceHash !== input.previewHash) malformed("preview hash does not match the uploaded file");
    if (!parsed.importEligible) malformed("an incomplete preview cannot be committed");
    const declared = new Map<string, ActivityPurpose>();
    for (const entry of purposes) {
      if (declared.has(entry.orderId)) malformed("each order must be classified exactly once");
      declared.set(entry.orderId, entry.purpose);
    }
    for (const order of parsed.orders) {
      if (!declared.has(order.orderId)) malformed("each order must be classified exactly once");
    }
    if (declared.size !== parsed.orders.length) malformed("each order must be classified exactly once");
    return db.transaction(async (q) => {
      await q.query(CLASSIC_CSV_QUERIES.lockOwner, [userId]).catch(mapPersistenceError);
      const repeated = (await q.query<Row>(CLASSIC_CSV_QUERIES.findImport, [userId, parsedScope, parsed.sourceHash]).catch(mapPersistenceError)).rows[0];
      if (repeated) {
        owned(repeated, userId, "csv import");
        if (String(repeated.account_scope) !== parsedScope || String(repeated.source_hash) !== parsed.sourceHash || String(repeated.parser_version) !== CLASSIC_CSV_VERSION) {
          malformed("stored import receipt does not match this file");
        }
        if (Number(repeated.order_count) !== parsed.orders.length || Number(repeated.execution_count) !== parsed.summary.totalExecutionRows) {
          malformed("stored import receipt counts do not match this file");
        }
        const events = (await q.query<Row>(CLASSIC_CSV_QUERIES.importEvents, [userId, repeated.id]).catch(mapPersistenceError)).rows;
        if (events.length !== parsed.orders.length) malformed("import provenance does not cover every order in this file");
        const seenActivities = new Set<string>();
        const incomingOrderIds = new Set(parsed.orders.map((order) => order.orderId));
        const activities: Record<string, unknown>[] = [];
        for (const event of events) {
          owned(event, userId, "activity event");
          if (String(event.import_id) !== String(repeated.id)) malformed("provenance link is broken");
          const data = eventData(event);
          if (data.parserVersion !== CLASSIC_CSV_VERSION || data.sourceHash !== parsed.sourceHash || !Array.isArray(data.executionKeys)) {
            malformed("import provenance does not match this file");
          }
        }
        for (const event of events) {
          const activityId = String(event.activity_id);
          if (seenActivities.has(activityId)) malformed("import provenance links a duplicate activity");
          seenActivities.add(activityId);
          const activity = owned(
            (await q.query<Row>(CLASSIC_CSV_QUERIES.getActivity, [userId, activityId]).catch(mapPersistenceError)).rows[0],
            userId,
            "spot activity",
          );
          if (!incomingOrderIds.has(String(activity.order_id))) malformed("import provenance references an order absent from this file");
          activities.push(await loadActivityRead(q, activity));
        }
        if (seenActivities.size !== incomingOrderIds.size) malformed("import provenance does not cover every order in this file");
        return {
          status: 200,
          body: {
            import: repeated,
            activities,
            insertedOrderCount: 0,
            existingOrderCount: parsed.orders.length,
            insertedExecutionCount: 0,
            existingExecutionCount: parsed.summary.totalExecutionRows,
            repeatedFile: true,
            existingPurposesAuthoritative: true,
          },
        };
      }
      const existing = await findExistingOrders(q, parsedScope, parsed.orders.map((order) => order.orderId));
      const activityIds = [...existing.values()].map((row) => String(row.id));
      const storedExecutions =
        activityIds.length === 0
          ? []
          : (await q.query<Row>(CLASSIC_CSV_QUERIES.executions, [userId, activityIds]).catch(mapPersistenceError)).rows;
      for (const row of storedExecutions) owned(row, userId, "spot execution");
      const storedByActivity = new Map<string, Row[]>();
      for (const row of storedExecutions) {
        const key = String(row.activity_id);
        storedByActivity.set(key, [...(storedByActivity.get(key) ?? []), row]);
      }
      const purposes = await latestPurposeMap(q, activityIds);
      for (const order of parsed.orders) {
        const prior = existing.get(order.orderId);
        if (!prior) continue;
        if (String(prior.identity_hash) !== order.identityHash) conflict("order identity changed between exports");
        const currentPurpose = purposes.get(String(prior.id));
        if (!currentPurpose) malformed("existing activity is missing its declared purpose");
        if (currentPurpose.purpose !== declared.get(order.orderId)) {
          conflict("an existing order has a different declared purpose; reclassify it through the purpose endpoint");
        }
        const stored = new Map<string, number>();
        for (const row of storedByActivity.get(String(prior.id)) ?? []) {
          stored.set(String(row.signature), (stored.get(String(row.signature)) ?? 0) + 1);
        }
        const incoming = new Map<string, number>();
        for (const execution of order.executions) {
          incoming.set(execution.signature, (incoming.get(execution.signature) ?? 0) + 1);
        }
        const subset = [...incoming.entries()].every(([key, count]) => (stored.get(key) ?? 0) >= count);
        const superset = [...stored.entries()].every(([key, count]) => (incoming.get(key) ?? 0) >= count);
        if (!subset && !superset) conflict("execution evidence for an existing order is not nested with previously imported data");
      }
      const importRow = (
        await q
          .query<Row>(CLASSIC_CSV_QUERIES.insertImport, [
            userId,
            parsedScope,
            parsed.sourceHash,
            CLASSIC_CSV_VERSION,
            input.filename,
            parsed.orders.length,
            parsed.summary.totalExecutionRows,
            JSON.stringify(parsed.warnings),
          ])
          .catch(mapPersistenceError)
      ).rows[0];
      if (!importRow) conflict("csv import could not be saved");
      let insertedOrderCount = 0;
      let existingOrderCount = 0;
      let insertedExecutionCount = 0;
      let existingExecutionCount = 0;
      const touched: Row[] = [];
      for (const order of parsed.orders) {
        const prior = existing.get(order.orderId);
        const activity =
          prior ??
          (
            await q
              .query<Row>(CLASSIC_CSV_QUERIES.insertActivity, [
                userId,
                parsedScope,
                order.orderId,
                order.identityHash,
                order.baseAsset,
                order.quoteAsset,
                order.tradingPair,
                order.direction,
              ])
              .catch(mapPersistenceError)
          ).rows[0];
        if (!activity) conflict("spot activity could not be saved");
        owned(activity, userId, "spot activity");
        if (prior) {
          existingOrderCount += 1;
          const storedRows = storedByActivity.get(String(activity.id)) ?? [];
          const storedCounts = new Map<string, number>();
          for (const row of storedRows) storedCounts.set(String(row.signature), (storedCounts.get(String(row.signature)) ?? 0) + 1);
          const storedKeys = new Set(storedRows.map((row) => String(row.execution_key)));
          for (const execution of order.executions) {
            if (storedKeys.has(execution.executionKey)) {
              existingExecutionCount += 1;
              continue;
            }
            if ((storedCounts.get(execution.signature) ?? 0) >= execution.occurrence) conflict("execution occurrence conflicts with stored evidence");
            await q
              .query(CLASSIC_CSV_QUERIES.insertExecution, [
                userId,
                activity.id,
                execution.executionKey,
                execution.signature,
                execution.occurrence,
                execution.dateText,
                execution.price,
                execution.quantity,
                execution.grossVolume,
                execution.feeAmount,
                execution.feeCurrency,
                JSON.stringify(execution.reportedRecord),
              ])
              .catch(mapPersistenceError);
            insertedExecutionCount += 1;
          }
        } else {
          insertedOrderCount += 1;
          for (const execution of order.executions) {
            await q
              .query(CLASSIC_CSV_QUERIES.insertExecution, [
                userId,
                activity.id,
                execution.executionKey,
                execution.signature,
                execution.occurrence,
                execution.dateText,
                execution.price,
                execution.quantity,
                execution.grossVolume,
                execution.feeAmount,
                execution.feeCurrency,
                JSON.stringify(execution.reportedRecord),
              ])
              .catch(mapPersistenceError);
            insertedExecutionCount += 1;
          }
        }
        await q
          .query(CLASSIC_CSV_QUERIES.insertEvent, [
            userId,
            activity.id,
            importRow.id,
            "source_snapshot",
            null,
            JSON.stringify({
              parserVersion: CLASSIC_CSV_VERSION,
              sourceHash: parsed.sourceHash,
              order,
              executionKeys: order.executions.map((execution) => execution.executionKey),
            }),
          ])
          .catch(mapPersistenceError);
        if (!prior) {
          await q
            .query(CLASSIC_CSV_QUERIES.insertEvent, [
              userId,
              activity.id,
              null,
              "purpose_change",
              1,
              JSON.stringify({ purpose: declared.get(order.orderId), basis: "user_declared", reason: null }),
            ])
            .catch(mapPersistenceError);
        }
        touched.push(activity);
      }
      const activities: Record<string, unknown>[] = [];
      for (const activity of touched) activities.push(await loadActivityRead(q, activity));
      return {
        status: 200,
        body: {
          import: importRow,
          activities,
          insertedOrderCount,
          existingOrderCount,
          insertedExecutionCount,
          existingExecutionCount,
          repeatedFile: false,
        },
      };
    }).catch(mapPersistenceError);
  }

  async function listImports(limit: number, cursor: string | null): Promise<Record<string, unknown>> {
    const parsedLimit = limitSchema.parse(limit);
    const parsedCursor = cursorSchema.parse(cursor);
    const rows = (await db.query<Row>(CLASSIC_CSV_QUERIES.listImports, [userId, parsedCursor, parsedLimit + 1]).catch(mapPersistenceError)).rows;
    for (const row of rows) owned(row, userId, "csv import");
    const imports = rows.slice(0, parsedLimit);
    return { imports, nextCursor: rows.length > parsedLimit ? String(imports[imports.length - 1].id) : null };
  }

  async function getImport(id: string): Promise<Record<string, unknown>> {
    const parsedId = uuidSchema.safeParse(id);
    if (!parsedId.success) malformed("request failed validation");
    return db.transaction(async (q) => {
      const row = owned(
        (await q.query<Row>(CLASSIC_CSV_QUERIES.getImport, [userId, parsedId.data]).catch(mapPersistenceError)).rows[0],
        userId,
        "csv import",
      );
      const events = (await q.query<Row>(CLASSIC_CSV_QUERIES.importEvents, [userId, row.id]).catch(mapPersistenceError)).rows;
      const activities: Record<string, unknown>[] = [];
      for (const event of events) {
        owned(event, userId, "activity event");
        const activity = owned(
          (await q.query<Row>(CLASSIC_CSV_QUERIES.getActivity, [userId, event.activity_id]).catch(mapPersistenceError)).rows[0],
          userId,
          "spot activity",
        );
        activities.push(await loadActivityRead(q, activity));
      }
      return { import: row, activities };
    }).catch(mapPersistenceError);
  }

  async function listActivities(limit: number, cursor: string | null): Promise<Record<string, unknown>> {
    const parsedLimit = limitSchema.parse(limit);
    const parsedCursor = cursorSchema.parse(cursor);
    return db.transaction(async (q) => {
      const rows = (await q.query<Row>(CLASSIC_CSV_QUERIES.listActivities, [userId, parsedCursor, parsedLimit + 1]).catch(mapPersistenceError)).rows;
      for (const row of rows) owned(row, userId, "spot activity");
      const activities: Record<string, unknown>[] = [];
      for (const row of rows.slice(0, parsedLimit)) activities.push(await loadActivityRead(q, row));
      return { activities, nextCursor: rows.length > parsedLimit ? String(rows[parsedLimit - 1].id) : null };
    }).catch(mapPersistenceError);
  }

  async function getActivity(id: string): Promise<Record<string, unknown>> {
    const parsedId = uuidSchema.safeParse(id);
    if (!parsedId.success) malformed("request failed validation");
    return db.transaction(async (q) => {
      const row = owned(
        (await q.query<Row>(CLASSIC_CSV_QUERIES.getActivity, [userId, parsedId.data]).catch(mapPersistenceError)).rows[0],
        userId,
        "spot activity",
      );
      return loadActivityRead(q, row);
    }).catch(mapPersistenceError);
  }

  async function setPurpose(id: string, input: PurposeChangeInput): Promise<Record<string, unknown>> {
    const parsed = purposeChangeSchema.parse(input);
    const parsedId = uuidSchema.safeParse(id);
    if (!parsedId.success) malformed("request failed validation");
    return db.transaction(async (q) => {
      await q.query(CLASSIC_CSV_QUERIES.lockOwner, [userId]).catch(mapPersistenceError);
      const activity = owned(
        (await q.query<Row>(CLASSIC_CSV_QUERIES.getActivity, [userId, parsedId.data]).catch(mapPersistenceError)).rows[0],
        userId,
        "spot activity",
      );
      const current = (await latestPurposeMap(q, [String(activity.id)])).get(String(activity.id));
      if (!current) malformed("activity is missing its declared purpose");
      if (parsed.purpose === current.purpose) return loadActivityRead(q, activity);
      if (parsed.expectedVersion !== current.version) conflict("purpose version is stale; reload the activity before reclassifying");
      await q
        .query(CLASSIC_CSV_QUERIES.insertEvent, [
          userId,
          activity.id,
          null,
          "purpose_change",
          current.version + 1,
          JSON.stringify({ purpose: parsed.purpose, basis: "user_declared", reason: parsed.reason ?? null }),
        ])
        .catch(mapPersistenceError);
      return loadActivityRead(q, activity);
    }).catch(mapPersistenceError);
  }

  return { preview, commit, listImports, getImport, listActivities, getActivity, setPurpose };
}
