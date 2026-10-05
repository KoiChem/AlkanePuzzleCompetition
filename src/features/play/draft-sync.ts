import type {V2LocalRecord} from './v2-local';
export function pendingDraftItems(record:V2LocalRecord,inflight:Record<string,number>) {
 return Object.entries(record.drafts).filter(([key,d])=>(d.version??0)>Math.max(d.syncedVersion??0,inflight[key]??0)).map(([key,d])=>{const split=key.lastIndexOf(':');return {key,questionId:key.slice(0,split),fieldId:key.slice(split+1),value:d.value,editedElapsedMs:d.editedElapsedMs,version:d.version!};}).slice(0,15);
}
export function draftsPending(record:V2LocalRecord|null){return !!record && Object.values(record.drafts).some(d=>(d.version??0)>(d.syncedVersion??0));}
