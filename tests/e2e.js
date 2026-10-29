// Запуск: NODE_PATH=$(npm root -g) node tests/e2e.js  (нужен playwright; node_modules в репо не хранится)
const {chromium}=require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert');
const HTML=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const EP=HTML.match(/const SHEET_ENDPOINT = '([^']*)';/)[1];
// '/' — страница с плейсхолдером (проверка «не настроено»), '/ep.html' — страница как в репо (реальный URL)
const HTML_PH=HTML.replace("'"+EP+"'","'REPLACE_WITH_WEB_APP_URL'");
const srv=http.createServer((q,r)=>{
  if(q.url==='/'||q.url.startsWith('/?')){r.setHeader('content-type','text/html; charset=utf-8');return r.end(HTML_PH);}
  if(q.url==='/ep.html'){r.setHeader('content-type','text/html; charset=utf-8');return r.end(HTML);}
  r.statusCode=404;r.end();
});
(async()=>{
await new Promise(r=>srv.listen(0,r));
const base='http://127.0.0.1:'+srv.address().port;
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:375,height:800},acceptDownloads:true});
const p=await ctx.newPage();
const errs=[];
p.on('console',m=>{if(m.type()==='error')errs.push('console:'+m.text())});
p.on('pageerror',e=>errs.push('pageerror:'+e.message));
// ни один запрос не уходит на настоящий script.google.com
await ctx.route('https://script.google.com/**',r=>r.fulfill({status:200,body:'ok'}));
const posts=[];
await p.route(EP,r=>{ if(r.request().method()==='POST') posts.push({body:r.request().postData(),ct:r.request().headers()['content-type']}); return r.fulfill({status:200,body:'ok'}); });
const k=s=>p.locator('[data-k="'+s+'"]');

// --- заполнение
await p.goto(base+'/ep.html');
await p.fill('[data-k=name]','Luis Prueba');
await k('q16_g0_othertxt').fill('cada martes');           // «Другое» в радио
assert(await p.locator('[data-k=q16_g0][value=other]').isChecked(),'radio other auto-checked');
await k('q2_g0_othertxt').fill('internet para casas rurales');           // checkbox №2
await k('q6_g0_othertxt').fill('CRM propio');             // checkbox №6
await k('q24_g0_other_pct').fill('7');
await k('q24_g0_othertxt').fill('criptomoneda');
await k('q24_g0_o0_pct').fill('80');
assert(await k('q24_g0_o0').isChecked(),'pct auto-checks option');
await p.locator('[data-k=q28_g0]').first().check();
await p.locator('[data-k=q29_g1][value=o0]').check();
await k('q29_g0_othertxt').count(); // нет other у №29 — не должно падать
await k('s0_chk').check();
await k('s0_c').fill('ejemplo anonimizado, archivo invoice.pdf');
await k('s8_c').fill('solo sin salir de la UE');

// --- испанский, без кириллицы
assert.equal(await p.getAttribute('html','lang'),'es');
assert(!/[А-Яа-яЁё]/.test(await p.evaluate(()=>document.body.innerText)),'no cyrillic in page');
assert.equal(await p.locator('text=Otro').count()>0,true);

// --- перезагрузка
await p.reload();
assert.equal(await k('name').inputValue(),'Luis Prueba');
assert.equal(await k('q16_g0_othertxt').inputValue(),'cada martes');
assert(await p.locator('[data-k=q16_g0][value=other]').isChecked());
assert.equal(await k('q2_g0_othertxt').inputValue(),'internet para casas rurales');
assert(await k('q2_g0_other').isChecked());
assert.equal(await k('q6_g0_othertxt').inputValue(),'CRM propio');
assert.equal(await k('q24_g0_other_pct').inputValue(),'7');
assert.equal(await k('s0_c').inputValue(),'ejemplo anonimizado, archivo invoice.pdf');

// --- экспорт файлов
await p.evaluate(()=>{document.querySelector('#bDl').scrollIntoView();});
const dls=[];p.on('download',d=>dls.push(d));
await p.click('#bDl'); await p.waitForTimeout(1200);
assert.equal(dls.length,2);
let txtF,jsonF;
for(const d of dls){const t=fs.readFileSync(await d.path(),'utf8'); if(d.suggestedFilename().endsWith('.txt'))txtF=t; else jsonF=t;}
for(const need of ['cada martes','internet para casas rurales','CRM propio','criptomoneda','7 %','80 %','Luis Prueba','invoice.pdf'])
  assert(txtF.includes(need),'txt has '+need);
