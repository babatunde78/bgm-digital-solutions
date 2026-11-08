# Connected development guide

Budget continuation: CONNECTED_BUDGETS.md covers expense-account authorisations, commitment reservations, posted-journal attribution, release workflows and close exceptions. Migration 012 follows 001–011 in the isolated Campus project; add `node --check campus/budget.js` to explicit nested checks. Use the workspace's period/basis/as-of filters and inspect attribution exceptions before interpreting availability. This is not completed purchasing/payables or a public launch.

Settlement continuation: CONNECTED_SETTLEMENTS.md supersedes earlier pending statements for its explicit clearing-transfer mode. Add `node --check campus/settlement.js` to nested syntax verification; migrations 010/011 follow all nine previous files in the dedicated project.

Treasury continuation: CONNECTED_TREASURY.md documents statement staging and reviewed matching. Add `node --check campus/treasury.js` to explicit nested syntax verification. The exported shared CSV parser changes no workbook file or Excel calculation.

Fee scheduling continuation: CONNECTED_BILLING.md covers the new approved-fee and batch-draft workflow. Also run `node --check campus/billing.js` when verifying nested Campus scripts. Existing statements below that all fee scheduling/batch billing is pending are superseded for that documented pilot scope.

Nested revenue validation also needs `node --check campus/revenue.js`; the existing top-level syntax script does not traverse this file.

Revenue continuation: [CONNECTED_REVENUE.md](CONNECTED_REVENUE.md) documents the newly implemented student/invoice/receipt/allocation workflows and both manual and institution-approved rule modes. Earlier missing-feature descriptions below are superseded only for that pilot scope; the Complete Suite, source corrections, hosted security and recovery remain pending.

This is a local development application for synthetic data, not a complete or deployed Full Suite. It provides staff sign-in, institution provisioning, membership assignment, a basis-selected journal schedule, journal transitions and linked reversal drafts. Student billing, expenditure modules, document release, professional policy configuration and hosted recovery acceptance are still pending.

## Start locally

Use Node 24 and the existing repository dependencies. Copy `campus/.env.example` to ignored `campus/.env.local`, then configure a dedicated development Supabase project and its publishable key. Do not reuse the storefront database or service-role credentials. Every new Campus environment value is validated by `readConfig` at startup.

From the repository root:

```powershell
node --env-file=campus/.env.local campus/app.js
```

Open the configured origin, initially `http://127.0.0.1:8787`. The process binds to loopback; deployment behind a reviewed HTTPS reverse proxy or platform adapter is a later task. `/health` confirms process readiness only and explicitly does not probe the database. The storefront's build/deployment configuration does not include this application.

## Dedicated database setup

Review and apply `001_ledger.sql`, then `002_operations.sql`, only in the dedicated project, after a verified backup. The files are transactional, ordered, and not rerunnable. The second migration adds a foreign key to actual Auth users; preflight any existing membership IDs before applying it. Do not delete or rewrite records to bypass a failed migration. See DEPLOYMENT.md for commands and recovery boundaries.

After creating and verifying the intended operator's Auth account through an authorised provider workflow, a trusted database operator inserts that exact UUID into `campus.platform_administrators`. The application cannot grant this role. Example template, never run with a guessed user:

```sql
insert into campus.platform_administrators(user_id) values ('<verified-operator-auth-uuid>'::uuid);
```

Expose the `campus` schema through the dedicated project's Data API only after reviewing its grants/RLS. Test signed-in and signed-out access in staging. Provision staff Auth accounts separately; this application does not send invitations, reset passwords or register users. No default account/password exists. Institutional administrator IDs must be checked by the operator before provisioning; an existing Auth UUID alone is not evidence of the person's authority.

Platform administrators can create an institution with legal name, currency code and its first administrator. They acquire no tenant membership or financial access automatically. Institution administrators can assign/disable the seven staff roles for existing Auth users in their own institution. The first administrator membership is fixed in this release; replacement, extra administrators and multi-role assignments need a later controlled process. The membership audit records actor, subject, assigned role, enabled flag and timestamp.

Accounting configuration now uses the workflow below after migration 003. Do not load live financial records or invent policy defaults to exercise the application. Cash/accrual recognition guidance and mappings still need professional approval; automated source posting is not implemented.

## Accounting configuration

Apply `003_configuration.sql` after 001/002, using the same backup/review procedure. It preserves prior records and leaves legacy accounts' new code/type fields unconfigured rather than inventing their values. Existing policy records have no automatic mapping migration: review them and prepare a new, approved mapped version before creating further journals. Legacy records remain readable; opening or reversing them may require an explicitly reviewed migration. New policy effective dates must follow existing approved dates for that basis. There is no automatic selection/conversion of policy versions.

