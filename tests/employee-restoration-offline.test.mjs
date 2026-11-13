import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createManagerApi } from '../lib/manager-api.mjs';
import { managerAttendanceView, managerLoginTime } from '../lib/attendance-view.mjs';

// Run the actual provider's login/recovery logic with in-memory React hooks and
// fixture credentials only. No real credentials, browser or Firebase are loaded.
function authFixture({ storage = new Map(), managerSignIn = async()=>{} } = {}) {
 const employees=[{id:'FIX-EMP',name:'Employee',password:'offline-employee',role:'agent'},{id:'NTS-MGR',name:'Manager',password:'offline-legacy-manager',role:'manager'}];
 let source=readFileSync(new URL('../contexts/AuthContext.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ','');
 source=source.replace('return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;','return value;');
 const slots=[];let cursor=0,mounted=false,managerAttempts=0,clears=0;
 const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
 const provider=new Function('createContext','useContext','useEffect','useRef','useState','employees','normalizeRole','clearManagerBrowserSession','establishManagerSession','portalReads','localStorage','window',source+';return AuthProvider;')(
  ()=>({}),()=>{},effect=>{if(!mounted){mounted=true;effect();}},initial=>{const index=cursor++;slots[index]??={current:initial};return slots[index];},initial=>{const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},
  employees,role=>role==='manager'?'manager':'employee',async()=>{clears++;},async password=>{managerAttempts++;await managerSignIn(password);},{invalidate(){}},localStorage,{}
 );
 const render=()=>{cursor=0;return provider({children:null});};render();
 return {render,storage,managerAttempts:()=>managerAttempts,clears:()=>clears};
}

test('existing employee password login and refresh recovery require no employee server session or private verifier',async()=>{
 const f=authFixture();let auth=f.render();
 assert.equal((await auth.login('FIX-EMP','wrong')).success,false);
 assert.equal((await auth.login(' fix-emp ','offline-employee')).success,true);
 auth=f.render();assert.equal(auth.user.id,'FIX-EMP');assert.equal(auth.isAuthenticated,true);assert.equal(auth.user.password,undefined);assert.equal(f.managerAttempts(),0);
 const refreshed=authFixture({storage:f.storage}).render();assert.equal(refreshed.user.id,'FIX-EMP');assert.equal(refreshed.isAuthenticated,true);
 assert.equal(await auth.logout(),true);assert.equal(f.render().isAuthenticated,false);assert.equal(f.clears(),1);
 const source=readFileSync(new URL('../contexts/AuthContext.js',import.meta.url),'utf8');assert.doesNotMatch(source,/loginSession|readSession|deleteSession|PORTAL_EMPLOYEE_PASSWORD_VERIFIERS|portal-data/);
});

test('manager legacy dashboard access never substitutes for protected manager authentication',async()=>{
 const f=authFixture({managerSignIn:async()=>{throw Error('Private manager credential is not configured');}});
 assert.equal((await f.render().login('NTS-MGR','offline-legacy-manager')).success,true);assert.equal(f.managerAttempts(),1);assert.match(f.render().managerSessionError,/not configured/);
 const api=createManagerApi({env:{},services:async()=>{throw Error('must not initialize Firebase');}});
 const response=await api(new Request('https://portal.example/api/manager-attendance/daily',{method:'POST',headers:{origin:'https://portal.example','Content-Type':'application/json'},body:JSON.stringify({action:'start',employeeId:'NTS-MGR',role:'manager'})}));assert.equal(response.status,503);
 const source=readFileSync(new URL('../app/portal/page.jsx',import.meta.url),'utf8');
 assert.match(source,/if \(isPersonalManager\) return handleManagerDaily\("start"\)/);assert.match(source,/if \(isPersonalManager\) return handleManagerDaily\("end"\)/);assert.match(source,/\[\.\.\.BREAK_TYPES, "Breather"\]/);assert.match(source,/isPersonalManager \? !managerDaily.canStart : shiftRunning/);assert.doesNotMatch(source,/employeeAttendanceFetch|employeeReady|createEmployeeDailyClient/);
});

test('employee Start/End and Tea/Lunch/Evening use the original storage contracts; manager writes are rejected',async()=>{
 for(const kind of ['attendance','breaks']){
  const writes=[];
  const source=readFileSync(new URL(`../app/api/${kind}/route.js`,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ','');
  const save=async row=>{writes.push(row);return {success:true,timestamp:'10:10',excel:true,firebase:true};};
  const route=new Function('saveAttendance','saveBreak','getTodaysAttendance','getEmployeeBreaks',source+';return {GET,POST};')(save,save,()=>[{EmployeeID:'FIX-EMP'}],id=>[{EmployeeID:id}]);
  const post=body=>route.POST(new Request('https://portal.example/api/'+kind,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
  const actions=kind==='attendance'?['clock-in','clock-out'].map(action=>({action})):['Tea','Lunch','Evening'].flatMap(breakType=>['start','end'].map(action=>({action,breakType})));
  for(const action of actions){const response=await post({employeeId:'FIX-EMP',employeeName:'Fixture',...action});assert.equal(response.status,200);assert.equal((await response.json()).success,true);}
  assert.equal(writes.length,actions.length);
  assert.equal((await post({employeeId:'NTS-MGR',action:'clock-in',breakType:'Breather'})).status,403);assert.equal(writes.length,actions.length);
  assert.equal((await route.GET(new Request('https://portal.example/api/'+kind+'?employeeId=FIX-EMP'))).status,200);
 }
});

test('working data helpers use Firebase directly with retained read coordination; historical manager records stay unchanged',()=>{
 for(const file of ['lib/firebase.js','lib/portal-helpers.js','lib/firebase-helpers.js','lib/portal-reads.js','lib/firestore-reads.js','utils/excelExport.js']){
  const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');assert.doesNotMatch(source,/portal-data-client|\/api\/portal-data/);assert.match(source,/firebase(?:\/firestore|\/app)|from ['"]\.\/firebase['"]|@\/lib\/firebase/);
 }
 const policy=readFileSync(new URL('../lib/portal-read-policy.mjs',import.meta.url),'utf8');assert.match(policy,/NOTIFICATION_INTERVAL_MS = 60000/);assert.match(policy,/BREAK_INTERVAL_MS = 30000/);
 const days=managerAttendanceView();assert.equal(days.length,400);assert.equal(days.filter(row=>row.attendanceStatus==='Present').length,286);assert.equal(days.filter(row=>row.attendanceStatus==='Absent').length,0);assert.equal(days.filter(row=>row.attendanceStatus==='Weekly Off').length,114);
 for(const row of days){assert.equal(row.clockIn,null);assert.equal(row.clockOut,null);if(row.attendanceStatus==='Present')assert.ok(managerLoginTime(row).startsWith(row.approximateArrival));}
 const real=managerAttendanceView({attendance:[{employeeId:'NTS-MGR',date:'2025-10-10',attendanceStatus:'Absent'},{employeeId:'NTS-MGR',date:'2025-10-14',clockInVerified:true,clockIn:'2025-10-14T04:30:00Z'}],leaves:[{employeeId:'NTS-MGR',status:'approved',fromDate:'2025-10-13',toDate:'2025-10-13'}]});
 assert.equal(real.find(row=>row.date==='2025-10-10').attendanceStatus,'Absent');assert.equal(real.find(row=>row.date==='2025-10-13').attendanceStatus,'Leave');assert.equal(real.find(row=>row.date==='2025-10-14').clockIn,'2025-10-14T04:30:00.000Z');
});