assert(!txtF.includes('(marcado)'),'no bare marker');
for(const need of ['Otro: cada martes','Cuestionario para Luis','Fecha de cumplimentación','Nombre: Luis Prueba','— sin respuesta —'])
  assert(txtF.includes(need),'txt es: '+need);
assert(!/[А-Яа-яЁё]/.test(txtF),'no cyrillic in txt');
const fn=dls.map(d=>d.suggestedFilename());
assert(fn.every(f=>/^ghofi-cuestionario-respuestas-\d{4}-\d{2}-\d{2}\.(txt|json)$/.test(f)),'filenames '+fn);
assert(jsonF.includes('cada martes'));
const J=JSON.parse(jsonF);
const q16=J.sections[2].questions.find(q=>q.n===16).groups[0];
assert.equal(q16.other,'cada martes');
assert.equal(J.name,'Luis Prueba');
// копирование
await ctx.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});
await p.click('#bCp');await p.waitForTimeout(300);
assert((await p.evaluate(()=>navigator.clipboard.readText())).includes('cada martes'));

// --- отправка
await p.click('#bSend'); await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('gracias'));
await p.click('#bSend'); await p.waitForFunction(()=>true); await p.waitForTimeout(300);
assert.equal(posts.length,2);
assert(posts[0].ct.startsWith('text/plain'));
const b0=JSON.parse(posts[0].body),b1=JSON.parse(posts[1].body);
assert(b0.submission_id&&b0.submission_id===b1.submission_id,'stable sid');
assert(b0.answers_text.includes('cada martes'));
assert.equal(b0.name,'Luis Prueba');
assert(/^\d+\/59 \(★ \d+\/\d+\)$/.test(b0.progress),b0.progress);
assert.equal(b0.answers.sections[2].questions.find(q=>q.n===16).groups[0].other,'cada martes');
assert.equal(await p.textContent('#status'),'¡Respuestas enviadas, gracias!');
// «Очистить» не сбрасывает sid
p.once('dialog',d=>d.accept()); await p.click('#bClr');
assert.equal(await k('q16_g0_othertxt').inputValue(),'');
await p.click('#bSend'); await p.waitForTimeout(400);
assert.equal(JSON.parse(posts[2].body).submission_id,b0.submission_id);

// --- reject
assert.deepEqual(errs,[],'console errors: '+errs);
await p.unroute(EP); await p.route(EP,r=>r.abort());
await p.click('#bSend'); await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('Descargar respuestas'));
assert(!(await p.locator('#bSend').isDisabled()),'button re-enabled');
errs.length=0; // сетевой сбой в этом шаге вызван намеренно

assert.equal(await p.evaluate(()=>document.title),'Cuestionario para Luis: clientes, facturas, banco');

// --- плейсхолдер
const p2=await ctx.newPage(); let called=false;
p2.on('request',r=>{if(r.method()==='POST')called=true});
p2.on('pageerror',e=>errs.push('pageerror:'+e.message));
await p2.goto(base+'/'); await p2.click('#bSend');
assert((await p2.textContent('#status')).includes('El envío aún no está configurado'));
assert(!called);
// mailto
const href=await p2.getAttribute('#bMail','href');
assert(href.startsWith('mailto:podgoretskiy@gmail.com?subject=')&&href.length<800);
assert(decodeURIComponent(href).includes('Cuestionario GhoFi — respuestas de Luis'));

// --- скролл
for(const w of [375,1280]){
  for(const pg of [p2]){
    await pg.setViewportSize({width:w,height:800});
    await pg.goto(base+'/ep.html');
    await pg.fill('[data-k=q16_g0_othertxt]','palabra-muy-larga-'.repeat(8));
    await pg.fill('[data-k=name]','x'.repeat(200));
    const m=await pg.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);
    assert(m[0]<=m[1],'hscroll at '+w+': '+m);
  }
}
assert.deepEqual(errs,[],'console errors: '+errs);
console.log('ALL OK');
await b.close();srv.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
