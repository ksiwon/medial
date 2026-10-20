// node brand/desimer-logo/render.cjs <svg> <png> [scale]  — flat render on the cream paper colour, for looking at.
const fs=require('fs'),{chromium}=require('../../node_modules/playwright');
(async()=>{const [svg,png,sc]=process.argv.slice(2);const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1549,height:324},deviceScaleFactor:Number(sc||2)});
await p.setContent('<style>html,body{margin:0;background:#F6F1E8}svg{display:block}</style>'+fs.readFileSync(svg,'utf8'));
await p.screenshot({path:png});await b.close();})();
