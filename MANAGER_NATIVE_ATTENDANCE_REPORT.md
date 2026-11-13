# Final manager attendance integration report

## Result

Manager historical attendance now uses the existing attendance dashboard, sidebar calendar, heatmap, personal month filter/history table and Export Center. The separate manager history component was removed. Standard status labels are Present, Absent and Weekly Off, with Leave where approved leave takes precedence. Historical provenance stays in internal metadata, report audit fields and a short contextual note; no calculated date is represented as a clock-in event.

**Manager Start/End Shift remain blocked.** The shared employee controls and visual design are reused, including the existing break controls, but disabled for NTS-MGR. Both shift and break handlers also refuse manager requests before reaching the unprotected employee endpoints. The working login still only establishes browser/localStorage state, not a server-verified manager identity. No second login screen, Firebase project, configuration change or authorization bypass was introduced. Existing secure backend timestamp/idempotency protections were retained, not activated.

## Files changed in this task

- `app/portal/page.jsx`: native attendance/calendar/table/report integration; shared manager controls fail closed; employee salary/performance selectors remain separate.
- `lib/attendance-view.mjs` (new): pure view selectors, manager monthly totals, common report rows, shared Excel workbook builder and escaped PDF-print HTML.
- `lib/firebase-helpers.js`: preserve punch-verification metadata and add cached, bounded legacy evidence retrieval for selected manager historical months.
- `components/ManagerHistoryPreview.jsx` (removed): replaced by the existing attendance views rather than another manager panel.
- `tests/attendance-native.test.mjs` (new): model, precedence, native wiring, bounded evidence, actual XLSX round-trip and PDF-print output checks.
- `tests/manager-history-offline.test.mjs`: assertions now target native integration.
- `tests/manager-secure-offline.test.mjs`: read-only selector assertion updated after removing the separate component.
- `tests/portal-security-quota.test.mjs`: native UI assertion replaces the old separate-panel assertion.
- `tests/portal-helpers-offline.test.mjs`: mock resolves the new pure date-helper import without loading Firebase.
- `MANAGER_NATIVE_ATTENDANCE_REPORT.md`: this consolidated report.

No authentication, payroll, task, worksheet, leave-write, export-calculation, permission, environment, rules, IAM or deployment configuration was changed in this task. Earlier working-tree changes remain intact.

## Native UI and data behavior

- The manager shares the existing Attendance Module and employee Start/End/break controls; no new screen or manager-only controls component exists.
- The existing month-wise personal history table includes all calculated historical dates, standard statuses, verified login/logout times when available, and blank time cells otherwise. The existing header shows manager monthly counts.
- The sidebar calendar uses the manager's historical Monday–Friday schedule and Saturday/Sunday weekly offs. Company holiday settings do not change the historical manager schedule. Employee calendars retain their existing behavior.
- The existing today table and heatmap include manager attendance. Virtual rows carry no timestamp and cannot fall through to a fabricated midnight/current-time display.
- Attendance reports include the manager through a separate attendance-only selector. The original `employeeList` and `monthlySummary` inputs to salaries, task assignment and performance rankings are unchanged. Calculated manager history never enters payroll or rankings.
- Genuine loaded records and approved leave take precedence. Real absences count toward the two-day monthly allowance. Excess real absences are retained and flagged for review; they are never overwritten to force the baseline. Missing future weekdays are not manufactured as Present or Absent. Existing post-cutoff manager punches can appear normally.

## Excel and PDF

Both existing Export Center buttons now consume the same report dataset for all employees and the manager.

Excel retains the existing `Monthly Summary` worksheet and its original first four columns: Employee, PresentDays, HalfDays and PayableDays. It appends EmployeeID, Month, AbsentDays, WeeklyOffDays, TotalWorkingDays and Notes. Original employee summary values are passed through unchanged; new count fields remain blank for employees rather than introducing new calculations. Manager payable days remain blank because this attendance integration does not implement manager payroll.

A common `Attendance History` worksheet contains EmployeeID, Employee, Month, Date, Status, LoginTime, LogoutTime and Notes. It is not a manager-only format. Verified punches supply real times; historical estimates, weekly offs and leave have blank times. Audit notes distinguish calculated history from existing verified/verification-unknown records.

