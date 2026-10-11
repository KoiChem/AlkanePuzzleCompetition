async(page)=>{
 const origin='http://localhost:8792',errors=[];page.on('pageerror',e=>errors.push(e.message));
 const context=await page.context().browser().newContext({viewport:{width:320,height:568},hasTouch:true,isMobile:true});
 await context.addInitScript(()=>{
  window.__panelTones=[];
  const create=AudioContext.prototype.createOscillator;AudioContext.prototype.createOscillator=function(){const osc=create.call(this),set=osc.frequency.setValueAtTime;osc.frequency.setValueAtTime=function(value,at){window.__panelTones.push(value);return set.call(this,value,at);};return osc;};
 });
 const g=await context.newPage();g.on('pageerror',e=>errors.push(e.message));
 const check=(condition,message)=>{if(!condition)throw Error(message);},cell=(r,c)=>g.locator(`.alkane-question [data-row="${r}"][data-col="${c}"]`),center=b=>({x:b.x+b.width/2,y:b.y+b.height/2});
 async function hold(r,c){const at=center(await cell(r,c).boundingBox());await g.mouse.move(at.x,at.y);await g.mouse.down();await new Promise(resolve=>setTimeout(resolve,450));check(await cell(r,c).locator('svg').count()===0,'pickup source remains');return at;}
 async function place(r,c){await g.getByRole('button',{name:'1級炭素',exact:true}).click();await cell(r,c).click();await g.getByRole('button',{name:'1級炭素',exact:true}).click();}
 async function finish(target){await target.getByRole('button',{name:'全解答確認',exact:true}).click();await target.getByRole('button',{name:'このまま提出',exact:true}).click();await target.getByRole('button',{name:'提出を確定する',exact:true}).click();}
 try{
  await page.goto(origin+'/#/mate/new');await page.getByLabel('ニックネーム（1〜16文字）').fill('長押し検証');await page.getByRole('button',{name:'5問',exact:true}).click();await page.getByRole('button',{name:'並べる',exact:true}).click();await page.getByRole('button',{name:'まとめて判定',exact:true}).click();await page.getByRole('button',{name:'メイトルームを作る',exact:true}).click();await page.getByRole('button',{name:'問題を準備して開始',exact:true}).waitFor();
  const code=new URL(page.url()).hash.match(/rooms\/([A-Z2-9]{6})/)[1];await g.goto(origin+'/#/join/'+code);await g.getByLabel('ニックネーム（1〜16文字）').fill('操作検証');await g.getByRole('button',{name:'参加する',exact:true}).click();await g.getByRole('heading',{name:'開始を待っています'}).waitFor();await page.getByRole('button',{name:'問題を準備して開始',exact:true}).click();await g.getByRole('button',{name:'1級炭素',exact:true}).waitFor();
  await place(2,3);await hold(2,3);await g.screenshot({path:'/private/tmp/alkane-pickup-320.png',fullPage:true});const ghost=await g.locator('.alkane-panel-ghost').evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,opacity:getComputedStyle(el).opacity}));check(ghost.width===56&&ghost.height===56&&Number(ghost.opacity)===.9,'ghost differs from original');
  await g.mouse.up();check(await cell(2,3).locator('svg').count()===1,'same-place drop loses panel');
  await hold(2,3);await g.evaluate(()=>window.dispatchEvent(new Event('blur')));await g.mouse.up();check(await cell(2,3).locator('svg').count()===1,'blur loses panel');check(await g.locator('.alkane-panel-ghost').count()===0,'blur leaves ghost');
  await hold(2,3);await cell(2,3).dispatchEvent('pointercancel',{pointerId:1});await g.mouse.up();check(await cell(2,3).locator('svg').count()===1,'cancel loses panel');
  await hold(2,3);const to=center(await cell(2,4).boundingBox());await g.mouse.move(to.x,to.y);await g.mouse.up();check(await cell(2,4).locator('svg').count()===1,'move failed');check(await cell(2,3).locator('svg').count()===0,'move duplicates source');
  await hold(2,4);await g.mouse.move(2,5);await g.mouse.up();check(await cell(2,4).locator('svg').count()===0,'outside drop keeps panel');
  const tones=await g.evaluate(()=>window.__panelTones);check([480,660,330,250].every(f=>tones.includes(f)),'original operation audio missing '+JSON.stringify(tones));
  await g.getByText('端末・サーバーに保存済み',{exact:true}).waitFor();await g.reload();await g.getByRole('button',{name:'1級炭素',exact:true}).waitFor();check(await cell(2,4).locator('svg').count()===0,'deleted panel restored');
  await finish(g);await finish(page);await page.getByRole('heading',{name:'最終結果',exact:true}).waitFor();check(!errors.length,errors.join('\n'));return {pickupSourceHidden:true,ghost,samePlace:true,blurRestore:true,pointerCancelRestore:true,move:true,outsideDelete:true,deletionPersisted:true,tones,pageErrors:errors};
 }finally{await context.close();}
}
