import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {loadNativeBindings} from '../src/native-loader.mjs';
import {NativeDom} from '../src/native.mjs';
import {startTheme} from './theme-fixture.mjs';
import {services} from './fixtures.mjs';
const compatibility=JSON.parse(fs.readFileSync(new URL('../adapters/26.1111.21308.json',import.meta.url)));
const fixture=`<html><body><aside data-slate-sidebar-content></aside><div class="root-HUUPVC" role="group"><button>Chat</button><button>Work</button></div><main data-app-shell-main-surface="default"><div class="MainContentTopFade-T6W4RS background-j0etS7" aria-hidden="true"></div><div data-feature="game-source"><div style="view-transition-name:var(--vt-splash-screen-headline)"><h1 class="heading-xl invisible" aria-hidden="true" inert>Headline sizing copy</h1><div class="heading-xl"><h1>Home headline</h1></div></div></div><div data-testid="home-icon"></div><div data-home-feed-composer><div data-thread-find-composer="true"><div data-codex-composer-root><div data-composer-surface-variant="default"><div contenteditable="true" role="textbox" class="ProseMirror">Unsent draft</div><button id="send">Send</button></div><div data-composer-rail><div data-composer-utility-rail><button aria-label="Choose project">Example</button></div></div></div></div></div><div data-thread-scroll-footer><div class="background-uNUrfY surface-nr8PSS" aria-hidden="true"></div></div><section><div class="CodeBlockPlaceholder-rW0eah">Code</div><div class="MermaidBlock-zsG6ii"><svg><text>Diagram</text></svg></div></section></main></body></html>`;

test('Rspack binding reuses initialized instances and sees later startup without calling factories',async()=>{
  const imports=[];let executions=0;
  const requireNative=()=>{executions++;throw Error('Must never execute a native factory');};requireNative.c={};
  const bindings=await loadNativeBindings({baseURI:'app://-/index.html'},compatibility,{importModule:async url=>{imports.push(url);return {__webpack_require__:requireNative};}});
  assert.equal(bindings.getServices(),undefined);assert.equal(bindings.getCloud(),undefined);
  const service={projectCatalog:{}}, client={safeGet(){}};
  requireNative.c.GaA7={exports:{appServices:service}};requireNative.c.Ghh3={exports:{Request:client}};
  assert.equal(bindings.getServices(),service);assert.equal(bindings.getCloud(),client);
  const replacement={projectCatalog:{updated:true}};requireNative.c.GaA7.exports.appServices=replacement;
  assert.equal(bindings.getServices(),replacement);assert.equal(executions,0);
  assert.deepEqual(imports,['app://-/assets/348410.374a9b8f98.js']);
});

test('missing native loader degrades data access and reports the error',async()=>{
  const errors=[];
  const bindings=await loadNativeBindings({baseURI:'app://-/index.html'},compatibility,{importModule:async()=>{throw Error('Native entry unavailable');}},error=>errors.push(error.message));
  assert.deepEqual(errors,['Native entry unavailable']);assert.equal(bindings.getServices(),undefined);assert.equal(bindings.getCloud(),undefined);
});

test('new home wrappers, composer div and decorative layers are identified and restored',t=>{
  const dom=new JSDOM(fixture,{pretendToBeVisual:true});t.after(()=>dom.window.close());
  const doc=dom.window.document,native=new NativeDom(doc,compatibility.selectors);
  const original=doc.body.innerHTML,editor=doc.querySelector('[contenteditable]');
  assert.equal(native.attach().isHome,true);assert.equal(native.nodes.composer.tagName,'DIV');
  assert.equal(native.nodes.rails.length,1);assert.equal(native.nodes.projectTrigger.getAttribute('aria-label'),'Choose project');
  assert.equal(doc.querySelectorAll('[data-aw-native-backdrop]').length,2);
  assert.ok(doc.querySelector('.CodeBlockPlaceholder-rW0eah').hasAttribute('data-aw-code'));
  assert.ok(doc.querySelector('.MermaidBlock-zsG6ii').hasAttribute('data-aw-visual'));
  native.enhanceHome(true);assert.ok(doc.querySelector('[data-feature]').hasAttribute('data-aw-original-hero'));
  assert.equal(doc.querySelector('[contenteditable]'),editor);assert.equal(editor.textContent,'Unsent draft');
  native.dispose();assert.equal(doc.body.innerHTML,original);
  doc.querySelector('[data-feature]').removeAttribute('data-feature');
  assert.equal(native.attach().isHome,true,'Chat-mode headline does not carry the Work-only game marker');native.dispose();
});

test('new build mounts with the native appServices export while keeping the real editor',async t=>{
  const dom=new JSDOM(fixture,{url:'https://local.test/',pretendToBeVisual:true});t.after(()=>dom.window.close());
  const win=dom.window,{service}=services();win.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
  win.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  win.electronBridge={getSentryInitOptions:()=>({appVersion:compatibility.packageVersion})};
  win.aemeathWish={readSettings:async()=>({config:{glowMode:'manual'}}),getBackgrounds:async()=>({folder:null,images:[]}),saveSettings:async()=>({}),diagnostics:async()=>({})};
  const editor=win.document.querySelector('[contenteditable]');
  const api=await startTheme(win,{compatibility,shared:{appServices:service}});assert.ok(api);t.after(()=>api.dispose());
  await new Promise(resolve=>setTimeout(resolve,80));
  assert.ok(win.document.querySelector('#aw-companion-entry'));
  const shadow=win.document.querySelector('aemeath-wish-theme').shadowRoot;
  assert.equal(shadow.querySelectorAll('.aw-project-card').length,4);assert.equal(win.document.querySelector('[contenteditable]'),editor);
  assert.equal(win.document.querySelector('main').dataset.awPage,'home');
});

