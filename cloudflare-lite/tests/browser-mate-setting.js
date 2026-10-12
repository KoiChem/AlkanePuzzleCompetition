async page => {
 const origin='http://localhost:8792',errors=[];
 const record=e=>errors.push(e.message);page.on('pageerror',record);
 const context=await page.context().browser().newContext(),student=await context.newPage();
 const teacherContext=await page.context().browser().newContext(),teacher=await teacherContext.newPage();
 student.on('pageerror',record);teacher.on('pageerror',record);
 const auth=async(target,token)=>target.route(origin+'/api/**',async route=>{const response=await target.request.fetch(route.request(),{headers:{...route.request().headers(),cookie:'__Host-alkane-lite-session='+token.repeat(43)}});await route.fulfill({response});});
 await auth(page,'A');await auth(teacher,'B');
 try{
  await page.goto(origin+'/#/teacher');
  const prepared=await page.evaluate(async()=>{const session=await (await fetch('/api/auth/session')).json();return (await fetch('/api/teacher/mate-setting',{method:'PUT',headers:{'content-type':'application/json','x-competition-csrf':session.csrfToken},body:'{"enabled":true}'})).status;});if(prepared!==200)throw Error('fixture setup failed '+prepared);
  await page.goto(origin+'/#/');
  await student.route(origin+'/api/public-config',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"検証用読込エラー"}'}));
  await student.goto(origin+'/#/mate/new');await student.getByRole('alert').waitFor();if(await student.getByRole('button',{name:'メイトルームを作る',exact:true}).count())throw Error('read failure permits creation');
  await student.unroute(origin+'/api/public-config');await student.getByRole('button',{name:'設定を再確認',exact:true}).click();
  await student.goto(origin+'/#/mate/new');await student.getByLabel('ニックネーム（1〜16文字）').fill('設定検証ホスト');
  const alcohol=student.getByRole('button',{name:'アルコール OFF',exact:true});
  const style=async locator=>locator.evaluate(e=>{const s=getComputedStyle(e),b=getComputedStyle(e.querySelector('span')),r=e.getBoundingClientRect();return {background:s.backgroundColor,color:s.color,badgeBackground:b.backgroundColor,badgeColor:b.color,width:r.width,height:r.height};});
  const off=await style(alcohol);await alcohol.click();const on=await style(student.getByRole('button',{name:'アルコール ON',exact:true}));
  if(off.background!==on.background||off.color!==on.color||on.badgeBackground===off.badgeBackground||on.badgeColor!=='rgb(255, 255, 255)'||off.height!==on.height)throw Error('alcohol visual states '+JSON.stringify({off,on}));
  await student.getByRole('button',{name:'アルコール ON',exact:true}).click();await student.getByRole('button',{name:'5問',exact:true}).click();
  await student.getByRole('button',{name:'メイトルームを作る',exact:true}).click();await student.getByRole('button',{name:'問題を準備して開始',exact:true}).waitFor();
  const watcher=await context.newPage();watcher.on('pageerror',record);await watcher.goto(origin+'/#/mate/new');await watcher.getByLabel('ニックネーム（1〜16文字）').waitFor();
  const code=new URL(student.url()).hash.match(/rooms\/([A-Z2-9]{6})/)[1],hostURL=student.url();
  await page.goto(origin+'/#/teacher');await page.getByRole('button',{name:'管理設定',exact:true}).click();
  const toggle=page.getByRole('switch',{name:'メイトマッチの新規作成を許可',exact:true});await toggle.waitFor();
  await page.waitForFunction(()=>document.querySelector('.mate-availability-card button[role="switch"]')?.getAttribute('aria-checked')==='true');
  const layouts=[];for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:844});const layout=await toggle.evaluate(e=>{const r=e.getBoundingClientRect();return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,height:r.height,right:r.right}});if(layout.overflow||layout.height<44||layout.right>width)throw Error('switch geometry '+JSON.stringify(layout));layouts.push(layout);}
  await page.route(origin+'/api/teacher/mate-setting',route=>route.request().method()==='PUT'?route.fulfill({status:503,contentType:'application/json',body:'{"error":"検証用保存エラー"}'}):route.continue());
  await toggle.click();await page.getByRole('alert').filter({hasText:'検証用保存エラー'}).waitFor();if(await toggle.getAttribute('aria-checked')!=='true')throw Error('failed save changed UI');
  await page.unroute(origin+'/api/teacher/mate-setting');await toggle.focus();await page.keyboard.press('Space');
  await page.getByText('新規作成を停止中',{exact:true}).waitFor();
  await watcher.evaluate(()=>window.dispatchEvent(new Event('focus')));await watcher.getByText('メイトマッチの新規作成は停止中です',{exact:true}).waitFor();
  await student.goto(origin+'/#/');
  const homeLink=student.locator('nav[aria-label="ルームを作成・管理する"] a').filter({hasText:'メイトマッチ'});await student.waitForFunction(()=>document.querySelector('nav[aria-label="ルームを作成・管理する"] a[aria-disabled="true"]'));
  if(await homeLink.getAttribute('href')!==null)throw Error('disabled home still links');
  await student.goto(origin+'/#/mate/new');await student.getByText('メイトマッチの新規作成は停止中です',{exact:true}).waitFor();if(await student.getByRole('button',{name:'メイトルームを作る',exact:true}).count())throw Error('direct route still permits creation');
  const denied=await student.evaluate(async()=>{const r=await fetch('/api/rooms',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'mate',nickname:'拒否検証',settings:{questionCount:5,timeLimitMinutes:3,mode:'name',difficulty:'easy',alcoholEnabled:false,gradingMode:'immediate'}})});return r.status;});if(denied!==403)throw Error('new mate API not denied '+denied);
  const guest=await context.newPage();guest.on('pageerror',record);await guest.goto(origin+'/#/join/'+code);await guest.getByLabel('ニックネーム（1〜16文字）').fill('既存ルーム参加');await guest.getByRole('button',{name:'参加する',exact:true}).click();await guest.getByRole('heading',{name:'開始を待っています',exact:true}).waitFor();
  await student.goto(hostURL);await student.getByRole('button',{name:'問題を準備して開始',exact:true}).click();await student.locator('.alkane-question').waitFor();
  await student.getByRole('button',{name:'中断',exact:true}).click();await student.getByRole('button',{name:'中断して結果を表示',exact:true}).click();await guest.getByRole('heading',{name:'中断時の結果',exact:true}).waitFor();
  await teacher.goto(origin+'/#/teacher');await teacher.getByRole('button',{name:'管理設定',exact:true}).click();const readonly=teacher.getByRole('switch',{name:'メイトマッチの新規作成を許可',exact:true});await teacher.getByText('新規作成を停止中',{exact:true}).waitFor();if(!await readonly.isDisabled())throw Error('registered teacher can change setting');
  await toggle.click();await page.getByText('新規作成を許可中',{exact:true}).waitFor();await student.goto(origin+'/#/');await student.locator('a[href="#/mate/new"]').waitFor();
  await page.reload();await page.getByRole('button',{name:'管理設定',exact:true}).click();await page.getByText('新規作成を許可中',{exact:true}).waitFor();
  if(errors.length)throw Error(errors.join('\n'));return {readFailureClosed:true,returnRefresh:true,failedSaveRetainsState:true,masterSavePersists:true,keyboardToggle:true,registeredTeacherReadonly:true,homeDisabled:true,directRouteBlocked:true,apiDenied:true,existingJoinStartResults:true,reenable:true,layouts,alcohol:{off,on},pageErrors:errors};
 }finally{await page.unroute(origin+'/api/teacher/mate-setting');await page.evaluate(async()=>{const session=await (await fetch('/api/auth/session')).json();await fetch('/api/teacher/mate-setting',{method:'PUT',headers:{'content-type':'application/json','x-competition-csrf':session.csrfToken},body:'{"enabled":true}'});});await context.close();await teacherContext.close();await page.unroute(origin+'/api/**');page.off('pageerror',record);}
}