PDF reuses the existing popup/print-to-PDF workflow, with matching shared summary and history tables. Names/notes/month values are HTML-escaped. No new PDF dependency or separate manager report layout was added.

Offline tests serialized an actual XLSX workbook to memory, reopened it and checked manager totals/blank times. PDF-print HTML was checked for manager identity, totals, time fields, audit notes, escaped content and the existing print invocation. Physical browser printing/PDF rendering was not run.

## Baseline monthly attendance

These are calculated schedule totals before genuine records or approved leave affect a month; they are not certified historical punches.

| Month | Working days | Present | Absent | Weekly Off |
|---|---:|---:|---:|---:|
| 2025-10 | 16 | 14 | 2 | 6 |
| 2025-11 | 20 | 18 | 2 | 10 |
| 2025-12 | 23 | 21 | 2 | 8 |
| 2026-01 | 22 | 20 | 2 | 9 |
| 2026-02 | 20 | 18 | 2 | 8 |
| 2026-03 | 22 | 20 | 2 | 9 |
| 2026-04 | 22 | 20 | 2 | 8 |
| 2026-05 | 21 | 19 | 2 | 10 |
| 2026-06 | 22 | 20 | 2 | 8 |
| 2026-07 | 23 | 21 | 2 | 8 |
| 2026-08 | 21 | 19 | 2 | 10 |
| 2026-09 | 22 | 20 | 2 | 8 |
| 2026-10 | 22 | 20 | 2 | 9 |
| 2026-11, through 13th | 10 | 8 | 2 | 3 |
| Total | 286 | 258 | 28 | 114 |

The existing deterministic historical model is reused. Selected-month real attendance and approved leave recalculate the view and report totals. No historical estimates are persisted into verified attendance collections or any other collection.

## Read efficiency and preservation

Phase 4 caching, in-flight deduplication, hidden-tab pauses, quota-error latch, 60-second notifications and 30-second today-only manager attendance/break updates remain unchanged. The running clock does not fetch historical evidence.

Additional legacy evidence reads occur on selected report/history/calendar month changes, visibility recovery or explicit refresh/mutation events, through the existing shared cache/coordinator. There are at most eight queries per distinct requested historical month, for at most three selected months: employeeId/empId equality plus date bounds on attendance/attendanceDaily and ISO/Timestamp overlap bounds on legacy leave_requests. Each query uses a 101-document detection cap and refuses more than 100 rows. Queries deduplicate document IDs and reject contradictory ownership. No unbounded fallback or global history loop was added. Existing leave_requests_v2 rows are reused from portal loading.

These are source-level bounds, not measured production usage. Index-entry work and actual document costs depend on deployed indexes/data. No live queries were executed.

## Verification

Quick offline command:

`node --test tests/attendance-native.test.mjs tests/manager-history-offline.test.mjs tests/manager-secure-offline.test.mjs tests/portal-security-quota.test.mjs tests/portal-helpers-offline.test.mjs`

**40 tests passed, 0 failed**, in under one second in the consolidated run. Coverage includes native UI call paths, historical range/totals/weekends/two absences, actual-record/leave precedence, excess real absences, no invented timestamps, both export paths, XLSX serialization, employee summary preservation, bounded evidence queries, authorization/replay safeguards and retained quota optimizations.

Targeted lint passes for the view module, helper and changed tests. The shared portal file retains the same existing lint debt as Git HEAD: three errors and eight warnings, with identical counts by rule/severity. No new portal lint diagnostics were introduced. No browser, full build or live Firebase tests were run.

## Remaining blockers

1. Secure manager shift/break writes cannot be enabled through the current browser-only login. A separately authorized trusted server-session integration is required; no security bypass was made.
2. Deployed manager storage protection, Firebase Auth setup and index availability remain unverified. New bounded legacy evidence queries may require indexes; no rules/IAM/environment/index configuration was changed.
3. Historical reconciliation is limited to supported, available records. Missing/unsupported date or ownership fields, denied reads, query overflows or other legacy schemas require review. Audit notes explicitly avoid certifying full database reconciliation; loading errors are surfaced in the existing portal message area.
4. Actual browser layout, live Auth/Firestore behavior and physical PDF printing remain untested under the requested restrictions.

No Firebase/Auth access, live writes, historical writes, migration, deployment, Git push or additional phase was performed.
