export const CONFIG_VERSION = 7;
const PREVIOUS_THEME_KEYS = ['opacity', 'cardBlur', 'glow', 'glowMode', 'breathPeriod', 'breathPeak'];
export const THEME_KEYS = [...PREVIOUS_THEME_KEYS, 'sidebarBlur', 'haloBlur', 'haloWidth', 'duration', 'dim', 'order', 'playing', 'wallpaperId'];
export const LIMITS = { duration: [5, 120], dim: [0, 60], opacity: [0, 95], cardBlur: [0, 24], sidebarBlur: [0, 32], haloBlur: [0, 24], haloWidth: [8, 48], glow: [0, 100], welcomeWidth: [580, 880], companionSize: [72, 216], breathPeriod: [2, 12], breathPeak: [0, 100] };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function clone(value) { return JSON.parse(JSON.stringify(value)); }
export function clamp(key, value) { return Math.min(LIMITS[key][1], Math.max(LIMITS[key][0], value)); }
function setPreference(target, key, value) {
  if (Object.hasOwn(LIMITS,key) && Number.isFinite(value)) target[key] = clamp(key,value);
  else if (key === 'glowMode' && ['breathe','manual'].includes(value)) target[key] = value;
  else if (key === 'order' && ['sequence','random'].includes(value)) target[key] = value;
  else if (key === 'playing' && typeof value === 'boolean') target[key] = value;
  else if (key === 'wallpaperId' && (value === null || (typeof value === 'string' && value.length <= 600))) target[key] = value;
}

