// Appended to the copied original preload. No Node integration is added to pages.
{
  const {contextBridge, ipcRenderer} = require('electron');
  const methods = {readSettings:'read-settings', saveSettings:'save-settings', getBackgrounds:'get-backgrounds', readImage:'read-image', chooseBackgroundFolder:'choose-background-folder', openBackgroundFolder:'open-background-folder', importSettings:'import-settings', exportSettings:'export-settings', diagnostics:'diagnostics'};
  contextBridge.exposeInMainWorld('aemeathWish', Object.fromEntries(Object.entries(methods).map(([method, channel]) => [method, (...args) => ipcRenderer.invoke('aemeath-wish:' + channel, ...args)])));
}
