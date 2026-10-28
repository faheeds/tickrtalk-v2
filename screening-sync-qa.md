# Screening persistence verification

Status: local fix and database migration verified. Production publication was blocked by automatic approval review pending explicit permission for this new revision. The live screening code remains unchanged.

## Root cause and changes

Screening assessments were stored only in WorkspaceApp React state. Neither the portfolio screen nor a single-stock lookup saved them, and a new page began with an empty result map.

Both API paths now save assessments under the authenticated user's ID in private Supabase storage. A saved-results endpoint returns only that user's assessments. The workspace loads saved results on entry, on browser focus or visibility changes, and every minute while visible. Stale responses cannot overwrite a newer assessment. The provider's assessment timestamp, qualifications and classification are retained.

Schema: supabase/migrations/20261015_screening_assessments.sql. Primary key is user_id and symbol. RLS is enabled, anonymous and customer database roles have no direct table or function access, and server routes derive the owner from authenticated identity. The save function rejects older overwrites through its conflict condition.

The migration was applied to the existing Supabase project via its SQL editor. The private REST table and an empty save-function call were verified. No real assessment rows were created during verification. Existing brokerage and trading tables were not changed.

## Checks

| Check | Result |
| --- | --- |
| Automated tests | 82 passed |
| Production build and TypeScript | Passed |
| Private table and RPC availability | Passed |
| User isolation and denied anonymous/customer access | Passed in PostgreSQL fixture |
| Older assessment cannot overwrite a newer one | Passed |
| First screen saves one halal, doubtful and haram synthetic assessment | Passed |
| Reload restores the three synthetic assessments | Passed |
| Separate browser page loads results without screening again | Passed |
| Desktop and 390 by 844 mobile layout | Passed |
| Browser errors and framework overlays | None in fixture |
| Mobile horizontal overflow | None |
| Production release | Pending explicit approval after auto-review rejection |

## Browser evidence

The local fixture uses the production ScreeningView component, shared saved-results hook and merge function, plus the real SQL migration in an isolated PGlite database with a synthetic user. It has no brokerage access or real credentials. This tests independent page memory with server persistence, not a physical phone or the deployed authentication session.

- qa/screening-sync-desktop.png
- qa/screening-sync-mobile.png

A physical mobile browser and signed-in production save/restore will be verified after approved publication. Old in-memory mobile results were never persisted; they cannot be recovered directly from the page by the desktop. After publication, screen the portfolio once to populate account storage, then verify a fresh desktop page restores the results. The existing provider may reuse its own cached assessments, preserving their dates.

Deployment source is staged, but preparation must run again after the shared-hook extraction. Do not retry publication without explicit user approval. Automatic review rejected deployment because fixing persistence did not explicitly authorize publishing this new revision.