An institution administrator selects the institution and refreshes Accounting configuration, then:

1. Creates each account with its text code, name and asset/liability/equity/income/expense type. Leading zeros remain intact. Account edits/deactivation are not supplied in this release; do not change used accounts through direct SQL as routine operation.
2. Creates financial periods with inclusive start/end dates. Overlap with another period in that institution is rejected. Period creation is separate from year rollover and opening balances.
3. Refreshes configuration to load the account choices. Creates a cash or accrual policy draft with effective date, complete recognition guidance and named mappings to configured accounts. Add mapping rows as needed; names use lowercase letters, digits and underscores, beginning with a letter. The names are labels for approved accounts, not an automatic recognition engine. Review the full policy narrative and mappings in the configuration schedule.
4. Gives the draft ID to an independent bursar for review. The bursar refreshes configuration and approves that exact draft. The server records an immutable next version for that basis, approver and approval timestamp. The preparer cannot self-approve even after a role change. Corrections use a new proposal/version; draft editing, withdrawal and rejection workflows remain pending.

New journal creation requires an approved effective policy with mappings, and every line account must appear in that policy's mappings. This verifies account eligibility; it does not prove that the narrative's recognition rules, account signs or all subledger mappings were applied correctly. Existing journal workflow, balance and period checks still apply. Statements and automated financial source posting remain pending.

A bursar can lock a period using its ID and current version after all its journals are posted. The server serializes the lock with journal creation/posting, increments the version and creates an audit event. New drafts/posting in locked periods are blocked. Reopening is intentionally unavailable in this development release; operational reconciliation, exceptions, close approval and rollover acceptance still need implementation/review before live close.

## Staff workflow

1. Sign in with an already provisioned account. Choose an institution, then a single cash or accrual basis and refresh the journal schedule. At most the latest 100 accessible headers are shown; it is not a trial balance or complete export. Preparers see their own journals; bursars/reviewers/auditors can read all journals in their institution. Institution administrators have no implicit finance role.
2. Use the journal ID and version in the transition form. Submit as its preparer; review as a reviewer/bursar other than the preparer; approve as a bursar other than the preparer; post as a bursar. The database checks roles and workflow independently of form visibility. Posting requires an open period and balanced entries.
3. To correct a posted journal, select its ID/version, an open reversal period, date and reason. The new draft retains basis/policy, swaps every debit/credit and links to the unchanged original. Only one reversal draft per original is allowed in this release. It must traverse fresh review/approval/posting. A date earlier than the original is rejected. Cancelling or editing a reversal draft is not yet supported.
4. On version conflict, refresh before deciding the next action. On uncertain network failure, check the displayed candidate reversal ID and schedule before retrying. Requests are not retried automatically. The original remains `posted`; use the linked reversal for the accounting correction.
5. Sign out when finished. Tokens exist only in tab memory, with no cookies/local/session storage. Reload requires another sign-in. Provider refresh tokens are discarded, and there is no silent renewal. Expiry clears the tab state. Local sign-out clears forms and schedules even if provider sign-out fails.

## Security and acceptance boundaries

Provider logout invalidates refresh capability; an already issued access JWT can remain valid until expiry. Do not promise immediate JWT revocation. Membership revocation is checked at each RPC. Configure appropriately short token lifetimes, provider abuse protection, disabled public signup, password recovery/MFA and deployment rate limits before a production launch. No application-level persistent login rate limiter or complete MFA flow has been delivered.

Primary sources reviewed 8 November 2026: [Auth REST contract](https://github.com/supabase/auth/blob/master/openapi.yaml), [password sign-in](https://github.com/supabase/auth/blob/master/docs/token.go), and [sign-out limitations](https://supabase.com/docs/reference/javascript/auth-signout). HTTP boundaries are mocked in local tests; no real Auth login or provider logout was performed during testing.

Run `node --test --test-concurrency=1 tests/*.test.js`, `node scripts/check.js`, and `node scripts/build.js`. The existing syntax script does not traverse `campus/`; also run `node --check campus/server.js`, `node --check campus/app.js`, `node --check campus/configuration.js`, and `node --check campus/web/client.js`. Local HTTP and jsdom tests verify interactions, not native browser rendering, mobile visual layout, hosted permissions or managed restoration. Those checks remain staging acceptance requirements.
