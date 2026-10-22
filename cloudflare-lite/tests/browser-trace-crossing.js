async(page)=>{
 const origin='http://localhost:8792',errors=[],failed=[];
 const context=await page.context().browser().newContext({viewport:{width:390,height:844},hasTouch:true}),guest=await context.newPage();
 const record=e=>errors.push(e.message),requestFailed=request=>failed.push(request.url());
 page.on('pageerror',record);guest.on('pageerror',record);guest.on('requestfailed',requestFailed);
 const check=(value,message)=>{if(!value)throw Error(message);};
 const cell=(r,c)=>guest.locator(`.alkane-question [data-row="${r}"][data-col="${c}"]`);
 const center=async(r,c)=>{const b=await cell(r,c).boundingBox();return{x:b.x+b.width/2,y:b.y+b.height/2,id:1};};
 const ring=[[2,1],[2,2],[2,3],[3,3],[3,2],[2,2]];
 const cases=[
  {name:'methyl',path:ring,arms:[[2,1,1],[2,2,3],[2,3,2],[3,2,2],[3,3,2]]},
  {name:'ring then branch',path:[[2,2],[2,3],[3,3],[3,2],[2,2],[1,2]],arms:[[1,2,1],[2,2,3],[2,3,2],[3,2,2],[3,3,2]]},
  {name:'1,1-dimethyl',path:[...ring,[1,2]],arms:[[1,2,1],[2,1,1],[2,2,4],[2,3,2],[3,2,2],[3,3,2]]},
  {name:'1,2-dimethyl',path:[...ring,[2,3],[1,3]],arms:[[1,3,1],[2,1,1],[2,2,3],[2,3,3],[3,2,2],[3,3,2]]},
  {name:'1,3-dimethyl',path:[...ring,[2,3],[3,3],[3,4]],arms:[[2,1,1],[2,2,3],[2,3,2],[3,2,2],[3,3,3],[3,4,1]]},
  {name:'branch backtrack',path:[...ring,[1,2],[2,2]],arms:[[2,1,1],[2,2,3],[2,3,2],[3,2,2],[3,3,2]]},
  {name:'repeated edge backtrack',path:[...ring,[2,3],[2,2]],arms:[[2,1,1],[2,2,3],[2,3,2],[3,2,2],[3,3,2]]},
 ];
 const trace=async(path,session,cancel=false)=>{
  if(session){await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[await center(...path[0])]});for(const point of path.slice(1))await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[await center(...point)]});await session.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});}
  else{const first=await center(...path[0]);await guest.mouse.move(first.x,first.y);await guest.mouse.down();for(const point of path.slice(1)){const p=await center(...point);await guest.mouse.move(p.x,p.y);}if(cancel)await guest.evaluate(()=>window.dispatchEvent(new Event('blur')));await guest.mouse.up();}
 };
 const verify=async(scenario)=>{const actual=await guest.locator('.alkane-question [data-alkane-cell]').evaluateAll(es=>es.filter(e=>e.querySelector('svg')).map(e=>[Number(e.dataset.row),Number(e.dataset.col),e.querySelectorAll('line[stroke-width="3"]').length]));check(JSON.stringify(actual)===JSON.stringify(scenario.arms),scenario.name+' '+JSON.stringify(actual));};
 const finish=async(target)=>{await target.getByRole('button',{name:'全解答確認',exact:true}).click();await target.getByRole('button',{name:'このまま提出',exact:true}).click();await target.getByRole('button',{name:'提出を確定する',exact:true}).click();};
 const results=[];let native=false;
 try{
  await page.goto(origin+'/#/mate/new');await page.getByLabel('ニックネーム（1〜16文字）').fill('描画確認ホスト');await page.getByRole('button',{name:'5問',exact:true}).click();await page.getByRole('button',{name:'3分',exact:true}).click();await page.getByRole('button',{name:'並べる',exact:true}).click();await page.getByRole('button',{name:'まとめて判定',exact:true}).click();await page.getByRole('button',{name:'メイトルームを作る',exact:true}).click();await page.getByRole('button',{name:'問題を準備して開始',exact:true}).waitFor();
  const code=new URL(page.url()).hash.match(/rooms\/([A-Z2-9]{6})/)[1];await guest.goto(origin+'/#/join/'+code);await guest.getByLabel('ニックネーム（1〜16文字）').fill('描画確認参加者');await guest.getByRole('button',{name:'参加する',exact:true}).click();await guest.getByRole('heading',{name:'開始を待っています',exact:true}).waitFor();await page.getByRole('button',{name:'問題を準備して開始',exact:true}).click();await guest.getByRole('button',{name:'1級炭素',exact:true}).waitFor();
  for(const width of [320,390,768,1280]){
   await guest.setViewportSize({width,height:900});
   for(const scenario of cases){await trace(scenario.path);await verify(scenario);await guest.getByRole('button',{name:'盤面の操作を1つ戻す',exact:true}).click();check(await guest.locator('.alkane-question [data-alkane-cell] svg').count()===0,'whole stroke Undo '+scenario.name);check(await guest.getByRole('button',{name:'盤面の操作を1つ戻す',exact:true}).isDisabled(),'extra Undo entry '+scenario.name);}
   const layout=await guest.evaluate(()=>{const bs=[...document.querySelectorAll('.alkane-palette-row')].flatMap(row=>[...row.querySelectorAll('button')].map(b=>b.getBoundingClientRect()));return{overflow:document.documentElement.scrollWidth>innerWidth,minGap:Math.min(...bs.flatMap((a,i)=>bs.slice(i+1).filter(b=>Math.abs(a.y-b.y)<1).map(b=>Math.max(a.left,b.left)-Math.min(a.right,b.right))))};});check(!layout.overflow&&layout.minGap>0,'layout '+JSON.stringify(layout));results.push({width,cases:cases.length,...layout});
  }
  await guest.setViewportSize({width:390,height:844});
  const chromium=page.context().browser().browserType().name()==='chromium',session=chromium?await context.newCDPSession(guest):null;
  try{await trace(cases[2].path,session,true);check(await guest.locator('.alkane-question [data-alkane-cell] svg').count()===0,'cancel did not restore');check(await guest.getByRole('button',{name:'盤面の操作を1つ戻す',exact:true}).isDisabled(),'cancel added history');await trace(cases[3].path,session);await verify(cases[3]);native=!!session;}finally{if(session)await session.detach();}
  await guest.getByText('端末・サーバーに保存済み',{exact:true}).waitFor();await guest.reload();await guest.getByRole('button',{name:'1級炭素',exact:true}).waitFor();await verify(cases[3]);check(await guest.getByRole('button',{name:'盤面の操作を1つ戻す',exact:true}).isDisabled(),'reload retained history');
  await finish(guest);await finish(page);await page.getByRole('heading',{name:'最終結果',exact:true}).waitFor();check(!errors.length,errors.join('\n'));check(!failed.length,failed.join('\n'));
  return{results,nativeTouch:native,cancelRestores:true,savedCrossingReload:true,submissionResults:true,pageErrors:errors,failedRequests:failed};
 }finally{await context.close();page.off('pageerror',record);}
}
