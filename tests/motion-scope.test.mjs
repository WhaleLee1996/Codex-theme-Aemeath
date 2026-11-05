import test from 'node:test';
import assert from 'node:assert/strict';
import {measureMotion, motionFixture} from './motion-fixture.mjs';

test('sixty breathing frames write only local effects, never native or shared ancestor styles', async () => {
  const report = await measureMotion();
  assert.equal(report.pageRootStyleMutations, 0);
  assert.equal(report.themeRootStyleMutations, 0);
  assert.equal(report.nativeSubtreeStyleMutations, 0);
  assert.equal(report.otherThemeStyleMutations, 0);
  assert.ok(report.localEffectStyleMutations > 0);
});

test('local glow follows composer size and zoom without rewriting its native surface', async t => {
  const scene = await motionFixture(); t.after(() => scene.close());
  const {win, doc, root, step} = scene;
  const surface = doc.querySelector('[data-composer-surface-variant]');
  const glow = root.querySelector('.aw-live-glow');
  const effects = [...root.querySelectorAll('.aw-live-glow,.aw-live-star')];
  const nativeStyle = surface.getAttribute('style');
  Object.defineProperty(surface, 'offsetWidth', {value:400});
  surface.getBoundingClientRect = () => ({left:120,top:380,right:620,bottom:630,width:500,height:250});
  win.dispatchEvent(new win.Event('resize')); await step();
  assert.equal(glow.style.left,'120px'); assert.equal(glow.style.top,'380px');
  assert.equal(glow.style.width,'500px'); assert.equal(glow.style.height,'250px');
  assert.equal(glow.style.borderRadius,'27.5px'); assert.match(glow.style.boxShadow,/18.75px/);
  assert.ok(effects.every(e => !e.hidden && e.style.opacity === glow.style.opacity));
  assert.ok(effects.every(e => e.style.willChange === 'opacity'));
  assert.equal(surface.getAttribute('style'), nativeStyle);
  surface.closest('[data-codex-composer-root]').remove(); await step(); await step();
  assert.ok(effects.every(e => e.hidden && e.style.willChange === 'auto'));
  assert.equal(scene.frames.size, 0);
});

test('manual brightness, zero peak, visibility pause and theme disable work on the isolated layers', async t => {
  const scene = await motionFixture({glow:23}); t.after(() => scene.close());
  const {win, doc, root, step} = scene;
  const effects = [...root.querySelectorAll('.aw-live-glow,.aw-live-star')];
  const set = (key,value) => {
    const input = root.querySelector(`[data-setting="${key}"]`);
    if (input.type === 'checkbox') input.checked = value; else input.value = String(value);
    input.dispatchEvent(new win.Event('input',{bubbles:true}));
  };
  root.querySelector('[data-glow-mode="manual"]').click(); await step();
  assert.ok(effects.every(e => e.style.opacity === '0.23' && e.style.willChange === 'auto'));
  assert.equal(scene.frames.size, 0);
  root.querySelector('[data-glow-mode="breathe"]').click(); await step();
  assert.equal(scene.frames.size, 1);
  const opacity = effects[0].style.opacity;
  Object.defineProperty(doc,'hidden',{configurable:true,value:true});
  doc.dispatchEvent(new win.Event('visibilitychange')); await step(5000);
  assert.equal(scene.frames.size, 0); assert.equal(effects[0].style.opacity,opacity);
  assert.ok(effects.every(e => e.style.willChange === 'auto'));
  Object.defineProperty(doc,'hidden',{configurable:true,value:false});
  doc.dispatchEvent(new win.Event('visibilitychange')); await step();
  assert.equal(scene.frames.size, 1); assert.equal(effects[0].style.opacity,opacity);
  set('breathPeak',0); await step();
  assert.equal(scene.frames.size, 0); assert.ok(effects.every(e => e.style.opacity === '0'));
  set('enabled',false); await step();
  assert.ok(effects.every(e => e.hidden)); assert.equal(scene.frames.size,0);
  set('enabled',true); await step();
  root.querySelector('[data-glow-mode="manual"]').click(); await step();
  assert.ok(effects.every(e => !e.hidden && e.style.opacity === '0.23'));
});
