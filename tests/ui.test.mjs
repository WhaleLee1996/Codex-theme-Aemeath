import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createView} from '../src/ui.mjs';
import {normalizeConfig} from '../src/core.mjs';
import {reference,template} from '../dist/reference.mjs';

test('four honest project slots remain usable with an empty or unavailable catalog',async t=>{
  const dom=new JSDOM('<body></body>');t.after(()=>dom.window.close());let picks=0,retries=0;
  const view=createView(dom.window.document,template,'./ui.css',reference,{project:()=>picks++,action:action=>{if(action==='refresh-projects')retries++;}});t.after(()=>view.dispose());
  view.renderConfig(normalizeConfig({},reference,['stars']),false);
  view.renderProjects({projects:[],allProjects:[]});
  assert.equal(view.root.querySelectorAll('.aw-project-card').length,4);assert.equal(view.root.querySelectorAll('[data-empty="true"]').length,4);
  assert.doesNotMatch(view.$('.aw-projects').textContent,/1970|Actual title/);
  view.$('.aw-projects button').click();await Promise.resolve();assert.equal(picks,0);assert.equal(view.$('.aw-pin-picker').hidden,false);
  view.renderProjects(null,new Error('unavailable'));view.$('.aw-pin-refresh').click();await Promise.resolve();assert.equal(retries,1);
  assert.equal(view.$('.aw-project-status').classList.contains('aw-sr-only'),true);
});

test('pin picker is anchored to its card, searches cloud projects, and never opens the composer picker',async t=>{
  const dom=new JSDOM('<body></body>');t.after(()=>dom.window.close());let composerPicks=0,pin;
  const view=createView(dom.window.document,template,'./ui.css',reference,{project:()=>composerPicks++,pin:(slot,project)=>{pin={slot,project};}});t.after(()=>view.dispose());
  const a={key:'chatgpt:chatgpt:cloud-a',id:'cloud-a',kind:'chatgpt',name:'AI Learning',threads:[]},b={key:'chatgpt:chatgpt:cloud-b',id:'cloud-b',kind:'chatgpt',name:'leetcode',threads:[]};
  view.renderProjects({projects:[a,null,null,null],allProjects:[a,b]});
  const trigger=view.$('[data-pin-slot="1"]');trigger.getBoundingClientRect=()=>({left:400,top:80,bottom:110,width:90,height:30});trigger.click();
  const picker=view.$('.aw-pin-picker');assert.equal(picker.parentElement,view.root);assert.equal(picker.style.left,'400px');assert.equal(picker.style.top,'118px');
  assert.equal(view.$(`[data-pin-key="${a.key}"]`).disabled,true);
  const search=view.$('.aw-pin-search');search.value='leet';search.dispatchEvent(new dom.window.Event('input',{bubbles:true}));assert.equal(view.root.querySelectorAll('.aw-pin-option').length,1);
  view.$('.aw-pin-option').click();await Promise.resolve();assert.equal(pin.slot,1);assert.equal(pin.project.key,b.key);assert.equal(composerPicks,0);assert.equal(picker.hidden,true);
  trigger.click();search.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(picker.hidden,true);assert.equal(view.host.shadowRoot.activeElement,trigger);
  trigger.click();view.setHomeVisible(false);assert.equal(picker.hidden,true);
});
test('real empty projects and scrolling conversation lists occupy the same four-card layout',t=>{
  const dom=new JSDOM('<body></body>');t.after(()=>dom.window.close());
  const view=createView(dom.window.document,template,'./ui.css',reference,{});t.after(()=>view.dispose());
  const snapshot={projects:[{id:'a',name:'Active',threads:[{displayTitle:'Actual conversation',sourceRecencyAt:100}],nextCursor:null},{id:'b',name:'New project',threads:[],nextCursor:null}]};
  view.renderProjects(snapshot);assert.equal(view.root.querySelectorAll('.aw-project-card').length,4);
  const list=view.$('[data-project-list="a"]');list.scrollTop=52;view.renderProjects(snapshot);assert.equal(view.$('[data-project-list="a"]').scrollTop,52);
  assert.match(view.$('[data-project-list="b"]').textContent,/还没有对话/);assert.doesNotMatch(view.$('[data-project-list="b"]').closest('section').textContent,/1970/);
});