test('unknown native versions remain blocked before settings or DOM changes',async t=>{
  const dom=new JSDOM(fixture,{url:'https://local.test/'});t.after(()=>dom.window.close());const reports=[];
  dom.window.electronBridge={getSentryInitOptions:()=>({appVersion:'99.0.0'})};
  dom.window.aemeathWish={readSettings(){throw Error('Must not read settings');},diagnostics:async data=>reports.push(data)};
  const original=dom.window.document.body.innerHTML;
  assert.equal(await startTheme(dom.window,{compatibility}),null);assert.equal(reports[0].status,'adapter-version-mismatch');assert.equal(dom.window.document.body.innerHTML,original);
});


test('Chat home uses its own native project picker and target instead of the Work selection',async t=>{
  // 26.1111: YHyp supplies homeProjectSelector to the Chat form. hYhU renders
  // Choose/Change project labels and invokes that form's onProjectChange.
  const html=`<html><body><main data-app-shell-main-surface="default"><div data-app-shell-focus-area="main"><div style="view-transition-name:var(--vt-splash-screen-headline)"><h1>How can I help?</h1></div><div data-home-feed-composer><form data-thread-find-composer="true" data-chatgpt-composer="true" data-composer-placement="home"><div data-composer-surface-variant="default"><div contenteditable="true" role="textbox" class="ProseMirror">Unsent Chat draft</div><button type="button" id="chat-project" data-chatgpt-project-picker="true" aria-label="Choose project" aria-expanded="false">Choose project</button><button type="submit">Send</button></div></form></div></div><div hidden><button aria-label="Change project: Work project">Work project</button></div></main></body></html>`;
  const dom=new JSDOM(html,{url:'https://local.test/',pretendToBeVisual:true});t.after(()=>dom.window.close());
  const win=dom.window,doc=win.document,{service}=services();win.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
  win.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  win.electronBridge={getSentryInitOptions:()=>({appVersion:compatibility.packageVersion})};
  win.aemeathWish={readSettings:async()=>({config:{glowMode:'manual'}}),getBackgrounds:async()=>({folder:null,images:[]}),saveSettings:async()=>({}),diagnostics:async()=>({})};
  const trigger=doc.querySelector('#chat-project'),editor=doc.querySelector('[contenteditable]'),form=doc.querySelector('form'),originalParent=trigger.parentElement;
  const beforeWorkSelection=await service.projectCatalog.readSelection();let chatProject=null,opens=0,submitted;
  form.addEventListener('submit',event=>{event.preventDefault();submitted={project:chatProject,text:editor.textContent};});
  const frame=doc.createElement('div');frame.setAttribute('data-radix-popper-content-wrapper','');
  frame.innerHTML='<div id="chat-project-menu" role="dialog"><button type="button" id="choose-chat-project">Chat project</button><button type="button" id="clear-chat-project">No project</button></div>';
  const rect=(x,y,width,height)=>({x,y,left:x,top:y,right:x+width,bottom:y+height,width,height});
  frame.getBoundingClientRect=()=>rect(200,500,280,220);
  Object.defineProperty(frame,'offsetWidth',{value:280});Object.defineProperty(frame,'offsetHeight',{value:220});
  const close=()=>{trigger.setAttribute('aria-expanded','false');trigger.removeAttribute('aria-controls');frame.remove();};
  trigger.onclick=()=>{opens++;trigger.setAttribute('aria-expanded','true');trigger.setAttribute('aria-controls','chat-project-menu');doc.body.append(frame);};
  frame.querySelector('#choose-chat-project').onclick=()=>{chatProject='g-p-chat';trigger.textContent='Chat project';trigger.setAttribute('aria-label','Change project: Chat project');close();};
  frame.querySelector('#clear-chat-project').onclick=()=>{chatProject=null;trigger.textContent='No project';trigger.setAttribute('aria-label','Choose project');close();};
  const api=await startTheme(win,{compatibility,shared:{appServices:service}});t.after(()=>api.dispose());
  const tick=()=>new Promise(resolve=>win.setTimeout(resolve,80));await tick();
  const shadow=doc.querySelector('aemeath-wish-theme').shadowRoot,chip=shadow.querySelector('.aw-project-chip'),label=shadow.querySelector('.aw-current-project');
  chip.getBoundingClientRect=()=>rect(620,420,180,36);
  assert.equal(doc.querySelector('main').dataset.awPage,'home');assert.equal(chip.disabled,false);assert.equal(label.textContent,'Choose project');
  chip.click();await tick();assert.equal(opens,1);assert.equal(frame.hasAttribute('data-aw-project-popup'),true);
  frame.querySelector('#choose-chat-project').click();await tick();assert.equal(label.textContent,'Chat project');assert.equal(frame.isConnected,false);
  assert.deepEqual(await service.projectCatalog.readSelection(),beforeWorkSelection,'Chat selection must not overwrite the separate Work selection');
  form.requestSubmit();assert.deepEqual(submitted,{project:'g-p-chat',text:'Unsent Chat draft'});
  assert.equal(doc.querySelector('[contenteditable]'),editor);assert.equal(trigger.parentElement,originalParent);
  chip.click();await tick();assert.equal(opens,2);frame.querySelector('#clear-chat-project').click();await tick();assert.equal(label.textContent,'No project');assert.equal(chip.disabled,false);
});
