import {expect,test} from 'vitest';
import {mergeDrafts,validDraftRecord} from '../src/drafts';
const record={key:'ABC234:p:q',room:'ABC234',participant:'p',question:'q',value:'{"tokens":["メタン"]}',updatedAtMs:100,expiresAtMs:1000};
test('preserves newer local draft rather than replacing it with server snapshot',()=>{expect(mergeDrafts({q:'{"tokens":[]}'},[record],200).q).toBe(record.value);});
test('expired or wrong-room local data cannot overwrite current answers',()=>{expect(validDraftRecord(record,1001)).toBe(false);expect(mergeDrafts({q:'server'},[record],200,'DIFFERENT').q).toBe('server');});
