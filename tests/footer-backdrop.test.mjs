import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {NativeDom} from '../src/native.mjs';
const {selectors}=JSON.parse(fs.readFileSync(new URL('../adapters/26.1111.21308.json',import.meta.url)));
const editor=id=>`<div data-codex-composer-root id="${id}-composer"><div data-composer-surface-variant="default"><div data-composer-body><textarea id="${id}-editor">Unsent ${id} draft</textarea></div><button id="${id}-send">Send</button></div></div>`;
const footer=(id,content=editor(id))=>`<div class="footer-A8ZvKV" id="${id}-footer"><div data-thread-scroll-footer="true"><div data-thread-composer-backdrop>${content}</div></div></div>`;
const fixture=`<html><body>${footer('outside')}<main data-app-shell-main-surface="default"><div data-app-shell-focus-area="main">${footer('main')}${footer('empty','<button>Other control</button>')}<section class="footer-A8ZvKV" id="lookalike">Article</section></div><aside data-app-shell-focus-area="right-panel" id="side">${footer('side')}</aside></main></body></html>`;

test('native footer paint is scoped to recognized editors and restores without changing drafts or controls',t=>{
 const dom=new JSDOM(fixture,{pretendToBeVisual:true});t.after(()=>dom.window.close());const doc=dom.window.document,native=new NativeDom(doc,selectors),before=doc.body.innerHTML;
 const input=doc.querySelector('#main-editor');input.setSelectionRange(2,7);let sent=0;doc.querySelector('#main-send').onclick=()=>sent++;
 native.attach();assert.deepEqual([...doc.querySelectorAll('[data-aw-composer-footer]')].map(n=>n.id),['main-footer','side-footer']);
 assert.equal(native.diagnose().footerBackdrops,2);assert.equal(doc.querySelector('#main-editor'),input);assert.equal(input.value,'Unsent main draft');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,7);
 doc.querySelector('#main-send').click();assert.equal(sent,1);assert.equal(doc.querySelectorAll('[data-thread-scroll-footer]').length,4);
 native.dispose();assert.equal(doc.body.innerHTML,before);
});

test('footer ownership follows native reparenting and hidden side chats, while unknown adapters leave footers alone',t=>{
 const dom=new JSDOM(fixture,{pretendToBeVisual:true});t.after(()=>dom.window.close());const doc=dom.window.document,native=new NativeDom(doc,selectors);
 native.attach();const original=doc.querySelector('#main-footer'),composer=doc.querySelector('#main-composer');
 original.insertAdjacentHTML('afterend',footer('replacement',''));doc.querySelector('#replacement-footer [data-thread-composer-backdrop]').append(composer);native.attach();
 assert.equal(original.hasAttribute('data-aw-composer-footer'),false);assert.equal(doc.querySelector('#replacement-footer').hasAttribute('data-aw-composer-footer'),true);
 doc.querySelector('#side').hidden=true;native.attach();assert.equal(doc.querySelector('#side-footer').hasAttribute('data-aw-composer-footer'),false);
 doc.querySelector('#side').hidden=false;native.attach();assert.equal(doc.querySelector('#side-footer').hasAttribute('data-aw-composer-footer'),true);
 native.dispose();const legacy=new NativeDom(doc);legacy.attach();assert.equal(doc.querySelector('[data-aw-composer-footer]'),null);legacy.dispose();
});
