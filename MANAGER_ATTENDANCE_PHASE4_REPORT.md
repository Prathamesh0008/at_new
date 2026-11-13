# Phase 4: local security and Firestore quota fixes

## Outcome

Requested local source fixes are complete. **31 targeted offline tests pass.** Production activation remains **NO-GO** pending separate configuration, deployed security/index verification and legacy-history assurance. No Firebase/Auth access, server/browser execution, migrations, database writes, account provisioning, environment/rules/IAM changes, dependency installation, deployment or push occurred.

Existing historical generation, dates, absence selection, estimate metadata, manager scope, approval tokens, conflict checks and disabled-by-default Apply gates were preserved.

## 1. Files changed in this pass

Updated:

1. `app/portal/page.jsx`: remove broad refresh timer; load tab-relevant datasets; reuse evidence for summaries/counts; scoped live polling; manual Refresh; logout failure/progress display.
2. `contexts/AuthContext.js`: await manager cookie clearing before portal logout; visible failure state; invalidate in-memory read cache on login/logout. Working credential comparison/login is unchanged.
3. `app/api/session/route.js`: safe allowlisted users for GET/POST, sanitized errors, same-origin legacy logout.
4. `components/ManagerHistoryPreview.jsx`: shift/version-bound commands, reusable pending command, separate history/verification labels, shared safe sign-out and serialized session exchange.
5. `lib/manager-api.mjs`: forward daily command preconditions; allow same-origin browser cookie deletion without activation or Firebase initialization.
6. `lib/manager-store.mjs`: transactional version checks and bounded idempotency receipts for daily commands. Historical implementation unchanged.
7. `lib/firebase-helpers.js`: shared read coordinator, optional timestamp/employee scopes with legacy ID aliases, and quota-error propagation instead of empty-success results.
8. `lib/portal-helpers.js`: shared cached/deduplicated reads; employee-scoped collection queries; fresh mutation-precondition reads; optional supplied evidence for monthly summaries.
9. `tests/manager-secure-offline.test.mjs`: update daily command fixtures and add replay/concurrency/atomic-failure/disabled-feature logout coverage.

Added:

10. `lib/portal-read-policy.mjs`: bounded in-memory cache, invalidation generations, quota latch, tab data plan, date-window merging and completion-based visible polling.
11. `lib/portal-reads.js`: SDK adapter with safe query/document comparisons and fresh document precondition reads.
12. `lib/public-user.mjs`: explicit safe user projection and fixed session error responses.
13. `utils/manager-logout.mjs`: bounded cookie-clear request and same-tab serialization against pending manager sign-in exchanges.
14. `tests/portal-security-quota.test.mjs`: read policy, polling, session handlers, logout and UI integration checks.
15. `tests/portal-helpers-offline.test.mjs`: scoped reads, task aliases, summary/payable-day compatibility, salary duplicate detection and quota propagation.
16. `MANAGER_ATTENDANCE_PHASE4_REPORT.md`: this report.

Package manifest/lockfile changes and other untracked experiments were already present before Phase 4. They were not installed, updated, enabled or reused in this pass. The Phase 1 integration of the manager panel remains in place.

## 2. Security fixes

### Experimental session route

GET and successful POST project employee objects through an explicit allowlist: id, name, email, phone, shift, role, department and dateOfJoining. Unknown fields are dropped; non-string values become null. Passwords, hashes, tokens and arbitrary nested objects cannot pass through this projection. Errors return fixed messages instead of reflecting internal error messages. Existing hash verification and server-session architecture were not replaced. Tests execute the actual GET/POST/error handler source with mocked dependencies, without loading credentials or Firebase services.

### Portal and independent manager logout

Portal Logout first clears the manager HttpOnly cookie through same-origin DELETE. Only after a successful response does it clear portal React/localStorage state. Failure keeps the portal open and displays a retry message; it does not falsely report successful logout. The button displays progress and prevents ordinary repeated clicks.

Cookie deletion is available even with the manager feature disabled or server credentials absent. It checks Origin/cross-site metadata, preserves cookie path/HttpOnly/SameSite/production Secure attributes, and never initializes Firebase. No session check was added to page refresh.

Independent manager sign-out uses the same helper. An invalidation generation cancels older same-tab sign-in attempts that are still waiting on Auth. Cookie exchanges are serialized with logout so an already-started exchange finishes before the clearing request. Browser clearing does not revoke other separately issued credentials; this change targets the requested browser session.

### Labels

Ordinary retrieval is labelled **Refresh monthly history**. Approval/fingerprint verification is labelled **Verify approved historical records**. Neither action activates historical application.

