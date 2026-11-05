import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {NativeDom} from '../src/native.mjs';
import {fixture} from './fixtures.mjs';

test('content adapters preserve source text, native actions and independent visual content',t=>{
  const dom=new JSDOM(fixture);t.after(()=>dom.window.close());const doc=dom.window.document,native=new NativeDom(doc),main=doc.querySelector('main');
  const content=doc.createElement('section');content.innerHTML='<div data-code-block data-theme="dark"><div data-code-block-controls><button>Copy</button></div><div data-code-block-source><code><span class="hljs-keyword">const</span> answer = 42;</code></div></div><div data-oai-writing-block-surface><button>Open document</button></div><div data-testid="chatgpt-chart-content-reference" style="background:white"><svg><path fill="#21a65a" stroke="#000" d="M0 0L10 10"></path><text fill="#111">1.5</text></svg></div><div class="_MermaidBlock_xjxw3_2"><svg style="background:#fff"><text fill="#123">Node</text></svg></div><div data-code-block-preview-pane="html"><iframe srcdoc="<p style=&quot;color:black;background:white&quot;>Preview</p>"></iframe></div><img src="data:image/png;base64,AA==" style="background:transparent"><table><tr><td>Cell</td></tr></table>';
  main.append(content);const before=content.innerHTML,svg=[...content.querySelectorAll('svg')].map(e=>e.outerHTML),frame=content.querySelector('iframe').outerHTML,img=content.querySelector('img').outerHTML;
  let copies=0;content.querySelector('button').onclick=()=>copies++;
  native.attach();assert.equal(content.querySelectorAll('[data-aw-code]').length,1);assert.equal(content.querySelectorAll('[data-aw-writing]').length,1);assert.equal(content.querySelectorAll('[data-aw-visual]').length,3);
  content.querySelector('button').click();assert.equal(copies,1);assert.equal(content.querySelector('code').textContent,'const answer = 42;');
  assert.deepEqual([...content.querySelectorAll('svg')].map(e=>e.outerHTML),svg);assert.equal(content.querySelector('iframe').outerHTML,frame);assert.equal(content.querySelector('img').outerHTML,img);
  assert.equal(content.querySelector('table').hasAttribute('data-aw-clear'),false);native.dispose();assert.equal(content.innerHTML,before);
});

test('both code palettes retain readable ordinary text and every syntax category on their paired backgrounds',()=>{
  const themes=JSON.parse(fs.readFileSync(new URL('../src/themes.json',import.meta.url),'utf8'));
  const luminance=hex=>{const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb.reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);};
  for(const [name,{tokens}] of Object.entries(themes)){
    const background=luminance(tokens['code-bg']);
    for(const key of ['ink',...['comment','keyword','literal','string','variable','attribute','name','error'].map(k=>'syntax-'+k)]){
      assert.match(tokens[key],/^#[0-9a-f]{6}$/i);const ink=luminance(tokens[key]),contrast=(Math.max(background,ink)+.05)/(Math.min(background,ink)+.05);
      assert.ok(contrast>=4.5,`${name} ${key} contrast ${contrast}`);
    }
  }
});
