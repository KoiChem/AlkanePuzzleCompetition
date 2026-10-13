async(page)=>{
 const origin='http://localhost:8792',context=await page.context().browser().newContext({viewport:{width:390,height:844},hasTouch:true}),guest=await context.newPage(),errors=[];
 const record=e=>errors.push(e.message);page.on('pageerror',record);guest.on('pageerror',record);
 await context.addInitScript(()=>{
  window.__contexts=0;window.__tones=[];
  const AC=window.AudioContext;window.AudioContext=class extends AC{constructor(...args){super(...args);window.__contexts++;}};
  const create=AC.prototype.createOscillator;AC.prototype.createOscillator=function(){const oscillator=create.call(this),set=oscillator.frequency.setValueAtTime;oscillator.frequency.setValueAtTime=function(value,at){window.__tones.push(value);return set.call(this,value,at);};return oscillator;};
 });
 const check=(ok,message)=>{if(!ok)throw Error(message);},cell=guest.locator('.alkane-question [data-row="2"][data-col="3"]');
 async function pickup(){const b=await cell.boundingBox();await guest.mouse.move(b.x+b.width/2,b.y+b.height/2);await guest.mouse.down();await guest.waitForTimeout(450);check(await guest.locator('.alkane-panel-ghost').count()===1,'muting blocked pickup');await guest.mouse.up();}
 try{
  await page.goto(origin+'/#/mate/new');await page.getByLabel('ニックネーム（1〜16文字）').fill('音検証');await page.getByRole('button',{name:'5問',exact:true}).click();await page.getByRole('button',{name:'3分',exact:true}).click();await page.getByRole('button',{name:'並べる',exact:true}).click();await page.getByRole('button',{name:'問題毎判定',exact:true}).click();await page.getByRole('button',{name:'メイトルームを作る',exact:true}).click();await page.getByRole('button',{name:'問題を準備して開始',exact:true}).waitFor();
  const code=new URL(page.url()).hash.match(/rooms\/([A-Z2-9]{6})/)[1];await guest.goto(origin+'/#/join/'+code);await guest.getByLabel('ニックネーム（1〜16文字）').fill('音参加');await guest.getByRole('button',{name:'参加する',exact:true}).click();await guest.getByRole('heading',{name:'開始を待っています',exact:true}).waitFor();await page.getByRole('button',{name:'問題を準備して開始',exact:true}).click();await guest.getByRole('button',{name:'1級炭素',exact:true}).waitFor();
  await guest.getByRole('button',{name:'1級炭素',exact:true}).click();await cell.click();await guest.getByRole('button',{name:'1級炭素',exact:true}).click();await pickup();
  await guest.getByRole('button',{name:'解答チェック',exact:true}).click();await guest.waitForFunction(()=>window.__tones.includes(493.88));
  check(await guest.evaluate(()=>window.__contexts===1),'answer and pickup use separate contexts');
  await guest.evaluate(()=>{localStorage.setItem('alkane-puzzle-competition:sound-level','off');window.__tones=[];});await pickup();await guest.getByRole('button',{name:'解答チェック',exact:true}).click();await guest.waitForTimeout(500);
  check(await guest.evaluate(()=>window.__tones.length===0),'muted effects emitted audio');
  await guest.evaluate(()=>localStorage.setItem('alkane-puzzle-competition:sound-level','medium'));await pickup();
  check(JSON.stringify(await guest.evaluate(()=>window.__tones))==='[480,660]','unmuted pickup changed');check(!errors.length,errors.join('\n'));
  return {sharedContext:true,answerSound:true,mutedPickupAndAnswer:true,unmutedOriginalPickup:true,pageErrors:errors};
 }finally{await context.close();page.off('pageerror',record);}
}
