import { z } from "zod";
import { AIError } from "../ai/errors";
import type { LLMProvider } from "../ai/types";
import {
  isDomainError,
  PersistenceError,
  PersistenceUnavailableError,
  RepositoryError,
} from "../db/repositories";
import {
  AUTOPSY_SYSTEM_PROMPT,
  REVIEW_DIMENSIONS,
  REVIEW_PROMPT_VERSION,
  SPARSE_AUTOPSY_PROMPT_VERSION,
  SPARSE_AUTOPSY_SYSTEM_PROMPT,
  classifyProcessOutcome,
  computeDecisionQuality,
  computeSparseManualMetrics,
  computeTradeMetrics,
  type ReviewDimension,
} from "../review-policy";
import { TradeError } from "../trades/errors";
import type { createReviewRepository } from "./repository";

type ReviewRepository = ReturnType<typeof createReviewRepository>;
type Row = Record<string, unknown>;

const MAX_CATALOG_ITEMS = 30;
const MAX_CATALOG_CHARS = 20000;
const METRIC_LABEL = "Deterministic process metrics trade-metrics.v1";
const SPARSE_METRIC_LABEL = "Deterministic process metrics trade-metrics.v2";
const SPARSE_OBSERVATIONS_LABEL = "Retrospective manual observations";
const CLINICAL_PATTERN = /\b(addict(?:ion|ed)?|mental illness|compulsive disorder|bipolar|psychosis|psychiatric)\b/i;
const OUTCOME_FIELDS = new Set(["grossPnl", "netRealizedPnl", "netPnlBasis", "netReturnPct", "outcome"]);
const SPARSE_OUTCOME_FIELDS = new Set([
  "exitPrice",
  "amountInvested",
  "proceedsReceived",
  "fees",
]);
const PNL_WORDS = /\b(pnl|profit|loss|return)\b/i;

const dimensionEntrySchema = z.strictObject({
  dimension: z.enum(REVIEW_DIMENSIONS),
  score: z.number().int().min(0).max(100).nullable(),
  explanation: z.string().min(1).max(1000),
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(z.string().uuid()),
  observedFacts: z.array(
    z.strictObject({
      evidenceId: z.string().uuid(),
      quote: z.string().min(1).max(1000),
    }),
  ),
  inferredFindings: z.array(
    z.strictObject({
      finding: z.string().min(1).max(1000),
      evidenceRefs: z.array(z.string().uuid()),
    }),
  ),
});

const autopsySchema = z.strictObject({
  dimensions: z.array(dimensionEntrySchema).length(5),
  summary: z.string().min(1).max(2000),
  lessons: z.array(
    z.strictObject({
      text: z.string().min(1).max(1000),
      evidenceRefs: z.array(z.string().uuid()),
    }),
  ),
});

export type AutopsyResult = z.infer<typeof autopsySchema>;

interface CatalogEntry {
  id: string;
  kind: string;
  text: string;
}

