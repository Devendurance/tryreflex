export const PLAYBOOK_QUERIES = {
  lockOwner: `SELECT id FROM public.users WHERE id=$1 FOR UPDATE`,
  list: `SELECT r.* FROM public.playbook_rules r WHERE r.user_id=$1 ORDER BY r.version,r.id`,
  get: `SELECT r.* FROM public.playbook_rules r WHERE r.user_id=$1 AND r.id=$2 LIMIT 1`,
  patterns: `SELECT p.* FROM public.patterns p WHERE p.user_id=$1 AND p.observed_statistics->>'producer'='decision-dna.v1' AND p.observed_statistics->>'active'='true' ORDER BY p.id`,
  patternEvidence: `SELECT l.pattern_id,e.* FROM public.pattern_evidence l JOIN public.patterns p ON p.user_id=l.user_id AND p.id=l.pattern_id JOIN public.evidence_records e ON e.user_id=l.user_id AND e.id=l.evidence_id WHERE l.user_id=$1 AND l.pattern_id=ANY($2::uuid[]) AND p.observed_statistics->>'active'='true' AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(p.observed_statistics->'evidenceRefs') ref WHERE ref.value=e.id::text) ORDER BY l.pattern_id,e.id`,
  ruleEvidence: `SELECT l.rule_id,e.* FROM public.playbook_rule_evidence l JOIN public.evidence_records e ON e.user_id=l.user_id AND e.id=l.evidence_id WHERE l.user_id=$1 AND l.rule_id=ANY($2::uuid[]) ORDER BY l.rule_id,e.id`,
  ownedEvidence: `SELECT e.* FROM public.evidence_records e WHERE e.user_id=$1 AND e.id=ANY($2::uuid[]) ORDER BY e.id`,
  insert: `INSERT INTO public.playbook_rules(user_id,version,previous_rule_id,source_pattern_id,status,title,trigger,rule_text,rationale,user_decision,decided_at) SELECT $1,COALESCE(MAX(version),0)+1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $9::rule_user_decision IS NULL THEN NULL ELSE now() END FROM public.playbook_rules WHERE user_id=$1 RETURNING *`,
  provenance: `INSERT INTO public.evidence_records(user_id,kind,rule_id,label) VALUES($1,'playbook_rule',$2,$3) RETURNING *`,
  linkEvidence: `INSERT INTO public.playbook_rule_evidence(user_id,rule_id,evidence_id) SELECT $1,$2,id FROM public.evidence_records WHERE user_id=$1 AND id=ANY($3::uuid[]) ON CONFLICT(user_id,rule_id,evidence_id) DO NOTHING`,
} as const;
