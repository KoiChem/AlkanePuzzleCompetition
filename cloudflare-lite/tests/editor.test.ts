import {test,expect} from 'vitest';
import {occupiedRegion} from '../game/client/AlkaneBoard';
import {applyTokenEdit} from '../game/client/NameWordBank';
test('review crop includes every occupied cell, preserves gaps and does not mutate the answer',()=>{
 const grid=Array.from({length:5},()=>Array(7).fill(null));grid[1][2]={type:1,rotation:0};grid[3][5]={type:1,rotation:90};const before=JSON.stringify(grid);
 expect(occupiedRegion(grid)).toEqual({top:1,left:2,bottom:3,right:5});expect(JSON.stringify(grid)).toBe(before);expect(occupiedRegion(grid.map(row=>row.map(()=>null)))).toBeNull();
});
test('token moves use insertion boundaries as the original puzzle does',()=>{
 expect(applyTokenEdit(['1','メチル','ブタン'],{type:'move',from:0,to:3})).toEqual(['メチル','ブタン','1']);
 expect(applyTokenEdit(['1','メチル','ブタン'],{type:'move',from:0,to:1})).toEqual(['1','メチル','ブタン']);
 expect(applyTokenEdit(['1','メチル','ブタン'],{type:'move',from:2,to:0})).toEqual(['ブタン','1','メチル']);
});
