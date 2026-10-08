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
- [ ] 3E Playbook + Pre-Trade Recall screens.
- [ ] 3F Persistent end-to-end QA, cross-user isolation, deploy prep.

## Current slice
- 3D DONE. New read seams (reviews repo, owner-scoped): GET /api/reviews?limit=1..50&cursor (summaries: symbol, quality status/score/coverage, no observed_metrics) and GET /api/decisions/[id]/trades (decision's trades + current review; foreign decision 404). Test tests/autopsy/review-list.test.ts (added to test:autopsy).
- UI: TradeEvidence panel on confirmed decisions (src/components/autopsy/trade-evidence.tsx): manual evidence form -> POST /api/trades/manual (side fixed from snapshot, watch-only blocked, symbol mismatch needs reason, exact-decimal strings, unit prices only, currency required for amounts/caps, capture basis required, retrospective comments separate, attestation, no double submit); per trade "Request autopsy" -> POST /api/reviews/generate, manual retry capped at 3 per page, UNSUPPORTED_INFERENCE shown as not validated/not saved; existing review -> "Open autopsy". Manual trades have no dedupe key, so each save is a new trade.
- Routes /app/autopsies (paginated list), /app/autopsies/[id] (quality score/status/coverage, quadrant only if present, 5 dimensions with Not assessed for null, observed quotes vs Inference findings, plan drift as one observation, lessons, trade evidence with Unknowns, outcome only when known, market-cap move labeled not a return, snapshot + raw rationale), /app/dna (GET /api/dna, user-triggered recompute, observation/emerging/established groups, strength labels, review links). Sidebar + Overview steps 3-4 link them. ConfirmedSnapshot exported from decision-detail.

## Completed
- 3C: Trade Activity /app/activity (+[id], imports/[id]); preview write-free, per-order purpose default unknown, commit with original File + previewHash, reclassify with version check. User ran genuine INJ CSV live. (01a0e40)
- 3A: Neon Auth pages, src/proxy.ts protecting /app (fails closed), workspace shell, Overview. SDK throws AuthApiError {status, code}; authErrorMessage maps thrown and returned errors.
- 3B: Decision Desk /app/decisions + /app/decisions/[id], GET /api/decisions owner-scoped list. Inferred origins never pre-ticked, explicit attestation, failed parse leaves a draft in Recent decisions. Correcting a confirmed decision not in UI yet.

## Blockers
- Fresh autopsy grounding reliability (affects 3D/3F). 3D UI shows UNSUPPORTED_INFERENCE honestly but the live path is unproven.
- No genuine decision+trade pair in the user's account yet, so autopsy, DNA, Playbook and Recall can't be shown with real data.
- Agent browser has no Neon session: signed-in screens need the user to check or share captures. Never create Neon Auth accounts without approval.

## Verification
- 3D agent: review-list 4/4; test:autopsy 142/142 (first run hit the known AgentKey timing flake at sparse.test.ts:1463, two reruns clean); type-check, lint 0 errors, production build pass. Anonymous /app/autopsies, /app/autopsies/[id], /app/dna 307 -> /sign-in; GET /api/reviews, /api/reviews/[id], /api/decisions/[id]/trades, /api/dna and POST trades/manual, reviews/generate, patterns/recompute all 401.
- 3D user-verified (user's browser, not agent browser): Autopsies and DNA empty states correct (no Update button on empty DNA); confirmed decision shows "No trade evidence yet"; empty submit blocked; differing symbol reveals required reason; Cancel saves nothing; 1440/820/390/320 no overflow/clipping/copy issues. No trade saved, no autopsy generated.
- NOT live-verified: manual trade save, real Groq autopsy, review detail rendering, DNA recompute. User has no real trade matching the confirmed decision; nothing fabricated.
- 3C: user ran genuine INJ CSV live. 3B: test:decisions 14/14, user ran a genuine decision end to end.

## Next action
- 3E Playbook + Pre-Trade Recall screens. Read src/server/playbook http shapes (GET /api/playbook, POST /api/playbook/propose {}, POST /api/playbook/[id]/decision {action}) and POST /api/recall first. Both depend on accepted reviews/DNA, which this user doesn't have yet: design honest empty states and decide with the user whether a genuine decision+trade will be recorded for live proof.
