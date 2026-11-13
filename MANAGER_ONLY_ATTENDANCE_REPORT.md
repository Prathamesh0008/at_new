    **Manager-only attendance implementation report**

    Scope: NTS-MGR, role manager, joining 2025-10-10. This pass preserves the existing account and the current application as the starting baseline. No authentication configuration, credentials, employee account constants, shared UI components, salary/leave/project logic, or database records were changed. Earlier workspace work was retained, not reset.

    Manager attendance and breaks

    - The current manager dashboard retains its existing administration sections and visual layout. My Attendance & Breaks reuses the existing shift controls, timers, personal history, calendar and export experience.
    - The manager attendance controls and historical administration panel are now explicitly gated to employee ID NTS-MGR with the manager role. The existing employee branch still evaluates the same capability check and uses the same break options as before this pass.
    - The target manager keeps the existing Tea, Lunch, Evening and Breather controls and existing server validations. Manager-only checks cover starting/ending a shift, all four break types, overlap prevention, pre-shift break rejection, duplicate shift prevention, totals and closing an active break when the shift ends. No shared shift/break model or notification policy was edited.

    Historical preview and approval

    - Range: 2025-10-10 through 2026-11-11 inclusive, in Asia/Kolkata. There are 398 calendar dates and 284 weekdays before holiday, leave and actual-record exclusions. These are calendar counts, not approved attendance totals.
    - All database queries for attendance, leave and estimates explicitly filter employeeId or empId to NTS-MGR. Other target IDs are rejected before database initialization.
    - The admin preview displays each date, its exclusion or proposed estimated Present status, and a deterministic suggested start from 09:50 to 10:20. It includes manager actual attendance, leave records and existing estimates for review. Undated or invalid actual attendance dates block approval pending reconciliation.
    - Saturdays, Sundays, company holidays, approved leave and existing actual records are excluded. Previously created estimates are skipped. Both 2025 and 2026 must have a manager-specific holiday review before any day becomes eligible. Existing company holidays cannot be silently removed by editing the manager review.
    - Holiday review now writes only attendanceBackfillPreviews/NTS-MGR_holiday_review plus a manager-specific audit document. The shared company holiday configuration is read but never updated by this workflow. The personal-history read adds the manager-specific review only when user.id is NTS-MGR; other employees keep their previous read/response path.
    - Preview reference/query reads were corrected: normal reads use reference.get(), while transactions use transaction.get(reference). The previous workflow incorrectly called get() on the database object.
    - Applying requires the existing authorized administrator check, a saved current manager preview, a reason, the exact approval phrase and the existing server-side enable flag. None of those authentication/enablement settings were changed.
    - Approved records are stored separately in attendanceBackfills/NTS-MGR_DATE, visibly marked Present (estimated; admin approved), with attendanceStatus=Present, estimated=true, source=admin_backfill_estimated, operator, reason, approval timestamp and preview ID. clockInVerified is false; actual clockIn, clockOut and breaks remain null. Suggested starts are not recorded punch events.
    - Append-only manager audit documents preserve approval provenance. Deterministic estimate IDs and create-only writes prevent overwriting existing estimates. Stale previews are rejected. Each approved transaction applies up to 100 dates; regenerate the preview to resume safely.
    - Actual attendance, actual breaks, salary calculations, approved leave and project records are never updated by the historical workflow. No historical breaks or clock-outs are invented.

    Changed files in this pass

    - app/portal/page.jsx: target-ID manager gating for existing controls/panel; employee rendering and existing management sections retained.
    - components/ManagerBackfill.jsx: manager-only review panel, explicit estimated Present labeling, safe request failure handling and duplicate-action prevention.
    - app/api/attendance/backfill/route.js: scoped metadata, reference reads, target validation, estimated Present approval and manager audit records.
    - lib/backfill-model.mjs: explicit target scope and estimated proposal metadata.
    - lib/attendanceStorage.js: conditional NTS-MGR-only holiday review lookup; employee path unchanged.
    - New lib/manager-attendance.mjs: target identity/date constants and manager scope checks.
    - New tests/manager-attendance.test.mjs: focused manager checks using an in-memory database boundary.
    - New MANAGER_ONLY_ATTENDANCE_REPORT.md: this report.

    Validation

    - npm run build: PASS, including compilation, TypeScript validation phase and page generation.
    - node --test tests/manager-attendance.test.mjs: 4 PASS. Covers manager shifts/breaks, deterministic inclusive date generation, exclusions, approval gates, target isolation, non-destructive mocked apply, resumability/idempotency and stale-preview rejection.
    - Targeted ESLint on the manager panel, backfill API/model, manager scope helper, storage and manager tests: PASS.
    - git diff --check: PASS.
    - A source/configuration fingerprint captured at the start of this pass confirms only the five listed existing files changed. Authentication modules, session transport, credentials/environment files, account constants, shared UI components, role helpers, shared shift/break logic, and salary/leave/project code are byte-for-byte unchanged from that baseline.
    - Mocked approval tests assert that all writes use NTS-MGR-prefixed document IDs with employeeId=NTS-MGR, that queries use equality filters for NTS-MGR, and that existing actual attendance and shared company configuration remain identical. No real employee records were read or written by those tests.
    - No Playwright, extensive E2E suite, deployment or production database operation was performed. Other employees' current code paths and data remain unchanged by this pass; their live behavior was not exercised against production.

    Readiness and limitations

    The manager implementation and admin review/approval workflow are ready for review. No historical attendance was approved or applied. A real production preview and live shift persistence were not executed. The previously identified missing Firebase Admin credentials/session configuration remains an external blocker for live verification; this pass deliberately does not modify authentication or credentials. An existing authorized administrator must resolve that configuration separately, review the complete company holidays for both years, inspect the live manager preview and explicitly approve any apply operation. Database access policies also remain unchanged.
