import fs from 'node:fs';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseLaunchArgs, createLaunchPlan, launchProblems, validateLaunchFiles, acquireLaunchLock, resolveRuntime} from './launch-plan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8').replace(/^\uFEFF/, ''));
const inspect = () => {
  if (process.platform !== 'win32') throw new Error('日常启动入口仅支持 Windows。');
  const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    const output = execFileSync(powershell, ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts','inspect-launch.ps1')], {encoding:'utf8',windowsHide:true,timeout:20000});
    const probe = JSON.parse(output.replace(/^\uFEFF/, ''));
    if (!Array.isArray(probe.packages) || !Array.isArray(probe.processes)) throw new Error('Invalid probe');
    return probe;
  } catch { throw new Error('无法检查 Codex 的安装版本或运行实例，因此没有启动。请查看入口说明。'); }
};

async function main() {
  const options = parseLaunchArgs(process.argv.slice(2));
  const manifest = read('runtime/current.json');
  const stage = read(path.relative(root, path.join(resolveRuntime(root, manifest), 'aemeath-stage.json')));
  const settings = fs.existsSync(path.join(root,'data/launch-profile.json')) ? read('data/launch-profile.json') : null;
  const plan = createLaunchPlan({root, manifest, stage, settings, options});
  validateLaunchFiles(plan);
  const summary = {executable:plan.executable, profileMode:plan.profileMode, appData:plan.appData, browserData:plan.browserData, codexHome:plan.codexHome, themeDisabled:plan.themeDisabled};
  if (options.check) {
    const probe = inspect();
    const problems = launchProblems(plan, settings, probe);
    console.log(JSON.stringify({...summary, readyToLaunch:problems.length===0, problems, probe, checkOnly:true},null,2));
    return;
  }
  const release = acquireLaunchLock(root);
  try {
    const problems = launchProblems(plan, settings, inspect());
    if (problems.length) throw new Error(problems.join('\n'));
    if (plan.profileMode === 'isolated') {
      for (const folder of [plan.appData, plan.codexHome]) fs.mkdirSync(folder, {recursive:true});
    }
    fs.mkdirSync(plan.temp, {recursive:true});
    fs.mkdirSync(path.join(root,'logs'), {recursive:true});
    fs.mkdirSync(path.join(root,'diagnostics'), {recursive:true});
    const startedAt = new Date().toISOString();
    const logPath = path.join(root,'logs','launch-'+startedAt.replace(/[:.]/g,'-')+'.log');
    const log = fs.openSync(logPath,'a');
    const record = {...summary, startedAt, buildManifestSha256:stage.buildManifestSha256, adapterVersion:stage.adapterVersion, logPath, nativeVisualAcceptance:false};
    await new Promise((resolve, reject) => {
      const child = spawn(plan.executable, plan.args, {cwd:root, env:plan.env, detached:true, stdio:['ignore',log,log], windowsHide:false});
      let completed = false;
      const finish = (state, extra={}) => {
        if (completed) return false;
        completed = true;
        clearTimeout(timer);
        fs.closeSync(log);
        Object.assign(record, {state, pid:child.pid??null, observedAt:new Date().toISOString()}, extra);
        fs.writeFileSync(path.join(root,'diagnostics/last-launch.json'), JSON.stringify(record,null,2)+'\n');
        return true;
      };
      const timer = setTimeout(() => {
        if (finish('running-after-startup', {observedForMs:8000})) {
          console.log((plan.profileMode === 'original' ? '原资料日常入口' : '独立试验入口')+'已启动（PID '+child.pid+'）。启动器即将退出。');
          child.unref();
          resolve();
        }
      }, 8000);
      child.once('error', error => { if (finish('spawn-failed', {error:error.message})) reject(error); });
      child.once('exit', (code,signal) => {
        if (finish('exited-before-startup-check', {exitCode:code,signal})) reject(new Error('应用提前退出，退出码 '+code+'。日志：'+logPath));
      });
    });
  } finally { release(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
