# Manager attendance consolidated implementation report

Status: local offline preview implemented; secure persistence, database reconciliation, server approval and daily tracking BLOCKED. No historical records applied. This is not a completed production attendance system.

## Files changed
- app/portal/page.jsx: one import and manager-ID/role-gated preview panel in existing dashboard. Existing modules and employee flow preserved.
- components/ManagerHistoryPreview.jsx: new on-demand preview, month/year selector, all-month totals, individual date review and local review checkbox; disabled approval, apply and shift controls.
- lib/manager-history.mjs: new pure deterministic proposal model and offline estimated-record contract.
- app/api/attendance/backfill/route.js: replaced pre-existing untracked experimental writer with unconditional 503 fail-closed GET/POST. No database imports or requests.
- tests/manager-history-offline.test.mjs: targeted offline tests.
- MANAGER_HISTORY_IMPLEMENTATION_REPORT.md: this report.

## Inspection and compatibility
Tracked authentication is contexts/AuthContext.js: client-side plaintext password comparison against utils/constants.js and localStorage user state. Existing attendance API trusts request employeeId. These are pre-existing risks, unchanged. The client role gate is visibility only, not authorization. No private attendance is loaded by the new panel.

Existing attendance uses auto-ID attendance event documents with employeeId/empId, date, action and timestamp. Leave schemas include leave_requests and leave_requests_v2 with employeeId, status, fromDate/toDate. The untracked lib/server/session experiments are not part of the restored commit; firebase-admin is not declared in package.json. They were not reused. Other leftover experiments and reports remain untouched and are not validated or endorsed by this implementation.

## Preview behavior
Inclusive fixed 400-day range, Monday–Friday eligible; all Saturdays/Sundays counted as weekly offs; no company holiday exclusions. Each month selects two available dates at least seven calendar days apart, minimizing distance to the one-third/two-thirds points. Iteration order breaks ties deterministically. Existing manager attendance is conservatively protected regardless of verification status; approved leave is protected. Overlaps, undated attendance, unsupported leave date representations, insufficient candidates and unreconciled input block the offline record contract. No inputs are mutated. Other employees are ignored.

The UI uses schedule-only input and explicitly marks database records unknown. It never claims these are final reconciled totals. No verified history is invented. Review checkbox is local and is not administrator approval. Generate and Review are usable; Approve and Apply remain blocked.

## Monthly baseline schedule totals
These assume no existing records or approved leave; actual approved totals must be reconciled later.

| Month | Eligible weekdays | Proposed Present | Proposed Absent | Weekly Off | Absent dates |
|---|---:|---:|---:|---:|---|
| 2025-10 | 16 | 14 | 2 | 6 | 17, 24 |
| 2025-11 | 20 | 18 | 2 | 10 | 11, 20 |
| 2025-12 | 23 | 21 | 2 | 8 | 11, 22 |
| 2026-01 | 22 | 20 | 2 | 9 | 12, 21 |
| 2026-02 | 20 | 18 | 2 | 8 | 10, 19 |
| 2026-03 | 22 | 20 | 2 | 9 | 11, 20 |
| 2026-04 | 22 | 20 | 2 | 8 | 10, 20 |
| 2026-05 | 21 | 19 | 2 | 10 | 11, 21 |
| 2026-06 | 22 | 20 | 2 | 8 | 11, 19 |
| 2026-07 | 23 | 21 | 2 | 8 | 10, 21 |
| 2026-08 | 21 | 19 | 2 | 10 | 11, 21 |
| 2026-09 | 22 | 20 | 2 | 8 | 11, 21 |
| 2026-10 | 22 | 20 | 2 | 9 | 12, 21 |
| 2026-11 | 10 | 8 | 2 | 3 | 02, 09 |
| Total | 286 | 258 | 28 | 114 | |

## Firebase structure, integrity and cost
No collection is used or created by this implementation. Zero additional Firestore reads/writes per preview, month change, review or blocked API call; no network fetches, listeners, timers, polling, transaction retries or persistence. Existing global reads/refresh behavior remains unchanged.

Offline record contract uses stable ID NTS-MGR_YYYY-MM-DD. Fields: employeeId, date, attendanceStatus Present/Absent, estimated:true, source:admin_approved_historical_estimate, clockInVerified:false, clockIn:null, clockOut:null, breaks:null, approvedBy, approvedAt, reason:Manager historical attendance estimate. No informational start reference is stored as a timestamp. Repeated generation yields the same unique IDs, but database-level idempotency is not implemented because writing is blocked.

Future separately approved persistence should use an isolated manager-only collection, create-only stable daily IDs, server-derived identity and approval timestamps, and transactional conflict rechecks against verified attendance/leave. Approval must bind to the exact reviewed snapshot and confirmation. A client-provided trustedServerIdentity flag in the pure offline helper is NOT authentication and must never be used as an API authorization mechanism. No endpoint calls that helper. Future transaction and read costs cannot be established until authorization and reconciliation are approved. A clean full-range baseline would propose 286 estimate documents, not 400 timestamp events. Weekly offs are derived.

## Isolation and preservation
Only NTS-MGR sees the new panel under the existing UI role gate. Server backfill endpoint denies every caller, including forged manager IDs, before any data access. No shared attendance API, employee service, breaks, tasks, salary, ranking, leave, holiday settings, exports, authentication, security rules, deployment config, credentials or environment files were changed. New proposals do not enter rankings or salary calculations.

## Offline verification
node --test tests/manager-history-offline.test.mjs: 5 tests passed, covering all ten requested categories: boundaries, weekend exclusion, two absences/month, deterministic spread and unique IDs, employee isolation, protected attendance, approved leave conflicts/insufficient candidates, approval prerequisites, authorization denial and absence of automatic history polling. Tests import only the pure model and blocked route; no Firebase SDK calls.
Targeted ESLint executed for new model, component, endpoint and test file. No app server, browser sessions, E2E, Firebase CLI, integrations, migrations, database writes, deployment or push performed.

## Untested and blocked
Database history, actual approved leave reconciliation, production manager authorization, persisted approval/audit, transaction races, real timestamp shifts/breaks and browser rendering remain untested and unimplemented where dependent on secure persistence. No live diagnostics were performed. Existing employee behavior was preserved by inspection, not E2E testing.

Separately approved trusted server authentication and protected persistence are prerequisites to enabling those operations. The task explicitly prohibits changing authentication architecture/configuration and instructs stopping that part if safe authorization cannot be implemented. This implementation follows that blocker instruction rather than treating localStorage or a supplied employee ID as authority. Separate administrator approval alone cannot enable Apply; safe server implementation and review are also required. No enable switch or automatic backfill was introduced.
