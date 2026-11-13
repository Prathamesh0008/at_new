**Sign-in fix report**

Root cause

The login path is Login.handleSubmit -> AuthContext.login -> POST /api/session -> Firestore loginAttempts transaction -> password hash verification -> session cookie signing. The earlier server-auth change added a dependency on Firebase Admin credentials without providing this machine with server credentials. Admin initialization unconditionally fell back to Application Default Credentials (ADC). Credential discovery was deferred until the Firestore transaction, producing the reported default-credentials error in the Google client initialization path. The route's catch did not guard SDK initialization before Firestore was created. GET /api/session also lacked an error boundary.

A second configuration blocker exists: SESSION_SECRET is absent. Even if Firestore authentication succeeded, session signing would fail.

Configuration inspection (names/presence only; no values printed)

- Present: NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_APP_ID, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID, NEXT_PUBLIC_FIREBASE_PROJECT_ID, NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET.
- Missing: FIREBASE_SERVICE_ACCOUNT_JSON, GOOGLE_APPLICATION_CREDENTIALS and SESSION_SECRET.
- No Windows well-known ADC file was found at the location derived from APPDATA/gcloud/application_default_credentials.json.
- The gcloud executable was not found in PATH.
- The existing public Firebase web configuration cannot authenticate Firebase Admin. No existing private configuration was found to reuse in the inspected environment.

Server changes

- lib/server/firebase.js: server-only initialization now selects and validates explicit service-account JSON or authorized ADC. It checks explicit credential file availability and Windows/Linux ADC locations. Managed Google runtimes support ADC automatically; other metadata-based environments can explicitly enable ADC with FIREBASE_USE_ADC=true. FIREBASE_PROJECT_ID is supported, with the existing public project ID used only as a non-secret project identifier. Service-account/project mismatches fail safely.
- A global readiness promise and the named Admin app are reused across concurrent calls and Next.js hot reloads. An awaited access-token preflight occurs before constructing Firestore. Initialization failures return a sanitized 503 and apply a 30-second cooldown. No global unhandled-rejection handler was added and no rejections are intentionally swallowed to manufacture success.
- lib/server/auth.js: validates SESSION_SECRET with a safe 503 message before signing.
- app/api/session/route.js: explicitly uses the Node runtime; catches GET/DELETE failures as well as POST failures; checks session configuration before cloud access; awaits Admin readiness; clears the login-attempt record before issuing a successful session. Origin validation, Firebase-backed login rate limiting, existing password checks and signed-session validation remain enforced.
- lib/attendanceStorage.js and app/api/attendance/backfill/route.js: only the serverDb call sites were updated to await the now-asynchronous readiness function. No historical generation/apply operation or attendance mutation was executed.
- lib/firebase.js was reviewed. It initializes the separate browser Firebase SDK using the existing public configuration and is not the source of Admin credential discovery. It was not changed for this fix.

Client changes

- utils/sessionClient.mjs: shares concurrent GET session checks and POST login submissions; makes requests without caching; handles failed responses; does not schedule automatic retries.
- contexts/AuthContext.js: uses the shared transport, ignores responses after effect cleanup, handles session-load failures, and catches logout failures.
- components/Login.js: adds an immediate submission lock and try/catch/finally so rapid clicks or Enter presses cannot submit concurrent logins and failures always release the form's loading state.
- Existing employee/manager identities, password hashes, role mappings, authorization policies and attendance records were not changed by this fix.

Source-map warnings

The reported invalid source-map warnings from google-auth-library/google-gax concern dependency stack-trace mapping. They do not supply missing credentials and are separate from the authentication failure. No node_modules files, dependency versions or warning-suppression settings were changed. The focused HTTP failure checks produced no Google source-map warnings after credential failure was handled before Firestore initialization. A separate dependency/toolchain investigation would be appropriate if warnings recur with configured credentials; their universal disappearance is not claimed.

Validation

- npm run build: PASS, including compilation, TypeScript validation phase and page generation.
- Targeted ESLint on changed server/client modules and tests: PASS.
- node --test tests/session.test.mjs tests/attendance.test.mjs: 7 PASS. Four new tests cover missing/malformed credentials, project mismatch, rejected token preflight, cooldown, concurrent initialization, Windows/managed ADC modes, hot reload reuse, client request deduplication and no automatic retries. Three existing pure attendance-model tests also passed. SDK success paths use injected test boundaries; they do not prove real cloud credentials work.
- Local production-server HTTP checks on localhost: repeated POSTs return 503 for missing SESSION_SECRET; with an ephemeral test-only process secret, repeated POSTs return 503 for missing Admin credentials. No session cookie was issued. Anonymous session GET remains 200 with user=null, GET error paths are caught, and unauthenticated attendance access remains 401.
- No unhandledRejection output or Google source-map warnings appeared during those HTTP checks. Test servers were stopped afterward.
- git diff --check: PASS. No Playwright or extensive E2E suite was used.
- No cloud login, successful credential-backed login, Firestore transaction or historical attendance/backfill write was performed. Environment files were not altered.

Required configuration action / remaining blocker

Sign-in does NOT yet work with the available configuration: authorized Firebase Admin credentials and SESSION_SECRET are both missing. The code now fails cleanly rather than bypassing security.

For local Windows development, choose one authorized credential source:

1. Set GOOGLE_APPLICATION_CREDENTIALS to an existing authorized Google credential JSON file outside the repository (forward-slash Windows paths are suitable in .env.local), or set server-only FIREBASE_SERVICE_ACCOUNT_JSON through your secret-management mechanism.
2. Alternatively, install the Google Cloud CLI and use its Application Default Credentials login flow with an account authorized for this existing project's Firestore database. A normal gcloud login alone is not the ADC login flow.

For production, use the hosting environment's attached authorized service identity/workload ADC, or its secret store for explicit credentials. On a managed Google runtime ADC is detected automatically; for another authorized metadata-based runtime use FIREBASE_USE_ADC=true. That flag does not create credentials or grant permissions.

Set a strong random server-only SESSION_SECRET (at least 32 random bytes) through local/server configuration, using a consistent value across production instances. Do not use NEXT_PUBLIC_ for credentials or this secret. Do not commit credential files. Ensure the selected identity has the existing project's required Firestore permissions; do not grant broad administrative permissions solely to make login pass.

Restart Next.js after configuring credentials and SESSION_SECRET, then validate a real employee and manager login. Restarting also clears any failed ADC app/cache retained during hot reload. Successful sign-in cannot be confirmed until authorized credentials are supplied.

Changed files in this fix: lib/server/firebase.js, lib/server/auth.js, app/api/session/route.js, lib/attendanceStorage.js, app/api/attendance/backfill/route.js, contexts/AuthContext.js, components/Login.js, utils/sessionClient.mjs, tests/session.test.mjs, SIGN_IN_FIX_REPORT.md. Earlier attendance work in the workspace was preserved. No deployment was performed.
