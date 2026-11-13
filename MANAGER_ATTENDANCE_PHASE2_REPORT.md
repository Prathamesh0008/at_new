# Phase 2: secure manager attendance consolidated report

## Outcome

Implemented locally; **not activated or certified production-ready**. No Firebase Auth requests, live database access, development server, browser sessions, migrations, deployment or push occurred. No environment file, credential, security rule, IAM or deployment configuration changed. npm registry access was used only to resolve the declared server dependency, with install scripts disabled.

This supersedes Phase 1's descriptions of missing local implementation. Configuration, storage protection and legacy-data validation remain prerequisites, described below. Historical Apply defaults off and requires separate administrator activation plus authenticated approval and typed confirmation.

## 1. Files changed

New Phase 2 files:

- `lib/manager-domain.mjs`: date validation and daily state transitions.
- `lib/manager-auth.mjs`: Firebase session verification, exact-origin checks, expiring signed review tokens.
- `lib/manager-store.mjs`: bounded reconciliation, approval audit, transactional history, verification, monthly history and daily persistence.
- `lib/manager-api.mjs`: injected request handlers, authorization/configuration gates, limited request bodies and sanitized errors.
- `lib/server/manager-firebase.js`: lazy, isolated named Firebase Admin adapter with explicit credentials.
- `app/api/manager-attendance/[operation]/route.js`: Node route adapter.
- `tests/manager-secure-offline.test.mjs`: mocked verification.
- `MANAGER_ATTENDANCE_PHASE2_REPORT.md`: this report.

Updated Phase 2 files:

- `components/ManagerHistoryPreview.jsx`: existing panel now supports secure sign-in, reviewed monthly previews, audited approval, gated Apply, read-only verification, history, shifts and breaks.
- `lib/manager-history.mjs`: stronger invalid-date checks.
- `tests/manager-history-offline.test.mjs`: obsolete no-fetch assertion now prohibits automatic polling while permitting explicitly requested authenticated reads.
- `package.json`, `package-lock.json`: declare Firebase Admin 14.5.0. npm also updated protobufjs and four protobuf helpers for the new server dependency graph; other existing application package versions were retained. Relevant protobuf dependency constraints were checked offline. The selected server dependency graph requires Node.js 22+; local checks used Node 24.11.0.

Preserved Phase 1 integration: `app/portal/page.jsx` still has only its added import and NTS-MGR/manager-gated panel. No additional Phase 2 shared portal edits. The legacy experimental `app/api/attendance/backfill/route.js` remains fail-closed (503). Other pre-existing untracked experiments and reports were not reused or certified.

## 2. Authentication

Existing employee login/localStorage behavior is unchanged. New APIs never authorize from that state, a supplied employee ID or a supplied role. The panel's visibility gate is not authorization.

The manager signs into a separately provisioned verified-email Firebase Auth account. A named, memory-only client Auth instance leaves employee Auth state untouched. The server verifies the ID token with revocation checks, requires authentication within five minutes, and pins its verified UID to server-only `NTS_MANAGER_FIREBASE_UID`. It creates a one-hour Firebase-managed session cookie, then the client signs out of its temporary Auth instance and clears the password input. No legacy password/hash is reused or exposed.

Every protected operation verifies the session cookie with revocation checks and maps that UID to NTS-MGR. Cookie: `nts_manager_attendance`, HttpOnly, SameSite=Strict, Secure in production, host-only, path `/api/manager-attendance`. Production requires an exact configured HTTPS origin. All mutations require that exact Origin and reject cross-site fetch metadata. Bodies are limited to 16 KB and reject client identity/approval fields. Errors suppress SDK and credential details; responses use `Cache-Control: no-store`.

The independent session has its own sign-out button. Legacy portal logout does not revoke this cookie; its one-hour expiry and Firebase revocation checks apply. On shared machines, sign out of manager attendance before leaving.

