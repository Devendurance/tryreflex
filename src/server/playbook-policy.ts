import { z } from "zod";
import { RepositoryError } from "./db/repositories";
import { computeSourceHash } from "./db/validation";
import { patternLifecycle } from "./decision-dna-policy";

export const PLAYBOOK_POLICY_VERSION = "playbook.v1";
export const PLAYBOOK_PRODUCER = "playbook.v1";

export interface PlaybookTemplate {
  templateId: "target_revision" | "research_check";
  category: "execution" | "leak";
  feature: string;
  title: string;
  trigger: string;
  ruleText: string;
}

export const PLAYBOOK_TEMPLATES: readonly PlaybookTemplate[] = [
  {
    templateId: "target_revision",
    category: "execution",
    feature: "target_drift",
    title: "Document evidence for exit-target revisions",
    trigger: "Before entering a trade and before revising its exit target",
    ruleText:
      "Before entering a trade, record my intended exit target and the evidence that would justify revising it. When my original target is reached, review that evidence before changing the plan.",
  },
  {
    templateId: "research_check",
    category: "leak",
    feature: "research_quality",
    title: "Document the research behind the trade",
    trigger: "Before entering a trade",
    ruleText:
      "Before entering a trade, record the research supporting my thesis, the assumptions I have not verified, and the evidence that would invalidate it. Review those gaps before deciding whether to proceed.",
  },
];

export function findPlaybookTemplate(category: string, feature: string): PlaybookTemplate | null {
  return PLAYBOOK_TEMPLATES.find((template) => template.category === category && template.feature === feature) ?? null;
}

export function findTemplateById(templateId: string): PlaybookTemplate | null {
  return PLAYBOOK_TEMPLATES.find((template) => template.templateId === templateId) ?? null;
}

export function ruleEquivalentKey(templateId: string, fingerprint: string): string {
  return computeSourceHash(`${PLAYBOOK_POLICY_VERSION}|${templateId}|${fingerprint}`);
}

const uuid = z.string().uuid();
const factQuoteSchema = z.looseObject({ evidenceId: uuid, quote: z.string() });
const sourceStatusSchema = z.enum(["observation", "emerging", "established"]);

const SCOPE: Record<string, string> = {
  observation: "single-decision observation, not recurrence",
  emerging: "emerging comparable evidence, not established recurrence",
  established: "established grounded recurrence under the product quality gate",
};

const EVIDENCE_STRENGTH: Record<string, string> = {
  observation: "limited",
  emerging: "emerging",
  established: "quality_supported_recurrence",
};

