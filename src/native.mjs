import {cloudThreads, mergeThreads, normalizeProjects, projectFilter, rankProjects} from './core.mjs';

// Every native selector and private capability stays in this versioned adapter.
export const SELECTORS = Object.freeze({
  main: 'main[data-app-shell-main-surface]',
  mainContent: '[data-app-shell-focus-area="main"]',
  sidePanel: 'aside[data-app-shell-focus-area="right-panel"]',
  sidebar: '[data-slate-sidebar-content], [data-sidebar-navigation-root]',
  hero: '[data-feature="game-source"].heading-xl',
  homeIcon: '[data-testid="home-icon"]',
  projectPicker: '[data-composer-navigation-target="workspace-project"]',
  composer: '[data-codex-composer-root], form[data-thread-find-composer]',
  surface: '[data-composer-surface-variant]',
  input: '[contenteditable="true"][role="textbox"], .ProseMirror[contenteditable="true"], textarea',
  homeComposer: '[data-home-feed-composer]',
  header: 'header[data-app-shell-header-layout]',
  modeToggle: '._root_1q7e3_1[role="group"]',
  composerRail: '[data-composer-utility-rail]',
  composerRailFrame: '[data-composer-rail]',
  writingSurface: '[data-oai-writing-block-surface]',
  userMessageBubble: '[data-user-message-bubble]',
  codeSurface: '[data-code-block], ._CodeBlockPlaceholder_xjxw3_2',
  visualSurface: '[data-testid="chatgpt-chart-content-reference"], [data-chatgpt-mermaid-preview], ._MermaidBlock_xjxw3_2, [data-code-block-preview-pane]',
  popupFrame: '[data-radix-popper-content-wrapper]',
  // These decorative classes are observed in the version-pinned native bundle.
  // They have no stable data marker and contain no interactive content.
  chromeBackdrop: '._background_18hic_2[aria-hidden="true"], ._MainContentTopFade_azz1c_2[aria-hidden="true"]',
  projectId: 'data-app-action-sidebar-project-id',
  selectProject: '[data-app-action-sidebar-select-project]',
  threadId: 'data-app-action-sidebar-thread-id',
  threadHost: 'data-app-action-sidebar-thread-host-id'
});
export const timeout = (promise, milliseconds = 8000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('原生数据读取超时')), milliseconds);
  Promise.resolve(promise).then(value => {clearTimeout(timer); resolve(value);}, error => {clearTimeout(timer); reject(error);});
});
async function mapLimit(items, concurrency, work) {
  let index = 0;
  const result = new Array(items.length);
  await Promise.all(Array.from({length: Math.min(items.length, concurrency)}, async () => {
    while (index < items.length) { const i = index++; result[i] = await work(items[i]); }
  }));
  return result;
}

// Use the app's authenticated client and the exact read-only routes used by its
// sidebar. No credentials, browser storage or original profile are accessed.
export class NativeCloud {
  constructor(getClient) { this.getClient = getClient; }
  async projects() {
    const client = this.getClient();
    if (!client?.safeGet) throw new Error('云端项目尚未就绪');
    const items = [], seen = new Set(); let cursor = null;
    do {
      const page = await timeout(client.safeGet('/gizmos/snorlax/sidebar', {parameters:{query:{conversations_per_gizmo:0, cursor, limit:20, owned_only:false}}}));
      if (!Array.isArray(page?.items)) throw new Error('云端项目数据格式已改变');
      items.push(...page.items); cursor = page.cursor ?? null;
      if (cursor !== null && (seen.has(cursor) || seen.size >= 100)) throw new Error('云端项目分页未完成');
      seen.add(cursor);
    } while (cursor !== null);
    return items;
  }
  async threads(projectId, cursor = null) {
    const page = await timeout(this.getClient().safeGet('/gizmos/{gizmo_id}/conversations', {parameters:{path:{gizmo_id:projectId}, query:{cursor, limit:24, owned_only:false}}}));
    if (!Array.isArray(page?.items)) throw new Error('云端对话数据格式已改变');
    return {entries:cloudThreads(page.items, projectId), nextCursor:page.cursor ?? null};
  }
}

