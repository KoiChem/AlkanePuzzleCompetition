import {it,expect} from 'vitest';
import {pendingDraftItems,draftsPending} from '../../src/features/play/draft-sync';
import type {V2LocalRecord} from '../../src/features/play/v2-local';
it('sends a newer edit during a slow request without duplicating the in-flight version',()=>{
 const record={drafts:{'q:name':{value:'new',version:2,syncedVersion:0,editedElapsedMs:200}}} as V2LocalRecord;
 expect(pendingDraftItems(record,{'q:name':1})).toHaveLength(1);
 expect(pendingDraftItems(record,{'q:name':2})).toHaveLength(0);
 expect(draftsPending(record)).toBe(true);
 record.drafts['q:name'].syncedVersion=2;
 expect(draftsPending(record)).toBe(false);
});