export const playbookProvenanceSchema = z
  .strictObject({
    producer: z.literal(PLAYBOOK_PRODUCER),
    templateId: z.enum(["target_revision", "research_check"]),
    equivalentKey: z.string().regex(/^[0-9a-f]{64}$/),
    patternFingerprint: z.string().min(1),
    sourcePatternId: uuid,
    maturity: z.enum(["experimental", "pattern_backed"]),
    sourceStatus: sourceStatusSchema,
    supportingDecisionCount: z.number().int().min(1),
    highQualityCount: z.number().int().min(0),
    establishedEligible: z.boolean(),
    supportingDecisionIds: z.array(uuid),
    supportingReviewIds: z.array(uuid),
    evidenceRefs: z.array(uuid).min(1),
    observedBehavior: z.string().min(1),
    supportingFacts: z.array(
      z.looseObject({
        decisionId: uuid,
        reviewId: uuid,
        basis: z.string(),
        observedFacts: z.array(factQuoteSchema),
      }),
    ),
    relevantMetrics: z.record(z.string(), z.unknown()),
    evidenceStrength: z.string().min(1),
    scope: z.string().min(1),
    effectiveness: z.literal("unproven"),
    financialBenefit: z.literal("unknown"),
    confidence: z.null(),
  })
  .superRefine((value, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const count = value.supportingDecisionCount;
    if (!Number.isInteger(count) || count < 1 || !Number.isInteger(value.highQualityCount) || value.highQualityCount < 0) {
      fail("supporting counts must be nonnegative integers with at least one support");
    } else if (value.highQualityCount > count) {
      fail("highQualityCount exceeds supportingDecisionCount");
    } else if (patternLifecycle(count, value.highQualityCount) !== value.sourceStatus) {
      fail("sourceStatus inconsistent with lifecycle gate");
    }
    if (value.establishedEligible !== (count >= 4 && value.highQualityCount >= 4)) fail("establishedEligible inconsistent with counts");
    if (value.maturity !== (value.sourceStatus === "established" ? "pattern_backed" : "experimental")) fail("maturity inconsistent with sourceStatus");
    if (value.scope !== SCOPE[value.sourceStatus]) fail("scope inconsistent with sourceStatus");
    if (value.evidenceStrength !== EVIDENCE_STRENGTH[value.sourceStatus]) fail("evidenceStrength inconsistent with sourceStatus");
    if (new Set(value.supportingDecisionIds).size !== value.supportingDecisionIds.length || value.supportingDecisionIds.length !== count) fail("supportingDecisionIds must be unique and match the count");
    if (new Set(value.supportingReviewIds).size !== value.supportingReviewIds.length || value.supportingReviewIds.length !== count) fail("supportingReviewIds must be unique and match the count");
    if (new Set(value.evidenceRefs).size !== value.evidenceRefs.length) fail("evidenceRefs must be unique");
    if (value.equivalentKey !== ruleEquivalentKey(value.templateId, value.patternFingerprint)) fail("equivalentKey mismatch");
    if (value.supportingFacts.length !== count) fail("supportingFacts must contain exactly one entry per support");
    const decisionSet = new Set(value.supportingDecisionIds);
    const reviewSet = new Set(value.supportingReviewIds);
    const refSet = new Set(value.evidenceRefs);
    if (
      value.supportingFacts.length === count &&
      (new Set(value.supportingFacts.map((fact) => fact.decisionId)).size !== decisionSet.size ||
        !value.supportingFacts.every((fact) => decisionSet.has(fact.decisionId)) ||
        new Set(value.supportingFacts.map((fact) => fact.reviewId)).size !== reviewSet.size ||
        !value.supportingFacts.every((fact) => reviewSet.has(fact.reviewId)))
    ) {
      fail("supportingFacts decision and review IDs must exactly equal the recorded support sets");
    }
    for (const fact of value.supportingFacts) {
      for (const observed of fact.observedFacts) {
        if (!refSet.has(observed.evidenceId)) fail("supportingFacts quote evidence must be within evidenceRefs");
      }
    }
    const metrics = value.relevantMetrics;
    if (
      metrics.decisionCount !== count ||
      !Number.isInteger(metrics.finalCount) ||
      !Number.isInteger(metrics.provisionalCount) ||
      !Number.isInteger(metrics.qualityUnassessedCount) ||
      (metrics.finalCount as number) < 0 ||
      (metrics.provisionalCount as number) < 0 ||
      (metrics.qualityUnassessedCount as number) < 0 ||
      (metrics.finalCount as number) + (metrics.provisionalCount as number) + (metrics.qualityUnassessedCount as number) !== count
    ) {
      fail("relevantMetrics must carry the deterministic support breakdown");
    }
  });
export type PlaybookRuleProvenance = z.infer<typeof playbookProvenanceSchema>;

export function decodePlaybookMarkerLabel(label: unknown): PlaybookRuleProvenance | null {
  if (typeof label !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(label);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.producer !== PLAYBOOK_PRODUCER) return null;
  const parsed = playbookProvenanceSchema.safeParse(value);
  if (!parsed.success) {
    throw new RepositoryError("playbook provenance marker is malformed", "INVALID_INPUT");
  }
  return parsed.data;
}

export const playbookDecisionSchema = z.strictObject({
  action: z.enum(["accept", "reject", "defer"]),
});
export type PlaybookAction = z.infer<typeof playbookDecisionSchema>["action"];

export function buildRationale(observedBehavior: string, scope: string): string {
  return `${observedBehavior} Scope: ${scope}. Effectiveness is unproven, financial benefit is unknown, and this is not a trade signal.`;
}

