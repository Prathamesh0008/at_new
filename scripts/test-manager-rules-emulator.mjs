import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, collection, setDoc, updateDoc, deleteDoc, getDoc, getDocs, terminate } from 'firebase/firestore';

const projectId = 'demo-nts-manager-rules';
const ordinary = ['attendance','attendanceDaily','breaks','activities','leave_requests','leave_requests_v2','daily_tasks','daily_worksheets','portal_notifications','reimbursements','attendance_corrections','portal_settings','salary_slip_requests','salary_slips'];
const protectedNames = ['managerAttendanceHistory','managerAttendanceApprovals','managerAttendanceDaily','managerAttendanceState'];
const timeout = setTimeout(() => { console.error('RULES TEST BLOCKED: emulator timed out'); process.exit(2); }, 60000);
let checks = 0;
const clients = [];
try {
  for (const actor of ['anonymous','employee','manager']) {
    const app = initializeApp({ projectId }, `rules-${actor}`);
    const db = getFirestore(app);
    connectFirestoreEmulator(db, '127.0.0.1', 8789, actor === 'anonymous' ? {} : { mockUserToken: { sub: `fixture-${actor}`, user_id: `fixture-${actor}`, role: actor } });
    clients.push({ app, db });
    for (const name of ordinary) {
      const ref = doc(db, name, `compatibility-${actor}`);
      await setDoc(ref, { employeeId: 'fixture', status: 'fixture' }); checks++;
      assert.equal((await getDoc(ref)).exists(), true); checks++;
      await updateDoc(ref, { status: 'updated' }); checks++;
      await deleteDoc(ref); checks++;
      await getDocs(collection(db, name)); checks++;
    }
    for (const name of protectedNames) {
      for (const path of [`${name}/fixture`, `${name}/fixture/nested/fixture`]) {
        const ref = doc(db, path);
        for (const operation of [() => getDoc(ref), () => setDoc(ref, { fixture: true }), () => updateDoc(ref, { fixture: true }), () => deleteDoc(ref)]) {
          await assert.rejects(operation(), error => error.code === 'permission-denied'); checks++;
        }
      }
      await assert.rejects(getDocs(collection(db, name)), error => error.code === 'permission-denied'); checks++;
    }
  }
  const pending = JSON.parse(fs.readFileSync('security-audit/manager-activation-pending.json','utf8'));
  const candidateSha256 = crypto.createHash('sha256').update(fs.readFileSync('firestore.rules')).digest('hex');
  assert.equal(pending.candidateSha256, candidateSha256);
  fs.writeFileSync('security-audit/manager-rules-emulator-result.json', JSON.stringify({ passed: true, projectId, endpoint: '127.0.0.1:8789', candidateSha256, checks, employeeCollections: ordinary, protectedCollections: protectedNames, actors: ['anonymous','employee','manager'], testedAt: new Date().toISOString() }, null, 2)+'\n');
  console.log(`AUTHORITATIVE FIRESTORE EMULATOR: ${checks} permission checks passed; employee CRUD/list preserved; manager CRUD/list and nested documents denied.`);
} catch (error) {
  console.error(`RULES TEST BLOCKED: ${error.code || error.name || 'validation failed'}`);
  process.exitCode = 2;
} finally {
  clearTimeout(timeout);
  for (const { app, db } of clients) { await terminate(db); await deleteApp(app); }
}
