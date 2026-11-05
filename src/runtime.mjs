import {reference, template} from './reference.mjs';
import {compatibility} from './compatibility.mjs';
import {CONFIG_VERSION, normalizeConfig, serializeConfig, changeTheme, rememberTheme, LIMITS, clamp, nextWallpaper} from './core.mjs';
import {createWallpaperPlayer} from './wallpaper-player.mjs';
import {createBreathing} from './motion.mjs';
import {NativeCatalog, NativeCloud, NativeDom, MutationJournal} from './native.mjs';
import {createView} from './ui.mjs';

export async function startTheme(win = window, options = {}) {
  const doc = win.document;
  if (win.__aemeathWishRuntime) return win.__aemeathWishRuntime;
  const bridge = win.aemeathWish;
  if (!bridge) return null;
  // The same index/preload is used by native pet and quick-chat windows, which
  // have their own OS input shapes. Never mount a second theme into those.
  const location = new URL(win.location.href);
  const route = location.searchParams.get('initialRoute') ?? location.pathname;
  if (compatibility.excludedWindowRoutes?.some(path => route.split('?')[0] === path || route.startsWith(path+'/'))) return null;
  const appVersion = win.electronBridge?.getSentryInitOptions?.()?.appVersion;
  // Never apply a known adapter to a different version by guessing.
  if (appVersion !== compatibility.packageVersion) {
    await bridge.diagnostics({status: 'adapter-version-mismatch', expected: compatibility.packageVersion, actual: appVersion ?? null});
    return null;
  }
  const loaded = await bridge.readSettings();
  if (loaded.disabled) return null;
  if (loaded.config?.schemaVersion > CONFIG_VERSION) {
    await bridge.diagnostics({status: 'newer-settings-schema', schemaVersion: loaded.config.schemaVersion});
    return null;
  }
  let config = normalizeConfig(loaded.config, reference, []);
  let backgroundSnapshot = await bridge.getBackgrounds(config.theme), images = backgroundSnapshot.images.map(a => ({...a,theme:config.theme}));
  // Only pre-folder settings need the old imported-image ID conversion. v6
  // already has valid folder IDs; expanding per-theme settings must keep them.
  const initialConfig = (loaded.config?.schemaVersion ?? 0) < 6 && backgroundSnapshot.legacyCurrentId ? {...loaded.config,wallpaperId:backgroundSnapshot.legacyCurrentId} : loaded.config;
  config = normalizeConfig(initialConfig, reference, images.map(a => a.id));
  let disposed = false, saveTimer, saveChain = Promise.resolve(), layoutFrame = null;
  let carouselTimer, catalogTimer, backgroundTimer, backgroundRefresh = null, backgroundEpoch = 0, snapshot = null, catalogError = null;
  const failedImages = new Map();
  let minimumComposerHeight = null, activeSurface = null, lastProjectLabel = null, started = performance.now();
  const errors = [];
  const record = error => {errors.push({at: Date.now(), message: String(error?.message ?? error).slice(0, 200)}); if (errors.length > 20) errors.shift();};
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  const native = new NativeDom(doc), journal = new MutationJournal();
  native.onChange = scheduleLayout;
  const rootStyles = new Set();
  let shared, cloudModule;
  try {shared = options.shared ?? await import(new URL(compatibility.services.module, doc.baseURI).href);} catch (error) {record(error);}
  if (!options.shared || options.cloudModule) {
    try {
      cloudModule = options.cloudModule ?? await import(new URL(compatibility.cloud.module, doc.baseURI).href);
      cloudModule[compatibility.cloud.initialize]?.();
    } catch (error) {record(error);}
  }
  const cloud = cloudModule ? new NativeCloud(() => cloudModule[compatibility.cloud.client]) : null;
  const catalog = new NativeCatalog(() => shared?.[compatibility.services.export], {cloud, getPins:() => config.pinnedProjects});
  const view = createView(doc, template, new URL('./ui.css', import.meta.url).href, reference, {
    async theme(name) {
      if (name === config.theme) return;
      changeTheme(config,name,reference.themes);
      resetBackgroundContext(); apply(); save(); await refreshBackgrounds();
    },
    setting(key, value) {
      if (key in LIMITS && Number.isFinite(value)) config[key] = clamp(key, value);
      else if (key === 'enabled' && typeof value === 'boolean') config.enabled = value;
      else if (key === 'order' && ['sequence','random'].includes(value)) config.order = value;
      else if (key === 'glowMode' && ['breathe','manual'].includes(value)) config.glowMode = value;
      else return;
      rememberTheme(config); apply(); save();
    },
    project(button) {if (!native.openProjectPicker(button)) view.toast('当前页面的项目选择器不可用，请使用原生侧边栏');},
    async pin(index, pin) {
      if (!Number.isInteger(index) || index < 0 || index > 3) return;
      if (pin && (!snapshot?.allProjects.some(p => p.key === pin.key) || config.pinnedProjects.some((p,i) => i !== index && p?.key === pin.key))) return;
      config.pinnedProjects[index] = pin;
      save(); snapshot = catalog.snapshot(); view.renderProjects(snapshot);
      await refreshCatalog();
    },
    thread(thread) {native.openThread(thread);},
    async more(id) {snapshot = await catalog.more(id); view.renderProjects(snapshot);},
    async action(action) {
      if (action === 'refresh-projects') {await refreshCatalog();}
      else if (action === 'play') {config.playing = !config.playing; apply(); save();}
      else if (action === 'next' || action === 'previous') {config.wallpaperId = nextWallpaper(config, action === 'previous' ? -1 : 1); apply(); save();}
      else if (action === 'choose-folder') {
        const theme=config.theme;
        ++backgroundEpoch; backgroundRefresh=null;
        const selected = await bridge.chooseBackgroundFolder(theme);
        if (disposed || theme !== config.theme) return;
        if (!selected) {scheduleBackgroundRefresh();return;}
        ++backgroundEpoch; backgroundRefresh=null;
        if(selected.folder !== backgroundSnapshot.folder){player.clear();failedImages.clear();}
        acceptBackgrounds(selected);scheduleBackgroundRefresh();
      } else if (action === 'open-folder') {await bridge.openBackgroundFolder(config.theme);}
      else if (action === 'refresh-backgrounds') {await refreshBackgrounds();}
      else if (action === 'export-settings') {await flushSave(); const result = await bridge.exportSettings(serializeConfig(config)); view.toast(`设置已保存到 ${result.path}`);}
      else if (action === 'import-settings') {
        const imported = await bridge.importSettings(); if (!imported) return;
        if (imported.schemaVersion > CONFIG_VERSION) throw new Error('设置来自较新版本，请先更新主题');
        config = normalizeConfig(imported, reference, []);
        resetBackgroundContext(); apply(); save(); await refreshBackgrounds(); refreshCatalog(); view.toast('各主题参数已导入，背景文件夹保持不变');
      } else if (action === 'diagnostics') {const result = await bridge.diagnostics(diagnose()); view.toast(`诊断已保存到 ${result.path}`);}
    }
  });
  view.root.addEventListener('click', event => {if (event.target.closest('[data-tab="background"]')) refreshBackgrounds();});
  const nativeStyle = doc.createElement('link'); nativeStyle.rel = 'stylesheet'; nativeStyle.href = new URL('./native.css', import.meta.url).href; nativeStyle.addEventListener('load',scheduleLayout); doc.head.append(nativeStyle);
  const background = doc.createElement('div'); background.id = 'aw-background';
  background.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden';
  const layers = [0,1].map(() => {const e = doc.createElement('div'); e.style.cssText = 'position:absolute;inset:0;background-position:center;background-size:cover;opacity:0;transition:opacity .7s'; background.append(e); return e;});
  const tint = doc.createElement('div'); tint.style.cssText = 'position:absolute;inset:0'; background.append(tint); doc.body.prepend(background);
  const player = createWallpaperPlayer({win,layers,reduced:()=>reduced.matches,read:asset=>bridge.readImage(asset.id,asset.revision,asset.theme),onDisplay:(asset,url)=>view.renderBackgroundPreview(asset,url),onError:(error,asset)=>{
    if(disposed)return;
    record(error);failedImages.set(asset.id,asset.revision);
    acceptBackgrounds(backgroundSnapshot);
    if(!config.wallpaperIds.length)view.toast('文件夹内的图片暂时无法显示，请检查后刷新');
  }});
  const glow = view.$('.aw-live-glow'), stars = [view.$('.aw-live-star-one'), view.$('.aw-live-star-two')];
  const motionNodes = [glow, ...stars];
  // Animate three theme-owned leaves only. An inherited variable on <html>
  // invalidated styles across the native app on every breathing frame. The
  // shadow shape is now static; only its independent layer's opacity changes.
  const breathing = createBreathing({requestFrame: fn => win.requestAnimationFrame(fn), cancelFrame: id => win.cancelAnimationFrame(id), visible: () => !disposed && view.host.isConnected && !doc.hidden && config.enabled && !!native.nodes.surface, reduced: () => reduced.matches, write: value => {
    const opacity = String(Math.round(value * 10000) / 10000);
    for (const node of motionNodes) setStyle(node, 'opacity', opacity);
  }});
  function setStyle(node, key, value) {if (node.style[key] !== value) node.style[key] = value;}
  function setVar(key, value) {
    for (const node of [view.root, doc.documentElement]) if (node.style.getPropertyValue(key) !== value) node.style.setProperty(key, value);
    rootStyles.add(key);
  }
  function syncMotion() {
    const animated = config.enabled && !!native.nodes.surface && !doc.hidden && !reduced.matches && config.glowMode === 'breathe' && config.breathPeak > 0;
    for (const node of motionNodes) setStyle(node, 'willChange', animated ? 'opacity' : 'auto');
    breathing.sync(config);
  }
  function save() {rememberTheme(config);clearTimeout(saveTimer); saveTimer = setTimeout(() => {flushSave().catch(error => {record(error); view.toast('设置保存失败，当前效果仍保留，请保存诊断');});}, 300);}
  async function flushSave() {
    clearTimeout(saveTimer); const value = serializeConfig(config);
    saveChain = saveChain.catch(() => {}).then(() => bridge.saveSettings(value));
    return saveChain;
  }
  function paintBackground() {
    background.hidden = !config.enabled;
    tint.style.background = `rgba(22,15,35,${config.dim/100})`;
    const asset=images.find(a=>a.id===config.wallpaperId && (!failedImages.has(a.id) || failedImages.get(a.id)!==a.revision));
    if(!config.enabled || doc.hidden || !asset){player.cancel();return;}
    player.show(asset);
  }
  function scheduleCarousel() {
    clearTimeout(carouselTimer);
    if (!config.enabled || !config.playing || doc.hidden || config.wallpaperIds.length < 2) return;
    carouselTimer = setTimeout(() => {carouselTimer=null;config.wallpaperId = nextWallpaper(config); apply(); save();}, config.duration * 1000);
  }
  function acceptBackgrounds(next) {
    if(disposed || (next.theme && next.theme !== config.theme))return;
    const before=config.wallpaperIds.join('\0'),current=config.wallpaperId;
    backgroundSnapshot=next;images=next.images.map(a => ({...a,theme:config.theme}));
    for(const [id,revision] of failedImages)if(!images.some(a=>a.id===id && a.revision===revision))failedImages.delete(id);
    const usable=images.filter(a=>!failedImages.has(a.id) || failedImages.get(a.id)!==a.revision);
    config.wallpaperIds=usable.map(a=>a.id);
    if(usable.length && !config.wallpaperIds.includes(config.wallpaperId))config.wallpaperId=usable[0].id;
    const warning=[next.warning,failedImages.size?`${failedImages.size} 张图片无法显示，已跳过`:''].filter(Boolean).join('；');
    view.renderBackgrounds({...next,images:usable,warning});view.renderConfig(config,reduced.matches);
    paintBackground();
    if(before!==config.wallpaperIds.join('\0') || current!==config.wallpaperId || !carouselTimer)scheduleCarousel();
    if(current!==config.wallpaperId)save();
  }
  function resetBackgroundContext() {
    ++backgroundEpoch;backgroundRefresh=null;failedImages.clear();
    clearTimeout(carouselTimer);carouselTimer=null;clearTimeout(backgroundTimer);
    player.clear();images=[];config.wallpaperIds=[];
    backgroundSnapshot={theme:config.theme,folder:'',images:[],loading:true};
    view.renderBackgrounds(backgroundSnapshot);
  }
  function scheduleBackgroundRefresh() {
    clearTimeout(backgroundTimer);
    if(!disposed && config.enabled && !doc.hidden)backgroundTimer=setTimeout(refreshBackgrounds,30000);
  }
  function refreshBackgrounds() {
    if(disposed)return Promise.resolve();
    if(backgroundRefresh)return backgroundRefresh.promise;
    const request={epoch:backgroundEpoch,theme:config.theme,promise:null};
    backgroundRefresh=request;
    request.promise=bridge.getBackgrounds(request.theme).then(next=>{
      if(!disposed && request.epoch===backgroundEpoch && request.theme===config.theme)acceptBackgrounds(next);
    }).catch(error=>{
      record(error);
      if(!disposed && request.epoch===backgroundEpoch && request.theme===config.theme && backgroundSnapshot.loading) acceptBackgrounds({theme:request.theme,folder:'',images:[],warning:'当前主题的背景文件夹暂时无法读取，请刷新'});
    }).finally(()=>{if(backgroundRefresh===request){backgroundRefresh=null;scheduleBackgroundRefresh();}});
    return request.promise;
  }
  function apply() {
    for (const [key,value] of Object.entries(reference.themes[config.theme].tokens)) setVar('--aw-'+key, value);
    const variables = {'opacity': config.opacity/100, 'card-blur': config.cardBlur+'px', 'side-blur':config.sidebarBlur+'px', 'halo-blur':config.haloBlur+'px', 'halo-width':config.haloWidth+'px', 'welcome-width':config.welcomeWidth+'px'};
    for (const [key,value] of Object.entries(variables)) setVar('--aw-'+key, value);
    view.renderConfig(config, reduced.matches);
    if (config.enabled) {journal.attr(doc.documentElement, 'data-aw-enabled', ''); journal.attr(doc.documentElement, 'data-theme', reference.themes[config.theme].nativeScheme);}
    else {native.dispose(); journal.restore();}
    paintBackground(); scheduleLayout(); scheduleCarousel(); scheduleBackgroundRefresh();
  }
  function scheduleLayout() {if (!disposed && layoutFrame === null) layoutFrame = win.requestAnimationFrame(layout);}
  function layout() {
    layoutFrame = null;
    if (disposed || !view.host.isConnected) {dispose(); return;}
    // Keep the chosen size stable when the sidebar changes. Only very short
    // windows constrain it so the settings panel still has usable space.
    const companionWidth = Math.min(config.companionSize, Math.max(64, (win.innerHeight - 240) * 90 / 107));
    setVar('--aw-companion-width', companionWidth+'px');
    setVar('--aw-companion-height', companionWidth*107/90+'px');
    const n = config.enabled ? native.attach() : native.nodes;
    const ready = config.enabled && n.isHome && n.main?.isConnected;
    native.enhanceHome(ready);
    const contentBounds = ready ? native.contentBounds() : null;
    if (ready) native.dockHomeComposer(contentBounds);
    const home = view.$('.aw-main'); home.hidden = !ready;
    view.setHomeVisible(ready);
    if (ready) {
      const bounds = contentBounds;
      home.style.cssText = `left:${bounds.left}px;top:${bounds.top}px;width:${bounds.width}px;height:${bounds.height}px;`;
      const project = snapshot?.allProjects.find(p => p.id === snapshot.selection?.projectId);
      const projectLabel = n.projectTrigger?.textContent?.trim().replace(/[?？]$/, '') || (n.projectTrigger ? project?.name : null) || '选择项目';
      view.$('.aw-current-project').textContent = projectLabel;
      const changedProject = lastProjectLabel !== null && lastProjectLabel !== projectLabel;
      lastProjectLabel = projectLabel;
      if (changedProject) refreshCatalog();
      view.$('.aw-project-chip').disabled = !n.projectTrigger;
    }
    const surface = config.enabled ? n.surface : null;
    const halo = view.$('.aw-live-halo');
    for (const node of motionNodes) node.hidden = !surface;
    if (surface) {
      if (surface !== activeSurface) {if (activeSurface) resize.unobserve(activeSurface); activeSurface = surface; resize.observe(surface); minimumComposerHeight = null;}
      const rect = surface.getBoundingClientRect();
      const scale = surface.offsetWidth > 0 ? rect.width / surface.offsetWidth : 1;
      for (const key of ['left','top','width','height']) setStyle(glow, key, rect[key]+'px');
      setStyle(glow, 'borderRadius', 22*scale+'px');
      setStyle(glow, 'boxShadow', `0 0 ${15*scale}px rgb(255, 172, 218)`);
      if (rect.height > 0) minimumComposerHeight = Math.min(minimumComposerHeight ?? Math.min(rect.height, 164), rect.height);
      const expanded = n.input && (n.input.scrollHeight > 90 || rect.height > (minimumComposerHeight ?? rect.height) + 25);
      halo.hidden = !expanded || config.haloBlur === 0;
      const w = config.haloWidth;
      halo.style.cssText = `left:${rect.left-w}px;top:${rect.top-w}px;width:${rect.width+2*w}px;height:${rect.height+2*w}px;`;
      setStyle(stars[0], 'left', rect.left+27+'px'); setStyle(stars[0], 'top', rect.top-13+'px');
      setStyle(stars[1], 'left', rect.right-54+'px'); setStyle(stars[1], 'top', rect.bottom-15+'px');
      if (ready) {
        const b = home.getBoundingClientRect();
        const composerBounds = native.composerBounds() ?? rect;
        const toolbarHeight = Math.max(0, composerBounds.height - rect.height);
        const reserved = Math.max(0, b.bottom - composerBounds.bottom) + (minimumComposerHeight ?? 145) + toolbarHeight + 24;
        view.root.style.setProperty('--aw-home-bottom', reserved+'px');
        const rows = b.width <= 700 ? 2 : 1;
        const listHeight = Math.max(48, Math.min(160, Math.floor((b.height - reserved - 202 - rows*55 - (rows-1)*10) / rows * .72)));
        view.root.style.setProperty('--aw-thread-height', listHeight+'px');
        view.clipHomeCards(composerBounds);
      }
    } else {halo.hidden = true; if (activeSurface) resize.unobserve(activeSurface); activeSurface = null; minimumComposerHeight = null;}
    if (!ready || !surface) view.clipHomeCards(null);
    if (config.enabled) native.syncProjectPicker();
    syncMotion();
    if (n.main && observedMain !== n.main) {if (observedMain) resize.unobserve(observedMain); observedMain = n.main; resize.observe(n.main);}
  }
  let observedMain = null;
  const resize = new win.ResizeObserver(scheduleLayout);
  const observer = new win.MutationObserver(records => {
    if (records.some(r => !(r.target === background || background.contains(r.target) || r.target === view.host))) scheduleLayout();
  });
  observer.observe(doc.body, {childList:true, subtree:true, attributes:true, attributeFilter:['hidden','inert','aria-hidden','aria-expanded','aria-controls','class','style','data-composer-placement','data-sidebar-collapsed']});
  async function refreshCatalog() {
    clearTimeout(catalogTimer);
    if (disposed || doc.hidden) return;
    try {snapshot = await catalog.refresh(); catalogError = null; view.renderProjects(snapshot);}
    catch (error) {catalogError = error; record(error); view.renderProjects(snapshot, error);}
    scheduleLayout();
    if (!disposed) catalogTimer = setTimeout(refreshCatalog, snapshot ? 30000 : 5000);
  }
  function visibility() {scheduleCarousel(); syncMotion(); scheduleBackgroundRefresh(); paintBackground(); if (!doc.hidden) {refreshCatalog();refreshBackgrounds();}}
  function focus() {if (performance.now()-started > 3000) {refreshCatalog();refreshBackgrounds();} scheduleLayout();}
  function motion() {apply();}
  win.addEventListener('resize', scheduleLayout); win.addEventListener('focus', focus);
  win.addEventListener('popstate',scheduleLayout); win.addEventListener('hashchange',scheduleLayout);
  doc.addEventListener('transitionend',scheduleLayout);
  doc.addEventListener('visibilitychange', visibility); reduced.addEventListener('change', motion);
  doc.addEventListener('input', scheduleLayout); win.addEventListener('pagehide', dispose, {once:true});
  function diagnose() {return {enabled:config.enabled, theme:config.theme, source:'native-capabilities', native:native.diagnose(), companion:view.diagnoseCompanion(), glass:{blur:config.cardBlur,opacity:config.opacity,homeClip:view.$('.aw-main').style.clipPath,cards:[...view.root.querySelectorAll('.aw-main .aw-glass')].map(card=>({kind:card.classList.contains('aw-welcome')?'welcome':'project',backdropFilter:win.getComputedStyle(card).backdropFilter,clip:card.style.clipPath}))}, backgrounds:{count:config.wallpaperIds.length,skipped:failedImages.size+(backgroundSnapshot.skipped??0),...player.diagnose()}, catalogReady:!!snapshot, projectCount:snapshot?.allProjects.length ?? 0, cloudProjectCount:snapshot?.allProjects.filter(p => p.kind === 'chatgpt').length ?? 0, pinnedProjectCount:config.pinnedProjects.filter(Boolean).length, catalogError:catalogError ? String(catalogError.message) : null, catalogFailures:snapshot?.errors ?? [], reducedMotion:reduced.matches, configSchema:config.schemaVersion, errors, nativeVisualAcceptance:false};}
  function dispose() {
    if (disposed) return; disposed = true;
    clearTimeout(carouselTimer); clearTimeout(catalogTimer); clearTimeout(backgroundTimer); clearTimeout(saveTimer);
    if (layoutFrame !== null) win.cancelAnimationFrame(layoutFrame);
    breathing.dispose(); player.dispose(); observer.disconnect(); resize.disconnect(); native.dispose(); journal.restore();
    doc.removeEventListener('input', scheduleLayout); doc.removeEventListener('visibilitychange', visibility);
    win.removeEventListener('resize', scheduleLayout); win.removeEventListener('focus', focus); reduced.removeEventListener('change', motion);
    win.removeEventListener('popstate',scheduleLayout); win.removeEventListener('hashchange',scheduleLayout); doc.removeEventListener('transitionend',scheduleLayout);
    nativeStyle.remove(); background.remove(); view.dispose();
    for (const key of rootStyles) doc.documentElement.style.removeProperty(key);
    delete win.__aemeathWishRuntime;
  }
  const api = {dispose, diagnose, refresh:refreshCatalog}; win.__aemeathWishRuntime = api;
  view.renderProjects(null);
  view.renderBackgrounds(backgroundSnapshot);
  apply(); refreshCatalog();
  if(loaded.config?.schemaVersion !== CONFIG_VERSION)save();
  if (loaded.warning) view.toast(loaded.warning);
  return api;
}

if (typeof window !== 'undefined') {
  const begin = () => startTheme().catch(error => {console.warn('[Aemeath Wish] Theme was not loaded:', error.message);});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin, {once:true}); else begin();
}