Implementation references: [Firebase session cookies](https://firebase.google.com/docs/auth/admin/manage-cookies), [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions). Documentation browsing did not contact project endpoints.

## 3. Historical persistence

| Collection | Document ID | Purpose |
|---|---|---|
| managerAttendanceHistory | NTS-MGR_YYYY-MM-DD | Approved historical estimate |
| managerAttendanceApprovals | NTS-MGR_MONTH_SHA256 | Approval identity, fingerprint, reason, approvedAt, application state/count/appliedAt |
| managerAttendanceDaily | NTS-MGR_YYYY-MM-DD | Actual shift/break state |
| managerAttendanceState | NTS-MGR | Pointer to unclosed shift date |

Estimate fields: employeeId:NTS-MGR, date, attendanceStatus:Present/Absent, estimated:true, source:admin_approved_historical_estimate, clockInVerified:false, clockIn:null, clockOut:null, breaks:null, approvedBy:verified Firebase UID, approvedAt:server approval Timestamp, reason:Manager historical attendance estimate, reviewReason, approvalId. Weekly offs are derived. No historical reference time becomes an event.

Workflow:

1. Offline baseline generation makes no requests or writes.
2. Reconciled monthly preview makes bounded reads only. A signed 30-minute token binds UID, month and a canonical SHA-256 fingerprint of evidence/proposal.
3. Review the dates/conflicts, enter a 10–500 character reason, check review, and type `APPROVE NTS-MGR HISTORICAL ESTIMATES`.
4. Approval transaction rechecks evidence and create-only records an approval audit with a server timestamp. It returns a signed approved token. It writes no estimates.
5. Separately enabled Apply requires that token and `APPLY NTS-MGR HISTORICAL ESTIMATES`. Its transaction rereads audit/evidence/existing history, rejects changes/conflicts, creates only missing stable IDs, and updates audit application state/count.
6. Explicit read-only verification compares audit, fingerprint, metadata, statuses and record count. It never repairs data.

Each month is atomic, with `maxAttempts:1`; there is no automatic all-month runner. Failed commits leave no partial month. Identical successful retries create zero documents and perform no audit update. On an unknown response, verify before a manual retry. Expired review tokens can be renewed from an unchanged preview using the same UID/reason, recovering the deterministic approval ID. Different approval IDs cannot take ownership of existing estimates. Incomplete previously applied history or inconsistent metadata requires investigation.

## 4. Reconciliation and conflicts

Legacy reads cover `attendance`, `attendanceDaily`, `leave_requests`, `leave_requests_v2`, using NTS-MGR equality on employeeId/empId and bounded calendar date/range filters. Each query has a 101-document detection limit; over 100 results requires manual review. ISO attendance dates and ISO/Timestamp leave ranges are supported, including approved leave spanning the month. Timestamp dates normalize to IST. Contradictory ownership fails closed. Missing indexes/services produce errors, never scan fallbacks.

All existing attendance is conservatively protected. Legacy records are labelled verification-unknown rather than certified as verified. Approved leave is protected. Attendance/leave overlaps, invalid queried dates, insufficient suitable absence dates, incompatible estimates and ownership mismatches block approval/application. Existing estimates do not alter absence selection, preserving exact retries.

**Legacy coverage limitation:** range queries cannot discover missing date fields, timestamp-only attendance without the indexed ISO date, unsupported schemas or later backdated writes. Before setting the historical gate, an administrator must separately establish schema completeness and freeze/control historical manager attendance/leave mutations during approval/application. Transactional snapshot checks cannot prevent an unrelated insecure writer from adding backdated records after commit. No broad scan or legacy repair was performed here.

Absences remain deterministic, at least seven days apart, nearest the one-third/two-thirds points of each covered month. Only Saturdays/Sundays are excluded. Baseline: 400 dates, 286 weekdays, 258 estimated Present, 28 Absent and 114 Weekly Off. These are not verified totals.

| Month | Eligible | Present | Absent | Off | Baseline absent dates |
|---|---:|---:|---:|---:|---|
| 2025-10 | 16 | 14 | 2 | 6 | 17, 24 |
| 2025-11 | 20 | 18 | 2 | 10 | 11, 20 |
| 2025-12 | 23 | 21 | 2 | 8 | 11, 22 |
| 2026-01 | 22 | 20 | 2 | 9 | 12, 21 |
| 2026-02 | 20 | 18 | 2 | 8 | 10, 19 |
| 2026-03 | 22 | 20 | 2 | 9 | 11, 20 |
| 2026-04 | 22 | 20 | 2 | 8 | 10, 20 |
| 2026-05 | 21 | 19 | 2 | 10 | 11, 21 |
| 2026-06 | 22 | 20 | 2 | 8 | 11, 21 |
| 2026-07 | 23 | 21 | 2 | 8 | 11, 21 |
| 2026-08 | 21 | 19 | 2 | 10 | 11, 21 |
| 2026-09 | 22 | 20 | 2 | 8 | 11, 21 |
| 2026-10 | 22 | 20 | 2 | 9 | 12, 21 |
| 2026-11 | 10 | 8 | 2 | 3 | 02, 09 |

## 5. Daily attendance and dashboard

Daily tracking starts after 13 November 2026. The server derives the IST date; client dates/timestamps are not accepted. Actual shift/break fields use Firestore serverTimestamp transforms. Actual records have estimated:false, source:verified_manager_daily and clockInVerified:true. Duplicate shift starts/ends do not replace timestamps. No automatic 7 PM close exists.

Tea, Lunch, Evening and Breather allow one simultaneous break and one instance of each type per shift. A completed type cannot reopen; duplicate transitions fail. Shift end requires ending the active break. This manager policy does not change employee allowances.

The state pointer and daily document update atomically. Recovery preserves an unclosed prior-date shift across midnight; it must end explicitly before another starts. Recovery makes no writes. localStorage is not authoritative attendance storage.

The reused panel provides month/year selection, baseline totals, per-date review, estimated/verified indicators, legacy warnings, history, secure approval and personal controls. Reads occur only on explicit clicks. Monthly history uses an in-memory component cache; explicit Refresh bypasses it and successful relevant writes invalidate it. There are no timer/effect-driven requests, listeners or polling loops. Isolated collections do not feed employee salary/rankings or existing exports. All other modules remain unchanged.

## 6. Firestore cost estimates

Actual development: **zero Firebase reads/writes**. Offline preview/disabled configuration: zero.

After separately authorized activation, assuming no legacy records:

- Historical preview: 12 bounded queries plus two stable reads per covered calendar day. Approximately 56 reads for partial October, 38 for partial November, up to 74 for a 31-day month. Zero writes.
- Approve/Apply/Verify: same reconciliation plus one audit read. Approve creates one audit; Apply creates eligible estimates and updates one audit; Verify writes nothing. Identical successful Apply retry writes nothing.
- All 14 baseline months through Generate/Approve/Apply/Verify: approximately 3,914 document/minimum-query reads, plus index-entry charges where applicable; 286 estimate creates + 14 audit creates + 14 audit updates = 314 writes. This sequence is not automatic.
- Legacy matches add reads, including duplicated ownership-query results even though processing deduplicates them. Successful reconciliation is bounded by 12*100 matching query documents plus up to 62 stable reads and minimum reads for empty queries. Overflows abort. Compound range queries may incur additional index-entry reads; these are not billing guarantees.
- Monthly history: two reads/day plus four bounded legacy attendance queries; about 66 reads for an empty 31-day month. Cached View adds zero reads; Refresh repeats the cost.
- Daily recovery: two reads. Mutation: two transaction reads/two writes; UI recovery after success adds two reads. Start/end plus four complete breaks (10 transitions): about 40 reads/20 writes, plus explicit recoveries. Rejected transitions write nothing.
- Firebase Auth/revocation checks make Authentication service requests, not Firestore collection reads.

Existing global dashboard reads/polling remain a quota risk and were not broadly refactored. No Cloud Functions, paid service, scheduler or Blaze dependency was introduced.

## 7. Offline verification

Command: `node --test tests/manager-history-offline.test.mjs tests/manager-secure-offline.test.mjs`.

Final result: **17 tests passed, 0 failed**, including final approval-metadata integrity checks. Tests use injected mock Auth and in-memory Firestore interfaces, not Firebase SDK clients.

Coverage includes boundaries, weekends/two monthly absences/spread, isolation, null historical times, protected attendance/spanning approved leave, stale reviews, confirmation/signature/expiry binding, UID/email/recent-auth/revocation checks, cookies/origin checks, disabled gates, create-only IDs, audited idempotency, atomic commit failure/manual retry, read-only verification, query caps, invalid schemas, daily/break transitions, midnight recovery, failed daily commits, request limits, sanitized errors and no automatic history polling.

Final targeted ESLint passed for the panel, manager modules, route and both test files. `git diff --check` passed. An existing baseline-browser-mapping stale-metadata notice does not affect lint results.

Not run: Next build/full suite, browser/E2E, real Firebase Auth/indexes/rules/transactions, quota diagnostics or production configuration checks. Mocks do not prove deployed rules, index availability, actual concurrent transaction behavior or IAM correctness.

## 8. Configuration required; nothing configured here

Server-only configuration for a separately authorized administrator:

| Variable | Requirement |
|---|---|
| MANAGER_ATTENDANCE_ENABLED | Master gate; absent/false disables protected operations before Firebase initialization |
| MANAGER_ATTENDANCE_ORIGIN | Exact HTTPS production origin, no trailing slash; only development localhost may use HTTP |
| NTS_MANAGER_FIREBASE_UID | Real verified-email manager Firebase Auth UID, never a browser employee ID |
| MANAGER_FIREBASE_SERVICE_ACCOUNT_JSON | Explicit server JSON credential matching existing NEXT_PUBLIC_FIREBASE_PROJECT_ID; no ADC/browser fallback |
| MANAGER_ATTENDANCE_REVIEW_SECRET | Independently generated secret of at least 32 bytes; never NEXT_PUBLIC |
| MANAGER_ATTENDANCE_STORAGE_APPROVED | Set true only after independent direct-client protection review of all four collections |
| MANAGER_LEGACY_HISTORY_RECONCILED | Set true only after supported schema completeness and historical-manager write-control assurance |
| MANAGER_ATTENDANCE_APPLY_ENABLED | Separate explicit administrator activation for Apply; keep absent/false in this phase |

Firebase Auth email/password provider, approved domain and the verified manager account must exist. No account creation, password reset, email verification, revocation, secret provisioning or existing public Firebase configuration change occurred.

## 9. Blockers and risks

Production readiness remains blocked by configuration, storage protection and legacy-data/write-control validation. Admin SDK checks do not prevent clients bypassing the server through permissive Firestore rules. If current rules do not already deny direct client reads/writes to these collections, a separately approved rule change is mandatory **before** the storage gate can be set. No rule/IAM change was made.

Legacy plaintext client passwords/localStorage and the shared attendance endpoint's untrusted employeeId remain pre-existing risks. The new APIs do not use them. Legacy manager controls elsewhere are unchanged; use the new panel for isolated manager tracking and separately control historical legacy writers before applying estimates. Other leftover untracked authentication routes require independent review before future deployment.

The configured manager UID is the authorized historical approver, as allowed by the requested manager/admin workflow. A second-person approval policy is not implemented. Missing credentials/services fail closed. Passing mocks alone is not a production safety certification.

## 10. Steps before authorized production activation

1. Review scoped files/dependencies and unrelated untracked routes before packaging. Confirm Node.js 22+ and install lockfile dependencies in the separately approved deployment process.
2. Obtain separate configuration/account approval. Provision the genuine manager Auth identity, verify email, pin UID, and configure explicit project credentials, exact HTTPS origin and independent review secret through approved secret management. Do not reuse the publicly shipped legacy password.
3. Independently verify direct-client Firestore protection for the four isolated collections. If missing, obtain separate rule-change approval first. Only then attest storage approval.
4. Separately authorize bounded schema/index validation, reconcile unsupported/missing manager fields, and freeze/control backdated historical NTS-MGR attendance/leave changes for the approval/application window. Keep other employee workflows unaffected. Only then attest legacy reconciliation.
5. Keep Apply disabled. After separate activation/testing approval, enable the master/storage gates and validate secure manager sign-in and real daily tracking in an authorized environment. No live validation was authorized/performed here.
6. For each historical month, Generate reconciled preview, review all dates/conflicts and enter a deliberate reason. Resolve conflicts separately. Type the exact APPROVE confirmation and approve. Audit writes are live operations requiring authorization too.
7. Obtain explicit separate administrator approval for historical application. Only then enable Apply and type its exact confirmation for a still-valid reviewed month. Submit one month at a time; never enable automatic backfill.
8. Verify each applied month read-only and inspect monthly history. On unknown responses, verify before retrying. Identical retries write nothing. Investigate incomplete/conflicting results without forced overwrites.
9. Disable Apply after the approved window and sign out. Keep future monitoring bounded and independent of clock updates. None of these activation steps was executed in this phase.
