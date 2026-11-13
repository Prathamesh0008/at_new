**Firestore read prevention report - Nova Attendance Portal**

Project: nova-attendance-1bf55. Scope: source inspection and offline/mocked verification only. No live Firestore request, production write, login POST, stress test, migration, backfill, billing change, rules change, project change or deployment was performed in this task. The verified local development server was paused before edits to prevent open browser tabs from issuing hot-reload reads. It has deliberately not been restarted.

**1. Confirmed cause versus suspected amplification**

The user-provided production measurements are 50,148 reads against the 50,000 daily free allowance, and RESOURCE_EXHAUSTED/code 8 on the loginAttempts read. Thus the immediate sign-in failure is the exhausted shared Firestore quota. The rate-limit lookup is a dependency that fails when the quota is exhausted; there is no evidence it generated most of those reads.

Source inspection proves the previous automatic call patterns below. It cannot retrospectively assign the 50,148 reads to a particular tab, user, deployment or query. Collection sizes, active-tab counts, external clients and historical request traces were not queried. The amplification mechanisms are proven code paths; their contribution to the production total is suspected until monitoring correlates usage with call sites.

No onSnapshot subscriptions were found. Existing interval cleanup generally existed; the dominant finding was repeated complete-history reads rather than missing unsubscribe calls. The one-second dashboard clock and TimerBar timers are local computations, not Firestore consumers. No repository cron configuration, scheduled cloud job, seed job or automatic backfill runner was found. Jobs deployed outside this repository and other Firebase clients remain unverified.

**2. Highest-risk sources, estimates and changes**

Definitions: Q(N)=max(1,N matching documents) for a query, before additional billable rule/index effects. A=all attendance-event documents; B=all break-event documents; L=leave documents; W=worksheets; T=tasks; SR=salary requests; SS=salary slips; R=reimbursements; C=corrections; H=the complete employee-scoped personal-history request, including legacy alias queries and metadata; V=visible notification-query read volume; U=unread-only notification-query volume; E=known accounts, currently 5. These are variables, not measured production counts.

The table models ONE continuously visible nine-hour shift. Before: a 15-second interval can issue about 2,161 loads including the initial load; a four-second interval about 8,101. After: a 60-second interval is about 540-541 loads and a 90-second interval about 361. Hidden tabs reduce the after estimates. Navigation, panel toggles, explicit actions and additional tabs add reads.

| Risk | Exact current source anchors | Before per request/session (estimate) | After (estimate) |
| --- | --- | --- | --- |
| Manager break polling | app/portal/page.jsx:889; lib/firebase-helpers.js:199 | Q(B) every four seconds: about 8,101*Q(B) per visible shift, plus overlapping broad refreshes | Manager-only GET /api/breaks?view=team-state reads exactly E known attendanceState references, about 541*E=2,705 reads per nine-hour manager dashboard. Initial complete history still loads once. Legacy break history is retained for accounts without state. |
| Broad dashboard refresh | app/portal/page.jsx:704-727; lib/portal-helpers.js:342,589,750,935,980,1102 | Rough manager load: 2Q(L)+Q(T)+2Q(W)+Q(SR)+Q(SS)+Q(R)+Q(C)+Q(A)+Q(B)+1, about 2,161 times; employee UI filtered downloaded collections afterward | No timed global reload. Initial/relevant navigation loads only; explicit actions refresh their domain. Employee filters execute in Firestore. Simultaneous identical queries share one pending result. Manager views still require complete authorized datasets; they are not silently truncated. |
| Personal attendance/history | components/PersonalAttendance.jsx:9-25; lib/attendanceStorage.js:55-98 | H every 15 seconds: about 2,161*H | H once on screen entry and after an explicitly approved historical apply. Shift/break actions and visible-minute recovery use one own attendanceState document: about H+540 reads plus actions per visit. Complete history uses 200-document pages and remains available in the calendar/export. |
| Notification polling | app/portal/page.jsx:732; lib/portal-helpers.js:167-185 | Two/three audience queries loading complete visible history every four seconds: about 8,101*V | Background queries request unread-only rows every 90 seconds: about 361*U. Opening the existing panel requests complete authorized history. With three empty queries, the minimum is about 1,083 reads per nine-hour account session; a large unread backlog costs more. |
| Manager monthly summary | app/portal/page.jsx:923; lib/portal-helpers.js:1148-1155 | Q(A)+Q(L), retriggered by the global 15-second refresh: about 2,161*[Q(A)+Q(L)] | Initial/relevant-view, selected-month and attendance/leave action changes only. Simultaneous matching reads deduplicate with main loaders. Full period calculations remain intact. |