## 3. Daily replay protection

Every daily mutation must supply:

- An expected shift ID exactly equal to NTS-MGR_YYYY-MM-DD.
- The expected shift date and global manager-state version displayed by recovery.
- An idempotency key restricted to 16–64 alphanumeric/underscore/hyphen characters.

The API still derives authorization from the verified manager session. Shift preconditions supplied by the client are not identity/permission claims.

The transaction reads the manager state and the specifically requested daily document. It checks ownership, expected date/version and state integrity before changing anything. Each successful transition increments the state/document version and atomically stores a receipt with a fingerprint of verified UID, action, break type, target date and expected version. Receipts are bounded to 32 per daily document; normal shift/break rules require at most ten successful transitions.

An exact duplicate returns its previous receipt without writes, even after a later shift starts. Reusing the key for different contents fails. A previously uncommitted delayed command targeting an older shift/version fails. Concurrent different commands from the same version cannot both advance state. Failed commits save neither receipt nor transition, allowing an explicit identical retry.

The panel requires daily state recovery before mutations, retains a pending command on failure, and offers explicit same-command retry or recovery. It does not automatically retry. Actual timestamps remain Firestore server-generated; no clock events are manufactured.

If unexpected pre-existing manager state lacks the new version fields, operations fail closed for separately authorized reconciliation. No migration or silent data upgrade was added or executed.

## 4. Before/after polling

| Path | Before | After |
|---|---|---|
| Broad dashboard datasets | Every 15 seconds | No periodic broad refresh; tab/filter/visibility entry, mutations, relevant notification changes and manual Refresh |
| Manager monthly summary | Attendance and leave queried again every 15 seconds | Derived from already loaded attendance/leave; zero independent reads |
| Dashboard pending counts | Repeated leave/worksheet/reimbursement/correction queries | Derive the two displayed counts from loaded leave/worksheet rows |
| Notifications | Every 4 seconds | Every 60 seconds while visible; panel/manual events can refresh immediately |
| Manager live breaks | Every 4 seconds, full history | Every 30 seconds, today's records only, visible dashboard only |
| Manager live attendance | Broad history in refresh and summary loops | Today's records in the same 30-second visible dashboard cycle |
| Historical attendance/break exports | Included in broad loading | Complete history only on export-tab demand or explicit refresh, cached for reuse |
| Hidden browser tabs | Polling continued | No new SDK reads; already-started requests may finish |
| Quota errors | Timers kept trying | Browser-session latch blocks subsequent coordinated reads, including queued starts; no automatic reset/retry |

Poll timers schedule the next cycle only after work completes. Identical in-flight SDK reads deduplicate across effects. A five-minute, maximum-64-entry in-memory snapshot cache prevents repeated tab-entry reads. Cache expiry alone starts no network work. Mutation/manual refresh invalidates cached snapshots; an invalidated in-flight read must finish before its replacement starts and cannot refill the new cache generation.

Attendance ranges cover the actual selected progress/month/activity windows plus the current heatmap period. Overlapping windows merge; distant windows remain separate rather than querying the gap. Employee reads include both supported ownership aliases where necessary. No result cap silently truncates exports or reports.

Manager administrative task/leave/worksheet lists and full exports can still require complete datasets. They load on demand and reuse snapshots; broad background polling was removed. Notification visibility queries still include matching history so the existing notification filters/history remain intact. These are residual read costs, not claims of zero collection-sized reads.

## 5. Estimated query/read reduction

These are source-based estimates, not measured production savings. Assumptions: one continuously visible manager dashboard, stable data, successful server-backed reads, no manual actions, tab changes or notification-change events. Initial loads and extra index-entry costs are excluded. Completion-based scheduling may result in fewer cycles than these nominal upper rates.

| Scheduled query path | Old/hour | New/hour |
|---|---:|---:|
| Broad datasets plus repeated summary | 3,360 | 0 |
| Three notification visibility queries | 2,700 | 180 |
| Live breaks | 900 | 120 |
| New bounded today-attendance cycle | Included above | 120 |
| Total periodic query calls | 6,960 | 420 |

Expected scheduled-query reduction under those assumptions: approximately **94%**. Notification cycles decrease about 93%; break cycles about 87%. Document savings depend on collection sizes and today/selected-window counts.

Previously, attendance history could be scanned approximately 480 times/hour and breaks 1,140 times/hour per active manager tab. The new periodic paths read today's attendance/breaks at most about 120 times/hour each, with selected history loaded separately on demand. New notifications, explicit Refresh, mutations, navigation and cache expiry on a later read add queries outside this steady-state estimate.

