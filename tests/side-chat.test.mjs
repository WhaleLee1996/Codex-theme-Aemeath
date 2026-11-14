import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {NativeDom} from '../src/native.mjs';
import {motionFixture} from './motion-fixture.mjs';
const compatibility=JSON.parse(fs.readFileSync(new URL('../adapters/26.1111.21308.json',import.meta.url)));

// Structural fixture from the pinned shell (961657) and local/side chat
// (884779) modules. jsdom verifies ownership/lifecycle, not GPU rendering.
const composer=(name,home=false)=>`<div data-thread-find-composer="true" id="${name}-root"><div data-codex-composer-root data-composer-placement="${home?'home':'thread'}"><div data-composer-surface-variant="default" id="${name}-surface"><div data-composer-body><div contenteditable="true" role="textbox" class="ProseMirror" id="${name}-input">${name} unsent draft</div></div><button id="${name}-send">Send</button></div><div data-composer-rail data-composer-rail-placement="below"><div data-composer-utility-rail><button aria-label="Choose project">${name} project</button></div></div></div></div>`;
const side=`<aside data-app-shell-focus-area="right-panel" id="side"><div role="tabpanel" data-app-shell-tab-panel-controller="content-pane" data-tab-id="sidechat:example"><div data-testid="home-icon" id="side-icon">Side chat</div><div class="side-transcript"><div data-thread-user-message-navigation-content><p id="selected-quote">Selected source text</p><pre>Unmodified content</pre></div></div><div class="side-footer">${composer('side')}</div></div></aside>`;
const fixture=({home=false,withSide=true}={})=>`<html><body><aside data-slate-sidebar-content>Sidebar</aside><main data-app-shell-main-surface="default"><div data-app-shell-focus-area="main" data-app-shell-titlebar-slot="main">Titlebar</div><div class="workspace"><div data-app-shell-main-content-layout><div data-app-shell-focus-area="main" id="primary">${home?'<div data-feature="game-source"><h1>Home</h1></div><div data-testid="home-icon" id="main-icon">Logo</div>':'<div class="main-transcript"><div data-thread-user-message-navigation-content><p>Original answer</p></div></div>'}<div ${home?'data-home-feed-composer':''}>${composer('main',home)}</div></div></div>${withSide?side:''}</div></main></body></html>`;
const box=(left,top,width,height)=>({x:left,y:top,left,top,right:left+width,bottom:top+height,width,height});
function scene(t,html=fixture()) {
  const dom=new JSDOM(html,{pretendToBeVisual:true}),doc=dom.window.document;
  const native=new NativeDom(doc,compatibility.selectors);
  t.after(()=>{native.dispose();dom.window.close();});return {dom,doc,native};
}
function setSetting(win,root,key,value) {
  const input=root.querySelector(`[data-setting="${key}"]`);
  if(input.type==='checkbox')input.checked=value;else input.value=String(value);
  input.dispatchEvent(new win.Event('input',{bubbles:true}));
}
async function settle(step) {await step();await step();await step();}
function geometry(doc) {
  for(const [name,rect] of [['main',box(220,640,680,120)],['side',box(970,640,350,120)]]) {
    const surface=doc.getElementById(`${name}-surface`);if(!surface)continue;
    surface.getBoundingClientRect=()=>rect;
    Object.defineProperty(surface,'offsetWidth',{configurable:true,value:rect.width});
  }
}

test('main plus selected-text side chat binds both nested composers without replacing editors, selection or handlers',t=>{
  const {dom,doc,native}=scene(t),original=doc.body.innerHTML;
  const main=doc.getElementById('main-input'),secondary=doc.getElementById('side-input'),range=doc.createRange();
  range.setStart(secondary.firstChild,2);range.setEnd(secondary.firstChild,8);
  dom.window.getSelection().addRange(range);const selected=dom.window.getSelection().toString();
  const sends=[];for(const name of ['main','side'])doc.getElementById(`${name}-send`).onclick=()=>sends.push(name);
  const nodes=native.attach();assert.equal(nodes.composers.length,2);assert.equal(nodes.composer.id,'main-root');
  assert.equal(doc.querySelector('main').dataset.awPage,'conversation');
  assert.equal(doc.querySelectorAll('[data-aw-composer]').length,2);assert.equal(doc.querySelectorAll('[data-aw-composer-rail]').length,2);
  assert.equal(doc.querySelector('#side').hasAttribute('data-aw-clear'),true);
  assert.equal(doc.querySelector('#side').hasAttribute('data-aw-page'),false,'do not double the conversation tint');
  assert.equal(doc.querySelector('pre').hasAttribute('data-aw-clear'),false);
  assert.equal(dom.window.getSelection().toString(),selected);
  secondary.focus();assert.equal(native.attach().composer.id,'main-root','focus must not move primary bindings');
  for(const name of ['main','side'])doc.getElementById(`${name}-send`).click();assert.deepEqual(sends,['main','side']);
  assert.equal(doc.getElementById('main-input'),main);assert.equal(doc.getElementById('side-input'),secondary);
  assert.equal(native.diagnose().recognizedComposers,2);assert.equal(native.diagnose().sideChatComposers,1);
  native.dispose();assert.equal(doc.body.innerHTML,original);
});

