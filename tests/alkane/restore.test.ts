import {describe,it,expect} from 'vitest';
import {mergeServerDrafts} from '../../src/features/play/restore-session';
import type {V2LocalRecord} from '../../src/features/play/v2-local';
it('restores server drafts and keeps a newer local edit in the same writer epoch',()=>{
 const local={writerEpoch:1,drafts:{'q:name':{value:'local',version:3,editedElapsedMs:30}}} as unknown as V2LocalRecord;
 const restored=mergeServerDrafts(local,{'q:name':{value:'server',version:2,writerEpoch:1,editedElapsedMs:20},'r:name':{value:'other',version:1,writerEpoch:1,editedElapsedMs:10}},1);
 expect(restored.drafts['q:name'].value).toBe('local');expect(restored.drafts['r:name'].value).toBe('other');
});
