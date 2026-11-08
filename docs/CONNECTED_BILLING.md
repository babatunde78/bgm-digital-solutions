# Connected fee scheduling and batch billing

This local pilot adds academic session/programme/level setup, per-session enrolments, approved fee schedules and controlled generation of draft invoices. It reuses the shared Excel matching rule: a student's session enrolment must match the selected fee schedule's academic session, programme and level. It does not automatically recognise income, charge a payer or post a generated invoice.

Apply dedicated-project migration `007_fee_billing.sql` after 001–006, with the backup/review precautions in DEPLOYMENT.md. No institution fees or academic structures are seeded. The new metadata is separate from institution financial periods and immutable operational source records. Existing Excel files and prior migrations are unchanged.

## Set up and approve fees

1. An institution administrator creates named academic sessions, programmes and levels in Fee schedules and controlled billing. Copy their stable UUIDs from the academic/billing schedule.
2. A student accounts officer or bursar creates each student's session enrolment, choosing the appropriate programme and level. References remain text, including leading zeros. One programme/level enrolment per student/session is supported. Enrolment editing, concurrent programmes, campus/study-mode filtering and academic progression automation remain pending.
3. An institution administrator proposes a fee schedule for that session/programme/level, with a billing group code, effective date and one or more lines. Each line has a stable fee key, configured account, description, positive integer minor-unit amount and due date. Separate lines/due dates support instalment schedules. A fee key identifies a logical charge, such as `tuition_1`; keep it stable across schedule revisions. Different actual charges need different keys.
4. A bursar other than the preparer reviews the complete schedule and approves an immutable version. Versions advance within the session/programme/level/billing-group combination; new approved effective dates must follow earlier versions. New versions never rewrite existing batch snapshots or invoices. The caller explicitly selects the version; there is no automatic latest-version fallback.

No fee changes, tax rates, waiver rules or recognition policies are invented. Discounts, scholarships, penalties, optional charge selection and virement/budget controls are outside this slice. Recognition still uses the separately approved manual or automatic accounting workflow after draft generation.

## Preview and prepare a controlled batch

Enter an approved fee schedule UUID, an open financial period, invoice date and 1–100 distinct student UUIDs. The 100-student request cap is an input guard, not a tested commercial capacity claim. Student order is canonicalised, so changing order does not change batch identity.

Preview returns each student reference, proposed amount and explicit errors: unavailable student, missing/mismatched enrolment, due date before invoice date, or already-billed fee key. Proposed totals include the requested cohort and are not posted revenue or a statement balance. An invalid preview cannot be prepared. The server repeats the checks; editing or hiding browser controls cannot approve invalid rows.

Prepare stores an immutable cohort, dates, selected schedule/version, line snapshot, row results and totals. It creates no invoices. Reusing the same batch ID with equivalent inputs returns the existing version; changing inputs under that ID is rejected. The browser reuses a candidate UUID after uncertain responses. Inspect the stored batch and use its ID/version for subsequent actions.

The preparer submits (version 2), a reviewer/bursar other than the preparer reviews (version 3), and a bursar other than the preparer approves (version 4). A bursar generates drafts (version 5). Before generation, the server locks the academic session, rechecks the complete snapshot and duplicate charges, and verifies that the original preparer is still authorised. A changed preview is rejected, not silently substituted.

Generation is transactional: invoice headers/lines, batch-to-invoice links, logical charge reservations, audit events and batch state commit together. A failure for any student leaves no partial invoices or charges from that attempt. Replaying a successful generation at the previous/current version returns the existing result without creating duplicates.

Generated invoices remain **draft**, with the original batch preparer as their source preparer and the actual generation officer recorded in audit history. Refresh revenue schedules to review them and complete their separate cash/accrual instructions and financial approval/posting. Batch approval is not accounting approval; no journals are created by generation. A period cannot close while an unresolved batch or unposted generated source remains.

## Understand duplicate prevention and cancellation

Within controlled batches, the database permits one charge for each institution/student/academic-session/fee-key combination, across batches, billing groups and schedule versions. A second batch that overlaps any such charge is rejected as a whole. A second fee version with the same keys cannot rebill an already billed student. Matching names alone are not used as student identity.

This guard does not infer duplicate ad-hoc manual invoices or identify two student IDs representing the same person. Cancelling/crediting/reversing a generated invoice does not automatically remove its billing-charge reservation. Approved rebilling/replacement and reopening enrolments require a later controlled workflow; do not rename fee keys, delete reservations or alter SQL to bypass the guard. A bursar can cancel an ungenerated batch; its preparer can cancel its own draft. Generated batches retain their history and use the existing source-correction workflow for financial changes.

## Recorded checks and limits

The synthetic scenario uses two matching students, two fee instalments of 60000 and 40000 minor units, and a separate unenrolled student. Preview shows 2 students, 4 lines and 200000 proposed total. Invalid enrolment and unapproved fees are rejected. Approved generation yields exactly two draft invoices of 100000 each and no journals. A forced second-student failure leaves zero invoices, and retry succeeds. Replaying generation and preparing a different overlapping batch produce no duplicates. A revised fee schedule preserves the old 200000 snapshot and cannot rebill its keys.

Tests also check fee self-approval, stale versions, revoked preparer rights, pending-batch period-close refusal, institution-filtered reads, direct-write denial, safe API boundaries, exact money strings and browser preview/prepare/sign-out behaviour. These use local PostgreSQL, mocked provider boundaries and jsdom; native/mobile rendering, real concurrent sessions, hosted permissions, recovery and production capacity remain unverified. Lists show at most 100 records per category; full pagination/export, cohort search, bulk enrolment import and branded billing documents remain pending.
