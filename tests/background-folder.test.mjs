import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {normalizeConfig,serializeConfig} from '../dist/core.mjs';
import {reference} from '../dist/reference.mjs';
const require=createRequire(import.meta.url),{createStorage,inside}=require('../src/host-storage.cjs');
const {createBackgrounds,MAX_IMAGE}=require('../src/host-backgrounds.cjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0t8AAAAASUVORK5CYII=','base64');
function setup(t) {
  const parent=path.join(root,'.test-tmp');fs.mkdirSync(parent,{recursive:true});
  const base=fs.mkdtempSync(path.join(parent,'folder-')),workspace=path.join(base,'workspace'),external=path.join(base,'pictures');
  fs.mkdirSync(workspace);fs.mkdirSync(external);
  t.after(()=>{assert.ok(inside(root,fs.realpathSync(base)));fs.rmSync(base,{recursive:true});});
  const storage=createStorage(workspace,[]),library=createBackgrounds(workspace,[],storage.writeAtomic);
  return {base,workspace,external,storage,library};
}

test('folder catalog scans 1200 entries without reading image contents or persisting a playlist',async t=>{
  const {workspace,external,library}=setup(t);
  for(let i=1;i<=1200;i++)fs.writeFileSync(path.join(external,`小爱 ${i}.png`),png);
  let imageReads=0;const readFile=fs.promises.readFile,open=fs.promises.open;
  fs.promises.readFile=async function(file,...args){if(String(file).endsWith('.png'))imageReads++;return readFile.call(this,file,...args);};
  fs.promises.open=async function(file,...args){if(String(file).endsWith('.png'))imageReads++;return open.call(this,file,...args);};
  t.after(()=>{fs.promises.readFile=readFile;fs.promises.open=open;});
  const snapshot=await library.select(external);
  assert.equal(snapshot.images.length,1200);assert.equal(imageReads,0);
  assert.equal(snapshot.images[0].fileName,'小爱 1.png');assert.equal(snapshot.images[1].fileName,'小爱 2.png');
  assert.ok(fs.statSync(path.join(workspace,'data/background-source.json')).size<1024);
  assert.equal(fs.existsSync(path.join(external,'image-library.json')),false);
  const payload=await library.read(snapshot.images[0].id,snapshot.images[0].revision);
  assert.equal(imageReads,1);assert.equal(payload.mime,'image/png');assert.deepEqual(payload.bytes,png);
  assert.deepEqual(fs.readFileSync(path.join(external,'小爱 1.png')),png);
});

test('refresh adds and removes files, ignores nested/oversize files, rejects stale or arbitrary IDs',async t=>{
  const {external,library}=setup(t),file=path.join(external,'2.png');
  fs.writeFileSync(file,png);fs.writeFileSync(path.join(external,'10.png'),png);
  fs.mkdirSync(path.join(external,'nested'));fs.writeFileSync(path.join(external,'nested/1.png'),png);
  const oversized=path.join(external,'large.png');fs.closeSync(fs.openSync(oversized,'w'));fs.truncateSync(oversized,MAX_IMAGE+1);
  fs.writeFileSync(path.join(external,'notes.txt'),'not an image');
  const first=await library.select(external);assert.equal(first.images.length,2);assert.equal(first.skipped,1);
  const original=first.images[0];fs.writeFileSync(file,Buffer.concat([png,Buffer.from([0])]));
  await assert.rejects(library.read(original.id,original.revision),/已改变/);
  fs.unlinkSync(path.join(external,'10.png'));fs.writeFileSync(path.join(external,'1.png'),png);
  const second=await library.list();assert.deepEqual(second.images.map(a=>a.fileName),['1.png','2.png']);
  assert.equal(second.images[1].id,original.id);assert.notEqual(second.images[1].revision,original.revision);
  await assert.rejects(library.read(first.images[1].id,first.images[1].revision),/不在当前/);
  await assert.rejects(library.read('../data/settings.json','x'),/不在当前/);
  await assert.rejects(library.read(original.id,original.revision),/列表已更新/);
});

test('empty and disconnected folders remain selected and never trigger bulk reads or source writes',async t=>{
  const {base,workspace,external,library}=setup(t);
  assert.match((await library.select(external)).warning,/暂无/);
  const source=fs.readFileSync(path.join(workspace,'data/background-source.json'));
  fs.renameSync(external,path.join(base,'temporarily-away'));
  const unavailable=await library.list();assert.equal(unavailable.images.length,0);assert.equal(unavailable.folder,external);assert.match(unavailable.warning,/无法读取/);
  assert.deepEqual(fs.readFileSync(path.join(workspace,'data/background-source.json')),source);
  fs.renameSync(path.join(base,'temporarily-away'),external);fs.writeFileSync(path.join(external,'back.png'),png);
  assert.equal((await library.list()).images.length,1);
});

