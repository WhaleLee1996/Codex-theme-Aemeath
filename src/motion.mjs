import {breathingLevel} from './core.mjs';

export function createBreathing({requestFrame, cancelFrame, write, visible, reduced}) {
  let frame = null, previous = null, elapsed = 0, period = 6, config;
  function stop() { if (frame !== null) cancelFrame(frame); frame = null; previous = null; }
  function tick(time) {
    frame = null;
    if (!visible() || reduced() || !config.enabled || config.glowMode !== 'breathe' || config.breathPeak === 0) { sync(config); return; }
    if (previous !== null) elapsed += Math.max(0, time - previous);
    previous = time;
    write(breathingLevel(elapsed, config.breathPeriod, config.breathPeak));
    frame = requestFrame(tick);
  }
  function sync(next) {
    if (!next) return;
    config = next;
    if (period !== next.breathPeriod) { elapsed = elapsed / period * next.breathPeriod; period = next.breathPeriod; }
    if (!next.enabled || !visible()) { stop(); return; }
    if (next.glowMode !== 'breathe' || reduced()) { stop(); write(next.glow / 100); return; }
    if (next.breathPeak === 0) { stop(); write(0); return; }
    write(breathingLevel(elapsed, next.breathPeriod, next.breathPeak));
    if (frame === null) frame = requestFrame(tick);
  }
  return {sync, dispose: stop};
}
