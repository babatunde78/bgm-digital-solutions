# Connected budget control desk

Local pilot continuation, 8 November 2026. Migration `012_budget_controls.sql`, gateway `campus/budget.js` and the existing staff workspace implement expense-account authorisations, commitments, actual attribution and traceable releases. This is a foundation for Package B, not completed purchasing, payables, grant accounting or budget revisions/virements. No remote migration or deployment has occurred.

## Configuration and records

An institution administrator creates a fund with a name and explicit restricted/unrestricted classification. This label alone does not enforce donor conditions. A bursar or budget officer creates a line referencing the same institution's expense account, financial period and fund, with an explicit cash or accrual basis. One account/period/fund combination has one basis; use separate fund configurations for separate budgets rather than adding both bases together. Capital/asset budgets are outside this slice.

`budget_funds` and `budget_lines` use institution-scoped UUID keys and composite foreign keys. `budget_events` is a separate immutable-event table: a positive integer minor-unit amount, effective document date, description or release reason, version, preparer/reviewer/approver and status. Actuals reference the exact posted journal debit line and optional posted commitment. Releases reference the original event. These connected records implement the shared workbook definitions of budget, commitment and actual; they do not replace the workbook schemas or modify issued editions.

Initial authorisation is one independently approved and posted `budget` event per line. Multiple proposals may be reviewed, but approval rechecks uniqueness. Later revisions and transfers are not supported yet; do not cancel a posted authorisation or edit it directly to simulate one.

## Workflow and authority

Budget officers/bursars prepare authorisations, commitments and commitment releases. Payables officers/bursars prepare actual attributions and actual releases. The preparer submits; another reviewer/bursar reviews; a bursar other than the preparer approves and posts. The reviewer may also approve where their role permits. Institution administrators do not inherit financial approval/report access. Auditors read. Every operation checks membership server-side, and authenticated clients cannot directly mutate these tables or execute private calculation functions.

Drafts do not reserve funds. Approved and posted commitments/actuals reserve capacity, with availability checked again under a locked financial period/line at approval and posting. Expected-version conflicts reject stale updates. Unposted events may be cancelled by their preparer or a bursar. Posted events require a separately approved release. All configuration and workflow actions append administration audit events; database/platform operators remain privileged.

## Position and attribution

Select a financial period, accounting basis and an as-of date within that period before refreshing. The report returns its refresh timestamp, positions, full event history and attribution exceptions. Refresh before making decisions; the pilot does not auto-refresh or provide a timed stale banner.

- Authorised: posted initial budget effective on/before the selected date.
- Actual exposure: approved/posted actual attribution less posted releases effective on/before that date. Future approved obligations reserve funds conservatively.
- Posted actual: posted actual effective on/before that date, less effective posted releases.
- Reserved actual: actual exposure less posted actual.
- Open commitment: approved/posted commitment less effective posted commitment releases and linked actual exposure.
- Available: authorised less actual exposure less open commitment.

All displayed monetary values are decimal strings in the institution currency's minor units; no float conversion is used. A 100,000 authorisation with a 60,000 commitment and a linked 20,000 actual gives 40,000 open commitment and 40,000 available. It does not consume 80,000. Explicit known zeros differ from unattributed expenditure exceptions.

Actual attribution creates no journal and no duplicate expense. It references an eligible posted expense debit in the same institution, account, period and basis, dated no later than the attribution. Total approved/posted attribution across funds cannot exceed that debit. An approved linked actual cannot exceed the unconsumed posted commitment. Attributing an expense without a commitment requires sufficient budget availability.

Manual journals are not yet universally blocked before spending. Posted, unreversed expense debits for configured budget accounts that lack attribution appear as exceptions and block new commitments against that account; new actual attribution may resolve the exception. Expenses on accounts without configured budget lines are outside this report. This is not a complete expenditure dashboard or a procurement approval engine. Credit adjustments require financial reversal and renewed attribution; arbitrary credit netting is not implemented.

## Corrections and close

Release an actual attribution through its own independent workflow before reversing its journal. A linked actual release restores the commitment reservation; it does not free the obligation. A separate commitment release frees that unused obligation. Releasing attribution does not erase the financial expense: it becomes an exception until re-attributed or its journal is reversed. Journal reversal guards prevent bypassing outstanding actual attribution. Original events remain intact.

Period locks reject unfinished budget events, open commitments and unattributed debits on configured budget accounts. No automatic carry-forward or reopening exists. Resolve exceptions and retire/release obligations with evidence before closing; do not edit financial records to bypass close controls.

## Verification and release limits

Local PostgreSQL-engine tests cover commitment-to-actual reconciliation, competing approved reservations, stale versions, overspending, self-approval, duplicate journal attribution, blocked reversal, separately approved releases, balanced existing journal reversal, period locks, audit creation, cross-institution denial and private/direct-write denial. Gateway tests check typed boundaries, same verified bearer forwarding and malformed report rejection. jsdom exercises actual preparation, explicit report filters and sign-out clearing. These checks do not establish hosted identity/RLS configuration, simultaneous-session correctness, native/mobile rendering, full budget lifecycle, legal compliance or tested production restoration.

Apply migration 012 only to an isolated Campus database after migrations 001–011, with a verified backup and reviewed schema/API grants. No new dependencies, environment variables or storefront assets are required. Production rollout, independent accounting/security review and hosted recovery verification remain pending.