test('inactive retained tabs and unrelated editors never create extra themed composers',t=>{
  const {doc,native}=scene(t);
  doc.querySelector('#side').insertAdjacentHTML('beforeend',`<div hidden>${composer('hidden')}</div><div inert>${composer('inert')}</div><div aria-hidden="true">${composer('aria')}</div><div style="display:none">${composer('css')}</div><div contenteditable="true" role="textbox" id="unrelated">Search</div>`);
  doc.body.insertAdjacentHTML('beforeend',`<dialog open>${composer('dialog')}</dialog>`);
  assert.equal(native.attach().composers.length,2);assert.equal(doc.querySelectorAll('[data-aw-composer]').length,2);
  for(const name of ['hidden','inert','aria','css','dialog'])assert.equal(doc.getElementById(`${name}-surface`).hasAttribute('data-aw-composer'),false);
});

test('closing, hiding and replacing a side chat restores obsolete tags and leaves the main chat bound',t=>{
  const {doc,native}=scene(t);native.attach();const pane=doc.querySelector('#side'),old=doc.querySelector('#side-surface');
  pane.hidden=true;assert.equal(native.attach().composers.length,1);assert.equal(old.hasAttribute('data-aw-composer'),false);
  pane.hidden=false;assert.equal(native.attach().composers.length,2);
  const replacement=old.cloneNode(true);replacement.removeAttribute('data-aw-composer');old.replaceWith(replacement);
  native.attach();assert.equal(old.hasAttribute('data-aw-composer'),false);assert.equal(replacement.hasAttribute('data-aw-composer'),true);
  pane.remove();assert.equal(native.attach().composers.length,1);assert.equal(replacement.hasAttribute('data-aw-composer'),false);
  assert.equal(doc.querySelector('main').dataset.awPage,'conversation');assert.ok(doc.querySelector('#main-surface').hasAttribute('data-aw-composer'));
});

test('homepage with a side chat confines cards and picker to the primary pane and tints the side chat once',t=>{
  const {doc,native}=scene(t,fixture({home:true}));
  doc.querySelector('main').getBoundingClientRect=()=>box(200,50,1300,900);
  doc.querySelector('#primary').getBoundingClientRect=()=>box(200,90,800,860);
  const nodes=native.attach();native.enhanceHome(true);
  assert.equal(nodes.isHome,true);assert.equal(nodes.projectTrigger.textContent,'main project');
  assert.equal(doc.querySelector('main').dataset.awPage,'home');assert.equal(doc.querySelector('#side').dataset.awPage,'conversation');
  assert.equal(doc.querySelector('#side-icon').hasAttribute('data-aw-original-home-icon'),false);
  assert.equal(doc.querySelector('#main-icon').hasAttribute('data-aw-original-home-icon'),true);
  assert.deepEqual(native.contentBounds(),{left:200,right:1000,top:90,bottom:950,width:800,height:860});
  doc.querySelector('#primary').getBoundingClientRect=()=>box(200,90,600,860);
  assert.equal(native.contentBounds().width,600);
});

