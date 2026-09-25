const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const server = fs.readFileSync('server.js','utf8');
const dbSource = fs.readFileSync('db.js','utf8');
function extract(source,start,end) { return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))); }
const batchCode=extract(dbSource,'async function importTracksBatched','// ─── Seed Default Effects');
test('abort between batches preserves committed work and prevents next batch',async()=>{
  const controller=new AbortController(), batches=[];
  const ctx=vm.createContext({importTracks:rows=>{batches.push(rows);return {inserted:rows.length};},yieldToEventLoop:async()=>controller.abort()});
  vm.runInContext(batchCode,ctx);
  await assert.rejects(ctx.importTracksBatched([1,2,3,4],{batchSize:2,signal:controller.signal}),{name:'AbortError'});
  assert.deepEqual(batches,[[1,2]]);
});
test('pre-aborted import writes nothing; normal import completes',async()=>{
  const controller=new AbortController();controller.abort();let writes=0;
  const ctx=vm.createContext({importTracks:rows=>{writes+=rows.length;return {inserted:rows.length};},yieldToEventLoop:async()=>{}});
  vm.runInContext(batchCode,ctx);
  await assert.rejects(ctx.importTracksBatched([1],{signal:controller.signal}),{name:'AbortError'});
  assert.equal(writes,0);
  const result=await ctx.importTracksBatched([1,2,3],{batchSize:2});
  assert.equal(result.inserted,3);assert.equal(result.total,3);
});
test('worker abort terminates worker, removes cache and ignores late result',async()=>{
  let worker,terminated=0,removed=0,loaded=0;
  class Worker extends EventEmitter {constructor(){super();worker=this;} async terminate(){terminated++;}}
  const ctx=vm.createContext({require:name=>name==='worker_threads'?{Worker}:require(name),
    __dirname:process.cwd(),process,path:require('node:path'),fs:{existsSync:()=>true,unlinkSync:()=>removed++},
    loadTracksFromWorkerMessage:()=>loaded++,setImmediate});
  vm.runInContext(extract(server,'function parseVdjDatabaseInWorker','async function runVdjLibraryImport'),ctx);
  const controller=new AbortController();
  const pending=ctx.parseVdjDatabaseInWorker('unused.xml',{signal:controller.signal});
  controller.abort(); worker.emit('message',{vdjParse:true,ok:true,tracks:[]});
  await assert.rejects(pending,{name:'AbortError'});
  assert.equal(terminated,1);assert.equal(removed,1);assert.equal(loaded,0);
});
function importHarness(controller) {
  const events=[],steps=[],configs=[];
  const ctx=vm.createContext({console:{log(){},error(){},warn(){}},vdjImportInProgress:false,
    isAlternateDjProviderActive:()=>false,planVdjImportOnStartup:()=>({run:true,xmlPath:'library.xml'}),
    vdjParser:{resolveDatabasePath:()=>({path:'library.xml'}),parseVdjDatabase:()=>{throw Error('must not fall back');}},
    db:{getConfig:()=> 'library.xml',setConfig:(...args)=>configs.push(args),importTracksBatched:async()=>{controller.abort();controller.signal.throwIfAborted();}},
    vdjDatabaseFingerprint:()=> 'fingerprint',fs:{statSync:()=>({mtimeMs:10})},
    parseVdjDatabaseInWorker:async()=>[1,2],broadcastVdjImportProgress(){},
    setBootStep:(...args)=>steps.push(args),broadcast:event=>events.push(event)});
  vm.runInContext(extract(server,'async function runVdjLibraryImport','async function loadVdjDatabaseAsync'),ctx);
  return {ctx,events,steps,configs};
}
test('cancelled import returns normally for startup, retains success metadata, releases busy flag',async()=>{
  const controller=new AbortController(),h=importHarness(controller);
  const result=await h.ctx.runVdjLibraryImport({updateBootStep:true,signal:controller.signal});
  assert.equal(result.cancelled,true);assert.equal(h.ctx.vdjImportInProgress,false);
  assert.equal(h.configs.length,0);assert.equal(h.steps.at(-1)[1],'cancelled');
  assert.equal(h.events.at(-1).phase,'cancelled');
});
test('startup worker error does not use blocking main-thread fallback',async()=>{
  const controller=new AbortController(),h=importHarness(controller);
  h.ctx.parseVdjDatabaseInWorker=async()=>{throw Error('worker unavailable');};
  const result=await h.ctx.runVdjLibraryImport({updateBootStep:true,signal:controller.signal});
  assert.equal(result.error,'worker unavailable');assert.equal(h.ctx.vdjImportInProgress,false);
});
test('index inline scripts compile',()=>{
  const html=fs.readFileSync('public/index.html','utf8');
  for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
});
test('boot only offers cancellation during library work and preserves cancelled state at ready',()=>{
  const ctx=vm.createContext({AbortController,Date,console:{log(){}},broadcast(){}});
  const bootCode=extract(server,'const startupImportController =','// ─── Event log');
  vm.runInContext(bootCode,ctx);
  assert.equal(ctx.bootSnapshot().canCancelImport,false);
  ctx.setBootStep('library','running','Parsing');
  assert.equal(ctx.bootSnapshot().canCancelImport,true);
  vm.runInContext('startupImportController.abort()',ctx);
  assert.equal(ctx.bootSnapshot().canCancelImport,false);
  assert.equal(ctx.bootSnapshot().importCancelRequested,true);
  ctx.setBootStep('library','cancelled','Stopped');ctx.markBootReady();
  assert.equal(ctx.bootSnapshot().ready,true);
  assert.equal(ctx.bootSnapshot().steps.find(s=>s.id==='library').status,'cancelled');
});
