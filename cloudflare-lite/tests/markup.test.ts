import {describe,it,expect} from 'vitest';
import {validStrokes,markStyles} from '../game/client/markup';
describe('question markup',()=>{
 it('uses the original yellow marker and red pen styles',()=>{expect(markStyles.yellow.width).toBe(22.5);expect(markStyles.red.width).toBe(3.2);});
 it('accepts normalized strokes and rejects invalid storage',()=>{const good={tool:'yellow',points:[{x:.5,y:.2}]};expect(validStrokes([good,{tool:'blue',points:[{x:0,y:0}]},{tool:'red',points:[{x:Infinity,y:0}]}])).toEqual([good]);expect(validStrokes(null)).toEqual([]);});
});
