import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {NativeCatalog, NativeCloud, NativeDom, MutationJournal} from '../src/native.mjs';

import {fixture, services} from './fixtures.mjs';
test('native catalog requests actual project-scoped pages and supports independent pagination', async()=>{
  const {service,calls}=services();const catalog=new NativeCatalog(()=>service);
  const initial=await catalog.refresh();assert.equal(initial.projects[0].threads[0].displayTitle,'Actual title');
  assert.deepEqual(calls[0].filter.includeThreadIds,['assigned']);assert.deepEqual(calls[0].filter.excludeThreadIds,['unassigned']);
  assert.equal(calls[0].sortKey,'updated_at');const more=await catalog.more('a');assert.equal(more.projects[0].threads.length,2);assert.equal(calls[1].cursor.threadId,'first');
  assert.equal('subscribeStatus' in service.localThreadCatalog,false);
});
test('theme leaves the native editor, send handler and project selection handler intact',()=>{
  const dom=new JSDOM(fixture);const doc=dom.window.document,native=new NativeDom(doc);
  const editor=doc.querySelector('[contenteditable]'),send=doc.querySelector('#send'),trigger=doc.querySelector('[data-feature] button');
  let sends=0,pickers=0;send.onclick=()=>sends++;trigger.onclick=()=>pickers++;
  assert.equal(native.attach().isHome,true);native.enhanceHome(true);
  assert.equal(doc.querySelector('[data-testid="home-icon"]').hasAttribute('data-aw-original-home-icon'),true);
  editor.textContent='Native text remains editable';send.click();native.openProjectPicker(trigger);
  assert.equal(sends,1);assert.equal(pickers,1);assert.equal(doc.querySelector('[contenteditable]'),editor);
  native.dispose();assert.equal(doc.querySelector('[data-feature]').hasAttribute('data-aw-original-hero'),false);assert.equal(trigger.hasAttribute('tabindex'),false);assert.equal(doc.querySelector('[data-testid="home-icon"]').hasAttribute('data-aw-original-home-icon'),false);assert.equal(editor.textContent,'Native text remains editable');dom.window.close();
});
test('an unselected homepage opens the original composer picker through its native keyboard handler',()=>{
  const html=fixture.replace('<span>What should we build in <button>Example?</button></span>','<span>What should we build?</span>').replace('<div data-home-feed-composer>','<div data-home-feed-composer><button aria-label="选择项目" id="native-picker">选择项目</button>');
  const dom=new JSDOM(html),doc=dom.window.document,native=new NativeDom(doc),trigger=doc.querySelector('#native-picker');
  let opens=0,clicks=0;trigger.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();opens++;trigger.setAttribute('aria-expanded','true');trigger.textContent='Chosen project';}});trigger.onclick=()=>clicks++;
  assert.equal(native.attach().projectTrigger,trigger);native.enhanceHome(true);
  assert.equal(native.openProjectPicker(doc.createElement('button')),true);assert.equal(opens,1);assert.equal(clicks,0);
  assert.equal(trigger.hasAttribute('data-aw-native-picker'),false);assert.equal(trigger.hasAttribute('tabindex'),false);assert.equal(trigger.textContent,'Chosen project');
  native.openProjectPicker(trigger);assert.equal(opens,1);native.dispose();dom.window.close();
});
test('an unavailable remote catalog does not hide local projects with no conversations',async()=>{
  const {service}=services();service.projectCatalog.readRemoteProjects=async()=>{throw new Error('remote offline');};service.localThreadCatalog.readPage=async()=>({entries:[],nextCursor:null});
  const snapshot=await new NativeCatalog(()=>service).refresh();assert.equal(snapshot.projects.length,1);assert.equal(snapshot.projects[0].name,'Example');assert.deepEqual(snapshot.projects[0].threads,[]);assert.equal(snapshot.errors[0].component,'remote-projects');
});
test('unknown or ambiguous native layout keeps the original homepage',()=>{
  const dom=new JSDOM(fixture.replace('data-codex-composer-root','data-new-unrecognized-composer'));
  const native=new NativeDom(dom.window.document);assert.equal(native.attach().isHome,false);native.enhanceHome(true);
  assert.equal(dom.window.document.querySelector('[data-aw-original-hero]'),null);native.dispose();dom.window.close();
});
test('chat navigation uses existing rows or the observed native router message',()=>{
  const dom=new JSDOM(fixture),native=new NativeDom(dom.window.document);let clicked=0,message;
  dom.window.document.querySelector('[data-app-action-sidebar-thread-id]').onclick=()=>clicked++;
  dom.window.addEventListener('message',e=>message=e.data);
  native.openThread({threadId:'visible',hostId:'local'});assert.equal(clicked,1);
  native.openThread({threadId:'hidden-chat',hostId:'remote-machine'});
  assert.equal(message.type,'navigate-to-route');assert.equal(message.threadSelection.hostId,'remote-machine');assert.equal(message.threadSelection.conversationId,'hidden-chat');dom.window.close();
});
test('cleanup does not overwrite a more recent native attribute update',()=>{
  const dom=new JSDOM('<div data-theme="light"></div>');const node=dom.window.document.querySelector('div'),journal=new MutationJournal();
  journal.attr(node,'data-theme','dark');node.setAttribute('data-theme','system-change');journal.restore();assert.equal(node.dataset.theme,'system-change');dom.window.close();
});

