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
- [ ] 3D Autopsy + DNA screens (dimensions, evidence, coverage, drift, honest sparse states).
- [ ] 3E Playbook + Pre-Trade Recall screens.
- [ ] 3F Persistent end-to-end QA, cross-user isolation, deploy prep.

## Current slice
- 3C DONE, frontend only (no backend change). Routes /app/activity (ImportFlow + Imported activity list + Import history, cursor "Show more"), /app/activity/[id] (order facts, fills, reported totals, purpose + reclassify + audit, provenance), /app/activity/imports/[id] (receipt + its orders). Sidebar NAV + Overview step 2 link to it.
- Files: src/components/activity/{activity-api.ts,activity-parts,activity-import,activity-desk,activity-detail}.tsx. upload() posts FormData without setting Content-Type; reuses ApiError/api from decision-api.
- Semantics: preview writes nothing; changing file or account label clears the preview; purposes default unknown, changing one unticks the attestation; commit sends the original File + same scope + previewHash + confirmed=true + purposes for every orderId; commit blocked when !importEligible or any duplicate conflict; already-imported orders keep their saved purpose; fills come from the canonical snapshot so order price and fill price stay distinct; net-of-fees labeled "Not profit"; cost basis/P&L always Unknown; reclassify posts the current version, 409 reloads the activity.

## Completed
- 3A: Neon Auth pages, src/proxy.ts protecting /app (fails closed), workspace shell, Overview. SDK throws AuthApiError {status, code}; authErrorMessage maps thrown and returned errors.
- 3B: Decision Desk /app/decisions + /app/decisions/[id], GET /api/decisions owner-scoped list. Inferred origins never pre-ticked, explicit attestation, failed parse leaves a draft in Recent decisions. Correcting a confirmed decision not in UI yet.

## Blockers
- Fresh autopsy grounding reliability (affects 3D/3F).
- Agent browser has no Neon session: signed-in screens need the user to check or share captures. Never create Neon Auth accounts without approval.

## Verification
- 3C: type-check, lint (0 errors), production build pass. Anonymous /app/activity, /app/activity/[id], /app/activity/imports/[id] 307 -> /sign-in; GET activities/imports list+[id] and POST preview/commit/purpose all 401. User approved and ran the genuine INJ CSV live: 2 new orders/2 fills, same-file reimport 0 new with "already imported", 7.404 order vs 7.407 fill separate, both payment_conversion, reclassify v1->v2->v3 audit, layouts OK. Server log clean (only pg sslmode warning). Cross-owner relies on existing classic-csv tests (51/51 historically); no second live account.
- 3B: test:decisions 14/14; user ran a genuine permanent decision end to end.

## Next action
- 3D Autopsy + DNA screens. Read src/server/reviews http (POST /api/reviews/generate, GET /api/reviews/[id]) and GET /api/dna + POST /api/patterns/recompute shapes first. Needs a confirmed decision with an attached trade: check whether trade attachment (POST /api/trades/manual) must be wired as part of 3D. Show dimensions, quotes, coverage, provisional/unassessed states, drift; surface UNSUPPORTED_MOTIVE_CLAIM grounding failures honestly.
