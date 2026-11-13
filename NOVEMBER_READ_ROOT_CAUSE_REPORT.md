**November 10-11 Firestore read incident: consolidated root-cause and stop verification report**

Scope: the local Nova attendance workspace at C:/Users/Nova Tech/Desktop/Rushikesh/at_new and evidence already present on this machine/in this conversation. No live Firebase operation, HTTP request to the app, Google credential check, metrics API request, server start, build, migration, seed or production write was performed in this investigation. No employee/manager data, attendance, rules, UI or authentication policy was changed.

**Bottom-line evidence**

The user reports about 92,000 reads in a November 10-11 usage graph. The prior confirmed production error was Firestore RESOURCE_EXHAUSTED/code 8 at loginAttempts. The immediate login failure is consistent with quota exhaustion. However, the 92,000 graph value is not a caller-level audit log: a two-day aggregate must not automatically be treated as a single day's 50,000 allowance. Graph timezone, aggregation and daily reset boundaries were not supplied as a local metrics export. No attempt was made to fetch them live.

The exact attribution of 92,000 reads is NOT established. Source proves read-amplifying loops existed. Local Codex records prove earlier diagnostic requests and server launches occurred. Neither evidence set proves that a specific component, Codex execution, machine or caller generated the entire graph total.

**1. Local stop/process verification**

- Windows process and listener metadata was inspected twice during this task. No Node/Python/Firebase/Java test/server process identifying the Nova workspace or nova-attendance-1bf55 project was found. No listener was found on Nova's previously used ports 3000, 3001, 3127, 3131 or 3132, or on 9099.
- Two existing Node processes, PIDs 21056 and 56312, remain. PID 56312 listens on 8080 and its command line identifies C:/Users/Nova Tech/Desktop/Rushikesh/propBank/node_modules/next/dist/server/lib/start-server.js. These are NOT the Nova attendance workspace. Its inspected .env.local, .env.production, .env.firebase-dev.local and .env.test-accounts.local configure Firebase project IDs different from nova-attendance-1bf55. The unrelated application was not stopped. Its inherited process environment was not inspected, so this does not certify every possible runtime connection it could make.
- An editor process (Code.exe) also references the attendance workspace. That is not evidence of a Firebase-connected development/test server and it was not terminated.
- No Nova process needed terminating in this task: the previous offline optimization had already stopped its verified development server. The mocked test workers launched here terminated after completion.
- Browser verification is incomplete. The available browser connector returned Browser not connected; no tab was navigated or loaded. Already-loaded client JavaScript can keep calling Firestore even after a Next.js server stops. Close any already-open Nova attendance tabs on this machine and other devices to stop that possible source. No browser or service-worker shutdown is claimed.
- No remote machine, deployed site, cloud function, scheduler or cloud process was inspected or stopped. Their status is UNKNOWN.

Accordingly: no IDENTIFIED Nova Firebase-connected development/test process remains running on the inspected Windows host. A project-wide or all-device shutdown cannot be certified from this evidence.

**2. Exact suspected call sites and possible multiplication**

The committed baseline is HEAD 4e0e099. The working tree already contained earlier manager-attendance/authentication/read-budget changes; none was reset. Historical and current line references below are deliberately distinguished.

Let R be all documents returned across one broad dashboard refresh, B the break-event collection size, A the attendance-event size, L the leave size, H one complete personal-history request including alias queries, and V the sum returned/minimum-charge reads across notification audience queries. One empty query can still cost a minimum read; these estimates exclude other index/rules effects and assume server responses rather than offline cache results. N simultaneous tabs/clients multiply the figures by approximately N. These are conditional estimates, not measured corpus sizes.

