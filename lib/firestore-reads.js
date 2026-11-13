import { getDocs as sdkGetDocs, getDoc as sdkGetDoc, queryEqual, refEqual, query, limit, startAfter } from 'firebase/firestore';
import { clientReadCoordinator, readDiagnosticsEnabled, readDiagnostic } from '@/utils/read-control.mjs';
export const browserReads = clientReadCoordinator;
// A shared coordinator also contains HTTP keys and document references.
// Never pass those to Firestore's Query comparator.
const sameQuery = (a,b) => a===b || (['query','collection'].includes(a?.type) && ['query','collection'].includes(b?.type) && queryEqual(a,b));
const sameDocument = (a,b) => a===b || (a?.type==='document' && b?.type==='document' && refEqual(a,b));
const site = () => readDiagnosticsEnabled() ? new Error().stack?.split('\n').filter(line => !line.includes('firestore-reads')).slice(2, 4).join(' ') : 'browser-query';
export const getDocs = ref => browserReads.run(ref, async () => {const result=await sdkGetDocs(ref);readDiagnostic('physical-query',{site:site(),requests:1,documents:Math.max(1,result.size)});return result;}, sameQuery, site());
export const getDoc = ref => browserReads.run(ref, async () => {const result=await sdkGetDoc(ref);readDiagnostic('physical-document',{site:site(),requests:1,documents:1});return result;}, sameDocument, site());

export const getPagedDocs = ref => {const callSite=site(); return browserReads.run(ref, async()=>{
  const docs=[]; let cursor=null;
  do {
    const page=await sdkGetDocs(query(ref,limit(200),...(cursor?[startAfter(cursor)]:[])));
    readDiagnostic('physical-query-page',{site:callSite,requests:1,documents:Math.max(1,page.size)});
    docs.push(...page.docs);
    if(page.size<200)break;
    cursor=page.docs.at(-1);
    if(browserReads.isBlocked())throw Object.assign(new Error('Firestore quota exhausted; paging stopped.'),{code:'resource-exhausted'});
  } while(cursor);
  return {docs,size:docs.length,empty:docs.length===0,forEach:callback=>docs.forEach(callback)};
},sameQuery,callSite); };
