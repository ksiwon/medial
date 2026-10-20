const fs=require('fs'),{chromium}=require('../../node_modules/playwright');
(async()=>{const [svg,png,x,w]=process.argv.slice(2);const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1549,height:324},deviceScaleFactor:3});
await p.setContent('<style>html,body{margin:0;background:#F6F1E8}svg{display:block}</style>'+fs.readFileSync(svg,'utf8'));
await p.screenshot({path:png,clip:{x:Number(x),y:0,width:Number(w),height:324}});await b.close();})();
