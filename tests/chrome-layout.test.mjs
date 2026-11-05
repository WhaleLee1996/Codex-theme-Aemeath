import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {NativeDom, MutationJournal} from '../src/native.mjs';
import {startTheme} from './theme-fixture.mjs';
import {services} from './fixtures.mjs';

// Representative source-owned chrome from this exact native version. Messages
// and code blocks deliberately have opaque backgrounds that must remain intact.
export const chromeFixture = `<html data-aw-enabled><body><header data-app-shell-header-layout="default">Header</header><div class="_root_1q7e3_1" role="group" aria-label="Composer mode"><button>聊天</button><button>工作</button></div><main data-app-shell-main-surface="default"><div class="_MainContentTopFade_azz1c_2" aria-hidden="true"></div><div class="heading-xl" data-feature="game-source">欢迎</div><div data-thread-user-message-navigation-content><div class="message">Message</div><pre>Code</pre></div><div class="home-layout"><div data-home-feed-composer><form data-thread-find-composer="true" data-composer-placement="home"><div data-composer-surface-variant="default"><div data-composer-body><textarea>Unsent draft</textarea></div><div data-composer-surface-variant="inline"></div></div><div data-composer-utility-rail><button type="button" aria-label="选择项目">选择项目</button></div></form></div></div><div data-thread-scroll-footer><div class="_background_18hic_2 _surface_18hic_2" aria-hidden="true"></div></div><div class="_background_18hic_2 _fade_18hic_2" aria-hidden="true"></div></main></body></html>`;

export function layoutGeometry(doc, scale = 1) {
  const box=(left,top,width,height)=>({x:left,y:top,left,top,right:left+width,bottom:top+height,width,height});
  const state={scale,inputHeight:100,railHeight:40,baseTop:360,bottom:1000,paintDock:true};
  const main=doc.querySelector('main'),form=doc.querySelector('form'),surface=form.querySelector('[data-composer-surface-variant]'),rail=form.querySelector('[data-composer-utility-rail]');
  const shift=()=>state.paintDock && form.hasAttribute('data-aw-home-dock') ? (parseFloat(form.style.getPropertyValue('--aw-home-dock-y'))||0)*state.scale : 0;
  main.getBoundingClientRect=()=>box(300,64,1100,state.bottom-64);
  doc.querySelector('header').getBoundingClientRect=()=>box(0,64,1400,46);
  doc.querySelector('[role="group"]').getBoundingClientRect=()=>box(650,100,200,36);
  form.getBoundingClientRect=()=>box(450,state.baseTop+shift(),800,(state.inputHeight+state.railHeight)*state.scale);
  surface.getBoundingClientRect=()=>box(450,state.baseTop+shift(),800,state.inputHeight*state.scale);
  rail.getBoundingClientRect=()=>box(450,state.baseTop+shift()+state.inputHeight*state.scale,800,state.railHeight*state.scale);
  Object.defineProperty(form,'offsetHeight',{get:()=>state.inputHeight+state.railHeight});
  return {state,form,surface,rail};
}

