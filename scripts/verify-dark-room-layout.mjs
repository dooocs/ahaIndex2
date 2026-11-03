// Isolated layout checks: synthetic late-game fixtures never touch a user's
// browser/storage. Also boot the real app once in a fresh browser context.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const root = path.resolve('public');
const button = text => `<div class="button">${text}<div class="cooldown"></div></div>`;
const rows = (n, cls='storeRow') => Array.from({length:n},(_,i)=>`<div class="${cls}"><span class="row_key">资源 ${i}</span><span class="row_val">123</span></div>`).join('');
function fixture(scene) {
  const stores = `<div id="storesContainer"><div id="stores" data-legend="库存">${rows(28)}</div></div>`;
  let panel;
  if(scene==='room') panel = `${stores}<div id="stokeButton" class="button">添柴</div>` + ['buildBtns','craftBtns','buyBtns'].map((id,i)=>`<div id="${id}" data-legend="${['建筑物','制作','交易'][i]}">${Array.from({length:20},(_,n)=>button(`物品 ${n}`)).join('')}</div>`).join('');
  if(scene==='outside') panel = `${button('伐木')}<div id="workers">${rows(12,'workerRow')}</div><div id="village">${rows(10)}</div>`;
  if(scene==='path') panel = `${stores}<div id="pathScroller"><div id="outfitting">${rows(22,'outfitRow')}</div>${button('出发')}</div><div id="perks">${rows(8,'perkRow')}</div>`;
  if(scene==='fabricator') panel = `${stores}<div id="fabricateButtons">${Array.from({length:16},(_,i)=>button(`制造 ${i}`)).join('')}</div><div id="blueprints">${rows(10,'blueprintRow')}</div>`;
  if(scene==='world') panel = `<div id="worldOuter"><div id="bagspace-world">行囊</div><div id="map">${Array.from({length:61},()=>'.'.repeat(61)).join('<br>')}</div></div>`;
  if(scene==='combat') panel = `<div class="eventPanel"><div id="description"><div class="fighter">战斗</div></div><div id="buttons">${['攻击','治疗','逃跑','投掷'].map(button).join('')}</div></div>`;
  const id = scene==='combat' ? 'roomPanel' : `${scene}Panel`;
  const body = `<div id="wrapper"><div id="notifications">${rows(8)}</div><div id="content"><div id="outerSlider" style="width:700px"><div id="main"><div id="header">小黑屋 ｜ 静谧森林</div><div id="locationSlider" style="width:700px"><div class="location" id="${id}">${panel}</div></div></div></div></div></div><div class="menu"></div>`;
  return `<!doctype html><meta charset="utf-8">${['main','room','outside','path','world','fabricator','site'].map(n=>`<link rel="stylesheet" href="/dark-room/css/${n}.css">`).join('')}<link rel="stylesheet" href="/dark-room/lang/zh_cn/main.css"><link rel="stylesheet" href="/dark-room/css/site.css"><script src="/dark-room/lib/jquery.min.js"></script>${body}<script>window.Engine={activeModule:{panel:[$('#${id}')[0]]}};</script><script src="/dark-room/script/site-ui.js"></script>`;
}
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/__layout_fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture(url.searchParams.get('scene')));return;}
    const file=path.resolve(root, '.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(root+path.sep))throw Error('path');
    const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.flac':'audio/flac'};
    res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));
  } catch {res.statusCode=404;res.end('missing');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1657,height:900}});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  for(const scene of ['room','outside','path','fabricator','world','combat']) {
    await page.goto(`${origin}/__layout_fixture?scene=${scene}`);
    await page.waitForFunction(()=>document.documentElement.style.getPropertyValue('--game-stage-height'));
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const result=await page.evaluate(()=>{
      const rect=selector=>{const e=document.querySelector(selector),r=e?.getBoundingClientRect();return r?{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}:null;};
      return {viewport:innerWidth,wrapper:rect('#wrapper'),primary:rect('#stokeButton'),build:rect('#buildBtns'),craft:rect('#craftBtns'),buy:rect('#buyBtns'),stores:rect('#stores'),workers:rect('#workers'),village:rect('#village'),content:rect('#content'),room:rect('#roomPanel'),outfit:rect('#outfitting'),perks:rect('#perks'),fabricate:rect('#fabricateButtons'),blueprints:rect('#blueprints'),event:rect('.eventPanel'),buttons:[...document.querySelectorAll('.button')].map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),map:document.querySelector('#map')?{width:document.querySelector('#map').getBoundingClientRect().width,lineHeight:getComputedStyle(document.querySelector('#map')).lineHeight}:null};
    });
    assert(Math.abs((result.wrapper.left+result.wrapper.right)/2-result.viewport/2)<1,`${scene}: wrapper centering`);
    for(const b of result.buttons){assert(b.height>=44,`${scene}: button height`);assert.equal(b.width,136,`${scene}: button width`);}
    if(scene==='room'){
      assert(Math.abs((result.primary.left+result.primary.right)/2-result.viewport/2)<1,'primary action visually centered');
      assert(result.build.right<=result.craft.left&&result.craft.right<=result.buy.left&&result.buy.right<result.stores.left,'three action columns clear inventory');
      assert(result.content.bottom>=Math.max(result.room.bottom,result.stores.bottom),'long lists are not vertically clipped');
    }
    if(scene==='outside'){assert(result.workers.right<result.village.left,'workers clear village'); assert(result.workers.left>=136,'workers clear action buttons');}
    if(scene==='path')assert(result.outfit.right<result.perks.left,'outfitting clears perks');
    if(scene==='fabricator')assert(result.fabricate.left+136<result.blueprints.left&&result.blueprints.right<result.stores.left,'fabricator columns clear');
    if(scene==='world'){assert(result.map.width<=700,'map fits original slider');assert.equal(result.map.lineHeight,'10px');}
    if(scene==='combat')assert(Math.abs((result.event.left+result.event.right)/2-result.viewport/2)<1,'combat dialog centered');
    console.log(`PASS ${scene}`);
  }
  await page.setViewportSize({width:1024,height:768});await page.goto(`${origin}/__layout_fixture?scene=room`);
  await page.waitForFunction(()=>document.documentElement.style.getPropertyValue('--game-stage-height'));
  assert(await page.locator('#wrapper').evaluate(e=>Math.abs(e.getBoundingClientRect().left-32)<1),'1024px: centered 960px stage');
  await page.setViewportSize({width:768,height:768});await page.goto(`${origin}/__layout_fixture?scene=room`);
  assert(await page.locator('#stokeButton').evaluate(e=>e.getBoundingClientRect().height>=44),'narrow window keeps usable buttons');
  await page.setViewportSize({width:1657,height:787});await page.goto(`${origin}/dark-room/app.html?ignorebrowser=true`);
  await page.locator('#lightButton').waitFor({state:'visible'});
  assert(await page.locator('#lightButton').evaluate(e=>e.getBoundingClientRect().height>=44),'real app fresh boot');
  await page.waitForFunction(()=>document.documentElement.style.getPropertyValue('--game-stage-height'));
  assert(await page.evaluate(()=>document.documentElement.scrollHeight===innerHeight),'fresh game has no unnecessary vertical scrolling');
  assert.deepEqual(errors,[],'no page errors');
  console.log('PASS real first visit, 1024px and narrow-window layout');
} catch(error) { console.error(error);process.exitCode=1; }
finally {await browser?.close();await new Promise(r=>server.close(r));}
