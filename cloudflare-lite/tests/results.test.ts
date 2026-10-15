import {createElement as h} from 'react';
import {test,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {Results} from '../src/CompetitionResults';
for(const gradingMode of ['immediate','deferred'] as const) test(`correct participant answer is shown once in ${gradingMode}`,()=>{
 const html=renderToStaticMarkup(h(Results,{data:{room:{kind:'mate',settings:{gradingMode} as any},own:{correctCount:1},questions:[{id:'q',ordinal:0,prompt:{mode:'arrange',name:'ヘキサン'} as any,fields:[{id:'name',state:'correct',correctAnswer:JSON.stringify({tokens:['ブタン']}),lastAnswer:JSON.stringify({tokens:['ペンタン']}),lastAnswerCorrect:true}]}]}}));
 expect(html).toContain('正解◯');expect(html).toContain('ペンタン');expect(html).not.toContain('ブタン');expect(html).not.toContain('あなたの解答：');
});
test('teacher review follows aggregate and result navigation',()=>{
 const html=renderToStaticMarkup(h(Results,{reviewControls:h('select',{'aria-label':'参加者の解答・復習'}),data:{room:{kind:'class'},aggregate:{averageCorrectCount:0,perfectCount:0,completedCount:0}}}));
 expect(html.indexOf('参加者の解答・復習')).toBeGreaterThan(html.indexOf('ホームへ戻る'));expect(html).toContain('teacher-review-section');
});

test('incorrect participant and teacher correct reviews retain the model answer',()=>{
 for(const own of [undefined,{correctCount:0}]){
  const html=renderToStaticMarkup(h(Results,{data:{room:{kind:'class'},own,questions:[{id:'q',ordinal:0,prompt:{mode:'arrange',name:'ヘキサン'} as any,fields:[{id:'name',state:own?'incorrect':'correct',correctAnswer:JSON.stringify({tokens:['ブタン']}),lastAnswer:JSON.stringify({tokens:['ペンタン']}),lastAnswerCorrect:!own}]}]}}));
  expect(html).toContain('ブタン');expect(html).toContain('ペンタン');expect(html).toContain('あなたの解答：');
 }
});

for (const count of [0, 1, 3, 5, 8, 12, 20, 30, 42]) test(`class host shows up to fifth place with ${count} participants`, () => {
 const ranking=Array.from({length:count},(_,i)=>({rank:i+1,nickname:`順位${i+1}番`,correctCount:0,elapsedCs:100,finishReason:'completed'}));
 const html=renderToStaticMarkup(h(Results,{data:{room:{kind:'class'},aggregate:{averageCorrectCount:0,perfectCount:0,completedCount:0},ranking}}));
 expect(html).toContain('上位5位');if(count>=5)expect(html).toContain('順位5番');expect(html).not.toContain('順位6番');
});
for (const boundary of [3,5]) test(`class result includes all ties at rank ${boundary}`, () => {
 const ranking=[1,2,3,3,5,5,7].map((rank,i)=>({rank,nickname:`同率検証${i}`,correctCount:0,elapsedCs:100,finishReason:'completed'}));
 const html=renderToStaticMarkup(h(Results,{data:{room:{kind:'class'},aggregate:{averageCorrectCount:0,perfectCount:0,completedCount:0},ranking,...(boundary===3?{own:{rank:7}}:{})}}));
 expect(html).toContain(boundary===3?'同率検証3':'同率検証5');expect(html).not.toContain(boundary===3?'同率検証4':'同率検証6');
});