export class NativeCatalog {
  constructor(getServices, {cloud = null, getPins = () => null} = {}) { this.getServices = getServices; this.cloud = cloud; this.getPins = getPins; this.projects = []; this.selection = null; this.refreshing = null; this.errors = []; }
  async refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      let pins, result;
      do {pins = JSON.stringify(this.getPins()); result = await this.read();} while (pins !== JSON.stringify(this.getPins()));
      return result;
    })().finally(() => {this.refreshing = null;});
    return this.refreshing;
  }
  async read() {
    const services = this.getServices();
    if (!services?.projectCatalog && !this.cloud) throw new Error('原生项目目录尚未就绪');
    this.errors = [];
    const requests = [
      ['local-projects', () => services?.projectCatalog?.readLocalProjects() ?? {}, {}],
      ['remote-projects', () => services?.projectCatalog?.readRemoteProjects?.() ?? [], []],
      ['selection', () => services?.projectCatalog?.readSelection?.() ?? null, null],
      ['memberships', () => services?.threadProjectAssignments?.readMemberships() ?? {}, {}],
      ['cloud-projects', () => this.cloud?.projects() ?? [], []]
    ];
    const results = await Promise.allSettled(requests.map(([name, read]) => timeout(Promise.resolve().then(read), name === 'cloud-projects' ? 30000 : 8000)));
    if ([0,1,4].every(i => results[i].status === 'rejected')) throw results[0].reason;
    const [local, remote, selection, memberships, cloud] = results.map((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      this.errors.push({component: requests[index][0], error: String(result.reason?.message ?? result.reason)});
      return requests[index][2];
    });
    this.selection = selection;
    const pins = this.getPins();
    this.projects = await mapLimit(normalizeProjects(local, remote, cloud), 3, async p => {
      const filter = projectFilter(p, memberships);
      if (pins && !pins.some(pin => pin?.key === p.key)) return {...p, filter, threads:[], nextCursor:null, unloaded:true};
      try {
        const page = await this.readPage({...p, filter});
        if (!Array.isArray(page?.entries)) throw new Error('对话目录数据格式已改变');
        return {...p, filter, threads: mergeThreads([], page.entries), nextCursor: page.nextCursor ?? null};
      } catch (error) {
        this.errors.push({component: 'project-threads', error: String(error.message ?? error)});
        return {...p, filter, threads: [], nextCursor: null, unavailable: true};
      }
    });
    return this.snapshot();
  }
  readPage(p, cursor) {
    return p.kind === 'chatgpt' ? this.cloud.threads(p.id, cursor) : timeout(this.getServices().localThreadCatalog.readPage({hostId:p.hostId, limit:24, sortKey:'updated_at', filter:p.filter, ...(cursor ? {cursor} : {})}));
  }
  snapshot() {
    const pins = this.getPins();
    const projects = pins ? pins.map(pin => pin ? this.projects.find(p => p.key === pin.key) ?? {...pin, missing:true, threads:[]} : null) : rankProjects(this.projects);
    return {projects, allProjects:this.projects, selection:this.selection, errors:this.errors};
  }
  async more(id) {
    const p = this.projects.find(x => x.key === id || x.id === id);
    if (!p || !p.nextCursor || p.loading) return this.snapshot();
    p.loading = true;
    try {
      const page = await this.readPage(p, p.nextCursor);
      if (!Array.isArray(page?.entries)) throw new Error('对话目录数据格式已改变');
      p.threads = mergeThreads(p.threads, page.entries);
      p.nextCursor = page.nextCursor ?? null;
    } finally { p.loading = false; }
    return this.snapshot();
  }
}