export function buildRuleProposal(input: {
  template: PlaybookTemplate;
  fingerprint: string;
  sourcePatternId: string;
  status: "observation" | "emerging" | "established";
  highQualityCount: number;
  establishedEligible: boolean;
  description: string;
  supportingDecisionIds: string[];
  supportingReviewIds: string[];
  evidenceRefs: string[];
  supportingFacts: PlaybookRuleProvenance["supportingFacts"];
  relevantMetrics: Record<string, unknown>;
  evidenceStrength: string;
}): { title: string; trigger: string; ruleText: string; rationale: string; provenance: PlaybookRuleProvenance } {
  const scope = SCOPE[input.status];
  const provenance = playbookProvenanceSchema.parse({
    producer: PLAYBOOK_PRODUCER,
    templateId: input.template.templateId,
    equivalentKey: ruleEquivalentKey(input.template.templateId, input.fingerprint),
    patternFingerprint: input.fingerprint,
    sourcePatternId: input.sourcePatternId,
    maturity: input.status === "established" ? "pattern_backed" : "experimental",
    sourceStatus: input.status,
    supportingDecisionCount: input.supportingDecisionIds.length,
    highQualityCount: input.highQualityCount,
    establishedEligible: input.establishedEligible,
    supportingDecisionIds: input.supportingDecisionIds,
    supportingReviewIds: input.supportingReviewIds,
    evidenceRefs: input.evidenceRefs,
    observedBehavior: input.description,
    supportingFacts: input.supportingFacts,
    relevantMetrics: input.relevantMetrics,
    evidenceStrength: input.evidenceStrength,
    scope,
    effectiveness: "unproven",
    financialBenefit: "unknown",
    confidence: null,
  });
  return {
    title: input.template.title,
    trigger: input.template.trigger,
    ruleText: input.template.ruleText,
    rationale: buildRationale(input.description, scope),
    provenance,
  };
}

type Row = Record<string, unknown>;

function malformed(message: string): never {
  throw new RepositoryError(message, "INVALID_INPUT");
}

export function validateFrozenRule(
  row: Row,
  evidenceRows: readonly Row[],
  userId: string,
): { provenance: PlaybookRuleProvenance | null; refs: string[] } {
  if (String(row.user_id) !== userId) malformed("rule row is not owned by the authenticated user");
  const markerCandidates = evidenceRows.filter(
    (evidence) =>
      evidence.kind === "playbook_rule" || (typeof evidence.label === "string" && evidence.label.includes(PLAYBOOK_PRODUCER)),
  );
  if (markerCandidates.length > 1) malformed("rule has multiple playbook provenance markers");
  const refs: string[] = [];
  let provenance: PlaybookRuleProvenance | null = null;
  for (const evidence of evidenceRows) {
    if (String(evidence.user_id) !== userId) malformed("rule evidence is not owned by the authenticated user");
    if (markerCandidates.includes(evidence)) continue;
    refs.push(String(evidence.id));
  }
  if (markerCandidates.length === 1) {
    const marker = markerCandidates[0];
    if (marker.kind !== "playbook_rule") malformed("playbook provenance marker has the wrong evidence kind");
    if (String(marker.rule_id) !== String(row.id)) malformed("playbook provenance marker references a different rule version");
    const decoded = decodePlaybookMarkerLabel(marker.label);
    if (!decoded) malformed("playbook provenance marker is malformed");
    provenance = decoded;
    if (String(row.source_pattern_id) !== provenance.sourcePatternId) malformed("rule source pattern does not match its frozen provenance");
    const template = findTemplateById(provenance.templateId);
    if (
      !template ||
      String(row.title) !== template.title ||
      String(row.trigger) !== template.trigger ||
      String(row.rule_text) !== template.ruleText
    ) {
      malformed("rule content does not match its frozen playbook provenance");
    }
    if (String(row.rationale) !== buildRationale(provenance.observedBehavior, provenance.scope)) {
      malformed("rule rationale does not match its frozen playbook provenance");
    }
    if (new Set(refs).size !== refs.length) malformed("rule evidence links contain duplicates");
    const expected = new Set(provenance.evidenceRefs);
    if (refs.length !== expected.size || !refs.every((ref) => expected.has(ref))) {
      malformed("rule evidence links do not match its frozen provenance refs");
    }
  }
  return { provenance, refs };
}
