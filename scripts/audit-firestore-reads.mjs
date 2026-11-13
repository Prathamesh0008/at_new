// Static audit only. No Firebase imports, environment loading, network or DB calls.
import { readFileSync, writeFileSync } from 'node:fs';
const files=['lib/firebase-helpers.js','lib/portal-helpers.js','utils/excelExport.js','lib/attendanceStorage.js','app/api/session/route.js','app/api/attendance/backfill/route.js','lib/firestore-reads.js'];
const inventory=[];
for(const file of files){
 const lines=readFileSync(file,'utf8').split(/\r?\n/);let owner='module';
 lines.forEach((line,index)=>{
  const declaration=line.match(/(?:export )?(?:async )?function (\w+)|(?:export )?const (\w+) = (?:async )?\(/);if(declaration)owner=declaration[1] || declaration[2];
  if(!/\b(?:getDocs|getDoc|sdkGetDocs|sdkGetDoc)\(|\b(?:tx|reader)\.get\(|\.getAll\(|\.get\(\)/.test(line))return;
  const point=/\bgetDoc\(|sdkGetDoc\(|tx\.get\((?:ref|dailyRef)\)|\.doc\([^)]*\)\.get\(\)/.test(line);
  const team=line.includes('.getAll(');
  inventory.push({file,line:index+1,owner,code:line.trim(),estimatedDocumentReads:team?'E known account documents (currently 5), once per visible minute':point?'1 per point lookup, per transaction attempt if transactional':'Q(N)=max(1,N matching documents); paginated traversals add one empty-page minimum when N is an exact positive multiple of 200',perSession:owner==='getPersonalAttendance'?'screen entry and explicit approved-history refresh only':owner==='getVisibleNotificationDocs'?'up to 321 polls per visible 8-hour session plus panel toggles':owner==='getAttendanceState'?'up to 480 visible-minute polls plus explicit own shift/break actions':owner==='mutateAttendance'?'explicit shift/break action; transaction retries may multiply reads':'initial relevant load, relevant navigation/action, explicit export/admin operation or wrapper invocation; not an automatic full-history timer'});
 });
}
writeFileSync('FIRESTORE_QUERY_INVENTORY.json',JSON.stringify({method:'Static source inventory; counts are estimates, not production measurements',pageSize:200,inventory},null,2)+'\n');
console.log(`Inventoried ${inventory.length} possible Firestore read call sites without database access.`);
