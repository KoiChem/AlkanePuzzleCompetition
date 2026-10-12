import {createElement as h} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {test,expect} from 'vitest';
import {AlkaneBoard,type BoardGrid,PaletteIcon} from '../game/client/AlkaneBoard';
function blank():BoardGrid{return Array.from({length:3},()=>Array(3).fill(null));}
function hydroxylSvg(grid:BoardGrid){return renderToStaticMarkup(h(AlkaneBoard,{grid})).match(/<svg[\s\S]*?<\/svg>/g)!.find(svg=>svg.includes('#E8564F'))!;}
for(const [dx,dy,rotation] of [[0,-1,90],[1,0,180],[0,1,270],[-1,0,0]])test(`OH hydrogen extends opposite carbon at ${dx},${dy}`,()=>{
 const grid=blank();grid[1][1]={type:1,rotation:0,element:'OH'};grid[1+dy][1+dx]={type:1,rotation};const svg=hydroxylSvg(grid);
 expect(svg).toContain(`<circle cx="${50-dx*32}" cy="${50-dy*32}" r="6"`);
 expect(svg).toContain(`<line x1="${50-dx*13}" y1="${50-dy*13}" x2="${50-dx*25}" y2="${50-dy*25}" stroke="var(--muted)"`);
 grid[1+dy][1+dx]!.rotation=(rotation+90)%360;
 expect(hydroxylSvg(grid)).toContain('<circle cx="64.1" cy="35.9" r="6"');
 grid[1+dy][1+dx]=null;expect(hydroxylSvg(grid)).toContain('<circle cx="64.1" cy="35.9" r="6"');
});
test('unconnected OH palette has no extended hydrogen bond',()=>{const svg=renderToStaticMarkup(h(PaletteIcon,{panel:{type:1,rotation:0,element:'OH'}}));expect(svg).toContain('<circle cx="64.1" cy="35.9" r="6"');expect(svg).not.toContain('<line');});
