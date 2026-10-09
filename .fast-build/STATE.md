# Fast Build State

## Product
- Name: Reflex, evidence-backed decision intelligence for crypto and tokenized US equities.
- Outcome: a usable frontend wired to the real backend. Process quality stays separate from P&L.
- Primary demo path: Landing -> Auth -> Decision Capture -> Confirm -> Attach trade -> Autopsy -> DNA -> Playbook -> Recall. CSV import verified separately.

## Existing capabilities (backend domain-complete, history in agent-state/)
- Neon Auth proxy /api/auth/[...path] + subject->Reflex user mapping: working (src/server/auth).
- Decisions parse/confirm/context/[id] + owner-scoped list GET /api/decisions: working.
- Manual/import trades, reviews generate/[id], plan drift: working. Fresh Groq autopsy can fail grounding (UNSUPPORTED_MOTIVE_CLAIM), surface honestly.
- DNA GET /api/dna + POST /api/patterns/recompute, POST /api/recall, Playbook GET/propose/decision: working.
- Classic CSV preview/commit/imports/activities/purpose: working. GET /api/activities -> {activities,nextCursor}.
- Landing page (196bfda) + mobile overlay nav (e7eb715): approved, locked.

## Frontend MVP slices
- [x] 3A Real Neon Auth UI (sign in/up, reset, sign out) + protected /app workspace shell + overview. (d101b38)
- [x] 3B Decision Desk: parse -> inspect -> correct -> confirm -> view saved decision. (623e6c7)
- [x] 3C Trade Activity + Classic CSV import UI (preview, purpose, commit, history, reclassify).
- [x] 3D Trade evidence + Autopsy + DNA screens (dimensions, evidence, coverage, drift, honest sparse states).
- [x] 3E Playbook + Pre-Trade Recall screens.
- [ ] 3F Persistent end-to-end QA, cross-user isolation, deploy prep.

## 3F.0A user-confirmed origin provenance DONE (no user-data writes)
- Root cause: repos.decisions.confirm saved snapshot.origins only; no runtime path wrote decision_origins basis=user_confirmed, so Autopsy catalog (service.ts user_confirmed filter) and DNA saw only parser inferences.
- Fix: src/server/db/repositories.ts initial confirm inserts each distinct snapshot origin as basis=user_confirmed, confidence NULL, explanation USER_CONFIRMED_ORIGIN_EXPLANATION ("Explicitly selected by the user during confirmation.") inside the same transaction after revision v1. Idempotent repeat, corrections and appendRevision write no origins. Inference rows untouched. Unique (user,decision,label,basis) violation rolls back the whole confirm.
- DNA (decision-dna-policy.ts effectiveOrigins): if a decision has any user_confirmed origin, only those drive influence features and cohorts; unselected inferences stay stored but excluded. Legacy inference-only decisions unchanged (inference basis, cannot establish).
- UI decision-detail.tsx: Origin fact shows "(confirmed by you)" per recorded label, legacy caption when no confirmed rows, and lists unselected model suggestions. Recall already labels basis (inferred vs confirmed), no change.
- Existing INJ decision NOT backfilled: it stays inference-only provenance (legacy caption).
- Tests: test:persistence 69/69 (+4 confirm origin tests), test:decisions 17/17 (+3: pure_impulse inferred -> social_confirmation confirmed via routes, foreign 404 no origin writes, legacy readable), test:autopsy 143/143 (+1 catalog carries confirmed origin, excludes inference), test:patterns 30/30 (+1 confirmed replaces unselected inference, single review = observation, legacy kept), test:recall 27/27, test:playbook 32/32, db:verify real Neon rollback (new invariants: user_confirmed beside inference, idempotent repeat, revision leaves provenance, origin failure rolls back confirm+revision, foreign denied; rollbackVerified). type-check clean, lint 0 errors (2 old warnings), build pass, 3002 restarted.

