import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {startTheme} from './theme-fixture.mjs';
import {fixture,services} from './fixtures.mjs';

test('complete theme mounts on native fixture, persists choices, and fully disables',async t=>{
  const dom=new JSDOM(fixture,{url:'https://local.test/',pretendToBeVisual:true});t.after(()=>dom.window.close());
  const win=dom.window,saves=[];const {service}=services();
  win.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
  win.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  win.electronBridge={getSentryInitOptions:()=>({appVersion:'26.1027.30824'})};
  win.aemeathWish={readSettings:async()=>({config:{schemaVersion:4,glowMode:'manual',glow:30}}),getBackgrounds:async()=>({folder:'test',images:[{id:'stars',name:'星海'}]}),readImage:async()=>({bytes:new Uint8Array([1]),mime:'image/png'}),saveSettings:async c=>{saves.push(c);return{saved:true};},diagnostics:async()=>({path:'test'})};
  const originalEditor=win.document.querySelector('[contenteditable]');
  const api=await startTheme(win,{shared:{Vct:service}});t.after(()=>api.dispose());
  await new Promise(r=>setTimeout(r,60));
  const shadow=win.document.querySelector('aemeath-wish-theme').shadowRoot;
  assert.equal(win.document.querySelector('[contenteditable]'),originalEditor);
  assert.equal(shadow.querySelectorAll('textarea,[contenteditable]').length,0);
  assert.doesNotMatch(shadow.querySelector('.aw-projects').textContent,/Actual title/);
  assert.equal(shadow.querySelectorAll('.aw-project-card').length,4);
  shadow.querySelector('[data-pin-slot="2"]').click();shadow.querySelector('.aw-pin-option').click();
  await new Promise(r=>setTimeout(r,380));
  assert.match(shadow.querySelectorAll('.aw-project-card')[2].textContent,/Actual title/);
  assert.deepEqual(saves.at(-1).pinnedProjects,[null,null,{key:'local:local:a',name:'Example'},null]);
  assert.equal(shadow.querySelector('.aw-current-project').textContent,'Example');
  const opacity=shadow.querySelector('[data-setting="opacity"]');assert.equal(opacity.min,'0');
  opacity.value='0';opacity.dispatchEvent(new win.Event('input',{bubbles:true}));
  await new Promise(r=>setTimeout(r,380));assert.equal(saves.at(-1).opacity,0);
  assert.equal(win.document.documentElement.style.getPropertyValue('--aw-opacity'),'0');
  const size=shadow.querySelector('[data-setting="companionSize"]'),entry=win.document.querySelector('#aw-companion-entry'),artwork=entry.style.backgroundImage;
  for(const width of [72,196,216]){
    size.value=String(width);size.dispatchEvent(new win.Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,380));assert.equal(saves.at(-1).companionSize,width);
    // Document entry and shadow settings must use the same size at both limits
    // and at the user's failing size, without replacing the interactive node.
    assert.equal(shadow.querySelector('#aw-ui').style.getPropertyValue('--aw-companion-width'),width+'px');
    assert.equal(win.document.documentElement.style.getPropertyValue('--aw-companion-width'),width+'px');
    assert.equal(win.document.documentElement.style.getPropertyValue('--aw-companion-height'),width*107/90+'px');
    assert.equal(win.document.querySelector('#aw-companion-entry'),entry);
    assert.equal(entry.style.backgroundImage===artwork,true);assert.equal(entry.childElementCount,0);
    entry.click();assert.equal(shadow.querySelector('.aw-settings').hidden,false);
    entry.click();assert.equal(shadow.querySelector('.aw-settings').hidden,true);
  }
  const toggle=shadow.querySelector('[data-setting="enabled"]');toggle.checked=false;toggle.dispatchEvent(new win.Event('input',{bubbles:true}));
  await new Promise(r=>setTimeout(r,380));assert.equal(win.document.documentElement.hasAttribute('data-aw-enabled'),false);assert.equal(win.document.querySelector('[data-aw-original-hero]'),null);assert.equal(saves.at(-1).enabled,false);
  const companion=win.document.querySelector('#aw-companion-entry');assert.equal(companion.getAttribute('aria-label'),'启用小爱主题');companion.click();
  await new Promise(r=>setTimeout(r,60));assert.equal(win.document.documentElement.hasAttribute('data-aw-enabled'),true);assert.equal(shadow.querySelector('.aw-settings').hidden,true);
  companion.click();assert.equal(shadow.querySelector('.aw-settings').hidden,false);
  shadow.querySelector('[data-action="exit-theme"]').click();await new Promise(r=>setTimeout(r,380));assert.equal(saves.at(-1).enabled,false);assert.equal(shadow.querySelector('.aw-settings').hidden,true);assert.equal(win.document.documentElement.hasAttribute('data-aw-enabled'),false);
  api.dispose();assert.equal(win.document.querySelector('aemeath-wish-theme'),null);assert.equal(win.document.querySelector('#aw-background'),null);assert.equal(win.document.documentElement.dataset.theme,'light');
});