test('cloud sidebar pagination supplies distinct pinnable projects and only selected projects load conversations',async()=>{
  const requests=[];
  const client={safeGet:async(path,options)=>{
    requests.push({path,...options.parameters});
    if(path==='/gizmos/snorlax/sidebar')return options.parameters.query.cursor ? {items:[{gizmo:{gizmo:{id:'g-two',display:{name:'AI Learning'}}}}],cursor:null} : {items:[{gizmo:{gizmo:{id:'a',display:{name:'leetcode'}}}}],cursor:'projects-next'};
    assert.equal(options.parameters.path.gizmo_id,'a');
    return options.parameters.query.cursor ? {items:[{id:'older',title:'Older',update_time:'2026-11-01T00:00:00Z'},{id:'archived',is_archived:true}],cursor:null} : {items:[{id:'recent',title:'Real cloud title',update_time:'2026-11-04T00:00:00Z'}],cursor:'chats-next'};
  }};
  const {service,calls}=services();let pins=[null,{key:'chatgpt:chatgpt:a',name:'leetcode'},null,null];
  const catalog=new NativeCatalog(()=>service,{cloud:new NativeCloud(()=>client),getPins:()=>pins});
  const snapshot=await catalog.refresh();assert.equal(snapshot.allProjects.length,3);assert.equal(snapshot.projects[0],null);
  assert.equal(snapshot.projects[1].threads[0].displayTitle,'Real cloud title');assert.equal(snapshot.projects[1].threads[0].sourceKind,'chatgpt');assert.equal(calls.length,0);
  assert.equal(requests[0].query.owned_only,false);assert.equal(requests[1].query.cursor,'projects-next');
  const more=await catalog.more('chatgpt:chatgpt:a');assert.equal(more.projects[1].threads.length,2);assert.equal(requests.at(-1).query.cursor,'chats-next');
  pins=[{key:'chatgpt:chatgpt:missing',name:'Deleted project'},null,null,null];const missing=await catalog.refresh();assert.equal(missing.projects[0].missing,true);assert.equal(missing.projects[0].name,'Deleted project');assert.equal(missing.projects[1],null);
});

test('a pin changed during catalog refresh is loaded before that refresh completes',async()=>{
  const {service,calls}=services();let pins=[null,null,null,null],release;
  const original=service.projectCatalog.readLocalProjects;
  service.projectCatalog.readLocalProjects=()=>new Promise(resolve=>{release=()=>{service.projectCatalog.readLocalProjects=original;resolve(original());};});
  const catalog=new NativeCatalog(()=>service,{getPins:()=>pins}),pending=catalog.refresh();
  await Promise.resolve();pins=[{key:'local:local:a',name:'Example'},null,null,null];release();
  const snapshot=await pending;assert.equal(snapshot.projects[0].threads[0].displayTitle,'Actual title');assert.ok(calls.length>0);
});

test('native thread forms and retained route changes restore the themed homepage without navigating or rewriting the editor',()=>{
  const dom=new JSDOM(fixture),doc=dom.window.document,native=new NativeDom(doc);
  const old=doc.querySelector('main');native.attach();native.enhanceHome(true);old.style.display='none';
  const page=doc.createElement('main');page.dataset.appShellMainSurface='default';page.innerHTML='<div class="transcript-shell"><div data-thread-user-message-navigation-content><p>Real answer</p><pre>untouched code</pre></div></div><div class="footer-shell"><form data-thread-find-composer="true" data-chatgpt-composer data-composer-placement="thread"><div data-composer-surface-variant="default"><textarea>Unsent draft</textarea><button type="submit">Send</button></div></form></div>';old.after(page);
  let submits=0;page.querySelector('form').onsubmit=e=>{e.preventDefault();submits++;};
  let nodes=native.attach();native.enhanceHome(nodes.isHome);assert.equal(nodes.composer.tagName,'FORM');assert.equal(nodes.isHome,false);assert.equal(page.dataset.awPage,'conversation');
  assert.equal(page.querySelector('.transcript-shell').hasAttribute('data-aw-clear'),true);assert.equal(page.querySelector('pre').hasAttribute('data-aw-clear'),false);
  page.querySelector('button').click();assert.equal(submits,1);assert.equal(page.querySelector('textarea').value,'Unsent draft');
  page.querySelector('.transcript-shell').innerHTML='<div data-testid="home-icon" aria-hidden="true">logo</div><div data-feature="game-source" class="heading-xl">我们要构建什么？</div>';
  page.querySelector('form').dataset.composerPlacement='home';nodes=native.attach();native.enhanceHome(nodes.isHome);
  assert.equal(nodes.isHome,true);assert.equal(page.dataset.awPage,'home');assert.equal(page.querySelector('[data-testid="home-icon"]').hasAttribute('data-aw-original-home-icon'),true);
  native.dispose();assert.equal(doc.querySelector('[data-aw-original-hero]'),null);assert.equal(doc.querySelector('[data-aw-clear]'),null);assert.equal(page.querySelector('textarea').value,'Unsent draft');dom.window.close();
});

test('cloud thread navigation uses the native project conversation route',()=>{
  const dom=new JSDOM(fixture),native=new NativeDom(dom.window.document);let message;
  dom.window.addEventListener('message',e=>message=e.data);
  native.openThread({threadId:'cloud-thread',hostId:'chatgpt',sourceKind:'chatgpt',projectId:'g-p-project'});
  assert.deepEqual(message,{type:'navigate-to-route',path:'/g/g-p-project/c/cloud-thread'});dom.window.close();
});
