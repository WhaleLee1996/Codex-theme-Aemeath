'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function inside(root, file) {const relative = path.relative(path.resolve(root), path.resolve(file)); return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);}
function createStorage(root) {
  root = path.resolve(root);
  const data = path.join(root, 'data');
  const config = path.join(data, 'settings.json');
  function writeAtomic(file, value) {
    if (!inside(root, file)) throw new Error('输出路径不在项目目录中');
    const text = JSON.stringify(value, null, 2) + '\n';
    if (Buffer.byteLength(text) > 256 * 1024) throw new Error('配置或诊断文件过大');
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const temporary = file + '.tmp-' + crypto.randomUUID();
    try { fs.writeFileSync(temporary, text, {flag: 'wx'}); fs.renameSync(temporary, file); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  function readConfig() {
    try {return {config: JSON.parse(fs.readFileSync(config, 'utf8')), warning: null};}
    catch (error) {
      if (error.code === 'ENOENT') return {config: null, warning: null};
      return {config: null, warning: '设置文件无法读取，已保留原文件。恢复默认前可查看 data/settings.json。', corrupt: true};
    }
  }
  function saveConfig(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 7) throw new Error('不支持的配置格式');
    const prior = readConfig();
    if (fs.existsSync(config)) {
      if (prior.config?.schemaVersion === 6 && !fs.existsSync(path.join(data,'settings.v6.json'))) fs.copyFileSync(config,path.join(data,'settings.v6.json'));
      const name = prior.corrupt ? 'settings.corrupt-' + Date.now() + '.json' : 'settings.previous.json';
      fs.copyFileSync(config, path.join(data, name));
    }
    writeAtomic(config, value);
    return {saved: true};
  }
  function exportJson(kind, value) {
    if (!['settings', 'diagnostics'].includes(kind)) throw new Error('无效导出类型');
    const target = path.join(root, 'exports', `${kind}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
    writeAtomic(target, value);
    return {path: target};
  }
  return {readConfig, saveConfig, exportJson, writeAtomic};
}
module.exports = {createStorage, inside};