test('only native decorative backdrops disappear; inner composer paint is cleared and restored',t=>{
  const dom=new JSDOM(chromeFixture);t.after(()=>dom.window.close());const doc=dom.window.document;
  const style=doc.createElement('style');style.textContent='.message,pre,._background_18hic_2,._MainContentTopFade_azz1c_2{background:rgb(24,24,24)}\n'+fs.readFileSync(new URL('../src/native.css',import.meta.url),'utf8');doc.head.append(style);
  const native=new NativeDom(doc),layers=[...doc.querySelectorAll('._background_18hic_2,._MainContentTopFade_azz1c_2')];
  const bubble=doc.createElement('div'),writing=doc.createElement('div');bubble.setAttribute('data-user-message-bubble','');bubble.innerHTML='<button type="button">Show more</button><pre>Native code</pre>';
  writing.setAttribute('data-oai-writing-block-surface','');writing.innerHTML='<div aria-hidden="true"></div><header>Writing<button type="button">Copy</button></header><div contenteditable="true">Editable content</div>';
  doc.querySelector('main').append(bubble,writing);const originalBubble=bubble.outerHTML,originalWriting=writing.outerHTML;let expansions=0,copies=0;
  bubble.querySelector('button').onclick=()=>expansions++;writing.querySelector('button').onclick=()=>copies++;
  const initial=layers.map(e=>dom.window.getComputedStyle(e).display);native.attach();
  for(const layer of layers)assert.equal(dom.window.getComputedStyle(layer).display,'none');
  for(const element of doc.querySelectorAll('[data-composer-surface-variant]'))assert.equal(dom.window.getComputedStyle(element).getPropertyValue('--composer-layout-surface-background'),'transparent');
  assert.equal(doc.querySelector('[data-composer-utility-rail]').hasAttribute('data-aw-composer-rail'),true);
  assert.equal(dom.window.getComputedStyle(doc.querySelector('pre')).backgroundColor,'rgb(24, 24, 24)');
  assert.equal(dom.window.getComputedStyle(doc.querySelector('.message')).backgroundColor,'rgb(24, 24, 24)');
  assert.equal(bubble.hasAttribute('data-aw-user-message'),true);assert.equal(writing.hasAttribute('data-aw-writing'),true);
  assert.equal(bubble.querySelector('pre').hasAttribute('data-aw-clear'),false);assert.equal(dom.window.getComputedStyle(bubble.querySelector('pre')).backgroundColor,'rgb(24, 24, 24)');
  bubble.querySelector('button').click();writing.querySelector('button').click();assert.equal(expansions,1);assert.equal(copies,1);
  native.dispose();layers.forEach((layer,i)=>assert.equal(dom.window.getComputedStyle(layer).display,initial[i]));
  assert.equal(doc.querySelector('[data-aw-composer-rail]'),null);
  assert.equal(bubble.outerHTML,originalBubble);assert.equal(writing.outerHTML,originalWriting);
});

test('Work home stays below mode controls and keeps the full composer at the bottom while expanding and scaling',t=>{
  const dom=new JSDOM(chromeFixture);t.after(()=>dom.window.close());const doc=dom.window.document,native=new NativeDom(doc),{state,form}=layoutGeometry(doc,1.25);
  form.style.transform='translateX(4px)';form.style.setProperty('--native-value','42');const input=form.querySelector('textarea');input.setSelectionRange(2,5);
  native.attach();native.enhanceHome(true);const bounds=native.contentBounds();assert.equal(bounds.top,146);
  native.dockHomeComposer(bounds);assert.equal(native.composerBounds().bottom,980);assert.equal(form.getBoundingClientRect().width,800);
  const shift=form.style.getPropertyValue('--aw-home-dock-y');native.dockHomeComposer(bounds);assert.equal(form.style.getPropertyValue('--aw-home-dock-y'),shift);
  state.inputHeight=300;native.dockHomeComposer(bounds);assert.equal(native.composerBounds().bottom,980);assert.equal(native.composerBounds().height,425);
  state.scale=1;state.bottom=760;state.baseTop=260;native.dockHomeComposer(native.contentBounds());assert.equal(native.composerBounds().bottom,740);
  assert.equal(input.value,'Unsent draft');assert.equal(input.selectionStart,2);assert.equal(form.style.transform,'translateX(4px)');
  form.dataset.composerPlacement='thread';doc.querySelector('[data-feature]').remove();native.attach();native.enhanceHome(false);
  assert.equal(form.hasAttribute('data-aw-home-dock'),false);assert.equal(form.style.getPropertyValue('--aw-home-dock-y'),'');assert.equal(form.style.getPropertyValue('--native-value'),'42');
  assert.equal(doc.querySelector('[data-aw-home-dock-path]'),null);native.dispose();
});

