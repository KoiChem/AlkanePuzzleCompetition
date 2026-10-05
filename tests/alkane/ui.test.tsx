import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { CompetitionSettingsForm, DEFAULT_SETTINGS, settingsSummary } from '../../src/features/setup/CompetitionSettingsForm';
import { AlkaneBoard, applyBoardEdit, advanceTrace, traceBoard, createBoardTapController, type BoardGrid } from '../../src/games/alkane-puzzle/client/AlkaneBoard';
import { applyTokenEdit } from '../../src/games/alkane-puzzle/client/NameWordBank';
import { QuestionView, pruneExpiredMarkup, restoreMarkupStrokes } from '../../src/games/alkane-puzzle/client/QuestionView';
import { ProfileRuleEditor } from '../../app/teacher/QuestionProfileDialog';
import { answerHasContent } from '../../src/features/play/answer-content';
import { DEFAULT_QUESTION_PROFILE } from '../../src/games/alkane-puzzle/shared/question-profile';

describe('alkane UI', () => {
  it('keeps competition controls and exposes only agreed modes and difficulty labels', () => {
    const html = renderToStaticMarkup(<CompetitionSettingsForm value={DEFAULT_SETTINGS} onChange={() => {}} />);
    for (const label of ['問題数', '制限時間', '判定方式', '並べる', '名付ける', 'すいすい', 'まあまあ']) expect(html).toContain(label);
    expect(html).not.toMatch(/イオン|化合物|やさしめ|ややむず|錯/);
    expect(settingsSummary(DEFAULT_SETTINGS)).toContain('並べる・すいすい');
  });
  it('shows every original profile field and three mutually exclusive ring substituent counts', () => {
    const html = renderToStaticMarkup(<ProfileRuleEditor rule={DEFAULT_QUESTION_PROFILE.rules.name.medium} mode="name" onChange={() => {}} />);
    for (const label of ['種類数', '主鎖の炭素数', '置換基数', '環の炭素数', '0個', '1個', '2個以上', 'OHを含めない', 'アルコール', 'OHを1個まで', 'OHを置換基数に含める', '折れ曲がり炭素数', '語群']) expect(html).toContain(label);
    expect((html.match(/type="radio"/g) ?? []).length).toBe(3);
    expect(html).not.toContain('forceRingSubstituent');
    const arrange = renderToStaticMarkup(<ProfileRuleEditor rule={DEFAULT_QUESTION_PROFILE.rules.arrange.easy} mode="arrange" onChange={() => {}} />);
    expect(arrange).toContain('枠数（横）'); expect(arrange).toContain('枠数（縦）');
  });
  it('adds, rotates, moves and deletes panels without mutating a restored answer', () => {
    const empty = Array.from({length:5}, () => Array(7).fill(null));
    const placed = applyBoardEdit(empty, {type:'place', row:2, col:2, panel:{type:1, rotation:0}});
    expect(empty[2][2]).toBeNull();
    const rotated = applyBoardEdit(placed, {type:'rotate', row:2, col:2});
    expect(rotated[2][2]?.rotation).toBe(90);
    const moved = applyBoardEdit(rotated, {type:'move', row:2, col:2, toRow:3, toCol:3});
    expect(moved[2][2]).toBeNull(); expect(moved[3][3]?.rotation).toBe(90);
    expect(applyBoardEdit(moved, {type:'remove', row:3, col:3})[3][3]).toBeNull();
  });
  it('traces connected carbon bonds through empty and existing cells, then undoes only the backtracked step', () => {
    const original:BoardGrid=Array.from({length:5},() => Array(7).fill(null));
    original[2][3]={type:1,rotation:0}; // Existing east bond must survive tracing north.
    let trace={path:[{row:2,col:2}],closed:false};
    trace=advanceTrace(original,trace,{row:2,col:3},{rows:3,cols:3});
    trace=advanceTrace(original,trace,{row:1,col:3},{rows:3,cols:3});
    const formed=traceBoard(original,trace);
    expect(formed[2][2]).toEqual({type:1,rotation:0});
    expect(formed[2][3]).toEqual({type:4,rotation:0}); // west, east and north
    expect(formed[1][3]).toEqual({type:1,rotation:90});
    expect(original[2][3]).toEqual({type:1,rotation:0});
    trace=advanceTrace(original,trace,{row:2,col:3},{rows:3,cols:3});
    expect(traceBoard(original,trace)[1][3]).toBeNull();
    expect(traceBoard(original,trace)[2][3]).toEqual({type:2,rotation:90});
    expect(advanceTrace(original,trace,{row:0,col:3},{rows:3,cols:3})).toEqual(trace);
  });
  it('closes a traced ring but refuses diagonal hops, noncarbon cells and self-crossings', () => {
    const original:BoardGrid=Array.from({length:5},() => Array(7).fill(null));
    original[2][5]={type:1,rotation:0,element:'Cl'};
    let trace={path:[{row:2,col:2}],closed:false};
    expect(advanceTrace(original,trace,{row:3,col:3})).toEqual(trace);
    for (const point of [{row:2,col:3},{row:3,col:3},{row:3,col:2}]) trace=advanceTrace(original,trace,point);
    expect(advanceTrace(original,trace,{row:2,col:3})).toEqual(trace);
    trace=advanceTrace(original,trace,{row:2,col:2});
    expect(trace.closed).toBe(true);
    expect(traceBoard(original,trace)[2][2]).toEqual({type:3,rotation:90});
    expect(advanceTrace(original,trace,{row:1,col:2})).toEqual(trace);
    expect(advanceTrace(original,{path:[{row:2,col:4}],closed:false},{row:2,col:5}).path).toHaveLength(1);
  });
  it('settles rapid taps on separate cells independently using the latest board', () => {
    vi.useFakeTimers();
    try {
      let board:BoardGrid=Array.from({length:5},() => Array(7).fill(null));
      board[2][2]={type:1,rotation:0}; board[2][3]={type:1,rotation:0};
      const taps=createBoardTapController(() => board, next => {board=next;});
      taps.tap(2,2); taps.tap(2,3);
      vi.advanceTimersByTime(220);
      expect(board[2][2]?.rotation).toBe(90);
      expect(board[2][3]?.rotation).toBe(90);
      taps.dispose();
    } finally {vi.useRealTimers();}
  });
  it('keeps double and triple taps cell-local and cancels a pending tap before another edit', () => {
    vi.useFakeTimers();
    try {
      let board:BoardGrid=Array.from({length:5},() => Array(7).fill(null));
      board[2][2]={type:3,rotation:0}; board[2][3]={type:1,rotation:0};
      const taps=createBoardTapController(() => board, next => {board=next;});
      taps.tap(2,2);taps.tap(2,2);
      taps.tap(2,3);taps.tap(2,3);taps.tap(2,3);
      expect(board[2][3]).toBeNull();
      vi.advanceTimersByTime(220);
      expect(board[2][2]?.rotation).toBe(270);
      taps.tap(2,2);taps.cancelAll();
      vi.advanceTimersByTime(220);
      expect(board[2][2]?.rotation).toBe(270);
      taps.dispose();
    } finally {vi.useRealTimers();}
  });
  it('holds a pending rotation while the second press is down', () => {
    vi.useFakeTimers();
    try {
      let board:BoardGrid=Array.from({length:5},() => Array(7).fill(null));
      board[2][2]={type:3,rotation:0};
      const taps=createBoardTapController(() => board, next => {board=next;});
      taps.tap(2,2);
      vi.advanceTimersByTime(100);
      taps.hold(2,2);
      vi.advanceTimersByTime(200);
      expect(board[2][2]?.rotation).toBe(0);
      taps.tap(2,2);
      vi.advanceTimersByTime(220);
      expect(board[2][2]?.rotation).toBe(270);
      taps.dispose();
    } finally {vi.useRealTimers();}
  });
  it('expires room-scoped markup and rejects legacy or malformed stored strokes', () => {
    const items=new Map<string,string>([
      ['alkane-markup:room:p:q:objective',JSON.stringify({expiresAtMs:100,strokes:[{pen:'red',points:[{x:.2,y:.3}]}]})],
      ['alkane-markup:room:p:q:structure',JSON.stringify({expiresAtMs:300,strokes:[{pen:'blue',points:[{x:.4,y:.6}]}]})],
      ['alkane-markup:old',JSON.stringify([{pen:'red',points:[{x:0,y:0}]}])],
      ['other:key','keep'],
    ]);
    const storage={get length(){return items.size;},key:(index:number)=>[...items.keys()][index]??null,getItem:(key:string)=>items.get(key)??null,removeItem:(key:string)=>{items.delete(key);}};
    pruneExpiredMarkup(storage,200);
    expect([...items.keys()]).toEqual(['alkane-markup:room:p:q:structure','other:key']);
    expect(restoreMarkupStrokes(storage,'alkane-markup:room:p:q:structure',200)).toEqual([{pen:'blue',points:[{x:.4,y:.6}]}]);
    expect(restoreMarkupStrokes(storage,'alkane-markup:room:p:q:structure',300)).toEqual([]);
    expect(items.has('alkane-markup:room:p:q:structure')).toBe(false);
    items.set('alkane-markup:bad',JSON.stringify({expiresAtMs:500,strokes:[{pen:'red',points:[{x:2,y:.3}]}]}));
    expect(restoreMarkupStrokes(storage,'alkane-markup:bad',200)).toEqual([]);
    expect(items.has('alkane-markup:bad')).toBe(false);
  });
  it('inserts and reorders naming tokens while preserving restored tokens', () => {
    const tokens = ['2', 'ブタン'];
    expect(applyTokenEdit(tokens, {type:'insert', token:'メチル', index:1})).toEqual(['2','メチル','ブタン']);
    expect(tokens).toEqual(['2','ブタン']);
    expect(applyTokenEdit(['2','ブタン','メチル'], {type:'move', from:2, to:1})).toEqual(['2','メチル','ブタン']);
    expect(applyTokenEdit(tokens, {type:'remove', index:0})).toEqual(['ブタン']);
  });
  it('renders source atom arms and hydrogens in a read-only review board', () => {
    const grid = [[{type:1 as const,rotation:0 as const}, {type:1 as const, rotation:180 as const}]];
    const html = renderToStaticMarkup(<AlkaneBoard grid={grid} label="自分の解答" />);
    expect(html).toContain('自分の解答'); expect(html).toContain('<svg'); expect(html).toContain('<circle');
    expect(html).not.toContain('<button');
  });
  it('renders each competition question with the original board or word bank and restored draft', () => {
    const base = { id:'q1', ordinal:0, progress:{resolvedFieldIds:[] as ('formula'|'name')[]} };
    const arrange = renderToStaticMarkup(<QuestionView question={{...base, fields:[{id:'formula',type:'formula'}], prompt:{kind:'alkane',mode:'arrange',name:'エタン',grid:[[null,null]],options:[{type:1,rotation:0}],values:[]}}} fieldId="formula" value={JSON.stringify({grid:[[{type:1,rotation:0},null]]})} onChange={() => {}}/>);
    expect(arrange).toContain('エタン'); expect(arrange).toContain('原子パレット'); expect(arrange).toContain('長押し'); expect(arrange).toContain('解答の構造');
    const name = renderToStaticMarkup(<QuestionView question={{...base, fields:[{id:'name',type:'name'}], prompt:{kind:'alkane',mode:'name',grid:[[{type:1,rotation:0}]],wordBank:[['1','2'],['ジ'],['メチル'],['メタン']],values:[]}}} fieldId="name" value={JSON.stringify({tokens:['2','メチル']})} onChange={() => {}}/>);
    expect(name).toContain('アルカン構造へのマーキング領域'); expect(name).toContain('2を外す'); expect(name).toContain('メチルを外す'); expect(name).toContain('cat-number');
  });
  it('keeps a full 5×7 answer grid while centering smaller active bounds', () => {
    const html = renderToStaticMarkup(<QuestionView question={{id:'bounded',ordinal:0,progress:{resolvedFieldIds:[]},fields:[{id:'formula',type:'formula'}],prompt:{kind:'alkane',mode:'arrange',name:'メタン',grid:null,bounds:{cols:3,rows:3},options:[{type:1,rotation:0}],alcoholEnabled:false,values:[]}}} fieldId="formula" onChange={() => {}}/>);
    expect((html.match(/data-alkane-cell="true"/g) ?? []).length).toBe(35);
    expect((html.match(/data-active="true"/g) ?? []).length).toBe(9);
    expect((html.match(/data-active="false"/g) ?? []).length).toBe(26);
  });
  it('does not count cleared serialized board and tokens as an entered answer', () => {
    const emptyGrid=Array.from({length:5},() => Array(7).fill(null));
    expect(answerHasContent(JSON.stringify({grid:emptyGrid}))).toBe(false);
    expect(answerHasContent(JSON.stringify({tokens:[]}))).toBe(false);
    emptyGrid[2][3]={type:1,rotation:0};
    expect(answerHasContent(JSON.stringify({grid:emptyGrid}))).toBe(true);
    expect(answerHasContent(JSON.stringify({tokens:['メタン']}))).toBe(true);
  });
  it('uses original notebook and all four word category colors across the app', () => {
    const css = readFileSync('app/styles.css','utf8') + readFileSync('app/globals.css','utf8');
    for (const color of ['#faf8f0','#fffdf6','#33302a','#6f6a5d','#2a9d8f','#1f8175','#d7f0ec','#e3f0fb','#f1e8fb','#e6f6ea','#fdf0e0']) expect(css.toLowerCase()).toContain(color);
    expect(css).not.toContain('#eef9ff');
  });
});
