// Optional WebKit runner: use an installed Playwright and its WebKit browser.
const {webkit}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs');
(async()=>{const browser=await webkit.launch({headless:true});try{const context=await browser.newContext();const page=await context.newPage();let source=fs.readFileSync(process.env.TEST_SCRIPT || __dirname+'/browser-tablet.js','utf8');if(process.env.TEST_ORIGIN)source=source.replace('http://localhost:8792',process.env.TEST_ORIGIN);const report=await (new Function('return ('+source+')'))()(page);console.log(JSON.stringify({engine:'Playwright WebKit, not physical iPadOS 17.7',...report}));}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1});