test('restoring one owned CSS property preserves native transforms and later updates',()=>{
  const dom=new JSDOM('<div style="transform:translateX(4px);color:blue!important"></div>'),node=dom.window.document.querySelector('div'),journal=new MutationJournal();
  journal.css(node,'--aw-home-dock-y','120px');journal.css(node,'color','red');node.style.transform='translateX(12px)';journal.restore();
  assert.equal(node.style.getPropertyValue('--aw-home-dock-y'),'');assert.equal(node.style.color,'blue');assert.equal(node.style.getPropertyPriority('color'),'important');assert.equal(node.style.transform,'translateX(12px)');
  journal.css(node,'--aw-home-dock-y','20px');node.style.setProperty('--aw-home-dock-y','30px');journal.restore();assert.equal(node.style.getPropertyValue('--aw-home-dock-y'),'30px');dom.window.close();
});

test('a stylesheet that has not loaded cannot accumulate repeated composer offsets',t=>{
  const dom=new JSDOM(chromeFixture);t.after(()=>dom.window.close());const doc=dom.window.document,native=new NativeDom(doc),{state,form}=layoutGeometry(doc);state.paintDock=false;
  const original=dom.window.getComputedStyle.bind(dom.window);dom.window.getComputedStyle=node=>{const style=original(node);if(node===form)Object.defineProperty(style,'translate',{value:state.paintDock?'0 480px':'none'});return style;};
  native.attach();native.enhanceHome(true);native.dockHomeComposer(native.contentBounds());const shift=form.style.getPropertyValue('--aw-home-dock-y');
  native.dockHomeComposer(native.contentBounds());assert.equal(form.style.getPropertyValue('--aw-home-dock-y'),shift);
  state.paintDock=true;native.dockHomeComposer(native.contentBounds());assert.equal(native.composerBounds().bottom,980);native.dispose();
});

test('a sibling utility bar keeps its native controls and moves with the editor above or below it',t=>{
  const dom=new JSDOM(chromeFixture);t.after(()=>dom.window.close());const doc=dom.window.document,native=new NativeDom(doc);
  const form=doc.querySelector('form'),surface=form.querySelector('[data-composer-surface-variant]'),rail=form.querySelector('[data-composer-utility-rail]'),feed=form.parentElement,wrapper=feed.parentElement;
  // This native home variant places the action rail outside the form, under a
  // display:contents wrapper. Only the existing common layout box can move both.
  feed.style.display='contents';const frame=doc.createElement('div');frame.dataset.composerRail='';frame.className='native-rail-frame';frame.append(rail);feed.prepend(frame);
  const device=doc.createElement('button');device.type='button';device.textContent='此计算机';rail.append(device);
  const project=rail.firstElementChild,input=form.querySelector('textarea');let projectClicks=0,deviceClicks=0;
  project.onclick=()=>projectClicks++;device.onclick=()=>deviceClicks++;input.setSelectionRange(2,5);
  const style=doc.createElement('style');style.textContent='.native-rail-frame{background:rgb(24,24,24);box-shadow:0 4px 20px black}\n'+fs.readFileSync(new URL('../src/native.css',import.meta.url),'utf8');doc.head.append(style);
  const box=(top,height)=>({x:450,y:top,left:450,top,right:1250,bottom:top+height,width:800,height});
  let above=true;const shift=()=>parseFloat(wrapper.style.getPropertyValue('--aw-home-dock-y'))||0;
  doc.querySelector('main').getBoundingClientRect=()=>({...box(64,936),left:300,right:1400,width:1100});
  wrapper.getBoundingClientRect=()=>box(360+shift(),140);
  form.getBoundingClientRect=surface.getBoundingClientRect=()=>box(360+shift()+(above?40:0),100);
  rail.getBoundingClientRect=frame.getBoundingClientRect=()=>box(360+shift()+(above?0:100),40);
  Object.defineProperty(wrapper,'offsetHeight',{value:140});
  for(const placement of ['above','below']){
    above=placement==='above';frame.dataset.composerRailPlacement=placement;
    const nodes=native.attach();native.enhanceHome(true);native.dockHomeComposer(native.contentBounds());
    assert.equal(nodes.dockRoot,wrapper);assert.deepEqual(nodes.rails,[rail]);assert.equal(native.composerBounds().bottom,980);
    assert.equal(frame.dataset.awComposerRailFrame,placement);assert.equal(form.hasAttribute('data-aw-home-dock'),false);
    assert.equal(dom.window.getComputedStyle(frame).boxShadow,'none');assert.equal(dom.window.getComputedStyle(frame).backgroundColor,'rgba(0, 0, 0, 0)');
    native.openProjectPicker(project);device.click();
    assert.equal(form.parentElement,feed);assert.equal(frame.parentElement,feed);assert.equal(rail.parentElement,frame);
    assert.equal(input.value,'Unsent draft');assert.equal(input.selectionStart,2);
  }
  assert.equal(projectClicks,2);assert.equal(deviceClicks,2);native.dispose();
  assert.equal(wrapper.hasAttribute('data-aw-home-dock'),false);assert.equal(wrapper.style.getPropertyValue('--aw-home-dock-y'),'');
  assert.equal(frame.hasAttribute('data-aw-composer-rail-frame'),false);assert.equal(rail.hasAttribute('data-aw-composer-rail'),false);
  assert.equal(dom.window.getComputedStyle(frame).backgroundColor,'rgb(24, 24, 24)');assert.equal(feed.style.display,'contents');
});

