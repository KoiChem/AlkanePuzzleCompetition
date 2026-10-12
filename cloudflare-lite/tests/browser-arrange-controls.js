async(page)=>{
 const origin='http://localhost:8792',errors=[];page.on('pageerror',e=>errors.push(e.message));
 const context=await page.context().browser().newContext({viewport:{width:320,height:568}}),g=await context.newPage();g.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(origin+'/#/mate/new');await page.getByLabel('ニックネーム（1〜16文字）').fill('並べる操作検証');await page.getByRole('button',{name:'5問',exact:true}).click();await page.getByRole('button',{name:'並べる',exact:true}).click();await page.getByRole('button',{name:'問題毎判定',exact:true}).click();await page.getByRole('button',{name:'メイトルームを作る',exact:true}).click();await page.getByRole('button',{name:'問題を準備して開始',exact:true}).waitFor();
  const code=new URL(page.url()).hash.match(/rooms\/([A-Z2-9]{6})/)[1];await g.goto(origin+'/#/join/'+code);await g.getByLabel('ニックネーム（1〜16文字）').fill('並べる参加');await g.getByRole('button',{name:'参加する',exact:true}).click();await g.getByRole('heading',{name:'開始を待っています'}).waitFor();await page.getByRole('button',{name:'問題を準備して開始',exact:true}).click();await g.locator('.arrange-immediate-actions button').first().waitFor();
  const layouts=[];for(const width of [320,390,768]){
   await g.setViewportSize({width,height:844});const buttons=await g.locator('.arrange-immediate-actions button').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {text:el.textContent,width:r.width,height:r.height,top:r.top};}));
   if(buttons.map(b=>b.text).join('/')!=='パス/クリア/解答チェック/全解答確認'||buttons.some(b=>b.height!==44||Math.abs(b.top-buttons[0].top)>1)||Math.abs(buttons[2].width/buttons[0].width-2)>.03||Math.abs(buttons[1].width-buttons[0].width)>1||Math.abs(buttons[3].width-buttons[0].width)>1)throw Error('incorrect arrange button layout '+JSON.stringify(buttons));layouts.push({width,buttons});
  }
  await g.setViewportSize({width:320,height:568});await g.screenshot({path:'/private/tmp/alkane-arrange-controls-320.png',fullPage:true});await g.getByRole('button',{name:'1級炭素',exact:true}).click();await g.getByRole('button',{name:'3行4列 空欄',exact:true}).click();await g.getByRole('button',{name:'クリア',exact:true}).click();if(await g.locator('.alkane-question [data-alkane-cell] svg').count())throw Error('clear failed');
  for(const p of [g,page]){await p.getByRole('button',{name:'全解答確認',exact:true}).click();await p.getByRole('button',{name:'このまま提出',exact:true}).click();await p.getByRole('button',{name:'提出を確定する',exact:true}).click();}await page.getByRole('heading',{name:'最終結果',exact:true}).waitFor();if(errors.length)throw Error(errors.join('\n'));return {layouts,clear:true,pageErrors:errors};
 }finally{await context.close();}
}
