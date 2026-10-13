async(page)=>{
 const origin='http://localhost:8792'; // Fixture-only: never modify public profiles.
 const context=await page.context().browser().newContext({viewport:{width:390,height:844}}),host=await context.newPage(),guest=await context.newPage();
 await host.goto(origin);
 const initial=await(await host.request.get(origin+'/api/question-profile')).json();
 const secret='A'.repeat(43),csrf=await host.evaluate(async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join(''),secret+':csrf');
 const headers={cookie:'__Host-alkane-lite-session='+secret,'x-competition-csrf':csrf,origin};
 const changed=structuredClone(initial.profile);changed.rules.arrange.easy.alcoholRate=100;changed.rules.name.easy.alcoholRate=100;
 try{
  const r=await host.request.put(origin+'/api/teacher/question-profile',{headers,data:{revision:initial.revision,profile:changed}});if(!r.ok())throw Error('fixture profile update failed '+await r.text());
  await host.goto(origin+'/#/mate/new');await host.getByLabel('ニックネーム（1〜16文字）').fill('準備ホスト');await host.getByRole('button',{name:'5問',exact:true}).click();await host.getByRole('button',{name:'ランダム',exact:true}).click();await host.getByRole('button',{name:/アルコール.*OFF/}).click();await host.getByRole('button',{name:'メイトルームを作る',exact:true}).click();await host.getByRole('button',{name:'問題を準備して開始',exact:true}).waitFor();
  const code=new URL(host.url()).hash.match(/rooms\/([A-Z2-9]{6})/)[1];await guest.goto(origin+'/#/join/'+code);await guest.getByLabel('ニックネーム（1〜16文字）').fill('準備参加');await guest.getByRole('button',{name:'参加する',exact:true}).click();await guest.getByRole('heading',{name:'開始を待っています',exact:true}).waitFor();
  await host.getByRole('button',{name:'問題を準備して開始',exact:true}).click();await host.getByText(/重複・連続を避けた問題を準備できませんでした/).waitFor();if(!await host.getByRole('button',{name:'問題を準備して開始',exact:true}).isEnabled())throw Error('preparation failure blocked retry');
  await host.getByText('競技設定を変更',{exact:true}).click();await host.getByRole('button',{name:/アルコール.*ON/}).click();await host.getByRole('button',{name:'設定を保存',exact:true}).click();await host.getByRole('button',{name:'問題を準備して開始',exact:true}).click();await guest.locator('.alkane-question').waitFor();
  await host.getByRole('button',{name:'中断',exact:true}).click();await host.getByRole('button',{name:'中断して結果を表示',exact:true}).click();await host.getByRole('heading',{name:'中断時の結果',exact:true}).waitFor();
  return {usefulError:true,waitingAfterFailure:true,settingsRetry:true,startedAfterRetry:true};
 }finally{const current=await(await host.request.get(origin+'/api/question-profile')).json();await host.request.put(origin+'/api/teacher/question-profile',{headers,data:{revision:current.revision,profile:initial.profile}});await context.close();}
}