test('document entry paints the frozen artwork itself; settings keep a separate nonmodal layer',async t=>{
  const dom=new JSDOM('<body><button id="native">Native action</button></body>');t.after(()=>dom.window.close());
  const {document,HTMLElement}=dom.window;let opened=0,closed=0,enabled;
  HTMLElement.prototype.showPopover=function(){assert.equal(this.isConnected,true);assert.equal(this.getAttribute('popover'),'manual');opened++;};
  HTMLElement.prototype.hidePopover=function(){closed++;};
  const view=createView(document,template,'./ui.css',reference,{setting:(key,value)=>{if(key==='enabled')enabled=value;}});
  const layer=view.$('.aw-control-layer'),companion=view.companion;
  assert.equal(opened,2);assert.equal(layer.contains(companion),false);assert.equal(layer.contains(view.$('.aw-settings')),true);
  assert.equal(companion.parentElement,document.body);assert.equal(companion.getRootNode(),document);
  const frozen=document.createElement('template');frozen.innerHTML=template;
  const artwork=frozen.content.querySelector('.aw-companion img').getAttribute('src');
  assert.equal(companion.style.backgroundImage.includes(artwork),true);
  assert.equal(companion.childElementCount,0);assert.equal(companion.draggable,false);
  assert.equal(companion.hasAttribute('data-tooltip'),false);
  assert.equal(view.root.querySelector('.aw-companion'),null);
  assert.equal(layer.contains(view.$('.aw-main')),false);assert.equal(layer.contains(view.$('.aw-live-glow')),false);
  view.renderConfig(normalizeConfig({},reference,['stars']),false);
  companion.click();assert.equal(view.$('.aw-settings').hidden,false);
  companion.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(view.$('.aw-settings').hidden,true);assert.equal(document.activeElement,companion);
  view.renderConfig(normalizeConfig({enabled:false},reference,['stars']),false);
  companion.click();await Promise.resolve();assert.equal(enabled,true);
  assert.equal(opened,2);assert.equal(closed,0); // No repeated promotion over native menus.
  let nativeClicks=0;document.querySelector('#native').onclick=()=>nativeClicks++;
  document.querySelector('#native').click();assert.equal(nativeClicks,1);
  view.dispose();assert.equal(closed,2);assert.equal(document.querySelector('aemeath-wish-theme'),null);
  assert.equal(document.querySelector('#aw-companion-entry'),null);
  assert.equal(document.querySelector('link[href$="entry.css"]'),null);
});

test('unsupported or rejected popover calls leave a working entry instead of a hidden popover',t=>{
  for(const throws of [false,true]){
    const dom=new JSDOM('<body></body>');t.after(()=>dom.window.close());
    if(throws)dom.window.HTMLElement.prototype.showPopover=()=>{throw new Error('Unavailable');};
    const view=createView(dom.window.document,template,'./ui.css',reference,{});t.after(()=>view.dispose());
    view.renderConfig(normalizeConfig({},reference,['stars']),false);
    assert.equal(view.$('.aw-control-layer').hasAttribute('popover'),false);
    assert.equal(view.companion.hasAttribute('popover'),false);
    assert.equal(view.diagnoseCompanion().mode,'fallback');
    view.companion.click();assert.equal(view.$('.aw-settings').hidden,false);
  }
});

test('background entry diagnostics retain document hit samples without inventing an image rectangle',t=>{
  const dom=new JSDOM('<body></body>');t.after(()=>dom.window.close());
  const view=createView(dom.window.document,template,'./ui.css',reference,{});t.after(()=>view.dispose());
  const button=view.companion,other=dom.window.document.createElement('div');
  button.getBoundingClientRect=()=>({x:800,y:600,left:800,top:600,width:201,height:239});
  dom.window.document.elementFromPoint=(x,y)=>y>800?other:button;
  const report=view.diagnoseCompanion();
  assert.equal(report.paint,'button-background');assert.equal(report.image,null);
  assert.deepEqual(report.button,{x:800,y:600,width:201,height:239});
  assert.deepEqual(report.hitSamples.map(s=>s.buttonHit),[true,true,false]);
  assert.equal(report.hitSamples[2].hitTag,'DIV');
  assert.equal(report.coordinateSpace,'document');
});

