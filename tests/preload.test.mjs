import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
test('theme preload adds its own bridge and preserves an existing native bridge',async()=>{
  // A synthetic bridge fixture; real installed bundles are verified during local staging.
  const original=`require('electron').contextBridge.exposeInMainWorld('electronBridge', {sendMessageFromView(){},getInitialSidebarBootstrap(){}});`;
  const additions=fs.readFileSync(new URL('../src/preload-extension.cjs',import.meta.url),'utf8'),exposed={},calls=[];
  const electron={contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(Object.hasOwn(exposed,name),false);exposed[name]=value;}},ipcRenderer:{sendSync:()=>({}),on(){},send(){},invoke:async(...args)=>{calls.push(args);return{ok:true};}},webUtils:{getPathForFile:()=>null}};
  const context={require:name=>{assert.equal(name,'electron');return electron;},window:{addEventListener(){}},document:{documentElement:{dataset:{}}},performance:{timeOrigin:0},process:{platform:'win32',arch:'x64'},module:{exports:{}},console};
  vm.runInNewContext(original+'\n'+additions,context,{timeout:1000});
  assert.equal(typeof exposed.electronBridge.sendMessageFromView,'function');assert.equal(typeof exposed.electronBridge.getInitialSidebarBootstrap,'function');
  await exposed.aemeathWish.saveSettings({schemaVersion:4});assert.equal(calls[0][0],'aemeath-wish:save-settings');
  assert.equal(typeof exposed.aemeathWish.chooseBackgroundFolder,'function');assert.equal('readFile' in exposed.aemeathWish,false);
});

test('native diagnostic geometry comes only from the authenticated app sender and contains no window content',async t=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const parent=path.join(root,'.test-tmp');fs.mkdirSync(parent,{recursive:true});
  const workspace=fs.mkdtempSync(path.join(parent,'host-diagnostic-'));
  t.after(()=>{assert.ok(fs.realpathSync(workspace).startsWith(fs.realpathSync(parent)+path.sep));fs.rmSync(workspace,{recursive:true});});
  const {install}=createRequire(import.meta.url)('../src/host-main.cjs');
  const handlers=new Map(),bounds={x:20,y:30,width:1200,height:800};let nativeReads=0;
  const owner={isDestroyed:()=>false,getBounds:()=>bounds,getContentBounds:()=>bounds};
  const auxiliary={isDestroyed:()=>false,isVisible:()=>true,getBounds:()=>({x:900,y:600,width:200,height:200}),isAlwaysOnTop:()=>true};
  install({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},app:{getVersion:()=> '26.1027.30824'},BrowserWindow:{fromWebContents:()=>{nativeReads++;return owner;},getAllWindows:()=>[owner,auxiliary]}},{workspaceRoot:workspace,runtimeRoot:path.join(workspace,'runtime'),assets:[],themeVersion:'0.1.8',adapterVersion:'test'});
  const call=handlers.get('aemeath-wish:diagnostics'),frame={url:'app://-/index.html'},sender={mainFrame:frame,getZoomFactor:()=>1.2};
  await assert.rejects(()=>call({sender,senderFrame:{url:'https://external.invalid'}},{}),/主应用窗口/);
  assert.equal(nativeReads,0);
  const report=await call({sender,senderFrame:frame},{companion:{button:{width:201}}});
  const data=JSON.parse(fs.readFileSync(report.path,'utf8'));
  assert.equal(data.nativeWindow.zoomFactor,1.2);assert.deepEqual(data.nativeWindow.bounds,bounds);
  assert.equal(data.nativeWindow.auxiliaryWindows.length,1);assert.equal(data.nativeWindow.auxiliaryWindows[0].alwaysOnTop,true);
  assert.equal(JSON.stringify(data).includes('app://'),false);
});
