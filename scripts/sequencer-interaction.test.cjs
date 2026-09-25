const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/js/sequencer.js', 'utf8');
function harness() {
  const handlers = {}, frames = new Map(), elements = new Map();
  let frameId = 0;
  function element(id) {
    if (!elements.has(id)) elements.set(id, { style: {}, dataset: {}, scrollLeft: 0,
      classList: { add() {}, remove() {}, toggle() {} },
      getBoundingClientRect: () => ({left: 0, top: 0}), appendChild(el) { elements.set(el.id, el); },
      addEventListener(type, fn) { handlers[id+':'+type] = fn; } });
    return elements.get(id);
  }
  const ctx = vm.createContext({ console, Map, Set, Math, Object, Promise,
    currentSeq: {bpm:120}, currentId:1, snapBeats:1, wfAnalysis:null, zoomPxPerSec:100,
    cues:[], selectedIds:new Set(), selectedPrimary:null, dragState:null, marquee:null,
    activeLanes:new Set(), cancelTimelineInteraction:null, saves:[], history:[], paints:0, renders:0,
    $:element, $$:() => [], on:(id,type,fn) => handlers[id+':'+type] = fn,
    document:{ addEventListener:(type,fn) => handlers[type] = fn, elementFromPoint:() => null, createElement:() => element('new') },
    window:{addEventListener:(type,fn) => handlers[type] = fn},
    requestAnimationFrame:fn => { frames.set(++frameId,fn); return frameId; },
    cancelAnimationFrame:id => frames.delete(id),
    updateSelectionVisuals() {}, updateProps() {}, clearSelection() {}, selectCue() {},
    buildCueIndex() {}, buildLaneList:() => [], alert() {},
  });
  vm.runInContext(`function apiPut(url,body) { saves.push({url,body}); return Promise.resolve({}); }
    function paintVisibleCues() { paints++; } function renderTimeline() { renders++; }
    function pushUndo(label,undo,redo) { history.push({label,undo,redo}); }`,ctx);
  const helpers = source.slice(source.indexOf('  let snapCache ='),source.indexOf('  // ── API'));
  const events = source.slice(source.indexOf('    // Cache gesture references'),source.indexOf('    // ── Keyboard Shortcuts'));
  vm.runInContext(helpers+events,ctx);
  return {ctx,handlers,frames,element,run:code => vm.runInContext(code,ctx)};
}
function drag(h, type='move') {
  h.run(`cues = [{id:1,start_ms:1000,duration_ms:1000,fixture_id:1}, {id:2,start_ms:1250,duration_ms:750,fixture_id:1}];
    dragState = {type:'${type}',startX:0,startY:0,scrollLeft:0,zoom:100,anchor:1000,minStart:1000,primaryIndex:0,
    items:cues.map(c => ({cue:c,before:{...c}})),line:{style:{}},trackLeft:140,sequenceId:1,moved:false,target:null};`);
}
const pointer = (x,y=0) => ({button:0,clientX:x,clientY:y});
test('uniform, offset, disabled and fluid subdivision snapping; cache invalidation', () => {
  const h = harness();
  assert.equal(h.run('snapToGrid(760)'),1000);
  assert.equal(h.run('currentSeq.beat_offset_ms=100; snapToGrid(760)'),600);
  assert.equal(h.run('snapBeats=0; snapToGrid(761)'),761);
  assert.equal(h.run('snapBeats=.5; wfAnalysis={beats:[0,400,1000]}; snapToGrid(790)'),800);
  assert.equal(h.run('currentSeq.beat_offset_ms=0; snapToGrid(790)'),700);
  assert.equal(h.run('wfAnalysis={beats:[0,600,1400]}; snapToGrid(790)'),600);
  assert.equal(h.run('snapBeats=4; wfAnalysis={beats:[0,500,1000,1500,2000]}; snapToGrid(1800)'),2000);
});
test('group movement preserves offsets and clamps whole group; includes unrendered cues', () => {
  const h = harness(); drag(h);
  assert.deepEqual(Array.from(h.run('interactionValues(dragState,60)'),v => v.start_ms),[1500,1750]);
  assert.deepEqual(Array.from(h.run('interactionValues(dragState,-200)'),v => v.start_ms),[0,250]);
});
test('click and resize-handle click do not save, create undo or redraw', async () => {
  for (const type of ['move','resize']) {
    const h = harness(); drag(h,type); await h.handlers.mouseup(pointer(0));
    assert.equal(h.ctx.saves.length,0); assert.equal(h.ctx.history.length,0);
    assert.equal(h.ctx.renders,0); assert.equal(h.ctx.paints,0);
  }
});
test('mousemove coalesces; release flushes latest position; undo/redo preserves group',async () => {
  const h=harness(); drag(h);
  h.handlers.mousemove(pointer(20)); h.handlers.mousemove(pointer(30));
  assert.equal(h.frames.size,1); assert.equal(h.ctx.dragState.values,undefined);
  await h.handlers.mouseup(pointer(60));
  assert.equal(h.frames.size,0); assert.equal(h.ctx.dragState,null);
  assert.deepEqual(Array.from(h.ctx.cues,c=>c.start_ms),[1500,1750]);
  assert.equal(h.ctx.renders,0); assert.equal(h.ctx.history.length,1);
  await h.ctx.history[0].undo(); assert.deepEqual(Array.from(h.ctx.cues,c=>c.start_ms),[1000,1250]);
  await h.ctx.history[0].redo(); assert.deepEqual(Array.from(h.ctx.cues,c=>c.start_ms),[1500,1750]);
});
test('resize preview values equal commit and minimum duration is enforced',async () => {
  const h=harness(); drag(h,'resize');
  h.run('previewInteraction({clientX:60,clientY:0})');
  const expected=Array.from(h.ctx.dragState.values,v=>v.duration_ms);
  await h.handlers.mouseup(pointer(60));
  assert.deepEqual(Array.from(h.ctx.cues,c=>c.duration_ms),expected);
  drag(h,'resize'); assert.ok(Array.from(h.run('interactionValues(dragState,-500)'),v=>v.duration_ms).every(v=>v===100));
});
test('blur cancels pending frame without persistence',() => {
  const h=harness(); drag(h); h.handlers.mousemove(pointer(60)); h.handlers.blur();
  assert.equal(h.frames.size,0); assert.equal(h.ctx.dragState,null); assert.equal(h.ctx.saves.length,0);
});
test('partial save failure retains only successful cues and undo',async () => {
  const h=harness(); drag(h);
  h.run(`apiPut = async (url,body) => url.endsWith('/2') ? {error:'failed'} : {};`);
  await h.handlers.mouseup(pointer(60));
  assert.deepEqual(Array.from(h.ctx.cues,c=>c.start_ms),[1500,1250]);
  assert.equal(h.ctx.dragState,null); assert.equal(h.ctx.history.length,1);
  await h.ctx.history[0].undo(); assert.deepEqual(Array.from(h.ctx.cues,c=>c.start_ms),[1000,1250]);
});
test('cross-lane move persists fixture with timing and undo restores both',async () => {
  const h=harness(); drag(h);
  const target=h.element('target'); target.dataset.fix='9';
  h.ctx.document.elementFromPoint=()=>({closest:()=>target});
  await h.handlers.mouseup(pointer(60,30));
  assert.deepEqual(Array.from(h.ctx.cues,c=>c.fixture_id),[9,9]);
  assert.equal(h.ctx.renders,1);
  await h.ctx.history[0].undo();
  assert.deepEqual(Array.from(h.ctx.cues,c=>[c.start_ms,c.fixture_id]),[[1000,1],[1250,1]]);
});
test('marquee uses scrolled container coordinates, retains additive selection and flushes release',async () => {
  const h=harness();
  h.element('tlLanes').getBoundingClientRect=()=>({left:-100,top:-50});
  h.element('tlScroll').scrollLeft=100;
  h.run(`marquee={start:{x:110,y:60},base:new Set([7]),el:{style:{}},items:[
    {id:1,rect:{left:120,right:140,top:70,bottom:90},el:{classList:{toggle(){}}}},
    {id:2,rect:{left:200,right:220,top:70,bottom:90},el:{classList:{toggle(){}}}}
  ]};`);
  h.handlers.mousemove(pointer(150,70));
  await h.handlers.mouseup(pointer(50,50));
  assert.deepEqual(Array.from(h.ctx.selectedIds),[7,1]);
  assert.equal(h.frames.size,0); assert.equal(h.ctx.marquee,null);
});
test('network failure clears gesture and leaves failed cue unchanged',async () => {
  const h=harness(); drag(h);
  h.run(`apiPut=async()=>{throw new Error('offline')};`);
  await h.handlers.mouseup(pointer(60));
  assert.equal(h.ctx.dragState,null); assert.equal(h.ctx.history.length,0);
  assert.deepEqual(Array.from(h.ctx.cues,c=>c.start_ms),[1000,1250]);
});
test('real mouse-down lifecycle accepts a browser NodeList without Array.map',async () => {
  const h=harness();
  const track=h.element('track'), cueEl=h.element('cue');
  cueEl.dataset.cue='1';
  cueEl.closest=selector=>selector==='.tl-cue'?cueEl:track;
  cueEl.classList.contains=()=>false;
  // querySelectorAll returns an iterable NodeList, not an Array.
  h.ctx.$$=()=>({0:cueEl,length:1,[Symbol.iterator]:function*(){yield cueEl;}});
  h.run('cues=[{id:1,start_ms:1000,duration_ms:1000,fixture_id:1}]; selectedIds=new Set([1]);');
  h.handlers['tlLanes:mousedown']({...pointer(0),target:cueEl,preventDefault(){}});
  assert.equal(h.ctx.dragState.type,'move');
  assert.equal(h.ctx.dragState.items[0].el,cueEl);
  h.handlers.mousemove(pointer(60));
  await h.handlers.mouseup(pointer(60));
  assert.equal(h.ctx.cues[0].start_ms,1500);
  assert.equal(h.ctx.saves.length,1);
  assert.equal(h.ctx.history.length,1);
});
test('marquee mouse-down accepts a browser NodeList without Array.map',async () => {
  const h=harness(),cueEl=h.element('cue'),track=h.element('track');
  cueEl.dataset.cue='1';
  cueEl.getBoundingClientRect=()=>({left:20,right:40,top:20,bottom:40});
  h.ctx.$$=()=>({0:cueEl,length:1,[Symbol.iterator]:function*(){yield cueEl;}});
  const target={closest:selector=>selector==='.tl-cue'?null:track};
  h.handlers['tlLanes:mousedown']({...pointer(0),target,preventDefault(){}});
  assert.equal(h.ctx.marquee.items.length,1);
  await h.handlers.mouseup(pointer(60,60));
  assert.deepEqual(Array.from(h.ctx.selectedIds),[1]);
});
