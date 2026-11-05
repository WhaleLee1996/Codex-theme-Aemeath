import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {createStorage,inside}=require('../src/host-storage.cjs');
const {createBackgrounds}=require('../src/host-backgrounds.cjs');
const {resolveConfiguration}=require('../src/host-main.cjs');
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0t8AAAAASUVORK5CYII=','base64');
const imageId=file=>'folder:'+crypto.createHash('sha256').update(path.resolve(file)).digest('hex');
function fixture(t) {
  const parent=path.join(workspace,'.test-tmp');fs.mkdirSync(parent,{recursive:true});
  const base=fs.mkdtempSync(path.join(parent,'relocation-'));
  const before=path.join(base,'before'),after=path.join(base,'after'),external=path.join(base,'external');
  fs.mkdirSync(before);fs.mkdirSync(external);
  t.after(()=>{assert.ok(inside(workspace,fs.realpathSync(base)));fs.rmSync(base,{recursive:true});});
  return {base,before,after,external};
}

test('both theme folders and current image IDs survive a real rename; settings and photos remain byte-identical',async t=>{
  const {before,after}=fixture(t),storage=createStorage(before);
  const themes={};
  for(const name of ['rose','plum']) {
    const folder=path.join(before,'backgrounds_'+name);fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder,'小爱.png'),png);themes[name]={folder};
  }
  const original={schemaVersion:2,themes};storage.writeAtomic(path.join(before,'data/background-source.json'),original);
  const config={schemaVersion:7,theme:'plum',opacity:0,companionSize:157,pinnedProjects:[{key:'chatgpt:test',name:'keep'}],themeAdjustments:{rose:{opacity:92,wallpaperId:imageId(path.join(themes.rose.folder,'小爱.png'))},plum:{opacity:0,wallpaperId:imageId(path.join(themes.plum.folder,'小爱.png'))}}};
  storage.saveConfig(config);const settingsBytes=fs.readFileSync(path.join(before,'data/settings.json'));
  const library=createBackgrounds(before,[],storage.writeAtomic);
  for(const name of ['rose','plum'])assert.equal((await library.list(name)).images[0].id,config.themeAdjustments[name].wallpaperId);
  const migrated=JSON.parse(fs.readFileSync(path.join(before,'data/background-source.json')));
  assert.equal(migrated.schemaVersion,3);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(before,'data/background-source.v2.json'))),original);
  fs.renameSync(before,after);
  const reopened=createBackgrounds(after,[],createStorage(after).writeAtomic);
  for(const name of ['rose','plum']) {
    const list=await reopened.list(name);
    assert.equal(list.folder,path.join(after,'backgrounds_'+name));
    assert.equal(list.images.length,1);assert.equal(list.images[0].id,config.themeAdjustments[name].wallpaperId);
    assert.deepEqual((await reopened.read(list.images[0].id,list.images[0].revision,name)).bytes,png);
    assert.equal(await reopened.folder(name),list.folder);
    assert.deepEqual(fs.readFileSync(path.join(list.folder,'小爱.png')),png);
  }
  assert.equal(fs.existsSync(before),false);
  assert.deepEqual(fs.readFileSync(path.join(after,'data/settings.json')),settingsBytes);
});

test('external background folders stay absolute while a selected workspace root is portable',async t=>{
  const {before,after,external}=fixture(t),storage=createStorage(before),library=createBackgrounds(before,[],storage.writeAtomic);
  fs.writeFileSync(path.join(before,'home.png'),png);fs.writeFileSync(path.join(external,'away.png'),png);
  const light=await library.select(before,'rose'),dark=await library.select(external,'plum');
  const source=JSON.parse(fs.readFileSync(path.join(before,'data/background-source.json')));
  assert.equal(source.themes.rose.folder,'.');assert.equal(source.themes.rose.relativeTo,'workspace');
  assert.equal(source.themes.plum.folder,external);assert.equal(source.themes.plum.relativeTo,undefined);
  fs.renameSync(before,after);
  const reopened=createBackgrounds(after,[],createStorage(after).writeAtomic);
  assert.equal((await reopened.list('rose')).images[0].id,light.images[0].id);
  assert.equal((await reopened.list('plum')).images[0].id,dark.images[0].id);
  assert.equal(await reopened.folder('plum'),external);
  assert.deepEqual(fs.readdirSync(external),['away.png']);
});

test('relative background entries cannot escape the project or impersonate an absolute folder',async t=>{
  const {before,external}=fixture(t),storage=createStorage(before);
  for(const folder of ['../external',external]) {
    storage.writeAtomic(path.join(before,'data/background-source.json'),{schemaVersion:3,themes:{rose:{folder,relativeTo:'workspace'},plum:{folder,relativeTo:'workspace'}}});
    await assert.rejects(createBackgrounds(before,[],storage.writeAtomic).list('rose'),/损坏/);
  }
});

test('packaged roots and asset paths resolve against the moved Electron resources directory', t=>{
  const {before,after}=fixture(t);
  const relative='runtime/app-version';
  fs.mkdirSync(path.join(before,relative,'resources'),{recursive:true});
  fs.mkdirSync(path.join(before,'preview/assets'),{recursive:true});
  fs.writeFileSync(path.join(before,'preview/assets/小爱.png'),png);
  const config={pathMode:'runtime-relative',workspaceRoot:'../..',runtimeRoot:'.',assets:[{id:'builtin-aemeath',path:'preview/assets/小爱.png'}]};
  fs.renameSync(before,after);
  const resources=path.join(after,relative,'resources'),resolved=resolveConfiguration(config,resources);
  assert.equal(resolved.workspaceRoot,after);assert.equal(resolved.runtimeRoot,path.dirname(resources));
  assert.deepEqual(fs.readFileSync(resolved.assets[0].path),png);
  assert.equal(config.assets[0].path,'preview/assets/小爱.png');
  assert.throws(()=>resolveConfiguration({...config,workspaceRoot:'..'},resources),/目录结构/);
  for(const assetPath of ['../external/photo.png',path.join(before,'preview/assets/小爱.png')]) {
    assert.throws(()=>resolveConfiguration({...config,assets:[{path:assetPath}]},resources),/相对路径|超出/);
  }
});
