import fs from 'node:fs';
import path from 'node:path';

export function parseLaunchArgs(args) {
  const options = {profile:null, native:false, check:false};
  for (const arg of args) {
    if (arg === '--native') options.native = true;
    else if (arg === '--check') options.check = true;
    else if (arg === '--original' || arg === '--isolated') {
      const profile = arg.slice(2);
      if (options.profile && options.profile !== profile) throw new Error('不能同时指定两种资料。');
      options.profile = profile;
    } else throw new Error('未知启动参数：' + arg);
  }
  return options;
}

export function resolveRuntime(root, manifest) {
  if (typeof manifest?.runtime !== 'string' || !manifest.runtime) throw new Error('无效的启动副本路径。');
  const runtime = path.resolve(root, manifest.runtime);
  const relative = path.relative(path.join(root, 'runtime'), runtime);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('无效的启动副本路径。');
  return runtime;
}

export function createLaunchPlan({root, manifest, stage, settings, options, env=process.env}) {
  const runtime = resolveRuntime(root, manifest);
  const profileMode = options.profile ?? settings?.defaultMode ?? 'isolated';
  if (!['original','isolated'].includes(profileMode)) throw new Error('未知资料模式。');
  let appData, browserData, codexHome;
  if (profileMode === 'original') {
    const original = settings?.original;
    if (!original?.authorizedAt) throw new Error('尚未配置经用户授权的原 Codex 资料目录。');
    ({appData, browserData, codexHome} = original);
    for (const value of [appData, browserData, codexHome]) {
      if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('原资料必须使用已核对的绝对路径。');
    }
    if (original.appVersion !== manifest.version || original.appVersion !== stage.appVersion ||
        path.resolve(original.installedApp).toLowerCase() !== path.resolve(stage.sourceApp).toLowerCase()) {
      throw new Error('原应用与主题副本的版本基线不一致，请先适配主题。');
    }
  } else {
    appData = browserData = path.join(root, 'profiles', 'app');
    codexHome = path.join(root, 'profiles', 'codex');
  }
  const temp = path.join(root, 'profiles', 'temp');
  const childEnv = {...env, CODEX_ELECTRON_USER_DATA_PATH:appData, CODEX_HOME:codexHome, TEMP:temp, TMP:temp};
  if (options.native) childEnv.AEMEATH_WISH_DISABLE = '1'; else delete childEnv.AEMEATH_WISH_DISABLE;
  return {
    executable:path.join(runtime, 'ChatGPT.exe'), runtime, profileMode,
    appData, browserData, codexHome, temp, themeDisabled:options.native,
    args:['--user-data-dir=' + browserData, '--enable-logging=stderr'], env:childEnv,
  };
}

export function launchProblems(plan, settings, probe) {
  const problems = [];
  if (plan.profileMode === 'original') {
    const original = settings.original;
    const installed = probe.packages.find(p => p.name === 'OpenAI.Codex');
    if (!installed || installed.version !== original.msixVersion ||
        path.resolve(installed.installLocation, 'app').toLowerCase() !== path.resolve(original.installedApp).toLowerCase()) {
      problems.push('原 Codex 的安装版本已改变或无法确认。请先更新主题适配，再复用原资料；现在仍可使用官方入口。');
    }
  }
  const runtimeParent = path.dirname(plan.runtime);
  const running = probe.processes.filter(p => {
    if (plan.profileMode === 'original' || !p.path) return true;
    const relative = path.relative(runtimeParent, path.resolve(p.path));
    return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  });
  if (running.length) {
    problems.push(plan.profileMode === 'original'
      ? '请保存内容并完全退出原 Codex 和小爱试验副本，再打开日常入口。关闭窗口后若仍驻留后台，请从应用菜单退出。'
      : '小爱副本已经运行。请先使用现有窗口，或完全退出后再切换资料／外观。');
  }
  return problems;
}

export function validateLaunchFiles(plan) {
  if (!fs.statSync(plan.executable).isFile()) throw new Error('主题副本程序不存在。');
  if (plan.profileMode === 'original') {
    for (const folder of [plan.appData, plan.browserData, plan.codexHome]) {
      if (!fs.statSync(folder).isDirectory()) throw new Error('原资料目录不存在：' + folder);
    }
  }
}

// Serialize launcher invocations; never remove a lock held by a live process.
export function acquireLaunchLock(root, ownerPid=process.pid, alive=pid => {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}) {
  const lock = path.join(root, 'profiles', 'launcher.lock');
  fs.mkdirSync(path.dirname(lock), {recursive:true});
  for (let attempt=0; attempt<2; attempt++) {
    let fd;
    try { fd = fs.openSync(lock, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let pid;
      try { pid = Number(fs.readFileSync(lock, 'utf8')); } catch {}
      // An incomplete lock may be in the tiny create/write interval: leave it alone.
      if (!Number.isSafeInteger(pid) || pid <= 0 || alive(pid)) throw new Error('另一个启动器正在运行，请稍后再试。');
      fs.unlinkSync(lock);
      continue;
    }
    try { fs.writeFileSync(fd, String(ownerPid)); } finally { fs.closeSync(fd); }
    return () => {
      if (fs.existsSync(lock) && fs.readFileSync(lock, 'utf8') === String(ownerPid)) fs.unlinkSync(lock);
    };
  }
  throw new Error('无法获得启动锁，请稍后再试。');
}
