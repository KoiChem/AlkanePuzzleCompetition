import {it,expect} from 'vitest';
import {updateMarkupExpiry,pruneExpiredMarkup} from '../../src/games/alkane-puzzle/client/QuestionView';
it('shortens only this participant memo expiry when the competition finishes early',()=>{
 const rows=new Map([['alkane-markup:r:p:q',JSON.stringify({expiresAtMs:200,strokes:[]})],['alkane-markup:other:p:q',JSON.stringify({expiresAtMs:200,strokes:[]})]]);
 const storage={get length(){return rows.size;},key:(i:number)=>[...rows.keys()][i]??null,getItem:(k:string)=>rows.get(k)??null,setItem:(k:string,v:string)=>{rows.set(k,v);},removeItem:(k:string)=>{rows.delete(k);}};
 updateMarkupExpiry(storage,'alkane-markup:r:p:',180,120);
 expect(JSON.parse(rows.get('alkane-markup:r:p:q')!).expiresAtMs).toBe(180);
 pruneExpiredMarkup(storage,181);
 expect(rows.has('alkane-markup:r:p:q')).toBe(false);
 expect(rows.has('alkane-markup:other:p:q')).toBe(true);
});
