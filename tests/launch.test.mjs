import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseLaunchArgs, createLaunchPlan, launchProblems, validateLaunchFiles, acquireLaunchLock, resolveRuntime} from '../scripts/launch-plan.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function fixture(t) {
  const base = path.join(workspace, '.test-tmp');
  fs.mkdirSync(base, {recursive:true});
  const root = fs.mkdtempSync(path.join(base, 'launch-'));
  t.after(() => {
    assert.ok(fs.realpathSync(root).startsWith(base + path.sep));
    fs.rmSync(root, {recursive:true});
  });
  const runtime = path.join(root,'runtime','1');
  const installedApp = path.join(root,'installed','app');
  const original = {authorizedAt:'2026-11-04', appVersion:'1', msixVersion:'1.0', installedApp,
    appData:path.join(root,'original-app'), browserData:path.join(root,'original-browser'), codexHome:path.join(root,'original-codex')};
  for (const dir of [runtime, original.appData, original.browserData, original.codexHome]) fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(runtime,'ChatGPT.exe'),'fixture');
  const settings = {defaultMode:'original', original};
  const input = {root, manifest:{runtime,version:'1'}, stage:{appVersion:'1',sourceApp:installedApp},settings,options:parseLaunchArgs([]),env:{}};
  const probe = {packages:[{name:'OpenAI.Codex',version:'1.0',installLocation:path.dirname(installedApp)}],processes:[]};
  return {root, original, settings, input, probe, plan:createLaunchPlan(input)};
}

test('daily launch preserves distinct Electron, Chromium and Codex profile paths; inherited trial env cannot redirect them', t => {
  const f=fixture(t);
  const plan=createLaunchPlan({...f.input,env:{CODEX_HOME:'wrong',CODEX_ELECTRON_USER_DATA_PATH:'wrong',AEMEATH_WISH_DISABLE:'1'}});
  assert.equal(plan.env.CODEX_HOME, f.original.codexHome);
  assert.equal(plan.env.CODEX_ELECTRON_USER_DATA_PATH, f.original.appData);
  assert.equal(plan.args[0], '--user-data-dir='+f.original.browserData);
  assert.equal(plan.env.AEMEATH_WISH_DISABLE, undefined);
  assert.deepEqual(launchProblems(plan,f.settings,f.probe),[]);
  validateLaunchFiles(plan);
});

test('isolated mode keeps original profiles untouched; native fallback uses the same selected profile', t => {
  const f=fixture(t);
  const isolated=createLaunchPlan({...f.input,options:parseLaunchArgs(['--isolated'])});
  assert.equal(isolated.appData,path.join(f.root,'profiles','app'));
  assert.equal(isolated.codexHome,path.join(f.root,'profiles','codex'));
  assert.equal(isolated.browserData,isolated.appData);
  assert.equal(fs.existsSync(path.join(f.root,'profiles')),false);
  const native=createLaunchPlan({...f.input,options:parseLaunchArgs(['--native'])});
  assert.deepEqual(native.args,f.plan.args);
  assert.equal(native.appData,f.plan.appData);
  assert.equal(native.env.AEMEATH_WISH_DISABLE,'1');
  assert.equal(createLaunchPlan({...f.input,settings:null}).profileMode,'isolated');
});

test('original launch requires consent and matching installed runtime versions', t => {
  const f=fixture(t);
  assert.throws(()=>createLaunchPlan({...f.input,settings:null,options:parseLaunchArgs(['--original'])}),/授权/);
  assert.throws(()=>createLaunchPlan({...f.input,manifest:{...f.input.manifest,version:'2'}}),/版本/);
  assert.throws(()=>createLaunchPlan({...f.input,manifest:{...f.input.manifest,runtime:path.join(f.root,'outside')}}),/路径/);
  assert.equal(launchProblems(f.plan,f.settings,{...f.probe,packages:[]}).length,1);
  assert.equal(launchProblems(f.plan,f.settings,{...f.probe,packages:[{...f.probe.packages[0],version:'2.0'}]}).length,1);
  assert.throws(()=>parseLaunchArgs(['--original','--isolated']),/两种/);
  assert.throws(()=>parseLaunchArgs(['--force']),/未知/);
});

test('running original or trial processes block daily reuse, including background-only processes', t => {
  const f=fixture(t);
  for (const exe of [path.join(f.original.installedApp,'ChatGPT.exe'),f.plan.executable,null]) {
    assert.match(launchProblems(f.plan,f.settings,{...f.probe,processes:[{path:exe,hasWindow:false}]})[0],/完全退出/);
  }
  const isolated=createLaunchPlan({...f.input,options:parseLaunchArgs(['--isolated'])});
  assert.equal(launchProblems(isolated,f.settings,{...f.probe,processes:[{path:path.join(f.original.installedApp,'ChatGPT.exe')}]}).length,0);
  assert.equal(launchProblems(isolated,f.settings,{...f.probe,processes:[{path:f.plan.executable}]}).length,1);
  assert.equal(launchProblems(isolated,f.settings,{...f.probe,processes:[{path:path.join(f.root,'runtime','older-theme','ChatGPT.exe')}]}).length,1);
});

test('missing original directories fail without creating a blank replacement', t => {
  const f=fixture(t), missing=path.join(f.root,'missing');
  assert.throws(()=>validateLaunchFiles({...f.plan,browserData:missing}));
  assert.equal(fs.existsSync(missing),false);
});

test('launcher lock rejects simultaneous starts and recovers a dead launcher without touching profiles', t => {
  const f=fixture(t);
  const release=acquireLaunchLock(f.root,100,()=>true);
  assert.throws(()=>acquireLaunchLock(f.root,101,()=>true),/正在运行/);
  release();
  const stale=path.join(f.root,'profiles','launcher.lock');
  fs.writeFileSync(stale,'999999');
  const releaseRecovered=acquireLaunchLock(f.root,102,()=>false);
  assert.equal(fs.readFileSync(stale,'utf8'),'102');
  releaseRecovered();
  assert.equal(fs.existsSync(stale),false);
  assert.deepEqual(fs.readdirSync(f.original.codexHome),[]);
});


test('relative runtime manifests work after a real project rename, without depending on the caller cwd', t => {
  const f=fixture(t),before=path.join(f.root,'project-before'),after=path.join(f.root,'project-after');
  fs.mkdirSync(path.join(before,'runtime','1'),{recursive:true});
  fs.writeFileSync(path.join(before,'runtime','1','ChatGPT.exe'),'fixture');
  const manifest={version:'1',runtime:'runtime/1'};
  const settings={defaultMode:'isolated'};
  validateLaunchFiles(createLaunchPlan({...f.input,root:before,manifest,settings}));
  assert.ok(path.resolve(process.cwd())!==after);
  fs.renameSync(before,after);
  const relocated=createLaunchPlan({...f.input,root:after,manifest,settings});
  validateLaunchFiles(relocated);
  assert.equal(relocated.runtime,path.join(after,'runtime','1'));
  assert.equal(relocated.appData,path.join(after,'profiles','app'));
  assert.equal(relocated.temp,path.join(after,'profiles','temp'));
  assert.equal(fs.existsSync(before),false);
  for(const runtime of ['', '../outside', 'runtime/../../outside', path.join(before,'runtime','1')]) {
    assert.throws(()=>resolveRuntime(after,{runtime}),/路径/);
  }
});
