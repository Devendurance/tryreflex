const noNewerAcceptedRule = `NOT EXISTS (WITH RECURSIVE descendants AS (
  SELECT n.id,n.version,n.status,n.user_decision FROM public.playbook_rules n WHERE n.user_id=r.user_id AND n.previous_rule_id=r.id AND n.version>r.version
  UNION ALL SELECT n.id,n.version,n.status,n.user_decision FROM public.playbook_rules n JOIN descendants parent ON n.previous_rule_id=parent.id WHERE n.user_id=r.user_id AND n.version>parent.version
) SELECT 1 FROM descendants WHERE status='active' AND user_decision='accepted')`;
const eligibleMemory = `m.user_id=$1 AND (
  (m.entity_type='decision' AND EXISTS (SELECT 1 FROM public.decisions d WHERE d.user_id=m.user_id AND d.id=m.entity_id AND d.status IN ('confirmed','closed'))) OR
  (m.entity_type='review' AND EXISTS (SELECT 1 FROM public.reviews r JOIN public.decisions d ON d.user_id=r.user_id AND d.id=r.decision_id WHERE r.user_id=m.user_id AND r.id=m.entity_id AND r.is_current AND d.status IN ('confirmed','closed') AND EXISTS (SELECT 1 FROM public.ai_runs a WHERE a.user_id=r.user_id AND a.id::text=r.ai_inference#>>'{ai,runId}' AND a.pipeline='decision-autopsy' AND a.status='success'))) OR
  (m.entity_type='pattern' AND EXISTS (SELECT 1 FROM public.patterns p WHERE p.user_id=m.user_id AND p.id=m.entity_id AND p.observed_statistics->>'producer'='decision-dna.v1' AND p.observed_statistics->>'active'='true' AND p.observed_statistics->>'memorySourceHash'=m.source_hash)) OR
  (m.entity_type='rule' AND EXISTS (SELECT 1 FROM public.playbook_rules r WHERE r.user_id=m.user_id AND r.id=m.entity_id AND r.status='active' AND r.user_decision='accepted' AND ${noNewerAcceptedRule}))
)`;
export const RECALL_QUERIES = {
  available: `SELECT EXISTS(SELECT 1 FROM public.memory_embeddings m WHERE ${eligibleMemory} AND m.model=$2 AND m.dimensions=$3) AS available`,
  search: `WITH current_memory AS (SELECT DISTINCT ON(m.entity_type,m.entity_id) m.* FROM public.memory_embeddings m WHERE ${eligibleMemory} AND m.model=$3 AND m.dimensions=$4 ORDER BY m.entity_type,m.entity_id,m.created_at DESC,m.id DESC) SELECT id,entity_type,entity_id,source_hash,model,dimensions,1-(embedding<=>$2::vector) AS similarity FROM current_memory ORDER BY embedding<=>$2::vector,id LIMIT $5`,
  decision: `SELECT * FROM public.decisions WHERE user_id=$1 AND id=$2 AND status IN ('confirmed','closed') LIMIT 1`,
  currentReview: `SELECT r.id FROM public.reviews r WHERE r.user_id=$1 AND r.decision_id=$2 AND r.is_current AND EXISTS (SELECT 1 FROM public.ai_runs a WHERE a.user_id=r.user_id AND a.id::text=r.ai_inference#>>'{ai,runId}' AND a.pipeline='decision-autopsy' AND a.status='success') ORDER BY r.created_at DESC,r.id DESC LIMIT 1`,
  origins: `SELECT * FROM public.decision_origins WHERE user_id=$1 AND decision_id=$2 ORDER BY label,basis,id`,
  decisionEvidence: `SELECT * FROM public.evidence_records WHERE user_id=$1 AND decision_id=$2 AND kind IN ('user_input','prior_decision') ORDER BY id`,
  pattern: `SELECT * FROM public.patterns WHERE user_id=$1 AND id=$2 AND observed_statistics->>'producer'='decision-dna.v1' AND observed_statistics->>'active'='true' LIMIT 1`,
  patternEvidence: `SELECT e.* FROM public.pattern_evidence l JOIN public.patterns p ON p.user_id=l.user_id AND p.id=l.pattern_id JOIN public.evidence_records e ON e.user_id=l.user_id AND e.id=l.evidence_id WHERE l.user_id=$1 AND l.pattern_id=$2 AND p.observed_statistics->>'active'='true' AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(p.observed_statistics->'evidenceRefs') ref WHERE ref.value=e.id::text) ORDER BY e.id`,
  rule: `SELECT r.* FROM public.playbook_rules r WHERE r.user_id=$1 AND r.id=$2 AND r.status='active' AND r.user_decision='accepted' AND ${noNewerAcceptedRule} LIMIT 1`,
  ruleEvidence: `SELECT e.* FROM public.playbook_rule_evidence l JOIN public.evidence_records e ON e.user_id=l.user_id AND e.id=l.evidence_id WHERE l.user_id=$1 AND l.rule_id=$2 ORDER BY e.id`,
} as const;
