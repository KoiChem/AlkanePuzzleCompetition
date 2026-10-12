import {describe,it,expect} from 'vitest';
import {validStrokes,markStyles} from '../game/client/markup';
describe('question markup',()=>{
 it('uses the original yellow marker and red pen styles',()=>{expect(markStyles.yellow.width).toBe(22.5);expect(markStyles.red.width).toBe(3.2);});
 it('supports fluorescent green and the original blue pen',()=>{expect(Object.keys(markStyles)).toEqual(['yellow','green','red','blue']);expect(markStyles.green).toEqual({color:'rgba(120, 220, 120, .46)',width:22.5});expect(markStyles.blue).toEqual({color:'rgba(22, 141, 225, .94)',width:3.2});expect(validStrokes([{tool:'green',points:[{x:.2,y:.4}]},{tool:'blue',points:[{x:0,y:1}]}])).toHaveLength(2);});
 it('accepts normalized strokes and rejects invalid storage',()=>{const good={tool:'yellow',points:[{x:.5,y:.2}]};expect(validStrokes([good,{tool:'pink',points:[{x:0,y:0}]},{tool:'red',points:[{x:Infinity,y:0}]}])).toEqual([good]);expect(validStrokes(null)).toEqual([]);});
});
