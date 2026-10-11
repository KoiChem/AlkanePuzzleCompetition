async (page) => {
 const origin='http://localhost:8792',errors=[],report={};
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/?uiux='+Date.now()+'#/mate/new');
 await page.getByLabel('ニックネーム（1〜16文字）').fill('UIUX主催');
 await page.getByRole('button',{name:'10問',exact:true}).click();await page.getByRole('button',{name:'両方',exact:true}).click();await page.getByRole('button',{name:'まとめて判定',exact:true}).click();
 await page.getByRole('button',{name:'出題に含める OFF',exact:true}).click();
 await page.getByRole('button',{name:'メイトルームを作る',exact:true}).click();await page.getByRole('button',{name:'問題を準備して開始',exact:true}).waitFor();
 const code=new URL(page.url()).hash.match(/rooms\/([A-Z2-9]{6})/)[1];
 const context=await page.context().browser().newContext({viewport:{width:320,height:568},isMobile:true,hasTouch:true}),g=await context.newPage();g.on('pageerror',e=>errors.push(e.message));
 async function drag(source,target){await g.mouse.move(source.x,source.y);await g.mouse.down();await g.mouse.move(target.x,target.y,{steps:12});await g.mouse.up();}
 const center=box=>({x:box.x+box.width/2,y:box.y+box.height/2});
 const tokens=()=>g.locator('[data-token-index]').allTextContents();
 const check=(ok,message)=>{if(!ok)throw new Error(message);};
 try{
  await g.goto(origin+'/#/join/'+code);await g.getByLabel('ニックネーム（1〜16文字）').fill('UIUX参加');await g.getByRole('button',{name:'参加する',exact:true}).click();await g.getByRole('heading',{name:'開始を待っています',exact:true}).waitFor();await page.getByRole('button',{name:'問題を準備して開始',exact:true}).click();await g.locator('.alkane-question').waitFor();
  const modes=[];let named=false,arranged=false;
  for(let index=0;index<10;index++){
   const mode=await g.locator('.alkane-question').getAttribute('data-mode');modes.push(mode);
   const body=await g.locator('body').innerText();check(!/この名前の構造|空きマスや|この構造に名前|語句を選んで|書き込み/.test(body),'guide text remains');check(await g.locator('.alkane-markup-tools,canvas.alkane-markup-canvas').count()===0,'unnecessary markup UI remains');
   const navigation=await g.locator('.question-navigation button').evaluateAll(buttons=>buttons.map(b=>{const r=b.getBoundingClientRect();return {top:r.top,right:r.right,left:r.left};}));check(navigation.length===3&&navigation.every(b=>Math.abs(b.top-navigation[0].top)<1&&b.left>=0&&b.right<=320),'navigation wraps');
   if(mode==='name'&&!named){
    named=true;const emptyAnswerHeight=(await g.locator('.alkane-answer-tokens').boundingBox()).height;await g.locator('.alkane-word-row button').nth(0).click();await g.locator('.alkane-word-row button').nth(1).click();check((await tokens()).join(',')==='1,2','tap append');
    const chip=await g.locator('[data-token-index="0"]').boundingBox();await g.mouse.click(chip.x+chip.width-3,chip.y+chip.height/2);await g.locator('.alkane-word-row button').nth(2).click();check((await tokens()).join(',')==='1,3,2','tap insertion marker');
    const box=await g.locator('.alkane-answer-tokens').boundingBox(),end={x:box.x+box.width-8,y:box.y+box.height/2};await drag(center(await g.locator('.alkane-word-row button').nth(3).boundingBox()),end);check((await tokens()).join(',')==='1,3,2,4','word bank drag');
    await drag(center(await g.locator('[data-token-index="0"]').boundingBox()),end);check((await tokens()).join(',')==='3,2,4,1','chip reorder');await drag(center(await g.locator('[data-token-index="3"]').boundingBox()),{x:end.x,y:box.y-24});check((await tokens()).join(',')==='3,2,4','drag outside deletion');await g.getByRole('button',{name:'1つ戻す',exact:true}).click();check((await tokens()).join(',')==='3,2,4,1','undo drag deletion');
    await context.setOffline(true);await g.locator('.alkane-word-row button').nth(4).click();await context.setOffline(false);await g.getByText('端末・サーバーに保存済み',{exact:true}).waitFor({timeout:12000});await g.reload();await g.locator('.alkane-word-row button').first().waitFor();check((await tokens()).join(',')==='3,2,4,1,5','offline/reload recovery');
    await g.screenshot({path:'/private/tmp/alkane-uiux-name-320.png',fullPage:true});report.name={tap:true,insert:true,drag:true,reorder:true,delete:true,undo:true,offlineReload:true,emptyAnswerHeight};
   }
   if(mode==='arrange'&&!arranged){
    arranged=true;check(await g.locator('.alkane-palette-row').count()===2,'palette rows');check((await g.locator('.alkane-palette-row').first().locator('.alkane-palette-card').allTextContents()).every(s=>s.trim()===''),'unexpected visible panel labels');
    await g.getByRole('button',{name:'1級炭素',exact:true}).click();await g.getByRole('button',{name:'3行4列 空欄',exact:true}).click();await g.getByRole('button',{name:'1級炭素',exact:true}).click();
    const from=center(await g.getByRole('button',{name:'3行4列 炭素',exact:true}).boundingBox()),to=center(await g.getByRole('button',{name:'3行5列 空欄',exact:true}).boundingBox());
    const cdp=await context.newCDPSession(g);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from.x,y:from.y}]});await new Promise(resolve=>setTimeout(resolve,450));check(await g.locator('.alkane-panel-ghost').count()===1,'long press ghost');check(await g.evaluate(()=>getSelection().toString()===''),'long press selected text');await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:to.x,y:to.y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await g.getByRole('button',{name:'3行5列 炭素',exact:true}).waitFor();await cdp.detach();
    const atom=center(await g.getByRole('button',{name:'F',exact:true}).boundingBox()),spot=center(await g.getByRole('button',{name:'3行6列 空欄',exact:true}).boundingBox());await drag(atom,spot);await g.getByRole('button',{name:'3行6列 F',exact:true}).waitFor();
    report.arrange={longPressMove:true,noSelection:true,atomDrag:true};await g.screenshot({path:'/private/tmp/alkane-uiux-arrange-320.png',fullPage:true});
   }
   check(await g.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
   if(index<9)await g.getByRole('button',{name:'次の問題',exact:true}).click();
  }
  check(modes.filter(m=>m==='name').length===5&&modes.filter(m=>m==='arrange').length===5,'unbalanced mixed mode');report.mixedModes=modes;
  await g.getByRole('button',{name:'全解答確認',exact:true}).click();const crops=await g.locator('.alkane-board-cropped').evaluateAll(boards=>boards.map(b=>({cells:b.querySelectorAll('[data-alkane-cell]').length,label:b.getAttribute('aria-label')})));check(crops.some(b=>b.label==='現在の解答'&&b.cells===2),'answer crop does not match two adjacent cells');report.reviewCrops=crops;await g.screenshot({path:'/private/tmp/alkane-uiux-review-320.png',fullPage:true});
  await g.getByRole('button',{name:'このまま提出',exact:true}).click();await g.getByRole('button',{name:'提出を確定する',exact:true}).click();await page.getByRole('button',{name:'全解答確認',exact:true}).click();await page.getByRole('button',{name:'このまま提出',exact:true}).click();await page.getByRole('button',{name:'提出を確定する',exact:true}).click();await g.getByRole('heading',{name:'最終結果',exact:true}).waitFor();
  const results=await g.locator('.alkane-board-cropped').evaluateAll(boards=>boards.map(b=>({cells:b.querySelectorAll('[data-alkane-cell]').length,label:b.getAttribute('aria-label')})));check(results.some(b=>b.label==='あなたの解答'&&b.cells===2),'submitted answer missing/crop lost');check(results.some(b=>b.label==='正解の構造'),'correct answer crop missing');report.resultCrops=results;
  check(!errors.length,errors.join('\n'));report.pageErrors=errors;await g.screenshot({path:'/private/tmp/alkane-uiux-results-320.png',fullPage:true});return report;
 }finally{await context.close();}
}
