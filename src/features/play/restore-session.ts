import type { V2LocalRecord } from './v2-local';
import type { SavedDraft } from '../../persistence/participant-drafts';
export function mergeServerDrafts(local:V2LocalRecord,server:Record<string,SavedDraft>,writerEpoch:number):V2LocalRecord {
 const drafts={...local.drafts};
 for(const [key,row] of Object.entries(server)) {
  const previous=drafts[key];
  if(!previous || local.writerEpoch!==writerEpoch || (row.version>(previous.version??0)))drafts[key]={...row,syncedVersion:row.version};
 }
 return {...local,drafts};
}
