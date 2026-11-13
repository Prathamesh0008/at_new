**Manager attendance and historical backfill implementation report**

The existing NTS-MGR identity remains Prathamesh Shinde, role manager, joining 2025-10-10, shift 10 AM-7 PM, Asia/Kolkata. No duplicate account was added. No deployment or historical attendance apply was performed.

Implemented behavior:

- The manager dashboard reuses employee shift/break controls under My Attendance & Breaks. Management sections and employee-specific project, leave and salary controls retain their existing role conditions.
- Tea (15m), Lunch (30m), Evening (15m) and manager Breather (5m) support persisted start/end, active timers and recovery from Firebase state. Employee break choices remain Tea/Lunch/Evening. The employee-only overrun notification guard remains in place, so managers do not send overrun notifications to themselves.
- Shift and break state changes use an Admin SDK Firestore transaction, a single state document per employee, deterministic daily document IDs, and append-only live events. Duplicate starts, repeat clock-outs, overlapping breaks, breaks before shifts, and cross-employee writes are rejected. Shift end closes any active break in the same transaction. Live timestamps come from the server.
- Existing legacy same-day attendance and break events are read before establishing state. Existing actual attendance is not replaced by historical estimates. Ambiguous legacy attendance blocks a duplicate start and needs administrator reconciliation. Prior-day open shifts must be ended before a new shift starts.
- Browser localStorage no longer establishes authentication or recovers shift state. Login uses server-side scrypt hashes of the existing credentials and an HttpOnly, signed, expiring session cookie. Password fields and shared admin password literals were removed from browser constants. Login attempts are limited in Firestore. Server modules are marked server-only.
- Personal history includes a monthly calendar, clock-in/out history, today status, completed break minutes, break history, month counts and a JSON export containing break records and provenance. Estimated days are counted separately and never feed verified Present/payable-day calculations. The existing team salary calculation remains unchanged.
- Live controls persist through authenticated APIs; legacy helper entry points now use those APIs. Excel writes, automatic synchronization and unreviewed legacy record edits are disabled. Existing local Excel files are not changed; legacy report reads remain available.

Backfill workflow:

- Only NTS-MGR is targeted, for 2025-10-10 through 2026-11-11 inclusive (398 calendar dates). No data changes run on startup or build.
- Preview lists every date and its exclusion or proposal, and displays existing attendance, leave records and prior estimates. Saturday/Sunday, configured company holidays, approved leave and existing actual attendance are excluded.
- The existing HOLIDAY_MAP seeds holiday configuration. Both 2025 and 2026 must be explicitly reviewed by an authorized administrator. Missing 2025 holidays are not assumed to be working days. The admin interface allows adding/correcting holiday JSON and saves an audited review.
- Missing or unparseable dates in actual Firebase attendance block preview rather than silently allowing estimates.
- Suggested clock-ins are deterministic date-based values in 09:50-10:20 IST. They are suggestions, not verified clock-in evidence. Estimates have source admin_backfill_estimated, an estimated status, clockInVerified=false, no clock-out and no invented breaks.
- Apply requires an authorized admin, a saved current preview, a reason, the exact approval phrase, and a server-side enable flag. Estimates store operator, reason, approval time, preview ID and append-only audit entries in separate collections.
- Each transaction applies at most 100 dates. Generate another dry-run after each batch to resume. Existing estimates are skipped; stale previews are rejected. A failed transaction does not partially commit a batch.

Changed files:

- Identity/authentication: utils/constants.js, utils/roles.js, contexts/AuthContext.js, components/Login.js, app/api/session/route.js, lib/server/auth.js, lib/server/firebase.js, lib/server/legacy-password-hashes.json.
- Attendance/break persistence: app/api/attendance/route.js, app/api/breaks/route.js, lib/attendanceStorage.js, lib/attendance-model.mjs, lib/firebase-helpers.js, lib/dualStorage.js, utils/shiftService.js, utils/breakService.js.
- UI/history: app/portal/page.jsx, components/PersonalAttendance.jsx, components/ManagerBackfill.jsx, app/attendance/page.jsx (redirects the previous invalid page/route hybrid to the portal).
- Historical administration: app/api/attendance/backfill/route.js, lib/backfill-model.mjs, utils/holidays.js, firestore-attendance.rules.fragment.
- Dependencies/checks: package.json, package-lock.json (firebase-admin), tests/attendance.test.mjs.

Verification:

- Production Next.js build passed, including compilation, TypeScript validation phase and page generation.
- Focused model tests: 3 passed, covering Kolkata date rollover, shared manager/employee shift and break transitions, duplicate/overlap guards, auto break closure, inclusive backfill bounds, deterministic times, exclusions and rerun idempotency. A test fixture has 279 proposed dates after its explicit holiday/leave/actual exclusions; this is NOT a production attendance count.
- Local production-server HTTP checks passed for unauthenticated API rejection, rejected cross-employee writes, signed-session NTS-MGR identity/role/joining date, no password returned, expired-session rejection and denied non-admin backfill access. These used synthetic signed validation sessions and did not write attendance or breaks.
- Targeted lint passed for the new components, auth and API modules, models and services. Linting the whole portal reports three existing errors in unchanged code (unescaped quote text and render-time Date.now), plus existing hook/image warnings. No Playwright or extensive E2E suite was run.
- Real password login against configured Firebase, live transactional persistence, deployed security rules and concurrent requests against a Firestore emulator were not integration-tested. Management/project/leave/salary regressions were checked by preserving their existing code paths, not by exercising production data.

Required configuration and remaining limitations:

- Set a strong server-only SESSION_SECRET and Firebase Admin credentials via FIREBASE_SERVICE_ACCOUNT_JSON or Application Default Credentials, scoped to the existing Firebase project. Do not use NEXT_PUBLIC_ names for secrets or commit credentials. Existing logins now require those server settings. Existing sessions require login again.
- Set ATTENDANCE_ADMIN_IDS to the IDs explicitly authorized to review/apply historical estimates. Manager status alone does not grant historical administrator access. Leave ENABLE_MANAGER_BACKFILL_APPLY unset/false until explicit approval; true enables the separate Apply action.
- No deployed Firestore rules are present in this repository. Merge firestore-attendance.rules.fragment into the real rules and remove overlapping wildcard write grants before rollout. Firestore rules combine allow grants with OR; simply adding deny matches beside permissive wildcard rules does not secure direct browser/SDK access. This fragment has NOT been deployed. The new API authorization is implemented, but the database boundary cannot be claimed secure until deployed rules are reviewed and tested.
- Existing project/leave/salary management helpers still use their prior browser Firestore integration. Their broader permission model was not migrated in this scoped change. Keep their existing rules when merging attendance restrictions, and review them separately if they currently permit broad client writes.
- The server uses the existing Firebase project as authoritative. Any actual attendance stored only in local Excel must be reconciled with Firebase by an administrator before approving historical estimates; no automatic legacy import is performed.
- Auto shift closure is triggered by the open portal after 7 PM IST and records the actual server end time. There is no new background scheduler; an offline/closed portal cannot guarantee a 7 PM close.
- Exports from the personal section are JSON, including full estimated-record provenance and break details. Existing team Excel/PDF exports continue reporting actual attendance.

Historical backfill is ready for administrator review as a gated workflow. It is not yet approved or applied: server configuration, Firestore rules review, live integration validation and complete 2025/2026 company holiday review remain prerequisites.
