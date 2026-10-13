// Pass the existing createAlkaneEngine() result as the second argument to decode
// displayed naming structures. The scenario never reads server-only answers.
async(page,engine)=>{
 const origin='http://localhost:8792',browser=page.context().browser(),reports=[],errors=[],networkFailures=[];
 const record=p=>{p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});p.on('requestfailed',r=>networkFailures.push(r.failure()?.errorText));};
 const check=(ok,message)=>{if(!ok)throw Error(message);};
 const describe=qs=>qs.map(q=>{const name=q.prompt.name??engine.generateName(q.prompt.grid).name;check(!!name,'cannot decode displayed structure');const summary=engine.namedGroupSummary(name);return {name,mode:q.prompt.mode,combination:summary.signature,carbons:summary.parentCarbonCount};});
 async function finish(p){if(await p.getByRole('button',{name:'全解答確認',exact:true}).count())await p.getByRole('button',{name:'全解答確認',exact:true}).click();await p.getByRole('button',{name:'このまま提出',exact:true}).click();await p.getByRole('button',{name:'提出を確定する',exact:true}).click();}
 for(const [mode,label]of [['arrange','並べる'],['name','名付ける'],['both','ランダム']]){
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true}),host=await context.newPage(),guestContext=await browser.newContext({viewport:{width:390,height:844},hasTouch:true}),guest=await guestContext.newPage();record(host);record(guest);
  let questions=null,hostQuestions=null;
  for(const [target,set]of [[host,q=>hostQuestions=q],[guest,q=>questions=q]])target.on('websocket',ws=>ws.on('framereceived',event=>{try{const message=JSON.parse(String(event.payload));if(message.state?.deferred?.questions)set(message.state.deferred.questions);}catch{}}));
  try{
   await host.goto(origin+'/#/mate/new');await host.getByLabel('ニックネーム（1〜16文字）').fill('出題検証');await host.getByRole('button',{name:'15問',exact:true}).click();await host.getByRole('button',{name:'3分',exact:true}).click();await host.getByRole('button',{name:label,exact:true}).click();await host.getByRole('button',{name:'まとめて判定',exact:true}).click();
   const alcoholOff=host.getByRole('button',{name:/アルコール.*OFF/});if(await alcoholOff.count())await alcoholOff.click();
   check(await host.getByRole('button',{name:'両方',exact:true}).count()===0,'old mixed label remains');
   const layouts=[];for(const width of [320,390,768,1280]){await host.setViewportSize({width,height:900});check(!await host.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'settings overflow '+width);const button=await host.getByRole('button',{name:'ランダム',exact:true}).boundingBox();check(button.width>=44&&button.height>=44,'random target too small');layouts.push(width);}
   await host.setViewportSize({width:390,height:844});await host.getByRole('button',{name:'メイトルームを作る',exact:true}).click();await host.getByRole('button',{name:'問題を準備して開始',exact:true}).waitFor();check((await host.locator('.settings-summary').first().textContent()).includes(label),'summary label mismatch');
   const code=new URL(host.url()).hash.match(/rooms\/([A-Z2-9]{6})/)[1];await guest.goto(origin+'/#/join/'+code);await guest.getByLabel('ニックネーム（1〜16文字）').fill('出題参加');await guest.getByRole('button',{name:'参加する',exact:true}).click();await guest.getByRole('heading',{name:'開始を待っています',exact:true}).waitFor();await host.getByRole('button',{name:'問題を準備して開始',exact:true}).click();await guest.getByRole('button',{name:'全解答確認',exact:true}).waitFor();
   check(questions?.length===15&&hostQuestions?.length===15,'missing prepared questions');const rows=describe(questions);check(JSON.stringify(rows)===JSON.stringify(describe(hostQuestions)),'participants received different questions');
   check(new Set(rows.map(q=>q.name)).size===15,'duplicate substance');for(let i=1;i<rows.length;i++)check(rows[i].combination!==rows[i-1].combination,'adjacent combination');
   const counts={arrange:rows.filter(q=>q.mode==='arrange').length,name:rows.filter(q=>q.mode==='name').length};if(mode==='both')check(Math.abs(counts.arrange-counts.name)===1,'mixed quota');else check(counts[mode]===15,'single mode changed');
   await guest.reload();await guest.getByRole('button',{name:'全解答確認',exact:true}).waitFor();check(JSON.stringify(describe(questions))===JSON.stringify(rows),'reload regenerated questions');
   for(const width of layouts){await guest.setViewportSize({width,height:900});check(!await guest.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'question overflow '+width);}
   await finish(guest);await finish(host);await host.getByRole('heading',{name:'最終結果',exact:true}).waitFor();
   reports.push({mode,label,counts,names:rows.map(q=>q.name),carbonSequence:rows.map(q=>q.carbons),unique:true,noAdjacentCombination:true,sameForPlayers:true,reloadStable:true,submissionResults:true,layouts});
  }finally{await guestContext.close();await context.close();}
 }
 check(!errors.length,errors.join('\n'));check(!networkFailures.length,networkFailures.join('\n'));return {reports,pageAndConsoleErrors:errors,networkFailures};
}