Illustration ONLY: if B were 200 documents, four-second break polling alone could request 1,620,200 document reads over nine hours. Its replacement requests about 2,705 current-state reads, plus initial history. This is not a production measurement or a promised total reduction.

Other read estimates:

- GET /api/session: zero Firestore reads; verifies the signed cookie against existing account metadata.
- POST /api/session: one loginAttempts lookup per normal attempt; persisted count update/reset and original password/session verification are unchanged. maxAttempts remains 1. After a quota response, further requests in that server process fail with 503 for 60 seconds without another lookup. Already in-flight requests and other instances can still make their first failed request. This is not a successful-login cache.
- GET /api/attendance?view=state: one authenticated user's state document, including the minimum charge if missing.
- GET /api/breaks?view=team-state: E explicit known state-document references; requires manager role before accessing the database. It returns current shift/break fields, not unrestricted personal-history collections.
- GET /api/attendance history: one state lookup; eight scoped history queries (employeeId and empId aliases over four collections); one company-holiday lookup; one additional manager-review lookup for NTS-MGR; one own approved-leave source query. Each query costs its matching raw document count/minimum plus page overhead. Alias overlap can still bill the same document twice; compatibility is preserved rather than silently dropping legacy records.
- Shift/break mutations: original state/daily point lookups and own daily attendance alias queries remain. First legacy reconciliation also reads own daily break aliases. Transaction retry behavior and validation remain unchanged. No mutation was executed in verification.
- Backfill GET/dry-run: two configuration lookups plus ten NTS-MGR-only history/leave/estimate queries. Apply also reads its saved preview in a transaction. These are now explicit admin operations, not automatic dashboard mount reads. Business logic, provenance, permissions and apply gates are unchanged.
- Each getDoc/transaction point lookup in review/edit helpers is one document per attempt. Each getDocs lookup/export is Q(N_matching) plus page overhead. Worksheet/slip existence scans are still explicit-action costs, not background jobs.
- Paginated reads request at most 200 documents per physical page, following cursors until complete. Paging does NOT reduce total document reads for a complete export. An exact positive multiple of 200 can require one additional empty-page query. No arbitrary result cap or partial successful export was introduced.

FIRESTORE_QUERY_INVENTORY.json lists all 56 possible source read-call sites with file, line, owner, read-cost formula and session-frequency estimate. Some are wrappers or dormant export/helper paths, not independent running consumers; do not add their counts together as if all execute on every load. Reproduce it with node scripts/audit-firestore-reads.mjs, which imports no Firebase SDK and performs no network/database requests.

**3. Modified files and reasons**

| File | Precise change |
| --- | --- |
| app/portal/page.jsx | Removed 15-second global data reload; added domain/action and relevant-navigation refresh scopes; unrelated actions no longer retrigger monthly summaries/history; switched manager live polling to bounded current-state reads; unread background notifications at 90 seconds; visible-tab, non-overlapping polling and cleanup. Existing cards, styles and controls retained. Current attendance projections use only persisted server timestamps. |
| components/PersonalAttendance.jsx | One explicit history load per screen visit; one-document state recovery at 60 seconds and after own actions; updates current-day view from authoritative state rather than reloading history; approved historical apply can explicitly reload history. Export also includes current persisted day break pairs, without fictional entries. |
| components/ManagerBackfill.jsx | Removed automatic mount preview. Existing preview/approval controls remain. Successful explicit apply notifies personal history to reload. No record-generation/approval logic changed. |
| lib/firestore-reads.js (new) | Public SDK Query/ref comparison, in-flight deduplication, 200-document cursor traversal and count-only diagnostics. HTTP keys/document references are never passed to the Query comparator. No result TTL cache. |
| utils/read-control.mjs (new) | Shared read-only quota circuit, opt-in redacted diagnostics, duplicate-poller registration counts, no-overlap/hidden-tab/cleanup scheduler. Browser quota circuit stops automatic reads for that page lifecycle; reload only after quota recovery. |
| utils/read-fetch.mjs (new) | In-flight HTTP read deduplication keyed internally by current account scope and URL; quota responses trip the same browser circuit. Neither keys nor payloads are logged. |
| lib/firebase-helpers.js | Attendance/break employee filters execute in Firestore, including legacy ID aliases; paginated, coordinated read transport. Write payloads are unchanged. |
| lib/portal-helpers.js | Employee filters for leave/worksheets/salary/reimbursements/corrections and task alias filters execute in Firestore; unreadOnly notification option; shared read transport. Business write payloads/review decisions remain unchanged. |
| utils/excelExport.js | Uses coordinated complete-query pagination. Existing exported data mapping remains unchanged. |
| lib/attendanceStorage.js | Paginates complete own history; adds one-document own state and manager-only known-account state readers; count-only read diagnostics. Existing attendance/break mutation transaction logic is unchanged. |
| app/api/attendance/route.js | Existing authenticated GET supports a state-only view. POST authorization/mutation code is unchanged. |
| app/api/breaks/route.js | Authenticated manager-only team-state GET view. POST authorization/mutation code is unchanged. |
| lib/server/auth.js | Converts raw quota errors into one safe 503 with a machine-readable quota code so read polling can stop. Cookie signing and authorization are unchanged. |
| lib/server/login-quota.mjs (new) | Process-local 60-second unavailable-service cooldown only; no rate-limit counter or authentication-result cache. |
| app/api/session/route.js | Checks fail-closed quota cooldown and starts it on quota exhaustion; existing Firestore rate checks, original hashes, session signing and origin checks remain. |
| tests/auth-flow.test.mjs | Supplies an isolated cooldown and asserts a second quota-blocked identity cannot issue a session or reread Firestore. |
| tests/read-budget.test.mjs (new) | Offline deduplication, cleanup, visibility, quota-stop, paging, scope, diagnostics and static automatic-read checks. |
| scripts/audit-firestore-reads.mjs, FIRESTORE_QUERY_INVENTORY.json (new) | Repeatable static inventory and per-query cost estimates. |
| FIRESTORE_READ_REPORT.md (new) | This consolidated report and monitoring plan. |