## 3F.0 RUNNER preflight DONE (read-only), awaiting explicit user approval
- Live DB (READ ONLY txn): only user 89478ac4 has rows: 1 confirmed INJ decision (snapshot origins [borrowed_conviction], basis inference row), 2 INJ/USDT payment-conversion spot activities, 0 trades/reviews/patterns/rules/embeddings, 1 decision-parse ai_run. RUNNER anywhere: 0 decisions, 0 trades, 0 spot. Neither INJ record may be linked to RUNNER.
- Writes per step: parse -> decisions draft (raw text permanent) + ai_runs + decision_origins basis=inference + evidence_records user_input per quote + decision_sources per parser evidence; confirm -> confirmed_snapshot/confirmed_at=now + decision_revisions v1 (later edits append "user correction", trade/autopsy keep original snapshot); trades/manual -> trades (no dedupe) + trade_events (occurred_at = submit time, eventTimeBasis recorded_at) + trade_data evidence (observed_at submit time), opened/closed_at stay NULL, fees column gets "10"; reviews/generate -> ai_runs per attempt + ensureEvidence rows BEFORE validation (persist on grounding failure) + reviews/dimensions/links on success, no embedding in reviews module; recompute -> patterns, prior_review evidence, pattern_evidence, Jina memory_embeddings; propose -> playbook_rules + provenance marker; accept -> new version + Jina embed; recall -> selector ai_run only.
- Gaps found: user_confirmed origin path (FIXED in 3F.0A). Parser will likely add permanent inferred pure_impulse (v22 replay: 0.9). Plan-drift detector needs exact retrospective wording (v22 approved text works). Earlier approved inputs had invalidation "Withdraw if I notice the chart going down past my initial investment" and "I looked at no evidence at all", both absent/different in the new brief.
- Prior 3E detail: 3E DONE, frontend only (no backend change). /app/playbook (src/components/playbook/playbook-view.tsx): GET /api/playbook grouped as Active, Waiting (proposed), Deferred, Rejected, Earlier versions; maturity tag Experimental/Pattern-backed, trigger, rule text, rationale, supportingDecisionCount, scope, effectiveness Unproven, financial benefit Unknown, provenance quotes + autopsy links; Accept/Reject need inline confirmation, Defer direct; reloads from server after every action (never optimistic), 409 -> reload + stale message; "Check for proposals" is click-only POST {} and recomputationRequired is shown as missing DNA, not an error.
- /app/recall (src/components/recall/recall-view.tsx): strict recallInputSchema form (text required, symbol regex, optional context, empty fields omitted), no double submit; renders explanation mode (model_selected / deterministic_fallback as complete standard order / deterministic_empty as general prompts, not personal insight), raw text verbatim + Not saved, questions, watchpoints, memories with origin basis, observations/emerging/established, accepted rules, missing info, source counts. 503 = memory search unavailable, never shown as empty history.
- Sidebar: Playbook + Pre-Trade Recall added, "Coming to your desk" removed; Overview step 5 links Playbook.

