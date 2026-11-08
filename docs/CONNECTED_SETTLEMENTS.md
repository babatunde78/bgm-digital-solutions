# Settlement accounting and explicit tolerances

This local pilot extends statement matching with independently approved account profiles, explicit bank/book differences, dual-basis clearing transfers and coordinated accounting backout. It records ledger journals; it does not execute a bank payment, refund or provider transaction. Real-provider verification, hosted security, restoration and full production accounting acceptance remain pending.

Apply `010_settlement_controls.sql` then `011_settlement_posting.sql` after all nine earlier dedicated-project migrations, following DEPLOYMENT.md. No customer account mappings or tolerance amounts are seeded. Read CONNECTED_TREASURY.md for verified import/matching semantics first.

## Approve each institution's mappings and limits

An institution administrator proposes a profile for a statement source, approved policy, accounting basis and effective date. A bursar other than its preparer approves an immutable version. Configure one explicit cash profile and one accrual profile; selection is explicit, with no automatic latest-version fallback.

Each profile uses named mappings from its approved policy:

- Bank: the statement source's configured asset account.
- Clearing: a distinct asset account already used by the original receipt/refund/chargeback journal.
- Fee: an expense or separate asset account, according to the professionally approved policy.
- Variance: an expense, liability or separate asset account, according to that policy.
- Limit: the maximum combined bank-side plus source-side differences for one statement line, in integer minor units. Zero permits no nonzero tolerance.

Income/equity accounts are not eligible for this transfer mode, and bank/clearing cannot be reused as fee/variance accounts. Fee and variance can share an eligible account if the institution explicitly maps them that way. The application supplies no recommended threshold, percentage or statutory treatment. Profiles must be effective on both the statement date and posting date. Historical/backout journals retain their original approved mappings.

## Propose and approve a particular difference

Matching remains exact in its capacity checks; a small amount never disappears automatically. After reviewed matching exists for a line, a bursar/student accounts officer can propose:

| Side | Meaning | Required source |
| --- | --- | --- |
| Bank residual | Statement gross exceeds the reviewed matching allocations. | Bank line and explicit reason; source ID blank. |
| Book/source residual | A posted source matched to that line has remaining book amount beyond its matching allocations. | Bank line, matched source ID and explicit reason. |

Each proposal binds both approved profile IDs and an exact positive amount. Its date context is the bank line; do not use a profile beginning after that statement date. Approval rechecks the actual residual, all other approved reservations, and the combined limit in each basis. It requires independent review and a bursar other than the preparer, with an explicit approval note. A limit authorises neither an automatic write-off nor bypassing that workflow. Bank/source decisions remain separate even when their net effect offsets elsewhere.

Approved differences reserve capacity. Pending void requests retain that reservation until independently reviewed/finally voided. Unapproved proposals may be cancelled with checked permissions. Profile edits, revocation and rejection/withdrawal of pending void requests are not yet provided.

## Prepare the complete journal preview

Choose the accepted bank line, open financial period/posting date and both approved profile IDs. Posting date cannot precede the bank date. The server requires reviewed matching plus approved bank residuals to cover the complete statement gross. Pending match/tolerance voids must be resolved first, and all attached differences must use those same profiles.

The snapshot preserves the bank gross/fee/net, matching IDs/versions, individual tolerance IDs/versions, source book amounts and both complete journal previews. It verifies the original posted source clearing entries under each basis and subtracts prior active settlement consumptions. It cannot transfer more clearing than exists or recognise bank cash twice.

This mode supports sources already recorded through clearing. If a receipt was booked directly to the bank account, use its matching evidence and the appropriate existing accounting treatment; do not manufacture a clearing entry to force a second transfer. Cash policies that defer recognition entirely until bank settlement, multi-currency conversion and other unsupported recognition modes need separate approved implementation.

Let matched amount be M, approved bank residual B and approved source residual S. Statement gross must equal M+B; book clearing equals M+S. The generated entries are:

| Movement | Bank | Clearing | Fee | Variance |
| --- | --- | --- | --- | --- |
| Incoming credit | Debit statement net | Credit book clearing | Debit stated fee | Credit bank−book excess, or debit book−bank shortfall |
| Outgoing debit | Credit statement net | Debit book clearing | Debit stated fee | Debit bank−book excess, or credit book−bank shortfall |

Zero legs are omitted; positive debit/credit amounts remain exact integer minor units. Account eligibility and journal balance are enforced by the existing posting functions. These are transfer mechanics for explicitly approved mappings, not a professional endorsement of any recognition policy or variance classification.

Preparation reserves the bank line and freezes its matching/difference links. Submit as its preparer; another reviewer/bursar reviews; a bursar other than the preparer approves; a bursar posts. Both bases, consumption records, audit events and status commit in one transaction. A failure on the second basis rolls back the first. Repeated stale-version posting is rejected. Pending settlements block period close. Cancelling an unposted normal preview releases its bank-line reservation.

## Back out before changing posted links

Posted journals cannot be edited or independently reversed through standalone journal controls. Prepare a settlement reversal with the original settlement ID, an open reversal period/date and reason. Its snapshot shows exact opposite journal lines for review, and posting verifies those lines against the original ledger. Fresh independent review/approval remains required.

The original settlement/journals remain posted and unchanged. New journals link to the originals, restoring the clearing availability and releasing that settlement's bank-line claim when the reversal posts. A later open period can be used while the original period stays closed. This is an accounting correction, not a reversal of money at the bank.

After backout, independently void any attached tolerance decisions before voiding matching. A new settlement can then be prepared against corrected approved evidence. Do not delete claims, consumptions, bank lines or audit records. Partial settlement backout and reversal of a settlement reversal are not provided; an unposted reversal can be cancelled and a replacement request prepared.

## Reports and recorded evidence

The new schedule displays profiles, differences, immutable previews, original/reversal IDs and generated journal IDs subject to role access. An institution administrator can see profile configuration without implicit financial access. Each panel lists at most 100 records; complete pagination/export and financial statements remain pending. Raw treasury matched/unmatched gross totals still describe matching allocations, not a claim that approved differences or ledger closure are zero. Read the explicit tolerance and settlement records alongside those totals.

The synthetic incoming fixture posts a 100000 clearing receipt against bank gross 100010, fee 1000 and net 99010, with an individually approved bank residual 10. A second 50010 receipt settles bank gross/net 50000 with approved source residual 10. Both bases show bank 149010, clearing 0, fees 1000 and net variance 0, while the two separate 10-unit decisions remain visible. No income entries are created.

Tests inject failure on the second basis and verify no partial journals/consumptions. The first settlement is then exactly reversed into an open 2027 period while 2026 remains locked, and its tolerance/matching links are voided through their separate approvals. An outgoing refund of 20000 with bank fees 200/net debit 20200 verifies the opposite transfer direction. A directly bank-booked receipt is refused for duplicate transfer. Source/role/version constraints, source clearing limits, income-account rejection, standalone reversal denial, both preview modes and sign-out clearing are also checked locally.

These PostgreSQL/jsdom/mock HTTP checks are not native browser/mobile, real simultaneous-session, provider-channel, managed-recovery or production-capacity acceptance. Broader source correction chains, approved rebilling, statement replacement/opening balances, complete management controls and professional security/accounting review remain launch work.