**4. Authentication, isolation and data integrity**

Login still requires the persisted Firestore rate limit, server-side scrypt verification and a signed HttpOnly session cookie. Invalid credentials, origin violations, expired/tampered sessions and rate-limit violations remain rejected. Quota exhaustion cannot produce a session. No fallback authentication, alternate database or new secret was introduced. No loginAttempts record was cleared in this task.

The cooldown only rejects requests while a dependency is unavailable. Once it expires, an explicit retry must still execute the full persisted checks. Browser POST login deduplication/timeouts remain unchanged and there is no automatic POST retry.

New team-state reads check manager role before database initialization. Personal state/history remains based on the session user, not a request-supplied employee ID. Identical in-flight queries must have matching SDK query semantics or matching account-scoped API keys. Completed sensitive results are not cached across requests/users.

Start-of-task SHA-256 source/config snapshots verify that account constants, IDs, roles, password hashes, Firebase credentials/project configuration, AuthContext, Login UI, session client, backfill route/model/target helper, security-rule fragment, dual-storage code, stylesheet and dependency files are unchanged. No actual employee/manager records were read or written in this task. Existing shift/break write transactions and backfill business logic were not edited. No page was redesigned; changes are in data scheduling/querying and component callbacks/props.

The pre-existing working-tree changes from earlier tasks were preserved; git diff relative to HEAD contains those too. The start-of-task snapshot was used to distinguish this task's changes.

**5. Development diagnostics (off by default)**

For a controlled post-reset local observation, temporarily set NEXT_PUBLIC_FIRESTORE_DIAGNOSTICS=true in your local environment and restart development mode. The flag is non-secret. It was NOT enabled or added to .env.local during this task. It is forcibly ineffective when NODE_ENV is production.

The console emits source call-site frames, logical requests, physical query-page/document counts, poll interval/start/stop registrations and duplicate-poller flags. Personal-history and state endpoints provide count-only server read events. It never emits query values, employee IDs/names, record payloads, passwords, tokens, credential paths or keys. Server transactional mutation/backfill reads are covered by the static inventory rather than comprehensive runtime tracing.

Sum documents from physical-query-page, physical-query, physical-document and server-read/server-query-page events for approximate attributed read volume. Do NOT add logical-read-completed events to those physical counts. Deduplicated events explain callers that shared the same pending operation. Missing point documents and empty queries may still have minimum charges; diagnostics are not a billing meter and do not account for every rules/index read or external client.

Unexpected duplicate:true for a poll site, missing corresponding poll-stop, repeated history scans without navigation/action, or many physical pages for one screen warrants investigation. A non-overlapping scheduler can have one operation finishing after cleanup; it will not reschedule or update a cleaned-up component.

**6. Free-plan read budget**

Operational target: at most 20,000 document reads/day for the entire portal, leaving 30,000 reads of headroom under 50,000. This is a planning target and monitoring threshold, NOT a hard enforced cap or a claim that actual unknown datasets meet it.

Assume five accounts including one manager, one visible browser tab per account, and nine-hour shifts:

| Allocation | Daily target |
| --- | ---: |
| Own current-state recovery | 3,000 |
| Manager known-account current-state polling | 3,000 |
| Background unread notifications and occasional panel opens | 6,500 |
| Initial scoped datasets, summaries and personal history | 4,000 |
| Explicit relevant refreshes, reports and approved admin previews | 2,000 |
| Authentication/rate-limit reads | 500 |
| Miscellaneous/measurement allowance | 1,000 |
| Total | 20,000 |

