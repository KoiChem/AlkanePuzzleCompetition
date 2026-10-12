async(page)=>{
 const origin='http://localhost:8792',layouts=[],errors=[];
 for(const viewport of [{width:320,height:568},{width:390,height:844},{width:1024,height:768},{width:1366,height:768}]){
  const context=await page.context().browser().newContext({viewport}),p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(()=>localStorage.setItem('alkane-lite:participant:ABCD23',JSON.stringify({code:'ABCD23',role:'participant',kind:'mate',token:'home-layout-fixture',participantId:'fixture',expiresAtMs:Date.now()+3600000})));
  let release;const gate=new Promise(resolve=>{release=resolve;});await p.route('**/api/rooms/ABCD23/state',async r=>{await gate;await r.fulfill({contentType:'application/json',body:JSON.stringify({room:{state:'FINISHED'}})});});
  try{await p.goto(origin+'/#/');await p.getByText('参加状況を確認しています…',{exact:true}).waitFor();await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const geometry=()=>p.evaluate(()=>Object.fromEntries(['.home-card','.join-form','.home-card nav'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return [selector,{top:r.top,height:r.height,left:r.left,width:r.width}];})));
   const before=await geometry();const text=await p.locator('#home-participation-status').evaluate(el=>{const r=el.getBoundingClientRect(),t=el.querySelector('p').getBoundingClientRect();return {contained:t.top>=r.top-.5&&t.bottom<=r.bottom+.5};});release();await p.getByText('参加状況を確認しています…',{exact:true}).waitFor({state:'hidden'});await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const after=await geometry();for(const selector of Object.keys(before))for(const key of ['top','height','left','width'])if(Math.abs(before[selector][key]-after[selector][key])>.5)throw Error('home layout shifted '+JSON.stringify({viewport,before,after}));if(!text.contained)throw Error('status text exceeds reserved slot');if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('horizontal overflow');layouts.push({viewport,before,after});
  }finally{release();await context.close();}
 }if(errors.length)throw Error(errors.join('\n'));return {layouts,pageErrors:errors};
}