| Source/evidence | Historical call site | Historical frequency | Possible read multiplication | Confidence |
| --- | --- | --- | --- | --- |
| Whole-dashboard reload | HEAD app/portal/page.jsx:734 (loadData), :180 (15s constant), :872-873 (refresh timer); full helper scans at HEAD lib/portal-helpers.js:343,590,752 | About 240 refreshes/hour/tab, plus initial load and manual refreshes | About 240*R reads/hour/tab; manager pending counts and summary can add duplicate collection reads | Proven source behavior. Contribution to the graph is unmeasured. |
| Full historical manager breaks | HEAD app/portal/page.jsx:182 and :955; HEAD lib/firebase-helpers.js:249 | About 900 full break queries/hour/manager tab, plus initial load; overlaps the general refresh | About 900*B reads/hour/tab. If B=100, roughly 90,000 reads/hour; 92,000 would take about 61 minutes from this path alone. B=100 is illustrative, not observed. | Proven source behavior; stored B and actual uptime unknown. |
| Personal full attendance/history | Earlier Codex-created components/PersonalAttendance.jsx:7, captured by prior source reads and creation commands; backend lib/attendanceStorage.js getPersonalAttendance | 15-second interval in that historical component, roughly 240 H requests/hour/tab, plus refreshToken-driven reloads | About 240*H reads/hour/tab; backend ran both employeeId and empId alias queries across four collections, so records with both fields could be read twice | Proven earlier Codex implementation; it is not present in Git HEAD because the component was newly created. It was later optimized. Runtime contribution unknown. |
| Notification history | HEAD app/portal/page.jsx:181 and :778; lib/portal-helpers.js:167-185 audience-query builder | About 900 polls/hour/tab; two/three audience queries per poll | About 900*V reads/hour/tab. Three empty queries would be about 2,700 reads/hour/tab; nonempty notification history increases this | Proven source behavior; audience result sizes, accounts and tabs unknown. |
| Manager monthly summary | lib/portal-helpers.js:1148; historical page summary effect depended on refreshToken | About 240 calls/hour alongside the global 15-second refresh | Approximately 240*[Q(A)+Q(L)] per hour before deduplication, where Q(N)=max(1,N) | Proven source dependency and reads; exact overlap/billing unmeasured. |
| Automatic historical preview | Earlier components/ManagerBackfill.jsx mount effect; app/api/attendance/backfill/route.js inputs | Once per mount, potentially twice in development Strict Mode; remount/reload repeats it | Two configuration reads plus ten NTS-MGR-only source queries per preview | Proven earlier automatic mount read. No repeating preview interval or automatic apply was found. |
| Login rate-limit lookup | app/api/session/route.js:26 | One persisted loginAttempts read per attempt with maxAttempts=1; earlier diagnostics retried bounded requests | Roughly number of attempts, not a collection scan. Quota errors can prevent successful reads altogether | Proven dependency. No evidence it was the main producer of 92,000 reads. |

No onSnapshot listener registration was found in the inspected application sources. Existing interval cleanup generally existed. Therefore a leaked realtime listener is NOT a confirmed cause. The one-second dashboard/TimerBar intervals update local clocks; they are not Firestore reads.

No repository cron, scheduled Firebase job, automatic backfill runner or production seeder was found. External jobs and other consumers are hypotheses only; none was inventoried through cloud APIs.

**3. Previous Codex execution evidence**

One matching local Codex JSONL session file was found for the requested dates, under .codex/sessions/2026/11/11. No matching November 10 session file was found in that standard directory. This does not rule out logs elsewhere or another machine.

The log uses custom_tool_call records, not ordinary function_call records. Initial simple text matching overcounted commands because audit/report text mentioned command names. The final classification parsed shell cmd literals and matched actual command-line starts, excluding mere mentions. Counts below are command occurrences in the available earlier record, NOT independent billed operations, successful executions or process lifetimes:

| Category | Recorded occurrences | What is established |
| --- | ---: | --- |
| npm run build | 8 | Builds were invoked. A build tag or compiled API route is not evidence the API handler ran a database query. Some earlier builds failed compilation. Source does not perform Firestore queries at module import for these handlers. |
| npm run start | 5 | Local production-mode test servers were launched in earlier diagnostics, using ports including 3127/3131/3132. Earlier outputs show temporary servers and later termination. This task verified no listeners remain on those ports. |
| npm run dev | 4 command occurrences | Two recorded successful starts, one lock failure and one policy-rejected cleanup/start command. Thus four occurrences must not be reported as four successful servers. Earlier Codex did start the app locally. |
| node --test | 14 | Earlier test commands ran. Inspected tests inject mocked Firebase/database/cookie boundaries or test pure models. No evidence was found that those suites themselves scanned production collections. |
| Local HTTP diagnostic scripts | 11 | Earlier Codex made real requests to localhost. Some scripts used bounded loops, including three POSTs per configuration mode across two test ports. This is not an unbounded request loop and 11 scripts is not 11 HTTP requests. |
| Direct loginAttempts diagnostic reads | 3 | Read-only Admin SDK point lookups were executed. Recorded output reported quota/code-8 failure; a failed attempt does not establish a successfully billed read. No direct full-collection scan was found in these diagnostic scripts. |
| Explicit token diagnostics | 2 | Credential-token checks occurred. Obtaining a Google OAuth token is not itself a Firestore document read. Another diagnostic went directly to a Firestore read without an explicit token call in its script. |

The three direct point-read commands were recorded on November 11 at 10:44:46, 10:45:12 and 10:53:47 UTC (16:14:46, 16:15:12 and 16:23:47 Asia/Kolkata). The available build/test/launch command records span roughly 09:51-11:24 UTC. These times do not establish the origins of November 10 usage.

Important distinction: previous Codex work DID add the personal-history 15-second polling component, and DID start servers and issue real diagnostics. Those facts should not be omitted. An authenticated tab open during an earlier server run could execute both the pre-existing full-collection loops and that added history loop. Whether such a tab was authenticated and active, for how long, and with which document counts is not established by the retained logs. Consequently that route to amplification is plausible, not proved attribution of the graph total.

