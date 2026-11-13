import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Evaluate only the adapter with every external dependency mocked. No Admin SDK,
// credential discovery, network, file writes or live database calls occur.
function fixture(env={}, unavailable=false){
 const calls={shared:0,initialize:0,cert:0};const shared={kind:'existing-server'},isolated={kind:'explicit-server'};
 const source=readFileSync(new URL('../lib/server/manager-firebase.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export async function','async function');
 const managerFirebase=new Function('process','serverDb','fail','getApps','initializeApp','cert','getFirestore','FieldValue','Timestamp','createManagerCredentialAuth','employees',source+'; return managerFirebase;')(
  {env},async()=>{calls.shared++;if(unavailable)throw Object.assign(Error('Server connection unavailable'),{status:503});return shared;},(message,status)=>{throw Object.assign(Error(message),{status});},()=>[],()=>{calls.initialize++;return {};},()=>{calls.cert++;return {};},()=>isolated,{serverTimestamp:()=> 'server-generated-fixture'},{fromDate:date=>date},db=>({boundDb:db}),[{id:'NTS-MGR',password:'public-fixture'}]
 );
 return {managerFirebase,calls,shared,isolated};
}
test('manager reuses existing trusted server connection without separate manager credentials or Firebase Auth',async()=>{
 const f=fixture();assert.equal(f.calls.shared,0);const services=await f.managerFirebase();
 assert.equal(services.db,f.shared);assert.equal(services.auth.boundDb,f.shared);assert.equal(services.stamp(),'server-generated-fixture');assert.equal(f.calls.shared,1);assert.equal(f.calls.initialize,0);assert.equal(f.calls.cert,0);
 const route=readFileSync(new URL('../app/api/manager-attendance/[operation]/route.js',import.meta.url),'utf8');assert.match(route,/await managerFirebase\(\)/);
});
test('existing explicit manager override remains supported and never silently falls back on invalid configuration',async()=>{
 const f=fixture({NEXT_PUBLIC_FIREBASE_PROJECT_ID:'offline-project',MANAGER_FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:'offline-project',private_key:'mock-only',client_email:'offline@example.test'})});
 assert.equal((await f.managerFirebase()).db,f.isolated);assert.equal(f.calls.shared,0);assert.equal(f.calls.initialize,1);
 for(const env of [{MANAGER_FIREBASE_SERVICE_ACCOUNT_JSON:'invalid'},{NEXT_PUBLIC_FIREBASE_PROJECT_ID:'offline-project',MANAGER_FIREBASE_SERVICE_ACCOUNT_JSON:'invalid'},{NEXT_PUBLIC_FIREBASE_PROJECT_ID:'offline-project',MANAGER_FIREBASE_SERVICE_ACCOUNT_JSON:'{}'}]){
  const bad=fixture(env);await assert.rejects(bad.managerFirebase(),{status:503});assert.equal(bad.calls.shared,0);
 }
});
test('project mismatch and unavailable shared server connection fail closed without any client fallback',async()=>{
 const mismatch=fixture({FIREBASE_PROJECT_ID:'other-project',NEXT_PUBLIC_FIREBASE_PROJECT_ID:'offline-project'});await assert.rejects(mismatch.managerFirebase(),{status:503});assert.equal(mismatch.calls.shared,0);
 const missing=fixture({},true);await assert.rejects(missing.managerFirebase(),{status:503});assert.equal(missing.calls.initialize,0);
 const source=readFileSync(new URL('../lib/server/manager-firebase.js',import.meta.url),'utf8');assert.doesNotMatch(source,/getAuth|firebase-admin\/auth|from ['"](?:\.\.\/)?firebase['"]/);
});

test('employee routes require session verification and reject browser identity fields before persistence',async()=>{
 for(const kind of ['attendance','breaks']){
  let writes=0;const source=readFileSync(new URL(`../app/api/${kind}/route.js`,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ','');
  const post=new Function('requireUser','apiError','serverDb','FieldValue','Filter','createEmployeeAttendance','readJsonBody','mirrorEmployeeEvent',source+'; return POST;')(
   async request=>{if(request.headers.get('x-fixture-auth')!=='employee')throw Object.assign(Error('Authentication required'),{status:401});return {id:'NTS-001',name:'Fixture'};},error=>Response.json({error:error.message},{status:error.status||503}),async()=>({}),{serverTimestamp:()=>null},{},()=>async(user)=>{writes++;return {state:{employeeId:user.id}};},request=>request.json(),()=>true
  );
  const request=(payload,auth=true)=>new Request('https://portal.example/api/'+kind,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{'x-fixture-auth':'employee'}:{})},body:JSON.stringify(payload)});
  assert.equal((await post(request({action:'start'},false))).status,401);
  assert.equal((await post(request({employeeId:'NTS-MGR',action:'start'}))).status,400);assert.equal(writes,0);
  assert.equal((await post(request({action:'start',command:{}}))).status,200);assert.equal(writes,1);
 }
});