test('default-folder migration copies existing backgrounds once and preserves the selected image',async t=>{
  const {workspace,external,storage}=setup(t);
  const bundled=path.join(external,'built-in.png'),imported=path.join(external,'用户图片.png');fs.writeFileSync(bundled,png);fs.writeFileSync(imported,png);
  const old={id:crypto.createHash('sha256').update(png).digest('hex')+'.png'};
  fs.mkdirSync(path.join(workspace,'data/wallpapers'),{recursive:true});fs.writeFileSync(path.join(workspace,'data/wallpapers',old.id),png);
  storage.writeAtomic(path.join(workspace,'data/image-library.json'),{[old.id]:'用户图片'});
  fs.writeFileSync(path.join(workspace,'data/settings.json'),JSON.stringify({schemaVersion:5,wallpaperId:old.id,glow:23}));
  const originalSettings=fs.readFileSync(path.join(workspace,'data/settings.json'));
  const assets=[{id:'builtin-stars',path:bundled,role:'wallpaper'}];
  const library=createBackgrounds(workspace,assets,storage.writeAtomic),snapshot=await library.list();
  assert.equal(snapshot.images.length,2);assert.equal(snapshot.images.find(a=>a.id===snapshot.legacyCurrentId).fileName,'用户图片.png');
  for(const name of ['built-in.png','用户图片.png'])assert.deepEqual(fs.readFileSync(path.join(workspace,'backgrounds',name)),png);
  assert.deepEqual(fs.readFileSync(imported),png);assert.deepEqual(fs.readFileSync(bundled),png);assert.deepEqual(fs.readFileSync(path.join(workspace,'data/settings.json')),originalSettings);
  const reopened=createBackgrounds(workspace,assets,storage.writeAtomic);assert.equal((await reopened.list()).images.length,2);
});

test('folder settings stay small for 10000 images and keep theme, motion and pinned-project preferences',()=>{
  const ids=Array.from({length:10000},(_,i)=>'folder:'+String(i).padStart(64,'0'));
  const config=normalizeConfig({schemaVersion:5,theme:'rose',glow:23,glowMode:'manual',companionSize:172,pinnedProjects:[{key:'local:local:p',name:'项目'},null,null,null],wallpaperIds:[ids[0]],wallpaperId:ids[7]},reference,ids);
  assert.equal(config.wallpaperIds.length,10000);assert.equal(config.wallpaperId,ids[7]);
  const saved=serializeConfig(config);assert.equal(saved.schemaVersion,7);assert.equal('wallpaperIds' in saved,false);assert.ok(JSON.stringify(saved).length<4096);
  assert.equal(saved.glow,23);assert.equal(saved.glowMode,'manual');assert.equal(saved.companionSize,172);assert.equal(saved.pinnedProjects[0].name,'项目');
  assert.deepEqual(normalizeConfig(saved,reference,ids).wallpaperIds,ids);
});

test('folder selection is authorized by the native dialog, persists, and opens only that directory',async t=>{
  const {workspace,external}=setup(t),handlers=new Map(),opened=[];let canceled=false;
  const {install}=require('../src/host-main.cjs');
  install({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog:{showOpenDialog:async options=>{assert.deepEqual(options.properties,['openDirectory']);return {canceled,filePaths:[external]};}},shell:{openPath:async folder=>{opened.push(folder);return '';}},app:{getVersion:()=> 'test'}},{workspaceRoot:workspace,runtimeRoot:path.join(workspace,'runtime'),assets:[]});
  const frame={url:'app://-/index.html'},event={senderFrame:frame,sender:{mainFrame:frame}};
  await assert.rejects(handlers.get('aemeath-wish:choose-background-folder')(event,'C:\\untrusted'),/未知主题/);
  const selected=await handlers.get('aemeath-wish:choose-background-folder')(event,'rose','C:\\untrusted');assert.equal(selected.folder,external);
  await handlers.get('aemeath-wish:open-background-folder')(event,'rose','C:\\untrusted');assert.deepEqual(opened,[external]);
  canceled=true;assert.equal(await handlers.get('aemeath-wish:choose-background-folder')(event,'rose'),null);
  assert.equal((await handlers.get('aemeath-wish:get-backgrounds')(event,'rose')).folder,external);
  assert.equal(handlers.has('aemeath-wish:import-images'),false);
});

test('shared folder migration preserves originals, while each theme keeps its own catalog after restart',async t=>{
  const {base,workspace,external,storage}=setup(t),second=path.join(base,'dark-pictures');fs.mkdirSync(second);
  fs.writeFileSync(path.join(external,'rose.png'),png);fs.writeFileSync(path.join(second,'plum.png'),png);
  const old={schemaVersion:1,folder:external,legacyCurrentId:'old-import-id'};
  storage.writeAtomic(path.join(workspace,'data/background-source.json'),old);
  const library=createBackgrounds(workspace,[],storage.writeAtomic);
  const light=await library.list('rose'),initialDark=await library.list('plum');
  assert.equal(light.folder,external);assert.equal(initialDark.folder,external);assert.equal(initialDark.legacyCurrentId,'old-import-id');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(workspace,'data/background-source.v1.json'))),old);
  const dark=await library.select(second,'plum');
  assert.equal((await library.read(light.images[0].id,light.images[0].revision,'rose')).mime,'image/png');
  await assert.rejects(library.read(dark.images[0].id,dark.images[0].revision,'rose'),/不在当前/);
  const reopened=createBackgrounds(workspace,[],storage.writeAtomic);
  assert.equal((await reopened.list('rose')).folder,external);assert.equal((await reopened.list('plum')).folder,second);
  // Both themes can intentionally share one folder again without merging prefs.
  await reopened.select(external,'plum');assert.equal((await reopened.list('plum')).images[0].id,light.images[0].id);
  assert.deepEqual(fs.readdirSync(external),['rose.png']);assert.deepEqual(fs.readdirSync(second),['plum.png']);
  assert.deepEqual(fs.readFileSync(path.join(external,'rose.png')),png);
});