The later offline read-budget task removed/reduced those loops and made no live Firebase requests. Its prevention changes remain in the working tree; they are not automatically deployed to any external host. Older browser bundles or deployed code can still have the old behavior.

**4. Surviving local Next.js logs and traces**

- .next/dev/logs/next-development.log: 253 bytes. It contains zero recognizable session POST, fetched attendance/break count, quota error or unhandledRejection markers. It is too small to reconstruct past traffic and is not a comprehensive request ledger.
- .next/dev/trace: 44 events, including four start-dev-server events and nine compile-path events. There are eight session-route tags in total but ONLY FOUR handle-request events for /api/session. Compilation/trace tags must not be double-counted as handled requests.
- Those four handle-request records have start times/durations approximately:
  - 2026-11-11 10:46:47.538 UTC: 2,713 ms.
  - 2026-11-11 10:51:03.954 UTC: 2,024 ms.
  - 2026-11-11 10:51:12.675 UTC: 1,101 ms.
  - 2026-11-11 10:54:22.719 UTC: 35 ms.
- These surviving trace records do not provide authoritative caller identity, HTTP status/method or billed document counts. They cannot all be assigned to Codex versus the user's browser merely by timestamp.
- .next/trace: 54 build events. .next/trace-build: six build events. API route tags in build output mean compilation/build work, not proof of live Firestore reads.
- The surviving files are November 11 artifacts and can be replaced by subsequent starts/builds. No November 10 local read-count series, request ledger or per-query billing/audit export was available in the inspected paths. No historical metric was fetched from the cloud in this task.

This evidence supports a small number of observed local diagnostics plus the existence of potentially expensive browser polling. It does not support asserting that the observed diagnostics alone consumed 92,000 reads.

**5. Current prevention and minimal changes in THIS task**

The prior source-supported read-budget changes were retained: no global 15-second dataset reload, own-state reads at 60 seconds, known-account manager state polling at 60 seconds, unread background notifications at 90 seconds, explicit backfill previews, in-flight query/request deduplication, complete 200-document paging, hidden-tab pauses and cleanup, and fail-closed login quota cooldown. Existing complete reports/exports can still read substantial history when explicitly requested; paging bounds batches, not total billed documents.

Only these files were changed/added now:

1. utils/read-control.mjs: rechecks the quota latch inside the queued microtask before invoking the operation. A read enqueued immediately before another response latches quota exhaustion now cancels before network execution. This is a small proven concurrency gap; it is NOT established as the cause of the historical spike.
2. tests/read-budget.test.mjs: regression test proves the queued operation's call count remains zero after the latch is set.
3. tests/no-live-network.cjs (new): explicit offline-test preloader blocks fetch, HTTP/HTTPS request/get, net connection entry points/Socket.connect and TLS connection entry points. It prevents these tests from contacting Firebase even if a fixture accidentally escapes its mock.
4. tests/network-guard.test.cjs (new): proves the guard rejects those connection paths before IO.
5. NOVEMBER_READ_ROOT_CAUSE_REPORT.md (new): this consolidated evidence/verification report.

No other runtime code was modified during this investigation. No UI or data/rules file was edited. No global machine firewall, account, credential or billing setting was changed. The guard is a test harness, not a substitute authentication implementation or a database-security-rule change.

**6. Verification results and limitations**

The following command ran only offline fixtures/static checks:

node --require ./tests/no-live-network.cjs --test tests/network-guard.test.cjs tests/read-budget.test.mjs tests/auth-flow.test.mjs tests/session.test.mjs tests/session-timeout.test.mjs tests/manager-attendance.test.mjs

Result: 25 PASS, 0 FAIL. This includes network-guard enforcement, request deduplication, cross-scope isolation, quota stop/cooldown, queued-read cancellation, poll cleanup/visibility/no-overlap, mocked authentication/cookies and manager attendance/backfill invariants. Mocked historical apply writes are to an in-memory Map, not Firestore. No manager/employee record was read or written live.

Targeted ESLint passed for the changed runtime/test files after renaming a test-harness local variable that conflicted with a Next lint rule. git diff --check passed. No Next.js build, server, live login test or Firebase script ran in this task.

The final local process check still showed only the unrelated propBank Node processes on 8080 and the workspace editor; no identified Nova server/test/CLI process was found. Browser tabs could not be inspected, and no statement is made about another device or cloud process stopping.

**Conclusion**

The production quota failure is established by prior recorded errors and the user's usage figures. High-frequency full-history polling is a strong, source-proven amplification mechanism, with both pre-existing loops and an earlier Codex-added personal-history loop. Earlier Codex server launches and bounded live diagnostics are also confirmed. Exact attribution of the two-day 92,000 reads remains unresolved because document counts, complete caller logs, November 10 evidence and metric aggregation details are absent. No party or single component is assigned the full total without that evidence. No permanent-fix or project-wide shutdown claim is made.
