import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{createStorage,inside}=require('../src/host-storage.cjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function sandbox(t) {const base=path.join(root,'.test-tmp');fs.mkdirSync(base,{recursive:true});const dir=fs.mkdtempSync(path.join(base,'storage-'));t.after(()=>{assert.ok(inside(root,fs.realpathSync(dir)));fs.rmSync(dir,{recursive:true});});return dir;}
test('atomic settings save preserves the previous version and corrupt original',t=>{
  const dir=sandbox(t),store=createStorage(dir,[]);store.saveConfig({schemaVersion:7,glow:20});store.saveConfig({schemaVersion:7,glow:40});
  assert.equal(store.readConfig().config.glow,40);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'data/settings.previous.json'))).glow,20);
  fs.writeFileSync(path.join(dir,'data/settings.json'),'bad json');assert.equal(store.readConfig().corrupt,true);store.saveConfig({schemaVersion:7,glow:0});
  const preserved=fs.readdirSync(path.join(dir,'data')).find(n=>n.startsWith('settings.corrupt-'));assert.equal(fs.readFileSync(path.join(dir,'data',preserved),'utf8'),'bad json');
});

test('v6 settings have a stable migration backup even after several v7 saves',t=>{
  const dir=sandbox(t),store=createStorage(dir),old={schemaVersion:6,opacity:10,theme:'plum',themeAdjustments:{rose:{opacity:85}}};
  store.writeAtomic(path.join(dir,'data/settings.json'),old);
  store.saveConfig({schemaVersion:7,opacity:0});store.saveConfig({schemaVersion:7,opacity:20});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'data/settings.v6.json'))),old);
});
test('settings and diagnostics cannot write outside the workspace',t=>{
  const dir=sandbox(t),store=createStorage(dir);
  assert.throws(()=>store.exportJson('../outside',{}));assert.throws(()=>store.writeAtomic(path.join(dir,'../escape.json'),{}));
});

test('host RPC rejects remote origins and child frames',t=>{
  const {install}=require('../src/host-main.cjs');const dir=sandbox(t),handlers=new Map();
  install({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog:{},app:{getVersion:()=> 'test'}},{workspaceRoot:dir,runtimeRoot:path.join(dir,'runtime'),assets:[]});
  const fn=handlers.get('aemeath-wish:read-settings');const frame={url:'https://example.com'},event={senderFrame:frame,sender:{mainFrame:frame}};
  return assert.rejects(fn(event),/外部页面/).then(()=>{const main={url:'app://-/index.html'};return assert.rejects(fn({senderFrame:frame,sender:{mainFrame:main}}),/主应用/);});
});
