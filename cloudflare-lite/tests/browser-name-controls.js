async(page)=>{
 const origin='http://localhost:8792',errors=[];page.on('pageerror',e=>errors.push(e.message));
 const context=await page.context().browser().newContext({viewport:{width:320,height:568}}),g=await context.newPage();g.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(origin+'/#/mate/new');await page.getByLabel('ニックネーム（1〜16文字）').fill('名前操作検証');await page.getByRole('button',{name:'5問',exact:true}).click();await page.getByRole('button',{name:'名付ける',exact:true}).click();await page.getByRole('button',{name:'問題毎判定',exact:true}).click();await page.getByRole('button',{name:'メイトルームを作る',exact:true}).click();await page.getByRole('button',{name:'問題を準備して開始',exact:true}).waitFor();
  const code=new URL(page.url()).hash.match(/rooms\/([A-Z2-9]{6})/)[1];await g.goto(origin+'/#/join/'+code);await g.getByLabel('ニックネーム（1〜16文字）').fill('名前参加');await g.getByRole('button',{name:'参加する',exact:true}).click();await g.getByRole('heading',{name:'開始を待っています'}).waitFor();await page.getByRole('button',{name:'問題を準備して開始',exact:true}).click();await g.locator('.alkane-token-controls button').first().waitFor();
  const layouts=[];for(const width of [320,390,768]){
   await g.setViewportSize({width,height:844});const buttons=await g.locator('.alkane-token-controls button').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {text:el.textContent,width:r.width,height:r.height,top:r.top};}));
   const input=await g.locator('.alkane-answer-tokens').boundingBox();
   if(buttons.length!==5||buttons.some(b=>b.height!==44||b.top>=input.y))throw Error('incorrect naming toolbar '+JSON.stringify(buttons));
   const footer=await g.locator('.name-immediate-actions button').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {text:el.textContent,width:r.width,height:r.height,top:r.top};}));
   if(footer.map(b=>b.text).join('/')!=='解答/パス/全解答確認'||footer.some(b=>b.height!==44||Math.abs(b.top-footer[0].top)>1||Math.abs(b.width-footer[0].width)>1))throw Error('incorrect footer '+JSON.stringify(footer));
   layouts.push({width,buttons});
  }
  await g.setViewportSize({width:320,height:568});await g.screenshot({path:'/private/tmp/alkane-name-controls-320.png',fullPage:true});await g.locator('.alkane-word-row button').first().click();await g.getByRole('button',{name:'解答を1つ戻す',exact:true}).click();if(await g.locator('[data-token-index]').count())throw Error('undo failed');
  await g.getByRole('button',{name:'黄色蛍光ペン',exact:true}).click();
  const surface=await g.locator('canvas.alkane-markup-canvas').boundingBox();
  await g.mouse.move(surface.x+20,surface.y+20);await g.mouse.down();await g.mouse.move(surface.x+80,surface.y+45,{steps:8});await g.mouse.up();
  const marked=await g.locator('canvas').evaluate(el=>Array.from(el.getContext('2d').getImageData(0,0,el.width,el.height).data).some(v=>v!==0));if(!marked)throw Error('marker failed');
  await g.getByRole('button',{name:'マーキングをすべて消す',exact:true}).click();if(await g.locator('canvas').evaluate(el=>Array.from(el.getContext('2d').getImageData(0,0,el.width,el.height).data).some(v=>v!==0)))throw Error('eraser failed');
  await g.getByRole('button',{name:'赤ペン',exact:true}).click();await g.mouse.move(surface.x+30,surface.y+25);await g.mouse.down();await g.mouse.move(surface.x+100,surface.y+60,{steps:8});await g.mouse.up();
  const persisted=await g.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('alkanecompetition-markup:')).map(k=>JSON.parse(localStorage.getItem(k)).strokes));if(!persisted.some(s=>s.some(p=>p.tool==='red')))throw Error('stroke not stored');
    if(context.browser().browserType().name()==='chromium'){
   await g.locator('canvas').scrollIntoViewIfNeeded();const r=await g.locator('canvas').boundingBox(),cdp=await context.newCDPSession(g);
   const count=()=>g.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('alkanecompetition-markup:')).reduce((n,k)=>n+JSON.parse(localStorage.getItem(k)).strokes.length,0));const before=await count();
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+30,y:r.y+30}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:r.x+70,y:r.y+40}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});if(await count()!==before)throw Error('cancel committed a stroke');
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+30,y:r.y+30}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:r.x+70,y:r.y+40}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});if(await count()!==before+1)throw Error('touch drawing failed');await cdp.detach();
  }
  for(const p of [g,page]){await p.getByRole('button',{name:'全解答確認',exact:true}).click();await p.getByRole('button',{name:'このまま提出',exact:true}).click();await p.getByRole('button',{name:'提出を確定する',exact:true}).click();}await page.getByRole('heading',{name:'最終結果',exact:true}).waitFor();if(errors.length)throw Error(errors.join('\n'));return {layouts,undo:true,marker:true,redPen:true,eraser:true,pageErrors:errors};
 }finally{await context.close();}
}