Current-state expectations are roughly 5*540=2,700 own reads and 5*541=2,705 manager team-state reads, before visibility pauses. Three empty notification queries every 90 seconds across five accounts already cost approximately 5,415 reads per nine-hour day, so notification backlog/panel usage must be observed. Large unread queues, many historical records, repeated exports/navigation, extra tabs or external clients can exceed these allocations. Complete authorized manager reports/exports still scale with stored history. Do not mistake pagination for a daily read cap.

At 20,000 daily reads, investigate before declaring success. At 30,000, stop unnecessary open dashboards/exports and review the highest measured bucket; hide/close unused tabs, which pauses these pollers. These are operator actions, not automatic denial of legitimate employee record operations. Do not enable billing, buy capacity or silently disable security to recover margin.

**7. Offline verification**

- 23 focused tests PASS: request deduplication, distinct scope isolation, no cached completed results, query paging completeness, quota latching, no overlapping polls, hidden-tab pause, cleanup, retry stopping, redacted/production-disabled diagnostics, duplicate registration cleanup, role-gated team reads, login cooldown failure handling, manager/employee cookie flow and preserved estimated-history approval behavior.
- npm run build PASS: compilation, TypeScript validation phase and page generation.
- Targeted ESLint PASS for new/changed read-control, API, helper, component and test modules. Linting app/portal/page.jsx still reports its three previously documented errors in unchanged UI code (two unescaped quote reports and render-time Date.now) and existing hook/image warnings. They were not suppressed or modified to widen this task.
- git diff --check PASS.
- All tests use injected SDK/database boundaries, fixtures and static source analysis. No Playwright, load test, extensive E2E suite or live Firebase access occurred. Public documentation was consulted; that is not a database request.
- Live login, deployed query/index compatibility and post-reset read-rate behavior remain UNVERIFIED. No automatic deployment or local dev restart was performed after the offline build.

**8. Exact post-reset monitoring procedure (administrator-run)**

1. Select nova-attendance-1bf55 in Firebase Console. Open Databases & Storage > Firestore > Usage, not the document Data browser. Confirm the daily read counter has reset before reopening portal dashboards. Free quota resets around midnight Pacific time, not midnight India time. Verify the actual reset rather than repeatedly trying login. [Firebase quotas](https://firebase.google.com/docs/firestore/quotas).
2. In Google Cloud Console for the SAME project, open Firestore/Databases, select the database and open Usage. Also review APIs & Services > Cloud Firestore API > Quotas & System Limits. Inspect existing metrics only; do not enable paid logging, new services, BigQuery exports or billing. [Official monitoring guide](https://firebase.google.com/docs/firestore/monitor-usage).
3. Record the baseline read total and timestamp with portal tabs closed. Start the updated local portal only when ready using npm run dev. Deployment remains a separate explicit action; old deployed clients will continue their old behavior until separately updated.
4. Use normal authorized usage, one manager and one employee at first, with one tab each. Avoid repeated login tests, opening large collections, batch exports or backfill apply while attributing the baseline. No stress loop is required. If a valid login now fails, inspect its single response code; never bypass the limiter.
5. During a short observation window, optionally enable the development diagnostic flag described above. Match source call-site/page counts with the console read increase. Check that state calls are about once per visible minute, notification polling about once per 90 seconds, full histories occur on entry/explicit approval only, and there are no automatic backfill previews or 15-second full-dataset reloads.
6. Hide the tab during ordinary use and confirm no NEW timed read work is scheduled while hidden. One already in-flight operation can finish. Cleanup and duplicate-registration diagnostics should balance after navigation.
7. Compare the console usage delta over an ordinary 15-30 minute window, then review a full working day. Multiple users/tabs multiply costs. The usage dashboard is approximate and can differ from billed usage; use official quota/usage totals for final assessment. Do not sum both logical and physical diagnostic events.
8. To identify the biggest consumer, group diagnostic physical document counts by source site/server route and compare them with page-open periods. Pay particular attention to unread notifications, initial manager reports, personal-history alias queries and manual exports. Project-level graphs alone do not identify a JavaScript call site. Existing audit/request logs can help if already available; do not enable additional paid log ingestion for this task. External deployments/jobs remain possible consumers if total usage materially exceeds local attribution.
9. Remove the local diagnostic flag after observation and restart development mode. If a page previously latched a quota failure, reload it only after quota recovery; its browser circuit intentionally does not keep probing the database. The server login cooldown expires after 60 seconds but does not retry on its own.
10. Confirm the whole project's daily total stays within the 20,000 planning target (and safely below 50,000) through a representative working day before describing this as sustainably resolved. No permanent-fix claim is made now.