// Restore only properties we still own; never undo a subsequent native update.
export class MutationJournal {
  constructor() { this.items = new Map(); this.styles = new Map(); }
  attr(node, key, value) {
    if (!node) return;
    let entries = this.items.get(node);
    if (!entries) this.items.set(node, entries = new Map());
    if (!entries.has(key)) entries.set(key, {previous: node.getAttribute(key), owned: null});
    const item = entries.get(key);
    item.owned = String(value);
    if (node.getAttribute(key) !== item.owned) node.setAttribute(key, item.owned);
  }
  css(node, key, value) {
    if (!node) return;
    let entries = this.styles.get(node);
    if (!entries) this.styles.set(node, entries = new Map());
    if (!entries.has(key)) entries.set(key, {previous:node.style.getPropertyValue(key), priority:node.style.getPropertyPriority(key), owned:null});
    const item = entries.get(key); item.owned = String(value);
    if (node.style.getPropertyValue(key) !== item.owned) node.style.setProperty(key,item.owned);
  }
  restore() {
    for (const [node, entries] of this.items) for (const [key, {previous, owned}] of entries) {
      if (node.getAttribute(key) !== owned) continue;
      if (previous === null) node.removeAttribute(key); else node.setAttribute(key, previous);
    }
    this.items.clear();
    for (const [node, entries] of this.styles) for (const [key, {previous, priority, owned}] of entries) {
      if (node.style.getPropertyValue(key) !== owned || node.style.getPropertyPriority(key)) continue;
      if (previous) node.style.setProperty(key,previous,priority); else node.style.removeProperty(key);
    }
    this.styles.clear();
  }
}