export function normalizeConfig(raw, reference, wallpaperIds) {
  const value = plain(raw) ? raw : {};
  const result = clone(reference.sourceStartingState);
  // Page state (the open project, sidebar, and settings panel) belongs to Codex.
  for (const key of ['current', 'sidebar', 'settings', 'background']) delete result[key];
  result.schemaVersion = CONFIG_VERSION;
  result.enabled = typeof value.enabled === 'boolean' ? value.enabled : true;
  result.companionSize = 144;
  const pins = Array.isArray(value.pinnedProjects) ? value.pinnedProjects : [];
  const seen = new Set();
  result.pinnedProjects = Array.from({length: 4}, (_, i) => {
    const pin = pins[i];
    if (!plain(pin) || typeof pin.key !== 'string' || pin.key.length > 600 || !/^(local|remote|chatgpt):/.test(pin.key) || seen.has(pin.key)) return null;
    seen.add(pin.key);
    return {key: pin.key, name: typeof pin.name === 'string' ? pin.name.slice(0, 200) : '项目'};
  });
  const themes = reference.themes;
  result.theme = Object.hasOwn(themes, value.theme) ? value.theme : result.theme;
  const startingPreferences = result.themeAdjustments;
  result.themeAdjustments = {};
  for (const name of Object.keys(themes)) {
    const prefs = {};
    const saved = plain(value.themeAdjustments?.[name]) ? value.themeAdjustments[name] : {};
    for (const key of THEME_KEYS) {
      setPreference(prefs,key,startingPreferences?.[name]?.[key] ?? themes[name].defaults[key] ?? result[key] ?? (key === 'wallpaperId' ? null : undefined));
      // Formerly shared settings start identically in every theme. Existing
      // per-theme glass/glow preferences must survive this migration intact.
      if (!(value.schemaVersion >= CONFIG_VERSION) && !PREVIOUS_THEME_KEYS.includes(key)) setPreference(prefs,key,value[key]);
      setPreference(prefs,key,saved[key]);
      // v7 stores the independent theme values as the source of truth. Older
      // files kept the active theme's latest values at the top level.
      if (name === result.theme && (!(value.schemaVersion >= CONFIG_VERSION) || !Object.hasOwn(saved,key))) setPreference(prefs,key,value[key]);
    }
    result.themeAdjustments[name] = prefs;
  }
  Object.assign(result, result.themeAdjustments[result.theme]);
  for (const key of Object.keys(LIMITS)) {
    if (!THEME_KEYS.includes(key) && Number.isFinite(value[key]) && (key !== 'welcomeWidth' || value.schemaVersion >= 2)) result[key] = clamp(key, value[key]);
  }
  result.density = value.density === 'compact' ? 'compact' : 'airy';
  // The folder is the playlist; its full list stays in memory, not settings.
  result.wallpaperIds = [...new Set(wallpaperIds)];
  const oldIndex = Number.isInteger(value.background) ? value.background : 0;
  result.wallpaperId = result.wallpaperIds.includes(result.wallpaperId) || !result.wallpaperIds.length ? result.wallpaperId : result.wallpaperIds[oldIndex] ?? result.wallpaperIds[0] ?? null;
  rememberTheme(result);
  return result;
}
export function serializeConfig(config) {rememberTheme(config);const {wallpaperIds,...value}=config;return clone(value);}
export function rememberTheme(config) { config.themeAdjustments[config.theme] = Object.fromEntries(THEME_KEYS.map(key => [key, config[key]])); }
export function changeTheme(config, name, themes) {
  if (!Object.hasOwn(themes, name)) throw new Error('未知主题');
  rememberTheme(config);
  config.theme = name;
  Object.assign(config, config.themeAdjustments[name] ?? themes[name].defaults);
  return config;
}
export function breathingLevel(elapsed, seconds, peak) { return peak / 100 * (1 - Math.cos(2 * Math.PI * (elapsed % (seconds * 1000)) / (seconds * 1000))) / 2; }
export function nextWallpaper(config, direction = 1, random = Math.random) {
  const ids = config.wallpaperIds;
  if (ids.length <= 1) return ids[0];
  const current = Math.max(0, ids.indexOf(config.wallpaperId));
  if (config.order === 'random' && direction > 0) return ids[(current + 1 + Math.floor(random() * (ids.length - 1))) % ids.length];
  return ids[(current + direction + ids.length) % ids.length];
}
export function projectKey(project) { return `${project.kind}:${encodeURIComponent(project.hostId ?? '')}:${encodeURIComponent(project.id)}`; }
export function normalizeProjects(local, remote = [], cloud = []) {
  const projects = [];
  for (const [id, p] of Object.entries(plain(local) ? local : {})) {
    if (!plain(p) || !Array.isArray(p.rootPaths)) continue;
    projects.push({id: p.id ?? id, name: p.name?.trim() || p.rootPaths[0]?.split(/[\\/]/).filter(Boolean).at(-1) || id, kind: 'local', hostId: 'local', roots: p.rootPaths.filter(x => typeof x === 'string' && x.length > 0)});
  }
  for (const p of Array.isArray(remote) ? remote : []) {
    if (typeof p.id === 'string' && typeof p.hostId === 'string' && typeof p.remotePath === 'string') projects.push({id: p.id, name: p.label || p.remotePath.split('/').filter(Boolean).at(-1) || p.id, kind: 'remote', hostId: p.hostId, roots: [p.remotePath]});
  }
  for (const item of Array.isArray(cloud) ? cloud : []) {
    const p = item?.gizmo?.gizmo;
    if (typeof p?.id === 'string' && typeof p.display?.name === 'string') projects.push({id:p.id, name:p.display.name, kind:'chatgpt', hostId:'chatgpt', roots:[]});
  }
  return [...new Map(projects.map(p => {p.key = projectKey(p); return [p.key, p];})).values()];
}
export function projectFilter(project, memberships = {}) {
  const includeThreadIds = [], excludeThreadIds = [...(memberships.projectlessThreadIds ?? [])];
  for (const [threadId, assignment] of Object.entries(memberships.assignments ?? {})) {
    // The native current format stores a project id string per thread.
    const id = typeof assignment === 'string' ? assignment : assignment?.projectId;
    if (id === project.id) includeThreadIds.push(threadId);
    else if (id) excludeThreadIds.push(threadId);
  }
  return {cwdValues: project.roots, cwdPrefixes: project.roots, includeThreadIds, excludeThreadIds: [...new Set(excludeThreadIds)]};
}
export function rankProjects(projects) {
  const recency = p => p.threads?.[0]?.sourceRecencyAt ?? p.threads?.[0]?.sourceUpdatedAt ?? 0;
  return [...projects].sort((a, b) => recency(b) - recency(a) || a.id.localeCompare(b.id)).slice(0, 4);
}
export function mergeThreads(previous, incoming) {
  return [...new Map([...previous, ...incoming].filter(x => typeof x.threadId === 'string').map(x => [`${x.sourceKind ?? 'local'}\0${x.hostId}\0${x.threadId}`, x])).values()].sort((a, b) => (b.sourceRecencyAt ?? b.sourceUpdatedAt ?? 0) - (a.sourceRecencyAt ?? a.sourceUpdatedAt ?? 0) || a.threadId.localeCompare(b.threadId));
}
export function cloudThreads(items, projectId) {
  const seconds = value => typeof value === 'number' ? (value > 1e12 ? value / 1000 : value) : (Date.parse(value) || 0) / 1000;
  return items.filter(x => typeof x?.id === 'string' && !x.is_archived).map(x => ({threadId:x.id, hostId:'chatgpt', sourceKind:'chatgpt', projectId, displayTitle: typeof x.title === 'string' ? x.title : '未命名对话', sourceUpdatedAt:seconds(x.update_time ?? x.updated_at ?? x.create_time)}));
}