test('runtime follows thread to new chat to Work, reserves the mode switch and keeps expansion over the welcome space',async t=>{
  const dom=new JSDOM(chromeFixture,{url:'https://local.test/',pretendToBeVisual:true});t.after(()=>dom.window.close());const win=dom.window,doc=win.document,{service}=services(),{state,form}=layoutGeometry(doc);
  doc.querySelector('[data-feature]').remove();form.dataset.composerPlacement='thread';const mode=doc.querySelector('[role="group"]');mode.hidden=true;
  win.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};win.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  win.electronBridge={getSentryInitOptions:()=>({appVersion:'26.1027.30824'})};win.aemeathWish={readSettings:async()=>({config:{glowMode:'manual'}}),getBackgrounds:async()=>({folder:'test',images:[{id:'stars'}]}),readImage:async()=>({bytes:new Uint8Array([1]),mime:'image/png'}),saveSettings:async()=>({}),diagnostics:async()=>({})};
  const api=await startTheme(win,{shared:{Vct:service}});t.after(()=>api.dispose());const tick=()=>new Promise(r=>setTimeout(r,80));
  const shadow=doc.querySelector('aemeath-wish-theme').shadowRoot,home=shadow.querySelector('.aw-main');
  home.getBoundingClientRect=()=>{const left=parseFloat(home.style.left)||0,top=parseFloat(home.style.top)||0,width=parseFloat(home.style.width)||0,height=parseFloat(home.style.height)||0;return {left,top,width,height,right:left+width,bottom:top+height};};
  await tick();assert.equal(home.hidden,true);
  const heading=doc.createElement('div');heading.className='heading-xl';heading.dataset.feature='game-source';heading.textContent='欢迎';doc.querySelector('main').prepend(heading);form.dataset.composerPlacement='home';mode.hidden=false;
  mode.lastElementChild.onclick=()=>{state.baseTop=420;form.classList.add('work-mode');};mode.lastElementChild.click();await tick();
  assert.equal(home.hidden,false);assert.equal(home.style.top,'146px');assert.equal(api.diagnose().native.fullComposerRect.bottom,980);assert.equal(shadow.querySelector('#aw-ui').style.getPropertyValue('--aw-home-bottom'),'184px');
  state.inputHeight=300;form.querySelector('textarea').dispatchEvent(new win.Event('input',{bubbles:true}));await tick();
  assert.equal(api.diagnose().native.fullComposerRect.bottom,980);assert.equal(shadow.querySelector('#aw-ui').style.getPropertyValue('--aw-home-bottom'),'184px');assert.equal(shadow.querySelector('.aw-live-halo').hidden,false);
  api.dispose();assert.equal(form.querySelector('textarea').value,'Unsent draft');assert.equal(form.hasAttribute('data-aw-home-dock'),false);
});
