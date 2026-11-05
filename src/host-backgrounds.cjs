'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const ALLOWED = new Set(['.png','.jpg','.jpeg','.webp','.gif']);
const MAX_IMAGE = 32 * 1024 * 1024;
const imageId = file => 'folder:' + crypto.createHash('sha256').update(path.resolve(file)).digest('hex');
const within = (root,file) => {const rel=path.relative(root,file);return !!rel && !rel.startsWith('..'+path.sep) && rel!=='..' && !path.isAbsolute(rel);};
const readJson = async file => {try {return JSON.parse(await fsp.readFile(file,'utf8'));} catch {return null;}};

function createBackgrounds(root, bundledAssets, writeAtomic, themeIds = ['rose','plum']) {
  root=path.resolve(root);
  const defaultFolder=path.join(root,'backgrounds'), sourceFile=path.join(root,'data/background-source.json');
  const themes = new Set(themeIds);
  if (!themes.size || [...themes].some(name => !/^[a-z][a-z0-9-]*$/.test(name) || ['constructor','prototype'].includes(name))) throw new Error('主题列表无效');
  const defaultTheme = themes.has('plum') ? 'plum' : themeIds[0];
  const requireTheme = (theme = defaultTheme) => {if (!themes.has(theme)) throw new Error('未知主题');return theme;};
  const entryFolder = entry => entry.relativeTo === 'workspace' ? path.resolve(root,entry.folder) : entry.folder;
  const validEntry = entry => {
    if (!entry || typeof entry.folder !== 'string' || !entry.folder) return false;
    if (entry.identityFolder !== undefined && (typeof entry.identityFolder !== 'string' || !path.isAbsolute(entry.identityFolder))) return false;
    if (entry.relativeTo === undefined) return path.isAbsolute(entry.folder);
    if (entry.relativeTo !== 'workspace' || path.isAbsolute(entry.folder)) return false;
    const folder=entryFolder(entry);
    return folder===root || within(root,folder);
  };
  const portableEntry = entry => {
    const folder=entryFolder(entry);
    // identityFolder is only an image-ID salt. Never open it as a filesystem path.
    // Keeping it stable preserves the selected image when the project is renamed.
    return folder===root || within(root,folder)
      ? {...entry,folder:path.relative(root,folder)||'.',relativeTo:'workspace',identityFolder:entry.identityFolder??folder}
      : {...entry};
  };
  let source=null, initialized=null, assets=new Map(), queue=Promise.resolve();
  const serial = fn => {const result=queue.catch(()=>{}).then(fn);queue=result;return result;};
  async function hash(file) {const sum=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))sum.update(chunk);return sum.digest('hex');}
  async function copySeed(file, name) {
    const ext=path.extname(file).toLowerCase();
    const stem=path.basename(name,ext).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,150) || 'background';
    for(let suffix=0;suffix<10000;suffix++) {
      const target=path.join(defaultFolder,stem+(suffix?' ('+suffix+')':'')+ext);
      try {await fsp.copyFile(file,target,fs.constants.COPYFILE_EXCL);return target;}
      catch(error) {if(error.code!=='EEXIST')throw error;}
      const stat=await fsp.lstat(target);
      if(stat.isFile() && !stat.isSymbolicLink() && await hash(file)===await hash(target))return target;
    }
    throw new Error('默认背景目录中存在过多同名文件');
  }
  async function initialize() {
    if(initialized)return initialized;
    initialized=(async()=>{
      const saved=await readJson(sourceFile);
      if ([2,3].includes(saved?.schemaVersion) && saved.themes && typeof saved.themes === 'object' && !Array.isArray(saved.themes)) {
        const fallback=Object.values(saved.themes).find(validEntry);
        if (!fallback || [...themes].some(name => Object.hasOwn(saved.themes,name) && !validEntry(saved.themes[name]))) throw new Error('主题背景目录设置损坏，请保留配置后检查');
        source={schemaVersion:3,themes:Object.fromEntries([...themes].map(name => [name,portableEntry(saved.themes[name] ?? fallback)]))};
        if (saved.schemaVersion===2) {
          const backup=path.join(root,'data/background-source.v2.json');
          if(!fs.existsSync(backup))writeAtomic(backup,saved);
        }
        if (JSON.stringify(saved)!==JSON.stringify(source)) writeAtomic(sourceFile,source);
        return;
      }
      if(saved?.schemaVersion===1 && validEntry(saved)) {
        const backup=path.join(root,'data/background-source.v1.json');
        if(!fs.existsSync(backup))writeAtomic(backup,saved);
        source={schemaVersion:3,themes:Object.fromEntries([...themes].map(name => [name,portableEntry({folder:saved.folder,legacyCurrentId:saved.legacyCurrentId??null})]))};
        writeAtomic(sourceFile,source);return;
      }
      if(fs.existsSync(sourceFile))throw new Error('背景目录设置损坏，请保留 data/background-source.json 后检查');
      await fsp.mkdir(defaultFolder,{recursive:true});
      // Only our default workspace directory is ever written. Selected folders
      // and all earlier asset copies are read-only inputs.
      if(!within(await fsp.realpath(root),await fsp.realpath(defaultFolder)))throw new Error('默认背景目录不能指向工作区外');
      const old=await readJson(path.join(root,'data/settings.json'));
      const library=await readJson(path.join(root,'data/image-library.json')) || {};
      let legacyCurrentId=null;
      for(const item of bundledAssets.filter(a=>a.role==='wallpaper')) {
        const target=await copySeed(item.path,path.basename(item.path));
        if(old?.wallpaperId===item.id)legacyCurrentId=imageId(target);
      }
      const legacyFolder=path.join(root,'data/wallpapers');
      let entries=[];try{entries=await fsp.readdir(legacyFolder,{withFileTypes:true});}catch(error){if(error.code!=='ENOENT')throw error;}
      for(const entry of entries) {
        if(!entry.isFile() || !/^[a-f0-9]{64}\.(png|jpe?g|webp|gif)$/.test(entry.name))continue;
        const original=path.join(legacyFolder,entry.name);
        if((await fsp.stat(original)).size>MAX_IMAGE)continue;
        const name=(typeof library[entry.name]==='string'?library[entry.name]:entry.name.slice(0,12))+path.extname(entry.name);
        const target=await copySeed(original,name);
        if(old?.wallpaperId===entry.name)legacyCurrentId=imageId(target);
      }
      source={schemaVersion:3,themes:Object.fromEntries([...themes].map(name => [name,portableEntry({folder:defaultFolder,legacyCurrentId})]))};
      writeAtomic(sourceFile,source);
    })().catch(error=>{initialized=null;throw error;});
    return initialized;
  }
  async function scan(theme) {
    await initialize();
    const selectedSource=source.themes[theme], selectedFolder=entryFolder(selectedSource);
    const found=new Map();let skipped=0;
    try {
      const folder=await fsp.realpath(selectedFolder), directory=await fsp.opendir(folder);
      for await(const entry of directory) {
        if(!entry.isFile() || !ALLOWED.has(path.extname(entry.name).toLowerCase()))continue;
        const file=path.join(folder,entry.name);
        let stat;try{stat=await fsp.stat(file);}catch{skipped++;continue;}
        if(!stat.isFile() || stat.size<12 || stat.size>MAX_IMAGE){skipped++;continue;}
        const item={id:imageId(path.join(selectedSource.identityFolder??selectedFolder,entry.name)),name:path.basename(entry.name,path.extname(entry.name)),fileName:entry.name,revision:`${stat.size}:${stat.mtimeMs}:${stat.ino}`,bytes:stat.size,path:file,folder};
        found.set(item.id,item);
      }
      assets.set(theme,found);
      const collator=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
      const images=[...found.values()].sort((a,b)=>collator.compare(a.fileName,b.fileName)||a.fileName.localeCompare(b.fileName)).map(({path:unused,folder:unusedFolder,...item})=>item);
      return {theme,folder:selectedFolder,images,legacyCurrentId:selectedSource.legacyCurrentId??null,skipped,warning:images.length?(skipped?`${skipped} 张图片无法读取或超过 32 MB，已跳过`:''):'文件夹内暂无可用图片，轮播暂停'};
    } catch(error) {
      assets.set(theme,new Map());
      return {theme,folder:selectedFolder,images:[],skipped,warning:'背景文件夹暂时无法读取，轮播暂停'};
    }
  }
  async function select(folder,theme) {
    await initialize();
    const resolved=path.resolve(folder);
    if(!(await fsp.stat(resolved)).isDirectory())throw new Error('请选择一个可读取的图片文件夹');
    // Read permission is checked before persisting a user-selected directory.
    const handle=await fsp.opendir(resolved);await handle.close();
    const next={...source,themes:{...source.themes,[theme]:portableEntry({folder:resolved})}};
    writeAtomic(sourceFile,next);source=next;
    return scan(theme);
  }
  async function imageData(id, revision, theme) {
    const item=assets.get(requireTheme(theme))?.get(id);
    if(!item)throw new Error('图片不在当前背景目录中，请刷新');
    if(revision!==item.revision)throw new Error('图片列表已更新，请重试');
    const stat=await fsp.lstat(item.path), actual=await fsp.realpath(item.path);
    if(!stat.isFile() || stat.isSymbolicLink() || !within(item.folder,actual))throw new Error('图片位置已改变，请刷新');
    const file=await fsp.open(actual,'r');
    try {
      const current=await file.stat();
      if(!current.isFile() || current.size<12 || current.size>MAX_IMAGE)throw new Error('图片超过 32 MB 或无法读取');
      if(`${current.size}:${current.mtimeMs}:${current.ino}`!==revision)throw new Error('图片已改变，请刷新');
      // Bounded read: a file growing while it is open must not allocate without
      // limit. Reading at most the validated size also keeps source files intact.
      const bytes=Buffer.alloc(current.size);let offset=0;
      while(offset<bytes.length){const n=await file.read(bytes,offset,bytes.length-offset,offset);if(!n.bytesRead)break;offset+=n.bytesRead;}
      if(offset!==bytes.length)throw new Error('图片读取未完成，请刷新');
      let mime;
      if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime='image/png';
      else if(bytes[0]===255 && bytes[1]===216 && bytes[2]===255)mime='image/jpeg';
      else if(bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP')mime='image/webp';
      else if(/^GIF8[79]a/.test(bytes.toString('ascii',0,6)))mime='image/gif';
      else throw new Error('图片内容无法识别');
      return {bytes,mime};
    } finally {await file.close();}
  }
  return {
    list(theme){theme=requireTheme(theme);return serial(()=>scan(theme));},
    select(folder,theme){theme=requireTheme(theme);return serial(()=>select(folder,theme));},
    read:imageData,
    async folder(theme){theme=requireTheme(theme);await initialize();return entryFolder(source.themes[theme]);}
  };
}
module.exports={createBackgrounds,MAX_IMAGE};