Multiple visible tabs still have separate browser memory/pollers and can multiply costs. There is no cross-tab/global cache. Full exports and matching notification history can remain expensive. Quota restoration requires a deliberate reload after the underlying quota is restored; login/cache invalidation does not reset the quota latch.

## 6. Employee functionality preservation

The working login credential comparison remains unchanged. Employee shift/break endpoints, allowed durations, automatic-close policy, attendance records, tasks, leave approvals, salary calculations and export formats were not rewritten. Existing appearance/modules remain; only a small Refresh control and logout status/error display were added to the existing header.

Scoped task queries retain both assignedTo and legacy employeeId ownership. Attendance queries retain employeeId/empId aliases. Date scoping follows the original timestamp-based display/summary behavior. Dashboard worksheets remain loaded for both roles so employee totals and manager performance inputs are preserved. Salary datasets load on the salary/export tabs. Complete exports remain available without silent truncation.

Monthly summary tests confirm the original half-day/payable-day arithmetic and manager exclusion. The salary duplicate lookup remains fresh, now scoped to the target employee. Mutation precondition document reads and worksheet/salary duplicate checks do not use stale cached snapshots.

Freshness intentionally changes: live manager attendance/breaks update at roughly 30 seconds, notifications at roughly 60 seconds, while other data follows navigation/change events/manual refresh. This is the quota tradeoff requested in Phase 4. Browser and live-service equivalence was not tested.

## 7. Offline verification

Command:

`node --test tests/manager-history-offline.test.mjs tests/manager-secure-offline.test.mjs tests/portal-security-quota.test.mjs tests/portal-helpers-offline.test.mjs`

Result: **31 passed, 0 failed**, under one second in the final run. Tests use pure functions or mocked Firebase/Auth interfaces, including the actual session handler source with mocked dependencies. No test contacts Firebase or writes persistent records.

Coverage includes historical boundaries/two absences/weekends/isolation/conflicts, secure authorization and approval, create-only historical idempotency, daily duplicates/delays/concurrent versions, failed-commit retry, disabled-feature logout, cookie/origin security, allowlisted session GET/POST/errors, logout ordering/failure, cache expiry/invalidation/deduplication, hidden-tab pause, quota latch, non-overlapping polling, scoped legacy aliases, report arithmetic and salary duplicate behavior.

Targeted ESLint passes for the changed manager panel/modules, SDK/read helpers, session route, logout helper and targeted tests. Full lint of the shared portal/context is not clean: **four errors and eight warnings predate this pass**. ESLint comparison of current files against Git HEAD found identical counts by severity/rule:

- Portal: two unescaped JSX quote errors, one existing render-time Date.now purity error, four effect-dependency warnings, four image warnings.
- Auth context: one existing synchronous setState-in-effect error in initial localStorage recovery.

No new diagnostics were introduced in those files. Unrelated lint debt was not repaired. `git diff --check` passed. The existing baseline-browser-mapping stale-metadata notice was not addressed through dependency changes.

## 8. Remaining blockers and untested areas

- All manager activation/configuration prerequisites from Phase 3 remain; no environment values were changed or enabled.
- Deployed direct-client protection for all four manager collections remains UNVERIFIED. A server-side storage attestation does not replace actual rules review.
- Legacy historical schema completeness, missing-date coverage and control of backdated manager attendance/leave writers still require separate assurance.
- The new employee/date-filtered attendance and break queries may require composite indexes for employeeId/empId plus timestamp. Existing index availability is UNKNOWN. Missing-index failures in scoped reads are surfaced rather than silently replacing data with empty history; no unbounded fallback is introduced. Historical multi-range leave index requirements also remain.
- Existing legacy plaintext client credentials and shared employee API authorization risks remain outside this narrow change. The experimental session response leak itself is fixed.
- No development server, Next production build, browser/E2E, real Auth/cookies, deployed rules/indexes, live concurrency, multi-tab behavior or measured quota validation was run.
- Unexpected old manager daily state without version metadata requires separate reconciliation. No live manager data was inspected to establish whether such state exists.
- Existing repository lint debt and unrelated untracked experiments still require review before packaging/deployment.

## 9. Local readiness decision

**PASS for the requested scoped local fixes and targeted offline verification. Production activation remains NO-GO.** The next authorized activity can be independent review/configuration planning, not automatic deployment, manager activation or historical application. Actual rules/index/configuration assurance and controlled runtime validation remain prerequisites. No further phase was started.
