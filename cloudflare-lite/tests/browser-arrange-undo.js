async(page)=>{
 const origin='http://localhost:8792',errors=[];
 const browser=page.context().browser(),context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true}),guest=await context.newPage();
 const record=e=>errors.push(e.message),dialog=d=>d.accept().catch(()=>{});page.on('pageerror',record);guest.on('pageerror',record);page.on('dialog',dialog);
 await context.addInitScript(()=>{window.__pickup=[];const create=AudioContext.prototype.createOscillator;AudioContext.prototype.createOscillator=function(){const osc=create.call(this),set=osc.frequency.setValueAtTime;osc.frequency.setValueAtTime=function(value,time){window.__pickup.push(value);return set.call(this,value,time);};return osc;};});
 const check=(value,message)=>{if(!value)throw Error(message);};
 const cell=(r,c)=>guest.locator(`.alkane-question [data-row="${r}"][data-col="${c}"]`);
 const undo=()=>guest.getByRole('button',{name:'盤面の操作を1つ戻す',exact:true}).click();
 const move=async(r,c)=>{const b=await cell(r,c).boundingBox();await guest.mouse.move(b.x+b.width/2,b.y+b.height/2);};
 const down=async(r,c)=>{await move(r,c);await guest.mouse.down();};
 const trace=async(points)=>{await down(...points[0]);for(const point of points.slice(1))await move(...point);await guest.mouse.up();};
 const place=async(element,r,c,deselect=true)=>{await guest.getByRole('button',{name:element,exact:true}).click();await cell(r,c).click();if(deselect)await guest.getByRole('button',{name:element,exact:true}).click();};
 const clear=()=>guest.getByRole('button',{name:'クリア',exact:true}).click();
 const atom=async(r,c,element)=>(await cell(r,c).getAttribute('aria-label')).endsWith(' '+element);
 const finish=async(target)=>{await target.getByRole('button',{name:'全解答確認',exact:true}).click();await target.getByRole('button',{name:'このまま提出',exact:true}).click();await target.getByRole('button',{name:'提出を確定する',exact:true}).click();};
 let native=false;const layouts=[];
 try{
  await page.goto(origin+'/#/mate/new');await page.getByLabel('ニックネーム（1〜16文字）').fill('Undoホスト');await page.getByRole('button',{name:'5問',exact:true}).click();await page.getByRole('button',{name:'3分',exact:true}).click();await page.getByRole('button',{name:'並べる',exact:true}).click();await page.getByRole('button',{name:'まとめて判定',exact:true}).click();const alcoholOff=page.getByRole('button',{name:/アルコール.*OFF/});if(await alcoholOff.count())await alcoholOff.click();await page.getByRole('button',{name:'メイトルームを作る',exact:true}).click();await page.getByRole('button',{name:'問題を準備して開始',exact:true}).waitFor();
  const code=new URL(page.url()).hash.match(/rooms\/([A-Z2-9]{6})/)[1];await guest.goto(origin+'/#/join/'+code);await guest.getByLabel('ニックネーム（1〜16文字）').fill('Undo参加');await guest.getByRole('button',{name:'参加する',exact:true}).click();await guest.getByRole('heading',{name:'開始を待っています',exact:true}).waitFor();await page.getByRole('button',{name:'問題を準備して開始',exact:true}).click();await guest.getByRole('button',{name:'1級炭素',exact:true}).waitFor();
  check(await guest.getByRole('button',{name:'盤面の操作を1つ戻す',exact:true}).isDisabled(),'initial Undo not disabled');
  for(const element of ['F','Cl','Br','I','OH']){
   await place(element,2,3);const original=await cell(2,3).innerHTML();await guest.evaluate(()=>window.__pickup=[]);await down(2,3);await guest.waitForTimeout(450);check(await guest.locator('.alkane-panel-ghost').count()===1,'noncarbon pickup '+element);check(JSON.stringify(await guest.evaluate(()=>window.__pickup))==='[480,660]','pickup tone differs '+element);await move(2,4);await guest.mouse.up();check(await atom(2,4,element),'move loses '+element);await undo();check(await cell(2,3).innerHTML()===original,'move Undo '+element);
   await trace([[1,3],[2,3],[3,3]]);check(await atom(2,3,'炭素'),'crossing not carbon '+element);await undo();check(await cell(2,3).innerHTML()===original,'cross Undo '+element);check(await cell(1,3).locator('svg').count()===0&&await cell(3,3).locator('svg').count()===0,'stroke not one Undo');
   await trace([[2,3],[1,3]]);check(await atom(2,3,'炭素'),'start not carbon '+element);await undo();
   await trace([[1,3],[2,3],[1,3]]);check(await cell(2,3).innerHTML()===original,'backtrack does not restore '+element);
   await down(1,3);await move(2,3);await guest.evaluate(()=>window.dispatchEvent(new Event('blur')));await guest.mouse.up();check(await cell(2,3).innerHTML()===original,'blur does not restore '+element);
   await clear();await undo();check(await atom(2,3,element),'clear Undo '+element);await clear();
  }
  await place('OH',2,3);await place('Cl',2,4);const old=await cell(2,4).innerHTML();await down(2,3);await guest.waitForTimeout(450);await move(2,4);await guest.mouse.up();await undo();check(await atom(2,3,'OH')&&await cell(2,4).innerHTML()===old,'overwritten destination not restored');await clear();
  await guest.getByRole('button',{name:'Cl',exact:true}).click();await trace([[2,3],[1,3]]);check(await guest.getByRole('button',{name:'Cl',exact:true}).getAttribute('aria-pressed')==='false','selected swipe did not deselect');check(await atom(2,3,'炭素')&&await atom(1,3,'炭素'),'selected trace loses first cell');await undo();check(await cell(2,3).locator('svg').count()===0,'selected trace Undo');
  await place('1級炭素',2,3);const oldCarbon=await cell(2,3).innerHTML();await cell(2,3).click();await guest.waitForTimeout(260);check(await cell(2,3).innerHTML()!==oldCarbon,'rotation failed');await undo();check(await cell(2,3).innerHTML()===oldCarbon,'rotation Undo failed');await cell(2,3).click({clickCount:3,delay:30});await undo();check(await cell(2,3).innerHTML()===oldCarbon,'triple delete Undo failed');await clear();
  if(browser.browserType().name()==='chromium'){
   await guest.getByRole('button',{name:'F',exact:true}).click();const session=await context.newCDPSession(guest);const point=async(r,c)=>{const b=await cell(r,c).boundingBox();return{x:b.x+b.width/2,y:b.y+b.height/2,id:1};};await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[await point(2,3)]});await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[await point(1,3)]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});check(await atom(2,3,'炭素'),'native touch selected trace');await undo();check(await cell(2,3).locator('svg').count()===0,'native Undo');await session.detach();native=true;
  }
  for(const width of [320,375,390,768,1280]){
   await guest.setViewportSize({width,height:900});const layout=await guest.locator('.alkane-grid-undo').evaluate(e=>{const b=e.getBoundingClientRect(),f=e.parentElement.querySelector('.alkane-palette-card').getBoundingClientRect(),s=getComputedStyle(e);return{width:b.width,height:b.height,left:b.right<=f.left,sameRow:Math.abs(b.y+b.height/2-(f.y+f.height/2))<1,border:s.borderColor,overflow:document.documentElement.scrollWidth>innerWidth};});check(layout.width===44&&layout.height===44&&layout.left&&layout.sameRow&&!layout.overflow,'Undo layout '+JSON.stringify(layout));layouts.push({viewport:width,...layout});
  }
  await place('Cl',2,3);await trace([[2,3],[1,3]]);await undo();await guest.getByText('端末・サーバーに保存済み',{exact:true}).waitFor();await guest.reload();await guest.getByRole('button',{name:'1級炭素',exact:true}).waitFor();check(await atom(2,3,'Cl')&&await cell(1,3).locator('svg').count()===0,'Undone draft not restored from saved data');check(await guest.getByRole('button',{name:'盤面の操作を1つ戻す',exact:true}).isDisabled(),'history persisted across reload');
  await clear();await guest.getByRole('button',{name:'次の問題',exact:true}).click();check(await guest.getByRole('button',{name:'盤面の操作を1つ戻す',exact:true}).isDisabled(),'history leaked to next question');await guest.getByRole('button',{name:'前の問題',exact:true}).click();check(await cell(2,3).locator('svg').count()===0,'cleared answer restored');
  // Advance only this browser clock while offline: no production deadline is changed.
  await place('Cl',2,3);await context.setOffline(true);await down(2,3);await move(1,3);
  await guest.evaluate(()=>{window.__undoClock=performance.now.bind(performance);Object.defineProperty(performance,'now',{configurable:true,value:()=>window.__undoClock()+240000});});
  await guest.waitForFunction(()=>document.querySelector('.alkane-palette-card')?.disabled);
  const cutoffBoard=await guest.locator('.alkane-question .alkane-board').innerHTML();
  await guest.mouse.up();await guest.locator('.alkane-grid-undo').evaluate(e=>e.click());
  check(await guest.locator('.alkane-question .alkane-board').innerHTML()===cutoffBoard,'deadline allowed late Undo or pointer edit');
  await guest.evaluate(()=>{delete performance.now;delete window.__undoClock;});await context.setOffline(false);await guest.getByText('端末・サーバーに保存済み',{exact:true}).waitFor();
  await finish(guest);await finish(page);await page.getByRole('heading',{name:'最終結果',exact:true}).waitFor();check(!errors.length,errors.join('\n'));
  return {allAtomPickup:true,overwriteAndBacktrack:true,selectedSwipe:true,wholeStrokeUndo:true,clearAndDestinationRestore:true,rotationAndDeleteUndo:true,nativeTouch:native,savedUndoReload:true,questionBoundary:true,simulatedDeadlineReadOnly:true,submissionResults:true,layouts,pageErrors:errors};
 }finally{await context.close();page.off('pageerror',record);page.off('dialog',dialog);}
}
