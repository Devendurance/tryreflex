import assert from "node:assert/strict";
import { z } from "zod";
import type { AuthProvider } from "../src/server/auth/context";
import type { DbSession } from "../src/server/db/client";
import type { EmbeddingProvider, LLMProvider } from "../src/server/ai/types";
import { AIError } from "../src/server/ai/errors";
import { createPlaybookHandler, createProposePlaybookHandler, createPlaybookDecisionHandler } from "../src/server/playbook/http";
import { createRecallHandler } from "../src/server/recall/http";

const provenanceSchema = z.looseObject({
  producer: z.literal("playbook.v1"), templateId: z.string(), maturity: z.literal("experimental"),
  sourceStatus: z.literal("observation"), supportingDecisionCount: z.literal(1),
  supportingDecisionIds: z.array(z.string().uuid()).length(1), supportingReviewIds: z.array(z.string().uuid()).length(1),
  evidenceRefs: z.array(z.string().uuid()).min(1), effectiveness: z.literal("unproven"), financialBenefit: z.literal("unknown"),
});
const ruleSchema = z.looseObject({
  id: z.string().uuid(), version: z.number().int().positive(), previousRuleId: z.string().uuid().nullable(),
  sourcePatternId: z.string().uuid(), status: z.enum(["proposed", "active", "rejected", "deferred"]),
  userDecision: z.enum(["accepted", "rejected", "deferred"]).nullable(), ruleText: z.string(), provenance: provenanceSchema,
});
const countsQuery = "SELECT (SELECT count(*)::int FROM public.decisions WHERE user_id=$1) AS decisions,(SELECT count(*)::int FROM public.trades WHERE user_id=$1) AS trades,(SELECT count(*)::int FROM public.trade_events WHERE user_id=$1) AS events";
export const PLAYBOOK_ROLLBACK_QUERY = "SELECT (SELECT count(*)::int FROM public.playbook_rules WHERE user_id=$1 AND id=ANY($2::uuid[])) AS rules,(SELECT count(*)::int FROM public.playbook_rule_evidence WHERE user_id=$1 AND rule_id=ANY($2::uuid[])) AS links,(SELECT count(*)::int FROM public.evidence_records WHERE user_id=$1 AND rule_id=ANY($2::uuid[])) AS provenance,(SELECT count(*)::int FROM public.memory_embeddings WHERE user_id=$1 AND entity_type='rule' AND entity_id=ANY($2::uuid[])) AS embeddings";