test('long composer clips only overlapping cards, leaving their backdrop ancestors uncut',t=>{
  const dom=new JSDOM('<body></body>');t.after(()=>dom.window.close());
  const view=createView(dom.window.document,template,'./ui.css',reference,{});t.after(()=>view.dispose());
  view.renderProjects({projects:[],allProjects:[]});
  const projects=[...view.root.querySelectorAll('.aw-project-card')],welcome=view.$('.aw-welcome');
  const box=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height});
  projects.forEach((card,i)=>{card.getBoundingClientRect=()=>box(i*200+20,30,180,230);});
  welcome.getBoundingClientRect=()=>box(40,340,740,130);
  view.clipHomeCards(box(50,400,700,210));
  assert.equal(view.$('.aw-main').style.clipPath,'');
  assert.ok(projects.every(card=>card.style.clipPath===''));
  assert.match(welcome.style.clipPath,/M32 60H688Q710 60/);
  // A taller editor reaches the project row as well, without changing a parent
  // into a Backdrop Root. Each cutout uses that card's local coordinates.
  view.clipHomeCards(box(50,200,700,410));
  assert.ok(projects.every(card=>card.style.clipPath.startsWith('path(evenodd')));
  assert.notEqual(projects[0].style.clipPath,projects[1].style.clipPath);
  for(const card of [...projects,welcome]){
    for(let node=card.parentElement;node;node=node.parentElement)assert.equal(node.style.clipPath,'');
  }
  view.clipHomeCards(null);
  assert.ok([...projects,welcome].every(card=>card.style.clipPath===''));
});

test('entry diagnostics record only bounded entry interactions and the glass control has a clear label',t=>{
  const dom=new JSDOM('<body><button id="native">Native</button></body>');t.after(()=>dom.window.close());
  const view=createView(dom.window.document,template,'./ui.css',reference,{});t.after(()=>view.dispose());
  view.renderConfig(normalizeConfig({},reference,['stars']),false);
  view.companion.getBoundingClientRect=()=>({x:800,y:600,left:800,top:600,width:201,height:239});
  for(let i=0;i<20;i++)view.companion.dispatchEvent(new dom.window.MouseEvent('pointerenter',{clientX:840,clientY:810}));
  dom.window.document.querySelector('#native').click();
  const report=view.diagnoseCompanion();assert.equal(report.pointerSamples.length,12);
  assert.ok(report.pointerSamples.every(e=>e.x===40&&e.y===210));
  assert.equal(view.root.querySelector('[data-setting="opacity"]').closest('label').textContent.includes('卡片与输入框不透明度'),true);
});

test('theme choice remains above child tabs and the settings scope follows the selected theme',t=>{
  const dom=new JSDOM('<body></body>');t.after(()=>dom.window.close());
  const view=createView(dom.window.document,template,'./ui.css',reference,{});t.after(()=>view.dispose());
  const config=normalizeConfig({theme:'plum'},reference,['stars']);view.renderConfig(config,false);
  assert.equal(view.$('.aw-theme-options').closest('[data-panel]'),null);
  assert.equal(view.$('[data-tab="background"]').getAttribute('aria-selected'),'true');
  view.$('[data-tab="glass"]').click();assert.match(view.$('.aw-setting-scope').textContent,/深粉紫/);
  view.renderConfig(normalizeConfig({theme:'rose'},reference,['stars']),false);assert.match(view.$('.aw-setting-scope').textContent,/浅粉/);
  assert.equal(view.$('[data-tab="glass"]').getAttribute('aria-selected'),'true');
  view.$('[data-tab="theme"]').click();assert.match(view.$('.aw-setting-scope').textContent,/全部主题共用/);
  view.$('[data-tab="theme"]').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));
  assert.equal(view.$('[data-tab="background"]').getAttribute('aria-selected'),'true');
});
