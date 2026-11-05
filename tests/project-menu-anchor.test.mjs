import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {NativeDom} from '../src/native.mjs';
import {startTheme} from './theme-fixture.mjs';
import {fixture,services} from './fixtures.mjs';

function setup(t) {
  const html=fixture.replace('<span>What should we build in <button>Example?</button></span>','<span>What should we build?</span>').replace('<div data-home-feed-composer>','<div data-home-feed-composer><button id="native-project" aria-label="选择项目" aria-expanded="false">选择项目</button>');
  const dom=new JSDOM(html,{pretendToBeVisual:true});t.after(()=>dom.window.close());
  const win=dom.window,doc=win.document,native=new NativeDom(doc),trigger=doc.querySelector('#native-project');
  const host=doc.createElement('div');doc.body.append(host);const shadow=host.attachShadow({mode:'open'}),anchor=doc.createElement('button');anchor.textContent='♡ 选择项目';shadow.append(anchor);
  const frame=doc.createElement('div');frame.setAttribute('data-radix-popper-content-wrapper','');frame.style.transform='translate(500px, 500px)';
  frame.innerHTML='<div id="native-project-content" role="dialog"><input placeholder="搜索项目"><button type="button">Example project</button></div>';
  const menu=frame.firstElementChild,search=menu.querySelector('input'),choice=menu.querySelector('button');
  const state={anchorLeft:700,anchorTop:600,width:280,height:320,baseLeft:500,baseTop:500,scale:1,paint:true,opens:0,selections:0};
  const rect=(left,top,width,height)=>({x:left,y:top,left,top,right:left+width,bottom:top+height,width,height});
  anchor.getBoundingClientRect=()=>rect(state.anchorLeft,state.anchorTop,180,36);
  frame.getBoundingClientRect=()=>{
    const dx=state.paint?(parseFloat(frame.style.getPropertyValue('--aw-picker-dx'))||0)*state.scale:0;
    const dy=state.paint?(parseFloat(frame.style.getPropertyValue('--aw-picker-dy'))||0)*state.scale:0;
    const available=state.paint?parseFloat(frame.style.getPropertyValue('--aw-picker-available-height'))||Infinity:Infinity;
    return rect(state.baseLeft+dx,state.baseTop+dy,state.width*state.scale,Math.min(state.height*state.scale,available));
  };
  Object.defineProperty(frame,'offsetWidth',{get:()=>state.width});
  Object.defineProperty(frame,'offsetHeight',{get:()=>frame.getBoundingClientRect().height/state.scale});
  const computed=win.getComputedStyle.bind(win);win.getComputedStyle=node=>{const s=computed(node);if(node===frame)Object.defineProperty(s,'translate',{value:state.paint?'0px 0px':'none'});return s;};
  function open(){state.opens++;trigger.setAttribute('aria-expanded','true');trigger.setAttribute('aria-controls',menu.id);doc.body.append(frame);search.focus();}
  function close(){trigger.setAttribute('aria-expanded','false');trigger.removeAttribute('aria-controls');frame.remove();trigger.focus();}
  trigger.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();if(state.async)win.setTimeout(open,10);else open();}});
  trigger.onclick=()=>trigger.getAttribute('aria-expanded')==='true'?close():open();
  choice.onclick=()=>{state.selections++;trigger.textContent='Example project';trigger.setAttribute('aria-label','Change project: Example project');close();};
  native.attach();native.enhanceHome(true);t.after(()=>native.dispose());
  return {win,doc,native,trigger,anchor,frame,menu,search,choice,state,open,close};
}

test('welcome opens its linked native picker beside itself and native selection updates the real target',async t=>{
  const {win,doc,native,trigger,anchor,frame,search,choice,state}=setup(t);
  const originalParent=trigger.parentElement,editor=doc.querySelector('[contenteditable]');editor.textContent='Unsent work';
  assert.equal(native.openProjectPicker(anchor),true);assert.equal(state.opens,1);
  assert.equal(frame.getBoundingClientRect().left,700);assert.equal(frame.getBoundingClientRect().bottom,592);
  assert.equal(doc.activeElement,search);assert.equal(anchor.getAttribute('aria-expanded'),'true');
  assert.equal(trigger.parentElement,originalParent);assert.equal(trigger.getAttribute('style'),null);assert.equal(frame.style.transform,'translate(500px, 500px)');
  search.value='Example';search.dispatchEvent(new win.Event('input',{bubbles:true}));native.syncProjectPicker();
  choice.click();native.syncProjectPicker();await new Promise(r=>win.setTimeout(r,5));
  assert.equal(state.selections,1);assert.equal(trigger.textContent,'Example project');assert.equal(native.attach().projectTrigger,trigger);
  assert.equal(editor.textContent,'Unsent work');assert.equal(frame.hasAttribute('data-aw-project-popup'),false);assert.equal(anchor.getAttribute('aria-expanded'),null);assert.equal(anchor.getRootNode().activeElement,anchor);
});