## 3D
- 3D DONE. New read seams (reviews repo, owner-scoped): GET /api/reviews?limit=1..50&cursor (summaries: symbol, quality status/score/coverage, no observed_metrics) and GET /api/decisions/[id]/trades (decision's trades + current review; foreign decision 404). Test tests/autopsy/review-list.test.ts (added to test:autopsy).
- UI: TradeEvidence panel on confirmed decisions (src/components/autopsy/trade-evidence.tsx): manual evidence form -> POST /api/trades/manual (side fixed from snapshot, watch-only blocked, symbol mismatch needs reason, exact-decimal strings, unit prices only, currency required for amounts/caps, capture basis required, retrospective comments separate, attestation, no double submit); per trade "Request autopsy" -> POST /api/reviews/generate, manual retry capped at 3 per page, UNSUPPORTED_INFERENCE shown as not validated/not saved; existing review -> "Open autopsy". Manual trades have no dedupe key, so each save is a new trade.
- Routes /app/autopsies (paginated list), /app/autopsies/[id] (quality score/status/coverage, quadrant only if present, 5 dimensions with Not assessed for null, observed quotes vs Inference findings, plan drift as one observation, lessons, trade evidence with Unknowns, outcome only when known, market-cap move labeled not a return, snapshot + raw rationale), /app/dna (GET /api/dna, user-triggered recompute, observation/emerging/established groups, strength labels, review links). Sidebar + Overview steps 3-4 link them. ConfirmedSnapshot exported from decision-detail.

## Completed
- 3C: Trade Activity /app/activity (+[id], imports/[id]); preview write-free, per-order purpose default unknown, commit with original File + previewHash, reclassify with version check. User ran genuine INJ CSV live. (01a0e40)
- 3A: Neon Auth pages, src/proxy.ts protecting /app (fails closed), workspace shell, Overview. SDK throws AuthApiError {status, code}; authErrorMessage maps thrown and returned errors.
- 3B: Decision Desk /app/decisions + /app/decisions/[id], GET /api/decisions owner-scoped list. Inferred origins never pre-ticked, explicit attestation, failed parse leaves a draft in Recent decisions. Correcting a confirmed decision not in UI yet.

## Blockers
- Fresh autopsy grounding reliability resolved for the live path: post-fix v23 attempt accepted on first try; DNA, Playbook and Recall with genuine history remain next.
- Agent browser has no Neon session: signed-in screens need the user to check or share captures. Never create Neon Auth accounts without approval.

## Verification
- 3E agent: type-check, lint 0 errors, production build pass; test:playbook 32/32 (grouping, propose/dedupe, maturity, defer/reject/concurrent accept, embedding rollback + retry dedupe, frozen provenance in memory text, chain/provenance fail-closed, foreign rules) and test:recall 27/27 (model_selected reorder keeps all items, invalid selection + AIError -> deterministic_fallback 200, empty memory skips Jina/Groq, embedding failure honest unavailable, 401/403/400, owner-scoped accepted-rule SQL). Anonymous /app/playbook, /app/recall 307 -> /sign-in; GET /api/playbook, POST propose/decision/recall 401.
- 3E user-verified (user's browser, 14 checks): nav entries, old list gone, empty Playbook + 3 links, Check for proposals reports insufficient DNA (not error), empty Recall blocked, bad symbol rejected, real Recall -> "No personal history yet", text verbatim + Not saved, exit/invalidation questions, missing-info panel, no fabricated history, 1440/820/390/320 OK, mobile menu OK.
- NOT live-verified: populated Playbook (proposals, accept/reject/defer, version history, memory) and populated Recall (memories, patterns, rules, model_selected/fallback). Account has no accepted reviews or DNA; backend tests above are the only evidence. No UI component tests exist.
- 3D agent: review-list 4/4; test:autopsy 142/142 (first run hit the known AgentKey timing flake at sparse.test.ts:1463, two reruns clean); type-check, lint 0 errors, production build pass. Anonymous /app/autopsies, /app/autopsies/[id], /app/dna 307 -> /sign-in; GET /api/reviews, /api/reviews/[id], /api/decisions/[id]/trades, /api/dna and POST trades/manual, reviews/generate, patterns/recompute all 401.
- 3D user-verified (user's browser, not agent browser): Autopsies and DNA empty states correct (no Update button on empty DNA); confirmed decision shows "No trade evidence yet"; empty submit blocked; differing symbol reveals required reason; Cancel saves nothing; 1440/820/390/320 no overflow/clipping/copy issues. No trade saved, no autopsy generated.
- Historical 3D checkpoint, superseded for manual-trade persistence by 3F.1 below: NOT live-verified: manual trade save, real Groq autopsy, review detail rendering, DNA recompute. User has no real trade matching the confirmed decision; nothing fabricated.
- 3C: user ran genuine INJ CSV live. 3B: test:decisions 14/14, user ran a genuine decision end to end.

## Current slice: 3F.1 DONE (v23 Autopsy accepted live, integrity verified read-only)
- User-initiated post-fix attempt succeeded: one accepted review, version 1, provisional quality 42.5 with 80% weighted coverage, outcome unknown, no process/outcome classification. Four dimensions scored, context unassessed, five owned evidence links all owner-valid. Financial unknowns stayed unknown; no realized PnL or execution timestamps fabricated. Confirmed and inferred origins remain separate. Target drift references only owned retrospective evidence with self-assessment preserved separately. Independent readback returns the identical review.
- Watchpoint (no action taken): the saved behavioral finding uses optimistic-expectation phrasing that the current validator vocabulary does not match. A targeted future validator/prompt correction may be warranted; the accepted review is left untouched.
- Privacy: this note carries no financial figures, UUIDs, raw rationale, private timestamps or account information.

## Next action
- STOP. 3F.1 complete. DNA recompute, Playbook proposals and Recall over genuine history are separate future slices, each requiring explicit authorization. No rule accept/reject/defer, deployment, further trades, or new accounts.