function isRecord(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringField(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function tradeProcessText(trade: Row): string {
  const lines = [
    `provider: ${String(trade.provider)}`,
    `symbol: ${String(trade.symbol)}`,
    `side: ${String(trade.side)}`,
    trade.quantity === null ? null : `quantity: ${String(trade.quantity)}`,
    trade.entry_price === null ? null : `entry_price: ${String(trade.entry_price)}`,
    trade.opened_at === null ? null : `opened_at: ${isoOf(trade.opened_at)}`,
    trade.closed_at === null ? null : `closed_at: ${isoOf(trade.closed_at)}`,
  ].filter((line): line is string => line !== null);
  return lines.join("\n");
}

function isoOf(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new RepositoryError("record timestamp is invalid", "INVALID_INPUT");
  return date.toISOString();
}

function metricProcessText(metrics: Record<string, unknown>, sparse: boolean): string {
  const lines: string[] = [`metric_version: ${String(metrics.version)}`];
  for (const [key, value] of Object.entries(metrics)) {
    if (OUTCOME_FIELDS.has(key) || PNL_WORDS.test(key)) continue;
    if (sparse && SPARSE_OUTCOME_FIELDS.has(key)) continue;
    if (value === null || key === "version") continue;
    lines.push(`${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
  }
  return lines.join("\n");
}

function sparseObservationsText(observations: Row): string {
  const lines: string[] = ["phase: after_the_fact manual observations, not decision-time evidence"];
  const fields: [string, string][] = [
    ["execution_state", "executionState"],
    ["cash_flow_basis", "cashFlowBasis"],
    ["capture_basis", "captureBasis"],
    ["settlement_currency", "settlementCurrency"],
    ["market_cap_currency", "marketCapCurrency"],
    ["contract_address", "contractAddress"],
    ["chain", "chain"],
  ];
  for (const [label, key] of fields) {
    const value = observations[key];
    if (typeof value === "string" && value.length > 0) lines.push(`${label}: ${value}`);
  }
  const amounts: [string, string][] = [
    ["observed_entry_market_cap", "entryMarketCap"],
    ["observed_exit_market_cap", "exitMarketCap"],
    ["peak_observed_market_cap_retrospective_timing_unknown", "peakObservedMarketCap"],
  ];
  for (const [label, key] of amounts) {
    const value = observations[key];
    if (typeof value === "string" && value.length > 0) lines.push(`${label}: ${value}`);
  }
  const comments = observations.retrospectiveComments;
  if (typeof comments === "string" && comments.trim().length > 0) {
    lines.push(`retrospective_comments: ${comments}`);
  }
  return lines.join("\n");
}

function snapshotText(snapshot: Row): string {
  const lines: string[] = [];
  for (const key of ["assetSymbol", "assetClass", "side", "thesis", "catalyst", "invalidation", "timeframe"]) {
    const value = snapshot[key];
    if (typeof value === "string" && value.length > 0) lines.push(`${key}: ${value}`);
  }
  for (const key of ["intendedEntry", "intendedRiskPct", "confidence"]) {
    const value = snapshot[key];
    if (typeof value === "number" && Number.isFinite(value)) lines.push(`${key}: ${value}`);
  }
  for (const key of ["intendedTakeProfitMarketCap", "marketCapCurrency", "knowledgeBasis"]) {
    const value = snapshot[key];
    if (typeof value === "string" && value.length > 0) lines.push(`${key}: ${value}`);
  }
  if (Array.isArray(snapshot.origins)) lines.push(`origins: ${snapshot.origins.join("|")}`);
  return lines.join("\n");
}

function originText(origin: Row): string {
  const parts = [`origin (user-confirmed): ${String(origin.label)}`];
  const explanation = stringField(origin, "explanation");
  if (explanation) parts.push(`explanation: ${explanation}`);
  return parts.join("\n");
}

function sourceText(source: Row): string {
  const parts = [`source_type: ${String(source.source_type)}`, `label: ${String(source.label)}`];
  const url = stringField(source, "url");
  if (url) parts.push(`url: ${url}`);
  const note = stringField(source, "note");
  if (note) parts.push(`note: ${note}`);
  return parts.join("\n");
}

function contextText(snapshot: Row): string {
  const facts = isRecord(snapshot.observed_facts) ? snapshot.observed_facts : {};
  const parts = [`captured_at: ${String(snapshot.captured_at)}`];
  for (const [key, value] of Object.entries(facts)) {
    parts.push(`${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
  }
  return parts.join("\n");
}

function assertCatalogSize(catalog: CatalogEntry[]): void {
  if (catalog.length > MAX_CATALOG_ITEMS) throw new TradeError("UNSUPPORTED");
  const total = catalog.reduce((sum, item) => sum + item.text.length, 0);
  if (total > MAX_CATALOG_CHARS) throw new TradeError("UNSUPPORTED");
}

interface TradeProvenance {
  feesKnown: boolean;
  calculationBasis: "linear_base_quantity" | "provider_net_only" | "manual_observations";
  settlementCurrency: string | null;
  netPnlBasis: string | null;
  timestampBasis: string | null;
  manualObservations: Row | null;
  receivedAt: string | null;
  eventTimeBasis: string | null;
}

function provenanceOf(events: Row[]): TradeProvenance {
  for (const event of events) {
    const facts = isRecord(event.facts) ? event.facts : null;
    if (facts && facts.kind === "trade_provenance") {
      const metadata = isRecord(facts.metadata) ? facts.metadata : null;
      const basis =
        facts.calculationBasis === "linear_base_quantity" ||
        facts.calculationBasis === "manual_observations"
          ? facts.calculationBasis
          : "provider_net_only";
      return {
        feesKnown: facts.feesKnown === true,
        calculationBasis: basis,
        settlementCurrency:
          typeof facts.settlementCurrency === "string" ? facts.settlementCurrency : null,
        netPnlBasis:
          facts.netPnlBasis === "supplied_net" ||
          facts.netPnlBasis === "computed_linear_net" ||
          facts.netPnlBasis === "actual_net_cashflows" ||
          facts.netPnlBasis === "actual_gross_cashflows_less_fees" ||
          facts.netPnlBasis === "unavailable"
            ? facts.netPnlBasis
            : null,
        timestampBasis:
          metadata && typeof metadata.timestampBasis === "string"
            ? metadata.timestampBasis
            : typeof facts.eventTimeBasis === "string"
              ? facts.eventTimeBasis
              : null,
        manualObservations: isRecord(facts.manualObservations) ? facts.manualObservations : null,
        receivedAt: typeof facts.receivedAt === "string" ? facts.receivedAt : null,
        eventTimeBasis: typeof facts.eventTimeBasis === "string" ? facts.eventTimeBasis : null,
      };
    }
  }
  return {
    feesKnown: false,
    calculationBasis: "provider_net_only",
    settlementCurrency: null,
    netPnlBasis: null,
    timestampBasis: null,
    manualObservations: null,
    receivedAt: null,
    eventTimeBasis: null,
  };
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function validateAutopsy(value: AutopsyResult, catalogById: Map<string, CatalogEntry>): void {
  const seen = new Set<string>();
  for (const dimension of value.dimensions) {
    if (seen.has(dimension.dimension)) throw new AIError("GROUNDING");
    seen.add(dimension.dimension);
    const refs = new Set(dimension.evidenceRefs);
    if (dimension.score === null) {
      if (
        dimension.confidence !== 0 ||
        dimension.evidenceRefs.length > 0 ||
        dimension.observedFacts.length > 0 ||
        dimension.inferredFindings.length > 0
      ) {
        throw new AIError("GROUNDING");
      }
    } else if (dimension.evidenceRefs.length === 0 || dimension.observedFacts.length === 0) {
      throw new AIError("GROUNDING");
    }
    for (const ref of dimension.evidenceRefs) {
      if (!catalogById.has(ref)) throw new AIError("GROUNDING");
    }
    for (const fact of dimension.observedFacts) {
      if (!refs.has(fact.evidenceId)) throw new AIError("GROUNDING");
      const entry = catalogById.get(fact.evidenceId);
      if (!entry || !entry.text.includes(fact.quote)) throw new AIError("GROUNDING");
    }
    for (const finding of dimension.inferredFindings) {
      if (finding.evidenceRefs.length === 0) throw new AIError("GROUNDING");
      for (const ref of finding.evidenceRefs) {
        if (!refs.has(ref)) throw new AIError("GROUNDING");
      }
    }
    if (CLINICAL_PATTERN.test(dimension.explanation)) throw new AIError("GROUNDING");
    for (const finding of dimension.inferredFindings) {
      if (CLINICAL_PATTERN.test(finding.finding)) throw new AIError("GROUNDING");
    }
  }
  for (const dimension of REVIEW_DIMENSIONS) {
    if (!seen.has(dimension)) throw new AIError("GROUNDING");
  }
  if (CLINICAL_PATTERN.test(value.summary)) throw new AIError("GROUNDING");
  for (const lesson of value.lessons) {
    if (lesson.evidenceRefs.length === 0) throw new AIError("GROUNDING");
    for (const ref of lesson.evidenceRefs) {
      if (!catalogById.has(ref)) throw new AIError("GROUNDING");
    }
    if (CLINICAL_PATTERN.test(lesson.text)) throw new AIError("GROUNDING");
  }
}

export async function generateReview(
  repo: ReviewRepository,
  llm: LLMProvider,
  input: unknown,
): Promise<{ review: Row; dimensions: Row[]; decisionQuality: Record<string, unknown>; classification: string | null; runId: string }> {
  const parsed = z.strictObject({ tradeId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) throw new RepositoryError("request failed validation", "INVALID_INPUT");
  const tradeId = parsed.data.tradeId;

  const bundle = await repo.loadBundle(tradeId);
  const trade = bundle.trade;
  if (!trade) throw new RepositoryError("trade not found", "NOT_FOUND");
  const decision = bundle.decision;
  if (!decision) throw new RepositoryError("decision not found", "NOT_FOUND");
  const snapshot = isRecord(decision.confirmed_snapshot) ? decision.confirmed_snapshot : null;
  if (!snapshot) throw new RepositoryError("decision snapshot missing", "CONFLICT");

  const provenance = provenanceOf(bundle.events);
  const isSparse =
    trade.provider === "manual" && provenance.calculationBasis === "manual_observations";
  const observations = provenance.manualObservations ?? {};
  const observedTimestamp = trade.closed_at ?? trade.opened_at ?? null;
  let captureBasis: "contemporaneous" | "retrospective" | "unknown" = "unknown";

  let metrics: Record<string, unknown> & { netPnlBasis: string };
  if (isSparse) {
    const executionState =
      observations.executionState === "open" ||
      observations.executionState === "closed" ||
      observations.executionState === "unknown"
        ? observations.executionState
        : trade.closed_at === null
          ? "unknown"
          : "closed";
    captureBasis =
      snapshot.knowledgeBasis === "retrospective_recollection" ||
      observations.captureBasis === "retrospective"
        ? "retrospective"
        : observations.captureBasis === "contemporaneous"
          ? "contemporaneous"
          : "unknown";
    metrics = computeSparseManualMetrics(
      {
        quantity: strOrNull(trade.quantity),
        entryPrice: strOrNull(trade.entry_price),
        exitPrice: strOrNull(trade.exit_price),
        side: trade.side === "long" ? "long" : "short",
        openedAt: (trade.opened_at ?? null) as Date | string | null,
        closedAt: (trade.closed_at ?? null) as Date | string | null,
        executionState,
        fees: provenance.feesKnown ? String(trade.fees) : null,
        netRealizedPnl: trade.realized_pnl === null ? null : String(trade.realized_pnl),
        amountInvested: strOrNull(observations.amountInvested),
        proceedsReceived: strOrNull(observations.proceedsReceived),
        cashFlowBasis:
          observations.cashFlowBasis === "gross_excluding_fees" ||
          observations.cashFlowBasis === "net_including_fees"
            ? observations.cashFlowBasis
            : "unknown",
        settlementCurrency: provenance.settlementCurrency,
        entryMarketCap: strOrNull(observations.entryMarketCap),
        exitMarketCap: strOrNull(observations.exitMarketCap),
        peakObservedMarketCap: strOrNull(observations.peakObservedMarketCap),
        intendedTakeProfitMarketCap:
          typeof snapshot.intendedTakeProfitMarketCap === "string" &&
          typeof snapshot.marketCapCurrency === "string" &&
          strOrNull(observations.marketCapCurrency) === snapshot.marketCapCurrency
            ? snapshot.intendedTakeProfitMarketCap
            : null,
        marketCapCurrency: strOrNull(observations.marketCapCurrency),
        captureBasis,
      },
      {
        confirmedAt: decision.confirmed_at as Date | string,
        intendedEntry: typeof snapshot.intendedEntry === "number" ? snapshot.intendedEntry : null,
      },
    );
  } else {
    metrics = computeTradeMetrics(
      {
        quantity: String(trade.quantity),
        entryPrice: String(trade.entry_price),
        exitPrice: trade.exit_price === null ? null : String(trade.exit_price),
        side: trade.side === "long" ? "long" : "short",
        openedAt: trade.opened_at as Date | string,
        closedAt: (trade.closed_at ?? null) as Date | string | null,
        fees: provenance.feesKnown ? String(trade.fees) : null,
        netRealizedPnl: trade.realized_pnl === null ? null : String(trade.realized_pnl),
        calculationBasis: provenance.calculationBasis === "linear_base_quantity"
          ? "linear_base_quantity"
          : "provider_net_only",
      },
      {
        confirmedAt: decision.confirmed_at as Date | string,
        intendedEntry: typeof snapshot.intendedEntry === "number" ? snapshot.intendedEntry : null,
      },
    );
  }
  if (provenance.netPnlBasis !== null && metrics.netPnlBasis === "supplied_net") {
    metrics.netPnlBasis = provenance.netPnlBasis;
  }

  const observedAt = isoOf(observedTimestamp ?? provenance.receivedAt ?? trade.created_at);
  const decisionCreatedAt = isoOf(decision.created_at ?? decision.confirmed_at);

  const catalog: CatalogEntry[] = [];
  catalog.push({
    id: String(
      (
        await repo.ensureEvidence({
          kind: "user_input",
          decisionId: String(decision.id),
          label: "Decision raw input",
          observedAt: decisionCreatedAt,
        })
      ).id,
    ),
    kind: "user_input",
    text: `decision raw input:\n${String(decision.raw_input)}`,
  });
  catalog.push({
    id: String(
      (
        await repo.ensureEvidence({
          kind: "user_input",
          decisionId: String(decision.id),
          label: "Confirmed decision snapshot",
          observedAt: decisionCreatedAt,
        })
      ).id,
    ),
    kind: "user_input",
    text: `original confirmed decision snapshot:\n${snapshotText(snapshot)}`,
  });
  for (const origin of bundle.origins) {
    if (origin.basis !== "user_confirmed") continue;
    catalog.push({
      id: String(
        (
          await repo.ensureEvidence({
            kind: "user_input",
            decisionId: String(decision.id),
            label: `Origin (user-confirmed): ${String(origin.label)}`,
            observedAt: decisionCreatedAt,
          })
        ).id,
      ),
      kind: "user_input",
      text: originText(origin),
    });
  }
  const tradeSummaryEvidence =
    bundle.evidence.find(
      (row) => row.kind === "trade_data" && row.label === "Trade attachment and execution summary",
    ) ??
    (await repo.ensureEvidence({
      kind: "trade_data",
      tradeId: String(trade.id),
      label: "Trade attachment and execution summary",
      observedAt,
    }));
  catalog.push({
    id: String(tradeSummaryEvidence.id),
    kind: "trade_data",
    text: tradeProcessText(trade),
  });
  if (isSparse) {
    catalog.push({
      id: String(
        (
          await repo.ensureEvidence({
            kind: "trade_data",
            tradeId: String(trade.id),
            label: SPARSE_OBSERVATIONS_LABEL,
            observedAt,
          })
        ).id,
      ),
      kind: "trade_data",
      text: sparseObservationsText(observations),
    });
  }
  catalog.push({
    id: String(
      (
        await repo.ensureEvidence({
          kind: "trade_data",
          tradeId: String(trade.id),
          label: isSparse ? SPARSE_METRIC_LABEL : METRIC_LABEL,
          observedAt,
        })
      ).id,
    ),
    kind: "trade_data",
    text: metricProcessText(metrics as Record<string, unknown>, isSparse),
  });
  for (const source of bundle.sources) {
    const existing = bundle.evidence.find(
      (row) => row.kind === "source" && String(row.source_id) === String(source.id),
    );
    const row =
      existing ??
      (await repo.ensureEvidence({
        kind: "source",
        sourceId: String(source.id),
        label: `Source: ${String(source.label ?? source.source_type)}`,
        observedAt: isoOf(source.created_at ?? decisionCreatedAt),
      }));
    catalog.push({ id: String(row.id), kind: "source", text: sourceText(source) });
  }
  for (const context of bundle.contexts) {
    const existing = bundle.evidence.find(
      (row) => String(row.context_snapshot_id ?? "") === String(context.id),
    );
    const row =
      existing ??
      (await repo.ensureEvidence({
        kind: "market_data",
        contextSnapshotId: String(context.id),
        label: "Market context snapshot",
        observedAt: isoOf(context.captured_at),
      }));
    catalog.push({ id: String(row.id), kind: "market_data", text: contextText(context) });
  }
  assertCatalogSize(catalog);
  const catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
  const allowedEvidenceIds = catalog.map((entry) => entry.id);

  const result = await llm.generateStructured<AutopsyResult>({
    system: isSparse ? SPARSE_AUTOPSY_SYSTEM_PROMPT : AUTOPSY_SYSTEM_PROMPT,
    input: JSON.stringify({
      decisionSnapshot: snapshot,
      captureTiming: metrics.captureTiming,
      evidenceCatalog: catalog,
    }),
    pipeline: "decision-autopsy",
    promptVersion: isSparse ? SPARSE_AUTOPSY_PROMPT_VERSION : REVIEW_PROMPT_VERSION,
    inputEntityIds: [String(decision.id), String(trade.id)],
    schema: autopsySchema,
    schemaName: "decision_autopsy",
    allowedEvidenceIds,
    validate: (value) => validateAutopsy(value, catalogById),
  });

  const scores: Record<ReviewDimension, number | null> = {
    research_quality: null,
    context_awareness: null,
    risk_discipline: null,
    execution_quality: null,
    behavioral_control: null,
  };
  for (const dimension of result.value.dimensions) {
    scores[dimension.dimension] = dimension.score;
  }
  const decisionQuality = computeDecisionQuality(scores);
  const classification = classifyProcessOutcome(
    decisionQuality.overallScore,
    metrics.outcome as Parameters<typeof classifyProcessOutcome>[1],
  );

  const aiInference = {
    summary: result.value.summary,
    lessons: result.value.lessons,
    dimensions: result.value.dimensions,
    evidenceCatalog: catalog,
    ai: {
      provider: result.provider,
      model: result.model,
      promptVersion: result.promptVersion,
      runId: result.runId,
    },
    snapshotBasis: "original_confirmed",
  };

  let persisted: { review: Row; dimensions: Row[] };
  try {
    persisted = await repo.persistReview({
      tradeId: String(trade.id),
      decisionId: String(decision.id),
      processClassification: classification,
      observedMetrics: {
        tradeMetrics: metrics,
        decisionQuality,
        settlementCurrency: provenance.settlementCurrency,
        timestampBasis: provenance.timestampBasis,
        manualObservations: isSparse ? provenance.manualObservations : null,
        evidenceQuality: isSparse
          ? {
              captureBasis,
              eventTimeBasis: provenance.eventTimeBasis,
              feesKnown: provenance.feesKnown,
            }
          : null,
      },
      aiInference,
      dimensions: result.value.dimensions.map((dimension) => ({
        dimension: dimension.dimension,
        score: dimension.score,
        explanation: dimension.explanation,
        confidence: dimension.confidence,
        evidenceRefs: dimension.evidenceRefs,
      })),
    });
  } catch (error) {
    if (isDomainError(error) && !(error instanceof PersistenceUnavailableError)) throw error;
    throw new PersistenceError();
  }

  return {
    review: persisted.review,
    dimensions: persisted.dimensions,
    decisionQuality,
    classification,
    runId: result.runId,
  };
}

export async function getReview(
  repo: ReviewRepository,
  id: unknown,
): Promise<Record<string, unknown>> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) throw new RepositoryError("request failed validation", "INVALID_INPUT");
  const view = await repo.getReviewView(parsed.data);
  if (!view.review) throw new RepositoryError("review not found", "NOT_FOUND");
  const metrics = isRecord(view.review.observed_metrics) ? view.review.observed_metrics : {};
  const inference = isRecord(view.review.ai_inference) ? view.review.ai_inference : {};
  const refsByDimension = new Map<string, Row[]>();
  const linkedEvidenceIds = new Set<string>();
  for (const link of view.evidenceLinks) {
    const key = String(link.dimension_id);
    const list = refsByDimension.get(key) ?? [];
    list.push(link);
    refsByDimension.set(key, list);
    linkedEvidenceIds.add(String(link.id));
  }
  const savedDimensions = new Map<string, Row>();
  if (Array.isArray(inference.dimensions)) {
    for (const saved of inference.dimensions) {
      if (isRecord(saved) && typeof saved.dimension === "string") {
        savedDimensions.set(saved.dimension, saved);
      }
    }
  }
  const savedCatalog = Array.isArray(inference.evidenceCatalog) ? inference.evidenceCatalog : [];
  const catalogById = new Map<string, Row>();
  for (const entry of savedCatalog) {
    if (isRecord(entry) && typeof entry.id === "string") catalogById.set(entry.id, entry);
  }
  const evidence = [...linkedEvidenceIds].map((id) => {
    const record = view.evidenceLinks.find((link) => String(link.id) === id) ?? {};
    const catalogEntry = catalogById.get(id);
    return {
      evidenceId: id,
      kind: record.kind ?? null,
      label: record.label ?? null,
      text: catalogEntry && typeof catalogEntry.text === "string" ? catalogEntry.text : null,
    };
  });
  return {
    reviewId: view.review.id,
    version: view.review.version,
    isCurrent: view.review.is_current,
    classification: view.review.process_classification ?? null,
    createdAt: view.review.created_at,
    trade: view.trade
      ? {
          id: view.trade.id,
          provider: view.trade.provider,
          symbol: view.trade.symbol,
          side: view.trade.side,
          quantity: view.trade.quantity,
          entryPrice: view.trade.entry_price,
          exitPrice: view.trade.exit_price ?? null,
          openedAt: view.trade.opened_at,
          closedAt: view.trade.closed_at ?? null,
          manualObservations: metrics.manualObservations ?? null,
          evidenceQuality: metrics.evidenceQuality ?? null,
        }
      : null,
    decision: view.decision
      ? {
          id: view.decision.id,
          status: view.decision.status,
          confirmedAt: view.decision.confirmed_at,
          snapshot: view.decision.confirmed_snapshot ?? null,
        }
      : null,
    metrics,
    decisionQuality: metrics.decisionQuality ?? null,
    ai: isRecord(inference.ai) ? inference.ai : null,
    summary: inference.summary ?? null,
    lessons: inference.lessons ?? [],
    evidence,
    dimensions: view.dimensions.map((dimension) => {
      const saved = savedDimensions.get(String(dimension.dimension));
      return {
        id: dimension.id,
        dimension: dimension.dimension,
        score: dimension.score,
        explanation: dimension.explanation,
        confidence: dimension.confidence,
        observedFacts: Array.isArray(saved?.observedFacts) ? saved.observedFacts : [],
        inferredFindings: Array.isArray(saved?.inferredFindings) ? saved.inferredFindings : [],
        evidenceRefs: (refsByDimension.get(String(dimension.id)) ?? []).map((ref) => ({
          evidenceId: ref.id,
          kind: ref.kind,
          label: ref.label,
        })),
      };
    }),
  };
}