test('native pet and utility windows never mount a second theme or write shared settings',async t=>{
  for(const route of ['/avatar-overlay','/spotlight','/global-dictation/record','/hotkey-window']){
    for(const url of [`https://local.test${route}`,`https://local.test/index.html?initialRoute=${encodeURIComponent(route+'?mode=test')}`]){
      const dom=new JSDOM('<body></body>',{url});t.after(()=>dom.window.close());let reads=0;
      dom.window.electronBridge={getSentryInitOptions:()=>({appVersion:'26.1027.30824'})};
      dom.window.aemeathWish={readSettings:async()=>{reads++;throw new Error('Auxiliary windows must not start');}};
      assert.equal(await startTheme(dom.window),null);assert.equal(reads,0);
      assert.equal(dom.window.document.querySelector('aemeath-wish-theme,#aw-companion-entry,#aw-background'),null);
    }
  }
});
test('version mismatch leaves the app untouched and records a diagnosis',async()=>{
  const dom=new JSDOM(fixture);let report;dom.window.electronBridge={getSentryInitOptions:()=>({appVersion:'future'})};dom.window.aemeathWish={diagnostics:async r=>{report=r;}};
  const result=await startTheme(dom.window);assert.equal(result,null);assert.equal(report.status,'adapter-version-mismatch');assert.equal(dom.window.document.querySelector('aemeath-wish-theme'),null);dom.window.close();
});

test('runtime observes CSS-retained routes and home form changes without intercepting new-chat navigation',async t=>{
  const dom=new JSDOM(fixture,{url:'https://local.test/',pretendToBeVisual:true});t.after(()=>dom.window.close());const win=dom.window,{service}=services();
  win.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};win.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  win.electronBridge={getSentryInitOptions:()=>({appVersion:'26.1027.30824'})};win.aemeathWish={readSettings:async()=>({config:{glowMode:'manual'}}),getBackgrounds:async()=>({folder:'test',images:[{id:'stars'}]}),readImage:async()=>({bytes:new Uint8Array([1]),mime:'image/png'}),saveSettings:async()=>({}),diagnostics:async()=>({})};
  const api=await startTheme(win,{shared:{Vct:service}});t.after(()=>api.dispose());const tick=()=>new Promise(r=>setTimeout(r,60));await tick();
  const home=win.document.querySelector('aemeath-wish-theme').shadowRoot.querySelector('.aw-main'),old=win.document.querySelector('main');assert.equal(home.hidden,false);
  const page=old.cloneNode(true);page.querySelector('[data-feature]').remove();page.querySelector('[data-testid="home-icon"]').remove();
  const root=page.querySelector('[data-codex-composer-root]'),form=win.document.createElement('form');form.dataset.threadFindComposer='true';form.dataset.composerPlacement='thread';form.innerHTML=root.innerHTML;root.replaceWith(form);
  page.style.display='none';old.after(page);await tick();old.style.display='none';page.style.display='block';await tick();assert.equal(home.hidden,true);assert.equal(api.diagnose().native.composerKind,'FORM');
  const heading=win.document.createElement('div');heading.className='heading-xl';heading.dataset.feature='game-source';heading.textContent='我们要构建什么？';page.prepend(heading);form.dataset.composerPlacement='home';await tick();
  assert.equal(home.hidden,false);assert.equal(heading.hasAttribute('data-aw-original-hero'),true);assert.equal(page.dataset.awPage,'home');
});
