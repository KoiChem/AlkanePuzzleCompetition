import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test} from 'vitest';
import {ReopenSubmission} from '../src/ReopenSubmission';

test('reopen starts with request and its caution, without executing or revealing confirmation',()=>{
 let calls=0;const html=renderToStaticMarkup(createElement(ReopenSubmission,{disabled:false,onConfirm:async()=>{calls++;}}));
 expect(html).toContain('差し戻しを希望する');expect(html).toContain('同点の場合の着順は、再提出の時刻で決まります。');expect(html).toContain('aria-describedby=');expect(html).toContain('aria-expanded="false"');expect(html).not.toContain('差し戻して解答に戻る');expect(calls).toBe(0);
});
test('waiting request is disabled when deadline or connection prevents reopening',()=>{
 const html=renderToStaticMarkup(createElement(ReopenSubmission,{disabled:true,onConfirm:async()=>{}}));expect(html).toMatch(/<button[^>]*disabled=""/);expect(html).toContain('競技終了後は差し戻せません');
});
