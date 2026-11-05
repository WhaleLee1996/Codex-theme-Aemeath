import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {startTheme} from './theme-fixture.mjs';
import {fixture,services} from './fixtures.mjs';
const tick=()=>new Promise(resolve=>setTimeout(resolve,60));
async function setup(t,configuration={}) {
  const dom=new JSDOM(fixture,{url:'https://local.test/',pretendToBeVisual:true}),win=dom.window;
  let snapshot={folder:'D:\\pictures',images:Array.from({length:1200},(_,i)=>({id:String(i),revision:'1',name:'图片 '+i}))};
  const reads=[],saves=[];let chosen=null,opens=0,scans=0,failId=null;
  win.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};win.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  win.electronBridge={getSentryInitOptions:()=>({appVersion:'26.1027.30824'})};
  win.aemeathWish={readSettings:async()=>({config:{schemaVersion:5,glowMode:'manual',...configuration}}),getBackgrounds:async()=>{scans++;return snapshot;},readImage:async id=>{reads.push(id);if(id===failId)throw new Error('bad image');return{bytes:new Uint8Array([1]),mime:'image/png'};},chooseBackgroundFolder:async()=>chosen,openBackgroundFolder:async()=>{opens++;},saveSettings:async value=>{saves.push(value);},diagnostics:async()=>({})};
  const api=await startTheme(win,{shared:{Vct:services().service}});
  t.after(()=>{api.dispose();win.close();});await tick();
  const root=win.document.querySelector('aemeath-wish-theme').shadowRoot;
  return {win,api,root,reads,saves,setSnapshot(value){snapshot=value;},choose(value){chosen=value;},fail(id){failId=id;},counts:()=>({opens,scans}),click(action){root.querySelector(`[data-action="${action}"]`).click();}};
}

test('opening settings for 1200 backgrounds loads one image and uses one preview, not a gallery',async t=>{
  const state=await setup(t);assert.deepEqual(state.reads,['0']);
  state.root.querySelector('[data-tab="background"]').click();await tick();
  assert.deepEqual(state.reads,['0']);assert.equal(state.root.querySelector('.aw-thumbnails'),null);
  assert.equal(state.root.querySelectorAll('.aw-background-preview').length,1);assert.match(state.root.querySelector('.aw-folder-count').textContent,/1200/);
  state.click('next');await tick();assert.deepEqual(state.reads,['0','1']);
  state.click('open-folder');await tick();assert.equal(state.counts().opens,1);
  await new Promise(resolve=>setTimeout(resolve,350));assert.equal(state.saves.at(-1).schemaVersion,7);assert.equal('wallpaperIds' in state.saves.at(-1),false);
});

test('folder changes, image replacement, empty directories and cancellation keep playback coherent',async t=>{
  const state=await setup(t);state.click('choose-folder');await tick();assert.deepEqual(state.reads,['0']);
  const changed={folder:'D:\\other',images:[{id:'new',revision:'1',name:'新图'}]};
  state.choose(changed);state.setSnapshot(changed);state.click('choose-folder');await tick();assert.equal(state.reads.at(-1),'new');
  assert.equal(state.root.querySelector('.aw-folder-path').textContent,'D:\\other');
  const oldPreview=state.root.querySelector('.aw-background-preview').src;
  state.setSnapshot({...changed,images:[{...changed.images[0],revision:'2'}]});state.click('refresh-backgrounds');await tick();
  assert.notEqual(state.root.querySelector('.aw-background-preview').src,oldPreview);
  const held=state.root.querySelector('.aw-background-preview').src;
  state.setSnapshot({folder:'D:\\other',images:[],warning:'文件夹内暂无可用图片，轮播暂停'});state.click('refresh-backgrounds');await tick();
  assert.equal(state.root.querySelector('.aw-background-preview').src,held);assert.equal(state.root.querySelector('[data-action="next"]').disabled,true);
  state.setSnapshot(changed);state.click('refresh-backgrounds');await tick();assert.equal(state.root.querySelector('[data-action="next"]').disabled,false);
});

test('corrupt images are skipped and metadata refresh does not restart a long carousel interval',async t=>{
  const original=globalThis.setTimeout;let carouselSchedules=0;
  globalThis.setTimeout=(fn,delay,...args)=>{if(delay===120000)carouselSchedules++;return original(fn,delay,...args);};
  t.after(()=>{globalThis.setTimeout=original;});
  const state=await setup(t,{duration:120,playing:true});const before=carouselSchedules;
  for(let i=0;i<3;i++){state.click('refresh-backgrounds');await tick();}
  assert.equal(carouselSchedules,before,'metadata polling must not postpone the next slide');
  state.fail('bad');const changed={folder:'D:\\bad-and-good',images:[{id:'bad',revision:'1'},{id:'good',revision:'1',name:'好图'}]};
  state.choose(changed);state.setSnapshot(changed);state.click('choose-folder');await tick();
  assert.equal(state.reads.at(-1),'good');assert.match(state.root.querySelector('.aw-folder-warning').textContent,/1 张图片/);
});

