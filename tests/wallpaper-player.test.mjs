import test from 'node:test';
import assert from 'node:assert/strict';
import {createWallpaperPlayer} from '../dist/wallpaper-player.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const payload={bytes:new Uint8Array([1,2,3]),mime:'image/png'};
function scene(read=async()=>payload) {
  const live=new Set(),timers=new Map(),displayed=[],errors=[];let id=0,peak=0;
  const win={Blob,URL:{createObjectURL(){const url='blob:test-'+(++id);live.add(url);peak=Math.max(peak,live.size);return url;},revokeObjectURL:url=>{assert.ok(live.delete(url),'release exactly once');}},
    setTimeout:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),
    Image:class{set src(value){this.value=value;if(value)queueMicrotask(()=>{if(this.value===value)this.onload?.();});}}
  };
  const layers=[{style:{}},{style:{}}];
  const player=createWallpaperPlayer({win,layers,read,reduced:()=>false,onDisplay:(asset,url)=>displayed.push({asset,url}),onError:(error,asset)=>errors.push({error,asset})});
  return {player,live,displayed,errors,layers,peak:()=>peak,finishFade(){for(const [id,timer]of timers)if(timer.delay<1000){timers.delete(id);timer.fn();}}};
}

test('240 backgrounds keep at most two Blob URLs and release all retired images',async()=>{
  const state=scene();
  for(let i=0;i<240;i++){state.player.show({id:String(i),revision:'1',name:'背景'});await flush();assert.equal(state.errors.length,0);}
  assert.equal(state.peak(),2);assert.equal(state.live.size,2);assert.equal(state.player.diagnose().libraryImageCache,0);
  state.finishFade();assert.equal(state.live.size,1);assert.equal(state.displayed.at(-1).asset.id,'239');
  state.player.dispose();assert.equal(state.live.size,0);assert.equal(state.displayed.at(-1).url,null);
});

test('rapid navigation coalesces to the latest choice with only one read in flight',async()=>{
  const pending=[],calls=[];
  const state=scene(asset=>{calls.push(asset.id);return new Promise(resolve=>pending.push(resolve));});
  state.player.show({id:'first',revision:'1'});
  for(let i=0;i<1000;i++)state.player.show({id:'next-'+i,revision:'1'});
  assert.deepEqual(calls,['first']);pending.shift()(payload);await flush();
  assert.deepEqual(calls,['first','next-999']);assert.equal(state.live.size,0);
  pending.shift()(payload);await flush();assert.equal(state.displayed.at(-1).asset.id,'next-999');assert.equal(state.live.size,1);
  state.player.dispose();assert.equal(state.live.size,0);
});

test('failed images preserve the last display and late reads cannot revive a disposed player',async()=>{
  let resolveLate;
  const state=scene(asset=>asset.id==='bad'?Promise.reject(new Error('bad image')):asset.id==='late'?new Promise(resolve=>{resolveLate=resolve;}):Promise.resolve(payload));
  state.player.show({id:'good',revision:'1'});await flush();const shown=state.displayed.at(-1).url;
  state.player.show({id:'bad',revision:'1'});await flush();assert.equal(state.errors.length,1);assert.ok(state.live.has(shown));
  state.player.show({id:'late',revision:'1'});state.player.dispose();resolveLate(payload);await flush();assert.equal(state.live.size,0);assert.equal(state.displayed.at(-1).url,null);
});

test('clearing for another theme releases visible images and rejects the prior theme late read',async()=>{
  let resolveLate;
  const state=scene(asset=>asset.id==='late'?new Promise(resolve=>{resolveLate=resolve;}):Promise.resolve(payload));
  state.player.show({id:'old',revision:'1'});await flush();assert.equal(state.live.size,1);
  state.player.show({id:'late',revision:'1'});state.player.clear();assert.equal(state.live.size,0);assert.equal(state.displayed.at(-1).url,null);
  state.player.show({id:'new-theme',revision:'1'});resolveLate(payload);await flush();
  assert.equal(state.displayed.at(-1).asset.id,'new-theme');assert.equal(state.displayed.some(item=>item.asset?.id==='late'),false);assert.equal(state.live.size,1);
  state.player.dispose();assert.equal(state.live.size,0);
});
