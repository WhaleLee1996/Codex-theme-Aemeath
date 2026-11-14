import {JSDOM} from 'jsdom';
import {startTheme} from './theme-fixture.mjs';
import {fixture, services} from './fixtures.mjs';

// Deterministic DOM probe, not a renderer/FPS benchmark. Only animation frames
// are advanced; native events, MutationObserver and theme code remain real.
export async function motionFixture(config = {}, {html=fixture,compatibility} = {}) {
  const dom = new JSDOM(html, {url:'https://local.test/', pretendToBeVisual:true});
  const win = dom.window, doc = win.document, frames = new Map();
  let id = 0, time = 0;
  win.requestAnimationFrame = fn => { frames.set(++id, fn); return id; };
  win.cancelAnimationFrame = key => frames.delete(key);
  const observedSizes = new Set();
  win.ResizeObserver = class {observe(node) {observedSizes.add(node);} unobserve(node) {observedSizes.delete(node);} disconnect() {observedSizes.clear();}};
  win.matchMedia = () => ({matches:false, addEventListener() {}, removeEventListener() {}});
  win.electronBridge = {getSentryInitOptions:() => ({appVersion:compatibility?.packageVersion ?? '26.1027.30824'})};
  win.aemeathWish = {
    readSettings:async () => ({config:{glowMode:'breathe', breathPeriod:6, breathPeak:100, playing:false, ...config}}),
    getBackgrounds:async()=>({folder:'test',images:[{id:'stars'}]}), readImage:async()=>({bytes:new Uint8Array([1]),mime:'image/png'}),
    saveSettings:async () => ({}), diagnostics:async () => ({})
  };
  const service=services().service;
  const api = await startTheme(win, {shared:{Vct:service,appServices:service},...(compatibility ? {compatibility} : {})});
  const root = doc.querySelector('aemeath-wish-theme').shadowRoot.querySelector('#aw-ui');
  async function step(delta = 1000/60) {
    await new Promise(resolve => setImmediate(resolve));
    time += delta;
    const pending = [...frames]; frames.clear();
    for (const [, fn] of pending) fn(time);
    await new Promise(resolve => setImmediate(resolve));
  }
  for (let i = 0; i < 6; i++) await step();
  return {win, doc, root, api, frames, step, observedSizes, close() {api.dispose(); win.close();}};
}

export async function measureMotion() {
  const scene = await motionFixture();
  const {win, doc, root, step} = scene;
  const records = [];
  const observer = new win.MutationObserver(batch => records.push(...batch));
  observer.observe(doc.documentElement, {attributes:true, attributeFilter:['style'], subtree:true});
  observer.observe(root, {attributes:true, attributeFilter:['style'], subtree:true});
  try {
    for (let i = 0; i < 60; i++) await step();
    const isLeaf = node => node.matches?.('.aw-live-glow,.aw-live-star');
    return {
      mode:'deterministic-dom-write-probe', simulatedFrames:60,
      pageRootStyleMutations:records.filter(r => r.target === doc.documentElement).length,
      themeRootStyleMutations:records.filter(r => r.target === root).length,
      nativeSubtreeStyleMutations:records.filter(r => doc.body.contains(r.target)).length,
      localEffectStyleMutations:records.filter(r => isLeaf(r.target)).length,
      otherThemeStyleMutations:records.filter(r => root.contains(r.target) && r.target !== root && !isLeaf(r.target)).length,
      nativeFrameRateMeasured:false, nativeHoverLatencyMeasured:false
    };
  } finally {observer.disconnect(); scene.close();}
}