test('runtime adds and removes independent side-chat effects while preserving wallpaper and glass settings',async t=>{
  const scene=await motionFixture({theme:'plum',opacity:65,cardBlur:6,dim:17},{html:fixture({withSide:false}),compatibility});t.after(()=>scene.close());
  const {win,doc,root,api,step,observedSizes}=scene;
  geometry(doc);win.dispatchEvent(new win.Event('resize'));await settle(step);
  const background=doc.querySelector('#aw-background'),backgroundBefore=background.innerHTML;
  const primaryGlow=root.querySelector('.aw-live-glow');assert.equal(primaryGlow.style.left,'220px');
  doc.querySelector('.workspace').insertAdjacentHTML('beforeend',side);geometry(doc);await settle(step);
  const glows=[...root.querySelectorAll('.aw-live-glow')];assert.equal(glows.length,2);assert.ok(glows.every(e=>!e.hidden));
  assert.equal(glows[0],primaryGlow);assert.equal(glows[1].style.left,'970px');assert.equal(glows[1].style.width,'350px');
  assert.equal(root.querySelectorAll('.aw-live-star:not([hidden])').length,4);
  assert.equal(root.style.getPropertyValue('--aw-opacity'),'0.65');assert.equal(root.style.getPropertyValue('--aw-card-blur'),'6px');
  assert.equal(background.innerHTML,backgroundBefore);assert.equal(api.diagnose().native.recognizedComposers,2);
  const secondary=doc.querySelector('#side-surface');assert.ok(observedSizes.has(secondary));
  doc.querySelector('#side').remove();await settle(step);
  assert.equal(root.querySelectorAll('.aw-live-glow').length,1);assert.equal(root.querySelector('.aw-live-glow'),primaryGlow);
  assert.equal(observedSizes.has(secondary),false);assert.equal(background.innerHTML,backgroundBefore);
  doc.querySelector('.workspace').insertAdjacentHTML('beforeend',side);await settle(step);
  assert.equal(root.querySelectorAll('.aw-live-glow').length,2);assert.equal(root.querySelectorAll('.aw-live-halo').length,2);
});

test('each expanded composer has its own halo, resize and manual brightness; disable and dispose clean up both',async t=>{
  const scene=await motionFixture({haloBlur:3,haloWidth:17},{html:fixture(),compatibility});t.after(()=>scene.close());
  const {win,doc,root,api,step,frames,observedSizes}=scene;geometry(doc);
  const editor=doc.getElementById('side-input');Object.defineProperty(editor,'scrollHeight',{configurable:true,value:240});
  editor.dispatchEvent(new win.Event('input',{bubbles:true}));await settle(step);
  const halos=[...root.querySelectorAll('.aw-live-halo')],glows=[...root.querySelectorAll('.aw-live-glow')];
  assert.equal(halos[0].hidden,true);assert.equal(halos[1].hidden,false);assert.equal(halos[1].style.left,'953px');
  doc.querySelector('#side-surface').getBoundingClientRect=()=>box(980,500,300,260);
  win.dispatchEvent(new win.Event('resize'));await settle(step);
  assert.equal(glows[0].style.top,'640px');assert.equal(glows[1].style.top,'500px');assert.equal(glows[1].style.width,'300px');
  root.querySelector('[data-glow-mode="manual"]').click();setSetting(win,root,'glow',29);await settle(step);
  assert.ok([...root.querySelectorAll('.aw-live-glow,.aw-live-star')].every(e=>e.style.opacity==='0.29'));assert.equal(frames.size,0);
  setSetting(win,root,'enabled',false);await settle(step);assert.equal(doc.querySelectorAll('[data-aw-composer]').length,0);
  assert.ok([...root.querySelectorAll('.aw-live-glow,.aw-live-star,.aw-live-halo')].every(e=>e.hidden));assert.equal(observedSizes.size,0);
  setSetting(win,root,'enabled',true);await settle(step);assert.equal(doc.querySelectorAll('[data-aw-composer]').length,2);
  assert.equal(doc.getElementById('side-input'),editor);assert.equal(editor.textContent,'side unsent draft');
  api.dispose();assert.equal(doc.querySelector('[data-aw-composer]'),null);assert.equal(doc.querySelector('aemeath-wish-theme'),null);
  assert.equal(frames.size,0);assert.equal(observedSizes.size,0);assert.equal(doc.querySelector('#selected-quote').textContent,'Selected source text');
});

test('two chat composers share one breathing clock with zero native/global style writes over sixty frames',async t=>{
  const scene=await motionFixture({glowMode:'breathe'},{html:fixture(),compatibility});t.after(()=>scene.close());
  const {win,doc,root,step,frames}=scene,records=[];
  assert.equal(frames.size,1);assert.equal(root.querySelectorAll('.aw-live-glow:not([hidden])').length,2);
  const observer=new win.MutationObserver(batch=>records.push(...batch));t.after(()=>observer.disconnect());
  observer.observe(doc.documentElement,{attributes:true,attributeFilter:['style'],subtree:true});
  observer.observe(root,{attributes:true,attributeFilter:['style'],subtree:true});
  for(let i=0;i<60;i++)await step();
  assert.ok(records.length>0);assert.ok(records.every(r=>r.target.matches('.aw-live-glow,.aw-live-star')));
  assert.equal(frames.size,1);const animated=new Set(records.map(r=>r.target));assert.equal(animated.size,6);
});
