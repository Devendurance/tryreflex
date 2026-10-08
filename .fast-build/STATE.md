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
- [x] 3B Decision Desk: parse -> inspect -> correct -> confirm -> view saved decision.
- [ ] 3C Trade Activity + Classic CSV import UI (preview, purpose, commit, history, reclassify).
- [ ] 3D Autopsy + DNA screens (dimensions, evidence, coverage, drift, honest sparse states).
- [ ] 3E Playbook + Pre-Trade Recall screens.
- [ ] 3F Persistent end-to-end QA, cross-user isolation, deploy prep.

## Current slice
- 3B DONE. Routes /app/decisions (composer + Recent decisions) and /app/decisions/[id] (draft review/confirm editor, or read-only saved view with raw text, Reflex inference, history). New GET /api/decisions?limit=1..50: owner-scoped summaries via existing decisions.list, hasMore, strict query keys; test in tests/decisions/routes.test.ts.
- UI files: src/components/decisions/{decision-api,decision-desk,decision-parts,decision-editor,decision-detail}.tsx; Decision Desk added to workspace-shell NAV and Overview step 1.
- Semantics: raw text verbatim; inferred origins tagged Inference with exact quotes and never pre-ticked; snapshot confidence is the user's own conviction, never prefilled from extraction confidence; intendedEntry = unit price only; market-cap targets use intendedTakeProfitMarketCap + required currency; empty optionals omitted; explicit attestation before confirm; a failed parse leaves a draft (error responses carry no id) that surfaces in Recent decisions and can be completed by hand.
- Not built: correcting a confirmed decision (backend appends a revision on a changed re-confirm; UI shows history only).

## Completed
- 3A: Neon Auth pages, src/proxy.ts protecting /app (fails closed), workspace shell, Overview. SDK throws AuthApiError {status, code}; authErrorMessage maps thrown and returned errors.

## Blockers
- Fresh autopsy grounding reliability (affects 3D/3F).
- Agent browser has no Neon session: signed-in screens need the user to check or share captures. Never create Neon Auth accounts without approval.

## Verification
- 3B: test:decisions 14/14; type-check/lint/build pass; anonymous /app/decisions* 307 -> /sign-in, /api/decisions list/get/parse 401. User approved one permanent genuine decision: parse, correct, confirm, refresh, Recent list reopen, logout/login all worked; user checked 1440/820/390/320. Cross-owner covered by route tests (owner-filtered list, foreign GET 404); no second live account used.

## Next action
- 3C Trade Activity + Classic CSV import UI at /app/activity. Read src/server/imports/bitget-classic/http.ts and repository read shapes first (listActivities -> {activities,nextCursor}, listImports -> {imports,nextCursor}). Flow: multipart preview -> per-order purpose (default unknown) -> commit with previewHash + confirmed:true -> import history -> purpose reclassify with version check. Manual trade entry via POST /api/trades/manual only if it fits the slice. No PnL or cost basis.
