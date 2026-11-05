import {LIMITS} from './core.mjs';

export function createView(document, template, cssUrl, reference, actions) {
  const host = document.createElement('aemeath-wish-theme');
  host.id = 'aemeath-wish-theme';
  const shadow = host.attachShadow({mode: 'open'});
  const style = document.createElement('link');
  style.rel = 'stylesheet'; style.href = cssUrl;
  shadow.append(style);
  const fragment = document.createElement('template'); fragment.innerHTML = template;
  shadow.append(fragment.content.cloneNode(true));
  const root = shadow.querySelector('#aw-ui');
  const $ = selector => root.querySelector(selector);
  $('[data-setting="opacity"]').min = String(LIMITS.opacity[0]);
  const settings = $('.aw-settings');
  const companion = $('.aw-companion');
  // One element paints the artwork and owns the entire rectangular hit area.
  // Real pointer events can still disagree with document hit tests; retain the
  // bounded diagnostic below rather than treating DOM geometry as acceptance.
  companion.id = 'aw-companion-entry';
  companion.removeAttribute('data-tooltip');
  companion.removeAttribute('data-tooltip-placement');
  companion.removeAttribute('data-action');
  companion.className = 'aw-companion';
  const artwork = companion.querySelector('img');
  companion.style.backgroundImage = `url("${artwork.getAttribute('src')}")`;
  companion.replaceChildren();
  companion.draggable = false;
  const controlLayer = document.createElement('div'); controlLayer.className = 'aw-control-layer';
  controlLayer.append(settings); root.append(controlLayer);
  const entryStyle = document.createElement('link'); entryStyle.rel = 'stylesheet'; entryStyle.href = cssUrl.replace(/[^/]*$/, 'entry.css');
  let controlLayerMode = 'fallback', controlLayerError = null;
  let entryLayerMode = 'fallback', entryLayerError = null;
  const title = settings.querySelector('header button'); title.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const themeOptions = $('.aw-theme-options');
  const tabs = $('.aw-setting-tabs');
  themeOptions.classList.add('aw-theme-picker');
  themeOptions.setAttribute('aria-label','选择要使用和调整的主题');
  settings.insertBefore(themeOptions,tabs);
  const scopeLabel = document.createElement('p');scopeLabel.className='aw-setting-scope';scopeLabel.setAttribute('role','status');
  settings.insertBefore(scopeLabel,tabs);
  const generalTab = $('[data-tab="theme"]');generalTab.textContent='通用';tabs.append(generalTab);
  $('#aw-theme-panel .aw-local-note').textContent='这些设置由全部主题共用。导入、导出包含各主题参数，背景文件夹保留本机选择。';
  const glassNote = document.createElement('p');glassNote.className='aw-local-note';glassNote.textContent='不透明度为 0% 时底色完全透明；背景模糊仍可独立调整。';
  $('#aw-glass-panel').append(glassNote);
  for (const [id, theme] of Object.entries(reference.themes)) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'aw-theme-option'; button.dataset.theme = id;
    const swatch = document.createElement('span'); swatch.className = 'aw-theme-swatch'; swatch.style.background = theme.swatch; swatch.style.color = theme.tokens.ink; swatch.innerHTML = '<span>Aa</span><span aria-hidden="true">♡</span>';
    const label = document.createElement('span'); label.className = 'aw-theme-info';
    const name = document.createElement('span'); name.className = 'aw-theme-name'; name.textContent = theme.name;
    const note = document.createElement('span'); note.className = 'aw-theme-description'; note.textContent = theme.description;
    label.append(name, note); button.append(swatch, label); themeOptions.append(button);
  }
  const management = document.createElement('div');
  management.innerHTML = '<label class="aw-companion-control"><span>小爱入口大小<output data-output="companionSize"></output></span><input type="range" min="72" max="216" step="1" data-setting="companionSize" aria-label="小爱入口大小"/></label><label class="aw-enable"><input type="checkbox" data-setting="enabled"/>启用小爱主题</label><div class="aw-settings-actions"><button type="button" class="aw-small-button" data-action="export-settings">导出设置</button><button type="button" class="aw-small-button" data-action="import-settings">导入设置</button><button type="button" class="aw-small-button" data-action="diagnostics">保存诊断</button></div><button type="button" class="aw-small-button aw-exit-theme" data-action="exit-theme">退出主题</button>';
  $('#aw-theme-panel').append(management);
  const state = {images: [], tab: 'background', theme:reference.sourceStartingState.theme, open: false, enabled: true, toastTimer: null, snapshot:null, projectError:null, pinSlot:null};
  const safely = fn => Promise.resolve().then(fn).catch(error => toast(error.message ?? String(error)));
  const picker = document.createElement('section'); picker.className = 'aw-pin-picker'; picker.hidden = true;
  picker.setAttribute('role','dialog'); picker.setAttribute('aria-label','固定快捷项目');
  picker.innerHTML = '<header><strong>选择项目</strong><button type="button" class="aw-small-button aw-pin-close" aria-label="关闭项目选择">×</button></header><input class="aw-pin-search" type="search" placeholder="搜索项目" aria-label="搜索快捷项目"/><div class="aw-pin-options"></div><footer><button type="button" class="aw-small-button aw-pin-refresh">刷新</button><button type="button" class="aw-small-button aw-pin-clear">清空这一栏</button></footer>';
  root.append(picker);
  const search = picker.querySelector('input'), choices = picker.querySelector('.aw-pin-options');
  function closePinPicker(restoreFocus = true) {
    const slot = state.pinSlot; state.pinSlot = null; picker.hidden = true;
    if (restoreFocus && slot !== null) root.querySelector(`[data-pin-slot="${slot}"]`)?.focus({preventScroll:true});
  }
  function placePinPicker() {
    if (state.pinSlot === null) return;
    const anchor = root.querySelector(`[data-pin-slot="${state.pinSlot}"]`);
    if (!anchor) {closePinPicker(false); return;}
    const box = anchor.getBoundingClientRect(), win = document.defaultView;
    const width = Math.max(180, Math.min(350, win.innerWidth - 24));
    const below = win.innerHeight - box.bottom - 20, above = box.top - 20;
    const onTop = below < 240 && above > below;
    const maxHeight = Math.max(100, Math.min(430, onTop ? above : below));
    picker.style.width = width+'px'; picker.style.maxHeight = maxHeight+'px';
    picker.style.left = Math.max(12,Math.min(box.left,win.innerWidth-width-12))+'px';
    picker.style.top = Math.max(12,onTop ? box.top-Math.min(picker.scrollHeight,maxHeight)-8 : box.bottom+8)+'px';
  }
  function renderPinChoices() {
    const active = shadow.activeElement?.dataset.pinKey, scroll = choices.scrollTop;
    choices.replaceChildren();
    const query = search.value.trim().toLocaleLowerCase();
    const all = state.snapshot?.allProjects ?? [];
    const matches = all.filter(p => p.name.toLocaleLowerCase().includes(query));
    for (const project of matches) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'aw-pin-option'; button.dataset.pinKey = project.key;
      const other = state.snapshot.projects.findIndex((p,i) => i !== state.pinSlot && p?.key === project.key);
      const selected = state.snapshot.projects[state.pinSlot]?.key === project.key;
      const name = document.createElement('span'); name.textContent = project.name;
      const kind = document.createElement('small'); kind.textContent = other >= 0 ? `已在第 ${other+1} 栏` : selected ? '当前项目' : project.kind === 'chatgpt' ? 'ChatGPT 项目' : project.kind === 'remote' ? '远程项目' : '本机项目';
      button.disabled = other >= 0; button.setAttribute('aria-pressed',String(selected)); button.append(name,kind);
      button.addEventListener('click', () => {const slot = state.pinSlot; closePinPicker(); safely(() => actions.pin(slot,{key:project.key,name:project.name}));});
      choices.append(button);
      if (active === project.key) button.focus({preventScroll:true});
    }
    if (!matches.length) {
      const note = document.createElement('p');
      note.textContent = query ? '没有匹配的项目' : !state.snapshot && !state.projectError ? '正在读取项目…' : state.projectError || state.snapshot?.errors?.length ? '暂时无法读取项目，请重试。' : '暂时没有项目'; choices.append(note);
    }
    if (matches.length && state.snapshot?.errors?.some(e => e.component.endsWith('projects'))) {
      const note = document.createElement('p'); note.textContent = '部分项目未能读取，可刷新重试。'; choices.append(note);
    }
    choices.scrollTop = scroll;
    picker.querySelector('.aw-pin-clear').disabled = !state.snapshot?.projects[state.pinSlot];
    placePinPicker();
  }
  function openPinPicker(index) {
    if (state.open) setOpen(false);
    state.pinSlot = index; picker.hidden = false; search.value = '';
    renderPinChoices(); search.focus({preventScroll:true});
  }
  picker.querySelector('.aw-pin-close').onclick = () => closePinPicker();
  picker.querySelector('.aw-pin-refresh').onclick = () => safely(() => actions.action('refresh-projects'));
  picker.querySelector('.aw-pin-clear').onclick = () => {const slot = state.pinSlot; closePinPicker(); safely(() => actions.pin(slot,null));};
  search.addEventListener('input',renderPinChoices);
  function outsidePicker(event) {if (state.pinSlot !== null && !event.composedPath().includes(picker) && !event.composedPath().some(e => e?.dataset?.pinSlot !== undefined)) closePinPicker(false);}
  document.addEventListener('pointerdown',outsidePicker);
  document.defaultView.addEventListener('resize',placePinPicker);

  function setOpen(open) {
    if (open) closePinPicker(false);
    state.open = open; settings.hidden = !open;
    companion.setAttribute('aria-expanded', String(open));
    if (open) title.focus(); else companion.focus({preventScroll: true});
  }
  function selectTab(tab) {
    state.tab = tab;
    for (const button of root.querySelectorAll('[data-tab]')) {const active = button.dataset.tab === tab; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;}
    for (const panel of root.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== tab;
    renderScope();
  }
  function renderScope() {const text = state.tab === 'theme' ? '通用设置 · 全部主题共用' : `正在调整：${reference.themes[state.theme].name} · 自动保存`;if(scopeLabel.textContent !== text)scopeLabel.textContent=text;}
  function toggleSettings() {
    if (!state.enabled) safely(() => actions.setting('enabled', true));
    else setOpen(!state.open);
  }
  companion.addEventListener('click', toggleSettings);
  companion.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.open) {event.preventDefault(); setOpen(false);}
  });
  root.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.tab) { selectTab(button.dataset.tab); return; }
    if (button.dataset.theme) {safely(() => actions.theme(button.dataset.theme)); return;}
    if (button.dataset.glowMode) {safely(() => actions.setting('glowMode', button.dataset.glowMode)); return;}
    const action = button.dataset.action;
    if (action === 'settings') toggleSettings();
    else if (action === 'exit-theme') {setOpen(false); safely(() => actions.setting('enabled', false));}
    else if (action === 'close-settings') setOpen(false);
    else if (action === 'project') safely(() => actions.project(button));
    else if (action) safely(() => actions.action(action));
  });
  root.addEventListener('input', event => {
    const key = event.target.dataset.setting;
    if (!key) return;
    const value = event.target.type === 'checkbox' ? event.target.checked : key === 'order' ? event.target.value : Number(event.target.value);
    safely(() => actions.setting(key, value));
  });
  root.addEventListener('keydown', event => {
    if (state.pinSlot !== null) {
      if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); closePinPicker(); return;}
      const buttons = [...picker.querySelectorAll('button,input')].filter(e => !e.disabled);
      if (event.key === 'Tab') {
        if (event.shiftKey && event.target === buttons[0]) {event.preventDefault(); buttons.at(-1)?.focus();}
        else if (!event.shiftKey && event.target === buttons.at(-1)) {event.preventDefault(); buttons[0]?.focus();}
      }
      if (['ArrowDown','ArrowUp'].includes(event.key)) {
        const options = [...choices.querySelectorAll('button:not(:disabled)')], at = options.indexOf(event.target);
        event.preventDefault(); options[at < 0 ? (event.key === 'ArrowDown' ? 0 : options.length-1) : (at + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
      }
    }
    if (event.key === 'Escape' && state.open) {event.preventDefault(); event.stopPropagation(); setOpen(false);}
    if (event.target.dataset.tab && ['ArrowRight','ArrowLeft','Home','End'].includes(event.key)) {
      event.preventDefault();
      const tabs = [...root.querySelectorAll('[data-tab]')]; const at = tabs.indexOf(event.target);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (at + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      selectTab(tabs[next].dataset.tab); tabs[next].focus();
    }
    if (event.key === 'Tab' && state.open) {
      const focusable = [...settings.querySelectorAll('button,input,select')].filter(e => !e.closest('[hidden]') && !e.disabled && e.tabIndex >= 0);
      if (event.shiftKey && event.target === focusable[0]) {event.preventDefault(); focusable.at(-1)?.focus();}
      else if (!event.shiftKey && event.target === focusable.at(-1)) {event.preventDefault(); focusable[0]?.focus();}
    }
  });
  function toast(message) {
    const box = $('.aw-toast'); box.textContent = message; box.hidden = false;
    clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => {box.hidden = true;}, 7000);
  }
  function renderConfig(config, reduced) {
    state.enabled = config.enabled;
    state.theme = config.theme;renderScope();
    root.dataset.enabled = String(config.enabled);
    const companionLabel = config.enabled ? '主题设置' : '启用小爱主题';
    companion.dataset.tip = companionLabel;
    companion.setAttribute('aria-label', companionLabel);
    if (!config.enabled && state.open) setOpen(false);
    if (!config.enabled) closePinPicker(false);
    for (const button of themeOptions.querySelectorAll('[data-theme]')) button.setAttribute('aria-pressed', String(button.dataset.theme === config.theme));
    for (const input of root.querySelectorAll('[data-setting]')) {
      const value = config[input.dataset.setting];
      if (input.type === 'checkbox') input.checked = Boolean(value); else if (value !== undefined) input.value = String(value);
    }
    const units = {duration:' 秒', breathPeriod:' 秒', dim:'%', opacity:'%', glow:'%', breathPeak:'%', cardBlur:' px', sidebarBlur:' px', haloBlur:' px', haloWidth:' px', companionSize:' px'};
    for (const output of root.querySelectorAll('[data-output]')) output.textContent = `${config[output.dataset.output]}${units[output.dataset.output] ?? ''}`;
    for (const button of root.querySelectorAll('[data-glow-mode]')) button.setAttribute('aria-pressed', String(button.dataset.glowMode === config.glowMode));
    for (const controls of root.querySelectorAll('[data-glow-controls]')) controls.hidden = controls.dataset.glowControls !== config.glowMode;
    $('.aw-motion-note').hidden = !reduced;
    $('.aw-play').textContent = config.playing ? '暂停轮播' : '播放轮播';
    $('.aw-wallpaper-name').textContent = state.images.find(x => x.id === config.wallpaperId)?.name ?? '背景';
    root.dataset.density = config.density;
  }
  function renderBackgrounds(snapshot) {
    state.images=snapshot.images;
    $('.aw-folder-path').textContent=snapshot.loading ? '正在读取当前主题的文件夹…' : snapshot.folder || '暂无可用文件夹';
    $('.aw-folder-count').textContent=snapshot.loading ? '' : `${snapshot.images.length} 张图片`;
    $('.aw-folder-warning').textContent=snapshot.warning || '';
    $('.aw-folder-warning').hidden=!snapshot.warning;
    for(const action of ['previous','next','play']) $(`[data-action="${action}"]`).disabled=!snapshot.images.length;
  }
  function renderBackgroundPreview(asset,url) {
    const image=$('.aw-background-preview');
    if(url){image.src=url;image.alt=asset.name;image.hidden=false;$('.aw-wallpaper-name').textContent=asset.name;}
    else {image.removeAttribute('src');image.hidden=true;}
  }
  function renderProjects(snapshot, error) {
    state.snapshot = snapshot; state.projectError = error;
    const area = $('.aw-projects');
    const scrolls = new Map([...area.querySelectorAll('[data-project-list]')].map(e => [e.dataset.projectList, e.scrollTop]));
    area.replaceChildren();
    $('.aw-project-status').textContent = error ? '项目列表暂时不可用' : !snapshot ? '正在读取项目' : snapshot.errors?.length ? '部分信息暂时不可用' : '';
    for (let index = 0; index < 4; index++) {
      const project = snapshot?.projects[index];
      const card = document.createElement('section'); card.className = 'aw-project-card aw-glass';
      const heading = document.createElement('div'); heading.className = 'aw-project-heading';
      heading.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z"/></svg>';
      if (!project) {
        card.dataset.empty = 'true';
        const name = document.createElement('span'); name.textContent = `快捷项目 ${index+1}`; heading.append(name);
        const meta = document.createElement('div'); meta.className = 'aw-project-meta'; meta.textContent = '\u00a0';
        const content = document.createElement('div'); content.className = 'aw-thread-list aw-project-empty';
        const note = document.createElement('p'); note.textContent = '选择一个项目固定在这里。'; content.append(note);
        const button = document.createElement('button'); button.type = 'button'; button.className = 'aw-small-button'; button.textContent = '选择项目'; button.dataset.pinSlot = index;
        button.addEventListener('click', () => openPinPicker(index));
        content.append(button); card.append(heading, meta, content); area.append(card); continue;
      }
      const name = document.createElement('span'); name.textContent = project.name; name.title = project.name; name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap'; heading.append(name);
      const change = document.createElement('button'); change.type = 'button'; change.className = 'aw-pin-change'; change.textContent = '⌄'; change.dataset.pinSlot = index; change.setAttribute('aria-label',`更换第 ${index+1} 栏项目`); change.title = '更换项目'; change.onclick = () => openPinPicker(index); heading.append(change);
      const meta = document.createElement('div'); meta.className = 'aw-project-meta';
      const recency = project.threads[0]?.sourceRecencyAt ?? project.threads[0]?.sourceUpdatedAt;
      meta.textContent = recency ? `${new Date(recency * 1000).toLocaleDateString('zh-CN')} 活跃` : project.missing ? '项目暂不可用' : project.unavailable ? '对话暂时不可用' : project.unloaded ? '正在读取对话…' : '尚无对话';
      const list = document.createElement('div'); list.className = 'aw-thread-list'; list.dataset.projectList = project.key ?? project.id; list.setAttribute('aria-label', `${project.name}的对话`); list.tabIndex = 0;
      if (!project.threads.length) {
        list.classList.add('aw-project-empty');
        const note = document.createElement('p'); note.textContent = project.missing ? '暂时找不到此项目，可刷新或更换。' : project.unavailable ? '读取失败，可以重新尝试。' : project.unloaded ? '正在读取对话…' : '这个项目还没有对话。'; list.append(note);
        if (project.unavailable || project.missing) {
          const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'aw-small-button'; retry.textContent = '重试';
          retry.addEventListener('click', () => safely(() => actions.action('refresh-projects'))); list.append(retry);
        }
      }
      for (const thread of project.threads) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'aw-thread';
        const text = document.createElement('span'); text.textContent = thread.displayTitle || '未命名对话'; text.title = text.textContent; button.append(text);
        button.addEventListener('click', () => safely(() => actions.thread(thread))); list.append(button);
      }
      if (project.nextCursor) {
        const more = document.createElement('button'); more.type = 'button'; more.className = 'aw-thread aw-more'; more.textContent = '显示更多';
        more.addEventListener('click', () => {more.disabled = true; safely(() => actions.more(project.key ?? project.id)).finally(() => {more.disabled = false;});}); list.append(more);
      }
      card.append(heading, meta, list); area.append(card); list.scrollTop = scrolls.get(project.key ?? project.id) ?? 0;
    }
    if (state.pinSlot !== null) renderPinChoices();
  }
  selectTab('background');
  document.head.append(entryStyle);
  document.body.append(host, companion);
  // The settings layer is pointer-transparent except for the open panel. The
  // document-level entry is independent; home cards and glow remain below.
  if (typeof controlLayer.showPopover === 'function') {
    try {
      controlLayer.setAttribute('popover', 'manual');
      controlLayer.showPopover(); controlLayerMode = 'top-layer';
    } catch (error) {
      controlLayer.removeAttribute('popover'); controlLayerError = String(error.message);
    }
  }
  if (typeof companion.showPopover === 'function') {
    try {
      companion.setAttribute('popover', 'manual');
      companion.showPopover(); entryLayerMode = 'top-layer';
    } catch (error) {
      companion.removeAttribute('popover'); entryLayerError = String(error.message);
    }
  }
  const pointerSamples = [];
  function trackEntryPointer(event) {
    // Only entry interactions; no chat text, keys, or general mouse tracking.
    const box = companion.getBoundingClientRect();
    if (!box.width || !box.height) return;
    pointerSamples.push({type:event.type, trusted:event.isTrusted, x:Math.round(event.clientX-box.left), y:Math.round(event.clientY-box.top), width:box.width, height:box.height});
    if (pointerSamples.length > 12) pointerSamples.shift();
  }
  for (const type of ['pointerenter','pointerleave','pointerdown','click']) companion.addEventListener(type,trackEntryPointer);
  function diagnoseCompanion() {
    const rect = companion.getBoundingClientRect();
    const bounds = r => ({x:r.x,y:r.y,width:r.width,height:r.height});
    const samples = typeof document.elementFromPoint === 'function' && rect.width && rect.height
      ? [.15,.5,.85].map(fraction => {
        const hit = document.elementFromPoint(rect.left + rect.width/2, rect.top + rect.height*fraction);
        return {fraction,buttonHit:hit === companion || companion.contains(hit),hitTag:hit?.tagName??null};
      }) : null;
    const win = document.defaultView, css = win.getComputedStyle(companion);
    return {mode:entryLayerMode,error:entryLayerError,coordinateSpace:'document',settingsLayer:controlLayerMode,settingsLayerError:controlLayerError,paint:'button-background',button:bounds(rect),image:null,hitSamples:samples,pointerSamples:[...pointerSamples],viewport:{width:win.innerWidth,height:win.innerHeight,devicePixelRatio:win.devicePixelRatio,visualScale:win.visualViewport?.scale??null},buttonZoom:css.zoom??null,appZoom:win.getComputedStyle(document.documentElement).getPropertyValue('--codex-window-zoom')};
  }
  function clipHomeCards(composer) {
    // An ancestor clip-path creates a Backdrop Root: its glass descendants can
    // no longer sample the wallpaper. Clip each glass surface itself instead.
    // Its own backdrop is filtered first, and then its paint/hit area is cut.
    for (const card of root.querySelectorAll('.aw-main .aw-glass')) {
      const box = card.getBoundingClientRect();
      let clip = '';
      if (composer && box.width > 0 && box.height > 0 && composer.left < box.right && composer.right > box.left && composer.top < box.bottom && composer.bottom > box.top) {
        const x = composer.left - box.left, y = composer.top - box.top;
        const right = composer.right - box.left, bottom = composer.bottom - box.top;
        const radius = Math.min(22, composer.width/2, composer.height/2);
        // Include the existing shadow beyond the border box.
        clip = `path(evenodd, "M-32 -32H${box.width+32}V${box.height+32}H-32Z M${x+radius} ${y}H${right-radius}Q${right} ${y} ${right} ${y+radius}V${bottom-radius}Q${right} ${bottom} ${right-radius} ${bottom}H${x+radius}Q${x} ${bottom} ${x} ${bottom-radius}V${y+radius}Q${x} ${y} ${x+radius} ${y}Z")`;
      }
      if (card.style.clipPath !== clip) card.style.clipPath = clip;
    }
  }
  return {host, root, companion, $, toast, renderConfig, renderBackgrounds, renderBackgroundPreview, renderProjects, setOpen, diagnoseCompanion, clipHomeCards, setHomeVisible(visible) {if (!visible) closePinPicker(false);}, dispose() {clearTimeout(state.toastTimer); document.removeEventListener('pointerdown',outsidePicker); document.defaultView.removeEventListener('resize',placePinPicker); if (controlLayerMode === 'top-layer') {try {controlLayer.hidePopover();} catch {}} if (entryLayerMode === 'top-layer') {try {companion.hidePopover();} catch {}} companion.remove(); entryStyle.remove(); host.remove();}};
}
