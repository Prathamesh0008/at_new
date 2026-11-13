# Manager attendance private-credential setup

Local implementation only; no production activation or deployment is authorized in this step. Local settings may already exist; never print their secret values.

The working employee flow has been restored: the existing browser Employee ID + Password login and employee storage helpers do not depend on the secure-portal migration APIs or employee private verifier settings. NTS-MGR uses the same screen and attendance controls, but only a private manager credential verified on the server can establish its attendance cookie. Legacy browser login may open the manager dashboard; it never authorizes manager attendance writes. The unused employee security-migration scaffolding and prepared deny-all firestore.rules are not activated and must not be deployed against this restored flow. No new security redesign is part of manager activation.

Required server-only configuration (never use NEXT_PUBLIC_ names):

- MANAGER_ATTENDANCE_PASSWORD_VERIFIER: JSON object with algorithm "scrypt-v1", salt (64 lowercase hexadecimal characters), and hash (128 lowercase hexadecimal characters). Generate a random 32-byte salt and derive 64 bytes using Node scrypt on the UTF-8 private password, with N=16384, r=8, p=1 and maxmem=33554432. Use the decoded salt bytes, not its hex text. Provision this through the administrator's trusted credential tooling; never commit the plaintext password or verifier. The private password must differ from the publicly bundled legacy password. No plaintext private-password environment variable is used.
- MANAGER_ATTENDANCE_SESSION_SECRET: independently generated cryptographically random secret, at least 32 bytes. Rotating this secret or the verifier invalidates existing manager cookies. Cookies last one hour and cannot be renewed using browser identity fields.
- MANAGER_ATTENDANCE_ORIGIN: exact canonical HTTPS portal origin, without a trailing slash. HTTP localhost is permitted only outside production.
- Database access reuses the portal's existing trusted serverDb connection (including its existing GOOGLE_APPLICATION_CREDENTIALS configuration). No new Firebase project, Firebase Auth account or separate manager database credential is required. An already configured MANAGER_FIREBASE_SERVICE_ACCOUNT_JSON remains supported as an explicit override, matching NEXT_PUBLIC_FIREBASE_PROJECT_ID; an invalid override fails closed. Firebase Authentication and NTS_MANAGER_FIREBASE_UID are not required for manager attendance.

Before separately authorized activation:

1. Confirm deployed rules deny direct client access to manager attendance collections, including managerAttendanceState. Local rule fragments do not prove deployed protection. The fixed NTS-MGR_auth_attempts document in managerAttendanceState protects sign-in attempts across server instances.
2. Provision the private verifier, independent session secret, origin and server database access securely. Do not copy a public legacy password into the private credential setup.
3. Only after storage protection is verified, separately authorize MANAGER_ATTENDANCE_STORAGE_APPROVED=true and MANAGER_ATTENDANCE_ENABLED=true. No code automatically sets either flag. Leave historical Apply disabled; no historical reconciliation/Apply flags are needed for daily shifts.
4. Sign out and sign in through the existing page using Employee ID NTS-MGR and the private password. The server sets a path-scoped HttpOnly, SameSite=Strict cookie (Secure in production). Refresh restores state through the existing protected manager daily API.
5. Separately authorize controlled production validation of Start/End Shift and each break. Offline tests do not verify deployed rules, server credentials, indexes or browser cookie behavior.

Login reserves at most five attempts per fixed 15-minute window, including successful attempts, using one transactional document read/write per allowed attempt. Lockout checks read that document but do not write it. Failed database operations fail closed; there is no process-local fallback, polling, or Firebase Auth call. Logout deletes the browser cookie; secret/verifier rotation revokes previously issued cookies globally. Existing shift version checks, command receipts, real server timestamps and historical protections are unchanged.

The existing daily attendance rule accepts shifts only after the historical cutoff: 2026-11-14 onward (IST). This restriction is unchanged; configuring authentication does not override it.