test('welcome picker follows viewport and native positioning changes without accumulating offsets',t=>{
  const {win,native,anchor,frame,state}=setup(t);state.paint=false;native.openProjectPicker(anchor);
  const first=frame.style.getPropertyValue('--aw-picker-dy');native.syncProjectPicker();assert.equal(frame.style.getPropertyValue('--aw-picker-dy'),first);
  state.paint=true;native.syncProjectPicker();assert.equal(frame.getBoundingClientRect().bottom,592);
  for(let i=0;i<3;i++)native.syncProjectPicker();assert.equal(frame.getBoundingClientRect().bottom,592);
  state.anchorTop=100;state.anchorLeft=950;state.scale=1.25;state.baseTop=250;state.baseLeft=650;frame.style.transform='translate(650px, 250px)';native.syncProjectPicker();
  assert.equal(frame.getBoundingClientRect().top,144);assert.equal(frame.getBoundingClientRect().right,win.innerWidth-10);
  win.innerHeight=360;win.innerWidth=480;state.anchorLeft=390;state.anchorTop=240;native.syncProjectPicker();
  assert.equal(frame.getBoundingClientRect().top,10);assert.equal(frame.getBoundingClientRect().bottom,232);assert.equal(frame.getBoundingClientRect().right,470);
  assert.equal(frame.style.transform,'translate(650px, 250px)');
});

test('direct native controls, unrelated popups, route changes and disabling release welcome positioning',t=>{
  const {win,doc,native,trigger,anchor,frame,state,close}=setup(t);
  const unrelated=doc.createElement('div');unrelated.setAttribute('data-radix-popper-content-wrapper','');unrelated.innerHTML='<div role="dialog">Other menu</div>';doc.body.append(unrelated);
  native.openProjectPicker(anchor);assert.equal(unrelated.hasAttribute('data-aw-project-popup'),false);
  trigger.dispatchEvent(new win.Event('pointerdown',{bubbles:true,composed:true}));assert.equal(native.picker,null);assert.equal(frame.style.getPropertyValue('--aw-picker-dx'),'');
  close();trigger.click();native.syncProjectPicker();assert.equal(frame.hasAttribute('data-aw-project-popup'),false);
  native.openProjectPicker(anchor);assert.equal(state.opens,2);assert.equal(frame.hasAttribute('data-aw-project-popup'),true);
  doc.querySelector('[data-feature]').remove();native.attach();assert.equal(frame.hasAttribute('data-aw-project-popup'),false);assert.equal(native.picker,null);
  native.dispose();assert.equal(frame.style.transform,'translate(500px, 500px)');assert.equal(unrelated.getAttribute('style'),null);
});

test('runtime observes asynchronously mounted native menus and releases positioning when the theme is disabled',async t=>{
  const {win,doc,native,anchor,frame,state,choice}=setup(t);native.dispose();state.async=true;const {service}=services();
  win.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};win.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  win.electronBridge={getSentryInitOptions:()=>({appVersion:'26.1027.30824'})};win.aemeathWish={readSettings:async()=>({config:{glowMode:'manual'}}),getBackgrounds:async()=>({folder:'test',images:[{id:'stars'}]}),readImage:async()=>({bytes:new Uint8Array([1]),mime:'image/png'}),saveSettings:async()=>({}),diagnostics:async()=>({})};
  const api=await startTheme(win,{shared:{Vct:service}});t.after(()=>api.dispose());const tick=()=>new Promise(r=>win.setTimeout(r,80));await tick();
  const shadow=doc.querySelector('aemeath-wish-theme').shadowRoot,chip=shadow.querySelector('.aw-project-chip');chip.getBoundingClientRect=anchor.getBoundingClientRect;
  chip.click();await tick();assert.equal(frame.getBoundingClientRect().left,700);assert.equal(frame.getBoundingClientRect().bottom,592);
  choice.click();await tick();assert.equal(shadow.querySelector('.aw-current-project').textContent,'Example project');assert.equal(frame.hasAttribute('data-aw-project-popup'),false);
  chip.click();await tick();assert.equal(frame.hasAttribute('data-aw-project-popup'),true);
  const enabled=shadow.querySelector('[data-setting="enabled"]');enabled.checked=false;enabled.dispatchEvent(new win.Event('input',{bubbles:true}));await tick();
  assert.equal(frame.hasAttribute('data-aw-project-popup'),false);assert.equal(frame.style.getPropertyValue('--aw-picker-dx'),'');assert.equal(frame.style.transform,'translate(500px, 500px)');
});