export class NativeDom {
  constructor(document, selectors = {}) { this.selectors = {...SELECTORS, ...selectors}; this.doc = document; this.journal = new MutationJournal(); this.homeJournal = new MutationJournal(); this.pickerJournal = new MutationJournal(); this.picker = null; this.nodes = {}; this.onChange = () => {}; }
  active(element) {
    if (!element || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    // React can retain previous routes using CSS rather than HTML hidden.
    // Our own invisible replacement heading must still be discoverable.
    const replaced = element.closest('[data-aw-original-hero], [data-aw-original-home-icon]');
    for (let node = element; node; node = node.parentElement) {
      const style = this.doc.defaultView.getComputedStyle(node);
      const themeHidden = replaced && (node === replaced || replaced.contains(node));
      if (style.display === 'none' || style.contentVisibility === 'hidden' || (!themeHidden && style.visibility === 'hidden')) return false;
    }
    return true;
  }
  homeMode(hero) {
    // The version-pinned native toggle orders Chat, then Work. Read its actual
    // pressed state so cloud Work composers are not mistaken for Chat forms.
    for (const toggle of this.doc.querySelectorAll(this.selectors.modeToggle)) {
      if (!this.active(toggle) || toggle.closest(`${this.selectors.sidePanel}, [role="dialog"]`)) continue;
      const buttons = [...toggle.querySelectorAll('button[aria-pressed]')].filter(button => this.active(button));
      if (buttons.length === 2 && buttons.filter(button => button.getAttribute('aria-pressed') === 'true').length === 1) return buttons[0].getAttribute('aria-pressed') === 'true' ? 'chat' : 'work';
    }
    // Local Work homes may omit the mode toggle; their native heading keeps
    // this marker. Unknown home variants retain the existing welcome layout.
    return hero?.getAttribute('data-feature') === 'game-source' ? 'work' : null;
  }
  find() {
    const mains = [...this.doc.querySelectorAll(this.selectors.main)].filter(e => this.active(e));
    const main = mains.length === 1 ? mains[0] : null;
    const roots = main ? [...main.querySelectorAll(this.selectors.composer)].filter(e => this.active(e)) : [];
    const candidates = roots.filter(e => !roots.some(parent => parent !== e && parent.contains(e)));
    // The shell contains both the main chat and temporary right-panel chats.
    // Deduplicate nested native composer wrappers, then bind each real editor.
    const composers = candidates.map(composer => {
      const surface = [...composer.querySelectorAll(this.selectors.surface)].find(e => this.active(e)) ?? null;
      const input = surface ? [...surface.querySelectorAll(this.selectors.input)].find(e => this.active(e)) ?? null : null;
      const sidePanel = composer.closest(this.selectors.sidePanel);
      const contentRoot = sidePanel ?? composer.closest(this.selectors.mainContent) ?? main;
      const railScope = composer.closest(this.selectors.homeComposer) ?? composer;
      const rails = [...railScope.querySelectorAll(this.selectors.composerRail)].filter(e => this.active(e));
      // Newer native footers paint a full-width fade using pseudo-elements.
      // Bind only the version-pinned wrapper around an identified editor.
      const footer = this.selectors.composerFooter ? composer.closest(this.selectors.composerFooter) : null;
      return {composer,surface,input,sidePanel,contentRoot,rails,footer};
    }).filter(n => n.surface && n.input);
    const primaryCandidates = composers.filter(n => !n.sidePanel);
    const primary = primaryCandidates.length === 1 ? primaryCandidates[0] : null;
    const {composer=null,surface=null,input=null,rails=[]} = primary ?? {};
    const contentRoot = primary?.contentRoot ?? main;
    const inPrimary = e => !e.closest(this.selectors.sidePanel) && this.active(e);
    const hero = [...(contentRoot?.querySelectorAll(this.selectors.hero) ?? [])].find(inPrimary) ?? null;
    // With no selected project the native heading is plain text. The actual
    // picker then lives in the composer's utility bar, with an accessible label.
    const pickerCandidates = contentRoot ? [...contentRoot.querySelectorAll('button')].filter(e => {
      const label = (e.getAttribute('aria-label') || e.textContent || '').trim();
      const matches = e.matches(this.selectors.projectPicker) || e.querySelector(this.selectors.projectPicker) || /^(Choose project|Select project|Change project[:：]|选择项目|更改项目|切换项目)/i.test(label);
      return matches && !e.disabled && e.getAttribute('aria-disabled') !== 'true' && inPrimary(e);
    }) : [];
    const projectTrigger = hero?.querySelector('button:not(:disabled)') ?? pickerCandidates[0] ?? null;
    const isHome = !!(hero && composer && input && (composer.dataset.composerPlacement === 'home' || composer.closest(this.selectors.homeComposer)));
    let dockRoot = composer;
    // Some native home variants render the utility rail beside the form. Dock
    // their existing common wrapper so the bar and editor never separate.
    if (isHome && rails.some(rail => !composer.contains(rail))) {
      let candidate = composer.parentElement;
      while (candidate && candidate !== main && !rails.every(rail => candidate.contains(rail))) candidate = candidate.parentElement;
      while (candidate && candidate !== main && this.doc.defaultView.getComputedStyle(candidate).display === 'contents') candidate = candidate.parentElement;
      if (candidate && candidate !== main && !candidate.contains(hero) && !candidate.querySelector(this.selectors.modeToggle)) dockRoot = candidate;
    }
    const sidebarCandidates = [...this.doc.querySelectorAll(this.selectors.sidebar)].filter(e => !e.closest('[data-sidebar-collapsed]') && this.active(e));
    const sidebar = sidebarCandidates.filter(e => !sidebarCandidates.some(parent => parent !== e && parent.contains(e)));
    return {main, contentRoot, composers, composer, surface, input, hero, projectTrigger, isHome, homeMode:isHome ? this.homeMode(hero) : null, sidebar, rails, dockRoot};
  }
  attach() {
    const nodes = this.find();
    const primaryChanged = nodes.main !== this.nodes.main || nodes.contentRoot !== this.nodes.contentRoot || nodes.hero !== this.nodes.hero || nodes.composer !== this.nodes.composer || nodes.dockRoot !== this.nodes.dockRoot || nodes.projectTrigger !== this.nodes.projectTrigger || nodes.isHome !== this.nodes.isHome;
    const bindings = n => (n.composers ?? []).flatMap(c => [c.composer,c.surface,c.input,c.contentRoot,c.footer,...c.rails]);
    const previous = bindings(this.nodes), current = bindings(nodes);
    if (primaryChanged) {this.resetProjectPicker(); this.homeJournal.restore();}
    if (primaryChanged || previous.length !== current.length || current.some((node,i) => node !== previous[i])) this.journal.restore();
    this.nodes = nodes;
    if (!nodes.main) return nodes;
    this.journal.attr(nodes.main, 'data-aw-main', '');
    this.journal.attr(nodes.main, 'data-aw-page', nodes.isHome ? 'home' : nodes.composers.length ? 'conversation' : 'other');
    for (let node = nodes.main; node && node !== this.doc.documentElement; node = node.parentElement) this.journal.attr(node, 'data-aw-clear', '');
    for (const sidebar of nodes.sidebar) {
      this.journal.attr(sidebar, 'data-aw-sidebar', '');
      // Native sidebar wrappers also carry opaque surfaces.
      for (let n = sidebar.parentElement, depth = 0; n && depth < 3 && !n.contains(nodes.main); n = n.parentElement, depth++) this.journal.attr(n, 'data-aw-clear', '');
    }
    for (const chat of nodes.composers) {
      this.journal.attr(chat.surface, 'data-aw-composer', '');
      if (chat.footer && nodes.main.contains(chat.footer)) this.journal.attr(chat.footer, 'data-aw-composer-footer', '');
      for (const rail of chat.rails) {
        this.journal.attr(rail, 'data-aw-composer-rail', '');
        const frame = rail.closest(this.selectors.composerRailFrame);
        if (frame && nodes.main.contains(frame)) this.journal.attr(frame,'data-aw-composer-rail-frame',frame.dataset.composerRailPlacement === 'below' ? 'below' : 'above');
      }
      // Clear only identified editor layout paths, including the side panel.
      // One shared main tint avoids stacking opacity once per chat pane.
      for (let node = chat.surface.parentElement; node && nodes.main.contains(node); node = node.parentElement) this.journal.attr(node, 'data-aw-clear', '');
      // A homepage has no main conversation tint: give its side chat its own.
      if (nodes.isHome && chat.sidePanel) this.journal.attr(chat.sidePanel, 'data-aw-page', 'conversation');
    }
    for (const backdrop of nodes.main.querySelectorAll(this.selectors.chromeBackdrop)) this.journal.attr(backdrop, 'data-aw-native-backdrop', '');
    // Transcript and composer are separate branches. Clear layout containers,
    // then apply each identified content type's palette without rewriting it.
    for (const transcript of nodes.main.querySelectorAll('[data-thread-user-message-navigation-content]')) {
      if (!this.active(transcript)) continue;
      for (let node = transcript; node && nodes.main.contains(node); node = node.parentElement) this.journal.attr(node, 'data-aw-clear', '');
    }
    for (const surface of nodes.main.querySelectorAll(this.selectors.writingSurface)) this.journal.attr(surface,'data-aw-writing','');
    for (const bubble of nodes.main.querySelectorAll(this.selectors.userMessageBubble)) this.journal.attr(bubble,'data-aw-user-message','');
    for (const code of nodes.main.querySelectorAll(this.selectors.codeSurface)) this.journal.attr(code,'data-aw-code','');
    for (const visual of nodes.main.querySelectorAll(this.selectors.visualSurface)) this.journal.attr(visual,'data-aw-visual','');
    return nodes;
  }
  enhanceHome(enabled) {
    const n = this.nodes;
    if (!enabled || !n.isHome) {this.homeJournal.restore(); return;}
    this.homeJournal.attr(n.hero, 'data-aw-original-hero', '');
    for (let node = n.hero.parentElement; node && n.main.contains(node); node = node.parentElement) this.homeJournal.attr(node, 'data-aw-clear', '');
    for (const icon of n.contentRoot.querySelectorAll(this.selectors.homeIcon)) this.homeJournal.attr(icon, 'data-aw-original-home-icon', '');
    if (n.hero.contains(n.projectTrigger)) this.homeJournal.attr(n.projectTrigger, 'tabindex', '-1');
    for (const e of n.contentRoot.querySelectorAll('[data-home-ambient-suggestions]')) this.homeJournal.attr(e, 'data-aw-original-suggestions', '');
    this.homeJournal.attr(n.main, 'data-aw-home', '');
  }
  contentBounds() {
    const shell = this.nodes.main?.getBoundingClientRect();
    if (!shell) return null;
    const pane = this.nodes.contentRoot?.getBoundingClientRect();
    // In split view the welcome card and project cards belong to the primary
    // content pane, not the full shell width occupied by the side chat.
    const main = pane?.width > 0 && pane?.height > 0 ? {left:Math.max(shell.left,pane.left),right:Math.min(shell.right,pane.right),top:Math.max(shell.top,pane.top),bottom:Math.min(shell.bottom,pane.bottom)} : shell;
    const width = Math.max(0,main.right-main.left), height = Math.max(0,main.bottom-main.top);
    let top = main.top;
    // Header and Chat/Work controls may be siblings of the main surface.
    // Measure the real visible controls instead of assuming a fixed header size.
    for (const node of this.doc.querySelectorAll(`${this.selectors.header}, ${this.selectors.modeToggle}`)) {
      if (!this.active(node) || node.closest('[role="dialog"]')) continue;
      const r = node.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.right > main.left && r.left < main.right && r.top < main.top + Math.min(180,height/3) && r.bottom > main.top) top = Math.max(top,r.bottom + (node.matches(this.selectors.modeToggle) ? 10 : 0));
    }
    return {left:main.left, right:main.right, top, bottom:main.bottom, width, height:Math.max(0,main.bottom-top)};
  }
  composerBounds() {
    const {composer,surface,rails,dockRoot} = this.nodes;
    if (!composer || !surface) return null;
    const boxes = [...new Set([dockRoot,composer,surface,...rails])].filter(e => this.active(e)).map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
    if (!boxes.length) return null;
    const left=Math.min(...boxes.map(r=>r.left)),right=Math.max(...boxes.map(r=>r.right)),top=Math.min(...boxes.map(r=>r.top)),bottom=Math.max(...boxes.map(r=>r.bottom));
    return {left,right,top,bottom,width:right-left,height:bottom-top};
  }
  dockHomeComposer(bounds) {
    const n = this.nodes;
    if (!n.isHome || !bounds || !n.composer || !n.surface) return;
    const target = n.dockRoot ?? n.composer;
    const r = target.getBoundingClientRect(), box = this.composerBounds();
    if (!box || r.height <= 0 || bounds.height <= 0) return;
    const scale = target.offsetHeight > 0 ? r.height/target.offsetHeight : 1;
    const translate = this.doc.defaultView.getComputedStyle(target).translate;
    const previous = translate === 'none' ? 0 : Number.parseFloat(target.style.getPropertyValue('--aw-home-dock-y')) || 0;
    // Keep the original editor and its horizontal layout. An independent CSS
    // translate moves it vertically, preserving React's own transform/handlers.
    const baseBottom = box.bottom - previous*scale;
    const offset = (bounds.bottom - 20 - baseBottom)/scale;
    this.homeJournal.attr(target,'data-aw-home-dock','');
    this.homeJournal.css(target,'--aw-home-dock-y',`${Math.round(offset*100)/100}px`);
    for (let node=target.parentElement; node && node !== n.main && n.main.contains(node); node=node.parentElement) this.homeJournal.attr(node,'data-aw-home-dock-path','');
  }
  openProjectPicker(anchor) {
    const trigger = this.nodes.projectTrigger;
    if (!trigger?.isConnected) return false;
    this.resetProjectPicker();
    if (this.nodes.isHome && anchor?.isConnected && anchor !== trigger) {
      // The native trigger and its handlers stay where React placed them. Only
      // this trigger's aria-controls-linked popup is visually anchored elsewhere.
      const direct = event => {if (event.composedPath().includes(trigger)) this.resetProjectPicker();};
      const picker = {trigger,anchor,direct,opened:false,frame:null};
      this.picker = picker;
      this.doc.addEventListener('pointerdown',direct,true);
      picker.timer = this.doc.defaultView.setTimeout(()=>{if(this.picker===picker && !picker.opened)this.resetProjectPicker();},1500);
    }
    if (trigger.getAttribute('aria-expanded') === 'true') {this.syncProjectPicker(); this.onChange(); return true;}
    // Native menu triggers may handle keyboard/pointer-down rather than click.
    // ArrowDown is the standard menu-open action; avoid a second toggle when
    // the native handler consumes it. Keep the visible composer control intact.
    const event = new this.doc.defaultView.KeyboardEvent('keydown', {key:'ArrowDown', code:'ArrowDown', bubbles:true, cancelable:true});
    trigger.dispatchEvent(event);
    if (!event.defaultPrevented) trigger.click();
    this.syncProjectPicker(); this.onChange();
    return true;
  }
  syncProjectPicker() {
    const picker=this.picker;
    if (!picker) return;
    const {trigger,anchor}=picker, win=this.doc.defaultView;
    if (!this.nodes.isHome || !trigger.isConnected || !anchor.isConnected || !this.active(anchor)) {this.resetProjectPicker(); return;}
    if (trigger.getAttribute('aria-expanded') !== 'true') {
      if (picker.opened) this.resetProjectPicker(true);
      return;
    }
    picker.opened=true; win.clearTimeout(picker.timer);
    const menu=this.doc.getElementById(trigger.getAttribute('aria-controls') ?? '');
    const frame=menu?.closest(this.selectors.popupFrame);
    if (!frame || !this.active(menu)) return;
    if (picker.frame && picker.frame!==frame) this.pickerJournal.restore();
    picker.frame=frame;
    const a=anchor.getBoundingClientRect(), r=frame.getBoundingClientRect();
    if (a.width<=0 || a.height<=0 || r.width<=0 || r.height<=0) return;
    const viewport=win.visualViewport, left=viewport?.offsetLeft ?? 0, top=viewport?.offsetTop ?? 0;
    const width=viewport?.width ?? win.innerWidth, height=viewport?.height ?? win.innerHeight, margin=10, gap=8;
    const above=Math.max(0,a.top-top-margin-gap), below=Math.max(0,top+height-margin-a.bottom-gap), placeAbove=above>below;
    this.pickerJournal.attr(frame,'data-aw-project-popup','');
    this.pickerJournal.css(frame,'--aw-picker-available-height',`${Math.max(1,placeAbove?above:below)}px`);
    // Native PopoverContent divides available height by its own UI zoom and
    // handles scrolling. Measure again after the constraint has taken effect.
    const box=frame.getBoundingClientRect(), style=win.getComputedStyle(frame);
    const scaleX=frame.offsetWidth>0?box.width/frame.offsetWidth:1, scaleY=frame.offsetHeight>0?box.height/frame.offsetHeight:1;
    const previousX=style.translate==='none'?0:parseFloat(frame.style.getPropertyValue('--aw-picker-dx'))||0;
    const previousY=style.translate==='none'?0:parseFloat(frame.style.getPropertyValue('--aw-picker-dy'))||0;
    const x=Math.max(left+margin,Math.min(a.left,left+width-margin-box.width));
    const y=Math.max(top+margin,Math.min(placeAbove?a.top-gap-box.height:a.bottom+gap,top+height-margin-box.height));
    this.pickerJournal.css(frame,'--aw-picker-dx',`${Math.round(((x-box.left)/scaleX+previousX)*100)/100}px`);
    this.pickerJournal.css(frame,'--aw-picker-dy',`${Math.round(((y-box.top)/scaleY+previousY)*100)/100}px`);
    this.pickerJournal.attr(anchor,'aria-expanded','true');
    this.pickerJournal.attr(anchor,'aria-haspopup',menu.getAttribute('role')==='menu'?'menu':'dialog');
  }
  resetProjectPicker(restoreFocus=false) {
    const picker=this.picker;
    this.picker=null; this.pickerJournal.restore();
    if (!picker) return;
    this.doc.defaultView.clearTimeout(picker.timer);
    this.doc.removeEventListener('pointerdown',picker.direct,true);
    if (restoreFocus) this.doc.defaultView.setTimeout(()=>{
      if (picker.anchor.isConnected && this.active(picker.anchor) && (this.doc.activeElement===picker.trigger || this.doc.activeElement===this.doc.body)) picker.anchor.focus({preventScroll:true});
    },0);
  }
  openThread(thread) {
    if (!thread?.threadId || !thread?.hostId) throw new Error('该对话暂不支持直接打开');
    if (thread.sourceKind === 'chatgpt') {
      // Same /g/:gizmoId/c/:conversationId path as the native route helper.
      const path = thread.projectId ? `/g/${encodeURIComponent(thread.projectId)}/c/${encodeURIComponent(thread.threadId)}` : `/c/${encodeURIComponent(thread.threadId)}`;
      this.doc.defaultView.dispatchEvent(new this.doc.defaultView.MessageEvent('message', {data:{type:'navigate-to-route', path}}));
      return;
    }
    const row = [...this.doc.querySelectorAll(`[${this.selectors.threadId}]`)].find(e => e.getAttribute(this.selectors.threadId) === thread.threadId && (e.getAttribute(this.selectors.threadHost) ?? 'local') === thread.hostId);
    if (row) { (row.querySelector('[data-interactive-row-link]') ?? row).click(); return; }
    // This is the same renderer notification consumed by the native router.
    this.doc.defaultView.dispatchEvent(new this.doc.defaultView.MessageEvent('message', {data: {type: 'navigate-to-route', path: `/local/${encodeURIComponent(thread.threadId)}`, threadSelection: {kind: 'local', conversationId: thread.threadId, hostId: thread.hostId}}}));
  }
  diagnose() {
    const n = this.nodes;
    const rect = e => {const r = e?.getBoundingClientRect(); return r ? {x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height)} : null;};
    return {main: !!n.main, homepage: !!n.isHome, homeMode:n.homeMode ?? null, composer: !!n.composer, composerKind: n.composer?.tagName ?? null, surface: !!n.surface, editor: !!n.input, nativeProjectPicker: !!n.projectTrigger, sidebarCount: n.sidebar?.length ?? 0, recognizedComposers:n.composers?.length ?? 0, sideChatComposers:n.composers?.filter(c=>c.sidePanel).length ?? 0, composers:(n.composers ?? []).map(c=>({kind:c.sidePanel?'side-chat':'main',composerRect:rect(c.surface),editor:!!c.input,utilityRails:c.rails.length})), mainCandidates:this.doc.querySelectorAll(this.selectors.main).length, composerCandidates:this.doc.querySelectorAll(this.selectors.composer).length, mainRect: rect(n.main), composerRect: rect(n.surface), contentRect:this.contentBounds(), fullComposerRect:this.composerBounds(), dockOffset:n.dockRoot?.style.getPropertyValue('--aw-home-dock-y') ?? '', dockIncludesUtilityWrapper:!!n.dockRoot && n.dockRoot !== n.composer, decorativeLayers:n.main?.querySelectorAll('[data-aw-native-backdrop]').length ?? 0, footerBackdrops:n.main?.querySelectorAll('[data-aw-composer-footer]').length ?? 0, utilityRails:n.rails?.length ?? 0};
  }
  dispose() { this.resetProjectPicker(); this.homeJournal.restore(); this.journal.restore(); }
}
