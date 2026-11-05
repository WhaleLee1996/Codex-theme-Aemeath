'use strict';
const path = require('node:path');
const fs = require('node:fs');
const {createStorage, inside} = require('./host-storage.cjs');
const {createBackgrounds} = require('./host-backgrounds.cjs');

// Packaged roots and assets are relative to the actual runtime, not its build location.
// Legacy absolute configuration remains supported for fixtures and older bundles.
function resolveConfiguration(configuration, resourcesPath = process.resourcesPath) {
  if (configuration.pathMode !== 'runtime-relative') return configuration;
  if (typeof resourcesPath !== 'string' || !path.isAbsolute(resourcesPath)) throw new Error('无法定位主题运行目录');
  const runtime = path.dirname(resourcesPath);
  const root = path.resolve(runtime, configuration.workspaceRoot);
  if (configuration.runtimeRoot !== '.' || path.dirname(runtime) !== path.join(root, 'runtime')) throw new Error('主题目录结构不正确');
  const assets = configuration.assets.map(asset => {
    if (path.isAbsolute(asset.path)) throw new Error('主题素材必须使用项目相对路径');
    const file = path.resolve(root, asset.path);
    if (!inside(root, file)) throw new Error('主题素材超出项目目录');
    return {...asset, path:file};
  });
  return {...configuration, workspaceRoot:root, runtimeRoot:runtime, assets};
}

function install({ipcMain, dialog, app, shell, BrowserWindow}, configuration) {
  configuration = resolveConfiguration(configuration);
  const root = path.resolve(configuration.workspaceRoot);
  const storage = createStorage(root);
  const backgrounds = createBackgrounds(root, configuration.assets, storage.writeAtomic, configuration.themeIds);
  const bundled = path.resolve(configuration.runtimeRoot);
  function assertSender(event) {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) throw new Error('仅主应用窗口可使用主题设置');
    const url = new URL(event.senderFrame.url);
    const isApp = url.protocol === 'app:' && (url.hostname === '-' || url.hostname === 'localhost');
    const isLocal = url.protocol === 'file:' && inside(bundled, require('node:url').fileURLToPath(url));
    if (!isApp && !isLocal) throw new Error('主题接口不接受外部页面');
  }
  function handle(name, fn) {ipcMain.handle('aemeath-wish:' + name, async (event, ...args) => {assertSender(event); return fn(...args);});}
  handle('read-settings', () => ({...storage.readConfig(), disabled:process.env.AEMEATH_WISH_DISABLE === '1'}));
  handle('save-settings', value => storage.saveConfig(value));
  handle('get-backgrounds', theme => backgrounds.list(theme));
  handle('read-image', (id, revision, theme) => backgrounds.read(String(id),String(revision),theme));
  handle('choose-background-folder', async theme => {
    const result = await dialog.showOpenDialog({title:'选择当前主题的背景文件夹',defaultPath:await backgrounds.folder(theme),properties:['openDirectory']});
    if(result.canceled || !result.filePaths[0])return null;
    return backgrounds.select(result.filePaths[0],theme);
  });
  handle('open-background-folder', async theme => {
    const error=await shell.openPath(await backgrounds.folder(theme));
    if(error)throw new Error('无法打开背景文件夹：'+error);
    return {opened:true};
  });
  handle('import-settings', async () => {
    const result = await dialog.showOpenDialog({title: '导入小爱主题设置', defaultPath: path.join(root, 'exports'), properties: ['openFile'], filters: [{name: 'JSON 设置', extensions: ['json']}]});
    if (result.canceled || !result.filePaths[0]) return null;
    const file = result.filePaths[0];
    if (fs.statSync(file).size > 256 * 1024) throw new Error('设置文件过大');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  });
  handle('export-settings', value => storage.exportJson('settings', value));
  ipcMain.handle('aemeath-wish:diagnostics', async (event, value) => {
    assertSender(event);
    let nativeWindow = null;
    try {
      const owner = BrowserWindow?.fromWebContents(event.sender);
      if (owner && !owner.isDestroyed()) nativeWindow = {
        bounds:owner.getBounds(),contentBounds:owner.getContentBounds(),zoomFactor:event.sender.getZoomFactor(),
        auxiliaryWindows:BrowserWindow.getAllWindows().filter(window => window !== owner && !window.isDestroyed() && window.isVisible()).map(window => ({bounds:window.getBounds(),alwaysOnTop:window.isAlwaysOnTop()}))
      };
    } catch (error) {nativeWindow = {error:String(error.message)};}
    return storage.exportJson('diagnostics', {themeVersion: configuration.themeVersion, adapterVersion: configuration.adapterVersion, appVersion: app.getVersion(), recordedAt: new Date().toISOString(), checks:value, nativeWindow});
  });
}
module.exports = {install, resolveConfiguration};