async function themedSetup(t, saved) {
  const dom=new JSDOM(fixture,{url:'https://local.test/',pretendToBeVisual:true}),win=dom.window;
  const catalogs=Object.fromEntries(['rose','plum'].map(theme=>[theme,{theme,folder:'D:\\'+theme,legacyCurrentId:'obsolete-import-id',images:[0,1,2].map(i=>({id:theme+'-'+i,revision:'1',name:theme+' '+i}))}]));
  const reads=[],saves=[],pending=new Map();let choose=null;
  win.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};win.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  win.electronBridge={getSentryInitOptions:()=>({appVersion:'26.1027.30824'})};
  win.aemeathWish={
    readSettings:async()=>({config:saved??{schemaVersion:6,theme:'plum',glowMode:'manual',wallpaperId:'plum-2',opacity:10,sidebarBlur:3,duration:30}}),
    getBackgrounds:async theme=>{assert.ok(theme in catalogs);const wait=pending.get(theme);if(wait){pending.delete(theme);await wait.promise;}return catalogs[theme];},
    readImage:async(id,revision,theme)=>{assert.ok(id.startsWith(theme+'-'));reads.push({id,theme});return{bytes:new Uint8Array([1]),mime:'image/png'};},
    saveSettings:async value=>{saves.push(value);},diagnostics:async()=>({}),
    chooseBackgroundFolder:async theme=>choose?choose(theme):null,
    importSettings:async()=>saved
  };
  const api=await startTheme(win,{shared:{Vct:services().service}});t.after(()=>{api.dispose();win.close();});await tick();
  const root=win.document.querySelector('aemeath-wish-theme').shadowRoot;
  return {win,api,root,catalogs,reads,saves,
    async theme(name){root.querySelector(`[data-theme="${name}"]`).click();await tick();},
    async set(key,value){const input=root.querySelector(`[data-setting="${key}"]`);input.value=String(value);input.dispatchEvent(new win.Event('input',{bubbles:true}));await tick();},
    async action(name){root.querySelector(`[data-action="${name}"]`).click();await tick();},
    hold(theme){let release;const promise=new Promise(r=>{release=r;});pending.set(theme,{promise});return release;},
    chooseWith(fn){choose=fn;}
  };
}

test('theme switching restores glass, slideshow and last image independently, including restart and zero opacity',async t=>{
  const state=await themedSetup(t);assert.equal(state.reads.at(-1).id,'plum-2','v6 folder IDs must not be replaced by old import migration metadata');
  await state.set('opacity',0);await state.set('sidebarBlur',1);await state.set('haloBlur',2);await state.set('haloWidth',28);await state.set('duration',15);await state.set('dim',0);
  await state.theme('rose');assert.equal(state.reads.at(-1).id,'rose-0');
  await state.set('opacity',85);await state.set('sidebarBlur',14);await state.set('duration',60);await state.set('dim',25);await state.action('next');await state.action('play');await state.set('order','random');
  assert.match(state.root.querySelector('.aw-setting-scope').textContent,/浅粉/);
  await state.theme('plum');assert.equal(state.reads.at(-1).id,'plum-2');
  for(const [key,value] of Object.entries({opacity:0,sidebarBlur:1,haloBlur:2,haloWidth:28,duration:15,dim:0,order:'sequence'}))assert.equal(state.root.querySelector(`[data-setting="${key}"]`).value,String(value),key);
  assert.equal(state.root.querySelector('.aw-play').textContent,'播放轮播');
  assert.equal(state.win.document.documentElement.style.getPropertyValue('--aw-opacity'),'0');
  await new Promise(r=>setTimeout(r,350));const saved=state.saves.at(-1);
  assert.equal(saved.themeAdjustments.rose.opacity,85);assert.equal(saved.themeAdjustments.rose.wallpaperId,'rose-1');assert.equal(saved.themeAdjustments.rose.playing,true);
  state.api.dispose();const reopened=await themedSetup(t,saved);assert.equal(reopened.reads.at(-1).id,'plum-2');
  await reopened.theme('rose');assert.equal(reopened.reads.at(-1).id,'rose-1');assert.equal(reopened.root.querySelector('[data-setting="duration"]').value,'60');assert.equal(reopened.root.querySelector('[data-setting="opacity"]').value,'85');
});

test('late folder scans and a folder dialog for another theme cannot replace the active background',async t=>{
  const state=await themedSetup(t),release=state.hold('rose');
  await state.theme('rose');assert.match(state.root.querySelector('.aw-folder-path').textContent,/正在读取/);
  await state.theme('plum');release();await tick();
  assert.equal(state.root.querySelector('.aw-folder-path').textContent,'D:\\plum');assert.equal(state.reads.at(-1).id,'plum-2');
  assert.equal(state.reads.some(item=>item.theme==='rose'),false);
  let finish;state.chooseWith(theme=>new Promise(resolve=>{finish=()=>resolve({...state.catalogs[theme],folder:'D:\\chosen-for-plum'});}));
  await state.action('choose-folder');await state.theme('rose');finish();await tick();
  assert.equal(state.root.querySelector('.aw-folder-path').textContent,'D:\\rose');assert.equal(state.reads.at(-1).theme,'rose');
  state.catalogs.plum={theme:'plum',folder:'D:\\offline',images:[],warning:'无法读取'};
  await state.theme('plum');assert.equal(state.api.diagnose().backgrounds.displayedImages,0);
  assert.equal(state.root.querySelector('.aw-background-preview').hidden,true);assert.equal(state.root.querySelector('[data-action="play"]').disabled,true);
});
