async(page)=>{
 const origin='http://localhost:8792',errors=[];page.on('pageerror',e=>errors.push(e.message));
 const context=await page.context().browser().newContext({viewport:{width:320,height:568}}),g=await context.newPage();g.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(origin+'/#/mate/new');await page.getByLabel('ニックネーム（1〜16文字）').fill('名前操作検証');await page.getByRole('button',{name:'5問',exact:true}).click();await page.getByRole('button',{name:'名付ける',exact:true}).click();await page.getByRole('button',{name:'まとめて判定',exact:true}).click();await page.getByRole('button',{name:'メイトルームを作る',exact:true}).click();await page.getByRole('button',{name:'問題を準備して開始',exact:true}).waitFor();
  const code=new URL(page.url()).hash.match(/rooms\/([A-Z2-9]{6})/)[1];await g.goto(origin+'/#/join/'+code);await g.getByLabel('ニックネーム（1〜16文字）').fill('名前参加');await g.getByRole('button',{name:'参加する',exact:true}).click();await g.getByRole('heading',{name:'開始を待っています'}).waitFor();await page.getByRole('button',{name:'問題を準備して開始',exact:true}).click();await g.locator('.alkane-token-controls button').first().waitFor();
  await g.getByRole('button',{name:'黄色蛍光ペン',exact:true}).click();
  const surface=await g.locator('canvas.alkane-markup-canvas').boundingBox();
  await g.mouse.move(surface.x+20,surface.y+20);await g.mouse.down();await g.mouse.move(surface.x+80,surface.y+45,{steps:8});await g.mouse.up();
  const marked=await g.locator('canvas').evaluate(el=>Array.from(el.getContext('2d').getImageData(0,0,el.width,el.height).data).some(v=>v!==0));if(!marked)throw Error('marker failed');
  await g.getByRole('button',{name:'マーキングをすべて消す',exact:true}).click();if(await g.locator('canvas').evaluate(el=>Array.from(el.getContext('2d').getImageData(0,0,el.width,el.height).data).some(v=>v!==0)))throw Error('eraser failed');
  await g.getByRole('button',{name:'赤ペン',exact:true}).click();await g.mouse.move(surface.x+30,surface.y+25);await g.mouse.down();await g.mouse.move(surface.x+100,surface.y+60,{steps:8});await g.mouse.up();
  const persisted=await g.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('alkanecompetition-markup:')).map(k=>JSON.parse(localStorage.getItem(k)).strokes));if(!persisted.some(s=>s.some(p=>p.tool==='red')))throw Error('stroke not stored');
    await g.getByRole('button',{name:'次の問題',exact:true}).click();await g.getByRole('button',{name:'前の問題',exact:true}).click();
  if(!await g.locator('canvas').evaluate(el=>Array.from(el.getContext('2d').getImageData(0,0,el.width,el.height).data).some(v=>v!==0)))throw Error('navigation lost markup');
  await g.reload();await g.locator('canvas').waitFor();
  if(!await g.locator('canvas').evaluate(el=>Array.from(el.getContext('2d').getImageData(0,0,el.width,el.height).data).some(v=>v!==0)))throw Error('reload lost markup');
  for(const p of [g,page]){await p.getByRole('button',{name:'全解答確認',exact:true}).click();await p.getByRole('button',{name:'このまま提出',exact:true}).click();await p.getByRole('button',{name:'提出を確定する',exact:true}).click();}await page.getByRole('heading',{name:'最終結果',exact:true}).waitFor();if(errors.length)throw Error(errors.join('\n'));return {navigationRetention:true,reloadRetention:true,marker:true,redPen:true,eraser:true,pageErrors:errors};
 }finally{await context.close();}
}
