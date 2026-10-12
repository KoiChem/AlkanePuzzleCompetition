async launcherPage => {
 const origin='http://localhost:8792',errors=[],checks=[];let nativeInput=null;
 const record=e=>errors.push(e.message),dialog=d=>d.accept();
 const context=await launcherPage.context().browser().newContext({viewport:{width:390,height:844},hasTouch:true}),page=await context.newPage(),guest=await context.newPage();page.on('pageerror',record);page.on('dialog',dialog);guest.on('pageerror',record);
 const root=()=>page.evaluate(()=>getComputedStyle(document.documentElement).overscrollBehaviorX);
 const cell=(row,col)=>page.locator(`.alkane-question [data-row="${row}"][data-col="${col}"]`);
 const center=async locator=>{const b=await locator.boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2};};
 async function assertEvents(target,protectedArea){
  const result=await target.evaluate(element=>{
   const touch=(type,count,cancelable=true)=>{const e=new Event(type,{bubbles:true,cancelable});Object.defineProperty(e,'touches',{value:Array(count).fill({})});element.dispatchEvent(e);return e.defaultPrevented;};
   const wheel=(deltaX,deltaY,ctrlKey=false)=>{const e=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX,deltaY,ctrlKey});element.dispatchEvent(e);return e.defaultPrevented;};
   return {start:touch('touchstart',1),move:touch('touchmove',1),multi:touch('touchstart',2),uncancelable:touch('touchstart',1,false),left:wheel(-120,0),right:wheel(120,0),diagonal:wheel(10,120),vertical:wheel(0,120),zoom:wheel(120,0,true)};
  });
  for(const key of ['start','move','left','right','diagonal'])if(result[key]!==protectedArea)throw Error('gesture protection '+key+' '+JSON.stringify(result));
  if(result.multi||result.uncancelable||result.vertical||result.zoom)throw Error('extra gesture blocked '+JSON.stringify(result));checks.push(result);
 }
 try{
  await page.goto(origin+'/#/');await page.locator('a[href="#/mate/new"]').waitFor();const original=await root();
  await page.goto(origin+'/#/mate/new');await page.getByLabel('ニックネーム（1〜16文字）').fill('ジェスチャー検証');await page.getByRole('button',{name:'5問',exact:true}).click();await page.getByRole('button',{name:'両方',exact:true}).click();await page.getByRole('button',{name:'まとめて判定',exact:true}).click();await page.getByRole('button',{name:'メイトルームを作る',exact:true}).click();await page.getByRole('button',{name:'問題を準備して開始',exact:true}).waitFor();
  const code=new URL(page.url()).hash.match(/rooms\/([A-Z2-9]{6})/)[1];await guest.goto(origin+'/#/join/'+code);await guest.getByLabel('ニックネーム（1〜16文字）').fill('確認参加');await guest.getByRole('button',{name:'参加する',exact:true}).click();await guest.getByRole('heading',{name:'開始を待っています',exact:true}).waitFor();await page.getByRole('button',{name:'問題を準備して開始',exact:true}).click();await page.locator('.play-answering .alkane-question').waitFor();
  for(let i=0;i<5&&!await page.locator('.alkane-question[data-mode="arrange"]').count();i++){if(await root()!==original)throw Error('name question has root guard');await page.getByRole('button',{name:'次の問題',exact:true}).click();}
  const board=page.getByRole('group',{name:'解答の構造',exact:true});await board.waitFor();
  await assertEvents(board,true);await assertEvents(board.locator('[data-active="true"]').first(),true);
  const inactive=board.locator('[data-active="false"]').first();if(await inactive.count())await assertEvents(inactive,true);
  await assertEvents(page.locator('.alkane-palette'),true);await assertEvents(page.getByRole('button',{name:'1級炭素',exact:true}),true);
  if(await root()!=='contain')throw Error('root gesture protection missing');
  await assertEvents(page.locator('.scorebar'),false);
  const startURL=page.url(),historyLength=await page.evaluate(()=>history.length);
  await page.getByRole('button',{name:'1級炭素',exact:true}).tap();await cell(2,3).tap();await page.getByRole('button',{name:'1級炭素',exact:true}).tap();if(await cell(2,3).locator('svg').count()!==1)throw Error('touch placement lost');
  await cell(2,3).tap();await page.waitForTimeout(250);
  const at=await center(cell(2,3));await page.mouse.move(at.x,at.y);await page.mouse.down();await page.waitForTimeout(450);if(await page.locator('.alkane-panel-ghost').count()!==1)throw Error('long press lost');const to=await center(cell(2,4));await page.mouse.move(to.x,to.y);await page.mouse.up();if(await cell(2,4).locator('svg').count()!==1||await cell(2,3).locator('svg').count()!==0)throw Error('drag move duplicated or lost');
  if(page.context().browser().browserType().name()==='chromium'){
   await page.evaluate(()=>{window.__guardNative=[];for(const type of ['touchstart','touchmove','wheel'])document.addEventListener(type,e=>{if(e.target.closest?.('.alkane-board'))window.__guardNative.push({type:e.type,trusted:e.isTrusted,prevented:e.defaultPrevented});},{passive:false});});
   const cdp=await context.newCDPSession(page),points=await Promise.all([cell(2,2),cell(2,3),cell(2,4)].map(center));
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[points[0]]});for(const point of points.slice(1))await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   for(const col of [2,3,4])if(await cell(2,col).locator('svg').count()!==1)throw Error('native touch trace lost');
   await page.mouse.move(points[0].x,points[0].y);await page.mouse.wheel(-150,0);await page.waitForTimeout(100);
   const events=await page.evaluate(()=>window.__guardNative);if(!events.some(e=>e.type==='touchstart'&&e.trusted&&e.prevented)||!events.some(e=>e.type==='wheel'&&e.trusted&&e.prevented))throw Error('native events not cancelled '+JSON.stringify(events));nativeInput={traceCells:3,touchStartPrevented:true,wheelPrevented:true};await cdp.detach();
  }
  await page.setViewportSize({width:390,height:420});await page.evaluate(()=>scrollTo(0,0));await page.mouse.move(2,200);await page.mouse.wheel(0,180);await page.waitForFunction(()=>scrollY>0);await page.evaluate(()=>scrollTo(0,0));await page.setViewportSize({width:390,height:844});
  await page.getByText('端末・サーバーに保存済み',{exact:true}).waitFor();await page.evaluate(()=>window.addEventListener('beforeunload',e=>e.stopImmediatePropagation(),{capture:true,once:true}));await page.reload();await cell(2,4).locator('svg').waitFor();await assertEvents(page.getByRole('group',{name:'解答の構造',exact:true}),true);
  if(page.url()!==startURL||await page.evaluate(()=>history.length)!==historyLength)throw Error('answer gesture changed history');
  await context.setOffline(true);await assertEvents(page.getByRole('group',{name:'解答の構造',exact:true}),true);if(await root()!=='contain')throw Error('paused guard missing');await page.waitForTimeout(150);await context.setOffline(false);await page.getByText('端末・サーバーに保存済み',{exact:true}).waitFor();
  await page.goBack();await page.getByRole('heading',{name:'メイトマッチを作る',exact:true}).waitFor();await page.getByLabel('ニックネーム（1〜16文字）').waitFor();if(await root()!==original)throw Error('back navigation guard leaked');await page.goForward();await page.getByRole('group',{name:'解答の構造',exact:true}).waitFor();if(await root()!=='contain')throw Error('forward restore guard missing');
  await page.getByRole('button',{name:'全解答確認',exact:true}).click();await page.getByRole('heading',{name:'全解答確認',exact:true}).waitFor();if(await root()!==original)throw Error('review root guard leaked');await assertEvents(page.locator('.review-card').first(),false);
  for(let i=0;i<5;i++){await page.getByRole('button',{name:'この問題へ',exact:true}).nth(i).click();const arrange=await page.locator('.alkane-question[data-mode="arrange"]').count()>0;if(await root()!==(arrange?'contain':original))throw Error('mixed mode guard leak');await page.getByRole('button',{name:'全解答確認',exact:true}).click();}
  await page.getByRole('button',{name:'このまま提出',exact:true}).click();if(await root()!==original)throw Error('confirmation guard leaked');await page.getByRole('button',{name:'提出を確定する',exact:true}).click();await guest.getByRole('button',{name:'全解答確認',exact:true}).click();await guest.getByRole('button',{name:'このまま提出',exact:true}).click();await guest.getByRole('button',{name:'提出を確定する',exact:true}).click();await page.getByRole('heading',{name:'最終結果',exact:true}).waitFor();if(await root()!==original)throw Error('results guard leaked');await page.getByRole('link',{name:'ホームへ戻る',exact:true}).click();await page.locator('a[href="#/mate/new"]').waitFor();if(await root()!==original)throw Error('home guard leaked');
  if(errors.length)throw Error(errors.join('\n'));return {eventChecks:checks.length,nativeInput,nativeTouchPlacement:true,tapDrag:true,verticalScroll:true,reloadPersistence:true,pausedGuard:true,backForward:true,mixedAndReviewRestore:true,submissionResults:true,rootRestore:true,pageErrors:errors};
 }finally{await context.close();page.off('pageerror',record);page.off('dialog',dialog);}
}