export async function verifyPlaybookReplay(input: {
  session: DbSession; authA: AuthProvider; authB: AuthProvider; jina: EmbeddingProvider;
  decisionId: string; tradeId: string; reviewId: string; targetObservationId: string;
}) {
  const { session, authA, authB, jina, decisionId, reviewId, targetObservationId } = input;
  const owner = await authA.getContext();
  const foreign = await authB.getContext();
  assert.ok(owner && foreign && owner.userId !== foreign.userId);
  const ruleIds = new Set<string>();
  const queryCache = new Map<string, Awaited<ReturnType<EmbeddingProvider["embedQuery"]>>>();
  let documentCalls = 0;
  let queryCalls = 0;
  const embedder: EmbeddingProvider = {
    embedDocument: async (text) => { documentCalls += 1; return jina.embedDocument(text); },
    embedQuery: async (text) => {
      const previous = queryCache.get(text);
      if (previous) return previous;
      queryCalls += 1;
      const result = await jina.embedQuery(text);
      queryCache.set(text, result);
      return result;
    },
    embedMany: (texts, mode) => jina.embedMany(texts, mode),
  };
  const deps = { db: session, authProvider: authA, embedder };
  const request = (body: unknown) => new Request("http://localhost:3002/api/playbook", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const success = async (response: Response) => {
    const body = await response.json();
    assert.equal(response.status, 200, `playbook operation failed: ${body.error?.code ?? "unknown"}`);
    return body;
  };
  const action = async (id: string, selected: "accept" | "reject" | "defer") => {
    const rule = ruleSchema.parse(await success(await createPlaybookDecisionHandler(deps)(request({ action: selected }), { id })));
    ruleIds.add(rule.id);
    return rule;
  };
  const baseline = await session.query(countsQuery, [owner.userId]);
  const generated = await success(await createProposePlaybookHandler(deps)(request({})));
  assert.equal(generated.generationMode, "deterministic");
  const proposals = z.array(ruleSchema).parse(generated.proposals);
  proposals.forEach((rule) => ruleIds.add(rule.id));
  const proposal = proposals.find((rule) => rule.provenance.templateId === "target_revision");
  assert.ok(proposal);
  assert.equal(proposal.sourcePatternId, targetObservationId);
  assert.equal(proposal.status, "proposed");
  assert.equal(proposal.userDecision, null);
  assert.deepEqual(proposal.provenance.supportingDecisionIds, [decisionId]);
  assert.deepEqual(proposal.provenance.supportingReviewIds, [reviewId]);
  assert.equal(proposal.ruleText, "Before entering a trade, record my intended exit target and the evidence that would justify revising it. When my original target is reached, review that evidence before changing the plan.");
  assert.equal(documentCalls, 0, "inactive proposals must not incur document embedding calls");
  const repeat = await success(await createProposePlaybookHandler(deps)(request({})));
  assert.equal(repeat.createdCount, 0);
  assert.deepEqual(repeat.proposals.map((rule: { id: string }) => rule.id).sort(), proposals.map((rule) => rule.id).sort());
  const foreignDecision = await createPlaybookDecisionHandler({ ...deps, authProvider: authB })(request({ action: "accept" }), { id: proposal.id });
  assert.equal(foreignDecision.status, 404);
  const proposedText = "I have early access to a hyped token and I'm thinking of buying without much research.";
  const controlledSelector: LLMProvider = {
    generateText: async () => { throw new AIError("TIMEOUT"); },
    generateStructured: async () => { throw new AIError("TIMEOUT"); },
  };
  const recall = () => createRecallHandler({ ...deps, llm: controlledSelector })(request({ text: proposedText })).then(success);
  const noAcceptedRule = async () => {
    const result = await recall();
    assert.ok(!result.acceptedPlaybookRules.some((rule: { id: string }) => ruleIds.has(rule.id)));
  };
  await noAcceptedRule();
  await session.query("SAVEPOINT playbook_rejection_path");
  try {
    const rejected = await action(proposal.id, "reject");
    assert.equal(rejected.status, "rejected");
    assert.equal((await action(proposal.id, "reject")).id, rejected.id);
    assert.equal((await createPlaybookDecisionHandler(deps)(request({ action: "accept" }), { id: rejected.id })).status, 409);
    const afterRejection = await success(await createProposePlaybookHandler(deps)(request({})));
    assert.equal(afterRejection.createdCount, 0);
    assert.ok(afterRejection.proposals.some((rule: { id: string; status: string }) => rule.id === rejected.id && rule.status === "rejected"));
    await noAcceptedRule();
  } finally {
    await session.query("ROLLBACK TO SAVEPOINT playbook_rejection_path");
    await session.query("RELEASE SAVEPOINT playbook_rejection_path");
  }
  await session.query("SAVEPOINT playbook_deferral_path");
  try {
    const deferred = await action(proposal.id, "defer");
    assert.equal(deferred.status, "deferred");
    assert.equal((await action(proposal.id, "defer")).id, deferred.id);
    assert.equal((await createPlaybookDecisionHandler(deps)(request({ action: "accept" }), { id: proposal.id })).status, 409);
    const listing = await success(await createPlaybookHandler(deps)());
    assert.ok(listing.pendingProposals.some((rule: { id: string; status: string }) => rule.id === deferred.id && rule.status === "deferred"));
    await noAcceptedRule();
    const rejectedDeferred = await action(deferred.id, "reject");
    assert.equal(rejectedDeferred.status, "rejected");
    assert.equal(rejectedDeferred.previousRuleId, deferred.id);
  } finally {
    await session.query("ROLLBACK TO SAVEPOINT playbook_deferral_path");
    await session.query("RELEASE SAVEPOINT playbook_deferral_path");
  }
  const accepted = await action(proposal.id, "accept");
  assert.equal(accepted.status, "active");
  assert.equal(accepted.userDecision, "accepted");
  assert.equal(accepted.previousRuleId, proposal.id);
  assert.ok(accepted.version > proposal.version);
  assert.deepEqual(accepted.provenance, proposal.provenance);
  assert.equal(documentCalls, 1);
  assert.equal((await action(proposal.id, "accept")).id, accepted.id);
  assert.equal(documentCalls, 1, "accepted action retry must not re-embed");
  const afterAccept = await success(await createProposePlaybookHandler(deps)(request({})));
  assert.equal(afterAccept.createdCount, 0);
  const listing = await success(await createPlaybookHandler(deps)());
  assert.ok(listing.currentRules.some((rule: { id: string }) => rule.id === accepted.id));
  assert.ok(listing.history.some((rule: { id: string; status: string }) => rule.id === proposal.id && rule.status === "proposed"));
  const recalled = await recall();
  const acceptedRecall = recalled.acceptedPlaybookRules.find((rule: { id: string }) => rule.id === accepted.id);
  assert.ok(acceptedRecall, "real Jina must retrieve the accepted experimental rule for the similar proposal");
  assert.equal(acceptedRecall.ruleText, accepted.ruleText);
  assert.equal(acceptedRecall.provenance.maturity, "experimental");
  assert.equal(acceptedRecall.provenance.effectiveness, "unproven");
  assert.equal(acceptedRecall.provenance.financialBenefit, "unknown");
  assert.deepEqual(acceptedRecall.provenance.supportingDecisionIds, [decisionId]);
  assert.ok(Number.isFinite(acceptedRecall.match.similarity));
  assert.equal(recalled.proposedTrade.rawText, proposedText);
  assert.equal(recalled.proposedTrade.durableProposalCreated, false);
  assert.equal(recalled.historicalMemories[0].outcome, "unknown");
  assert.equal(recalled.establishedPatterns.length, 0);
  assert.equal(recalled.emergingPatterns.length, 0);
  assert.ok(recalled.dnaObservations.some((item: { id: string; status: string; evidenceCount: number }) => item.id === targetObservationId && item.status === "observation" && item.evidenceCount === 1));
  assert.ok(!recalled.dnaObservations.some((item: { category: string }) => item.category === "regime"));
  const refs = [...new Set<string>(acceptedRecall.evidenceRefs)];
  const ownedRefs = await session.query("SELECT id FROM public.evidence_records WHERE user_id=$1 AND id=ANY($2::uuid[])", [owner.userId, refs]);
  assert.equal(ownedRefs.rows.length, refs.length);
  const foreignList = await success(await createPlaybookHandler({ ...deps, authProvider: authB })());
  assert.ok(!foreignList.history.some((rule: { id: string }) => ruleIds.has(rule.id)));
  const foreignRecall = await success(await createRecallHandler({ ...deps, authProvider: authB, llm: controlledSelector })(request({ text: proposedText })));
  assert.ok(!foreignRecall.acceptedPlaybookRules.some((rule: { id: string }) => ruleIds.has(rule.id)));
  const after = await session.query(countsQuery, [owner.userId]);
  assert.deepEqual(after.rows[0], baseline.rows[0], "Playbook actions and Recall must not create decisions, trades, or trade events");
  return {
    ruleIds: [...ruleIds], report: {
      status: "verified", verificationSurface: "historical accepted genuine v22 review replay, not a fresh Groq autopsy",
      generationMode: "deterministic", proposal, accepted, recall: recalled,
      rejection: "verified in isolated savepoint", deferral: "verified in isolated savepoint including later rejection",
      explicitAcceptance: true, repeatedProposalStable: true, repeatedAcceptanceStable: true,
      documentEmbeddingCalls: documentCalls, queryEmbeddingCalls: queryCalls,
      retrieval: { query: proposedText, ruleId: accepted.id, similarity: acceptedRecall.match.similarity, meaning: "real Jina retrieval in this verification corpus only" },
      ownerIsolation: "verified", evidenceRefsValidated: refs.length, noTradeOrDecisionRowsCreated: true,
      recallSelection: "controlled timeout injection to avoid another live Groq call; historical facts and rules are deterministic",
    },
  };
}
