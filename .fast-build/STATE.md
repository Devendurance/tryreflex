# Fast Build State

## Product
- Name: Reflex, evidence-backed decision intelligence for crypto and tokenized US equities.
- Outcome: a usable frontend wired to the real backend. Process quality stays separate from P&L.
- Primary demo path: Landing -> Auth -> Decision Capture -> Confirm -> Attach trade -> Autopsy -> DNA -> Playbook -> Recall. CSV import verified separately.

## Existing capabilities (backend domain-complete, history in agent-state/)
- Neon Auth proxy /api/auth/[...path] + subject->Reflex user mapping: working (src/server/auth).
- Decisions parse/confirm/context/[id]: working, no list endpoint.
- Manual/import trades, reviews generate/[id], plan drift: working. Fresh Groq autopsy can fail grounding (UNSUPPORTED_MOTIVE_CLAIM), surface honestly.
- DNA GET /api/dna + POST /api/patterns/recompute, POST /api/recall, Playbook GET/propose/decision: working.
- Classic CSV preview/commit/imports/activities/purpose: working. GET /api/activities -> {activities,nextCursor}.
- Landing page (196bfda) + mobile overlay nav (e7eb715): approved, locked.

## Frontend MVP slices
- [x] 3A Real Neon Auth UI (sign in/up, reset, sign out) + protected /app workspace shell + overview.
- [ ] 3B Decision Desk: parse -> inspect -> correct -> confirm -> view saved decision.
- [ ] 3C Trade Activity + Classic CSV import UI (preview, purpose, commit, history, reclassify).
- [ ] 3D Autopsy + DNA screens (dimensions, evidence, coverage, drift, honest sparse states).
- [ ] 3E Playbook + Pre-Trade Recall screens.
- [ ] 3F Persistent end-to-end QA, cross-user isolation, deploy prep.

## Current slice
- 3A DONE. User signed in with their own account on http://localhost:3002: landed on /app, Overview showed email + "Linked to your private record", refresh kept session, sign-out -> /sign-in, /app redirected after. No test accounts created by the agent. Agent could not screenshot signed-in screens (no session in agent browser), so the signed-in shell was visually checked by the user only.
- Files: src/proxy.ts (Neon middleware, loginUrl /sign-in, fails closed to /sign-in?status=unavailable), src/app/(auth)/{layout,sign-in,sign-up,forgot-password,reset-password}, src/components/auth/{auth-client,auth-forms,form-parts,auth-heading}, src/app/app/{layout,page}, src/components/workspace/{workspace-shell,overview}, access/page.tsx -> redirect /app, primitives ACCESS_HREF=/app + buttonClass.
- SDK gotcha: @neondatabase/auth client THROWS AuthApiError {status, code} instead of returning {error}; authErrorMessage handles both.
- Verified: anonymous /app 307 -> /sign-in, /access 307 -> /app, get-session 200 null, /api/activities 401, wrong password -> "Email or password is incorrect.", short password blocked client-side, reset without token explains next step, auth pages no overflow at 320/390/820/1440. type-check/lint/build pass.

## Completed
-

## Blockers
- Fresh autopsy grounding reliability (affects 3D/3F, not 3A).

## Verification
-

## Next action
- 3B Decision Desk at /app/decisions: parse form -> structured result -> correct supported fields -> confirm -> saved view. Read src/server/decisions http/schemas first (no list endpoint exists; keep a client-side recent list only if honest, or add nothing). Enable the sidebar item in workspace-shell NAV and the Overview step.
- For signed-in UI screenshots, ask the user to sign in again or share captures; the agent browser has no session.
