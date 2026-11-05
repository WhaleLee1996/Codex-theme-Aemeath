import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeConfig, serializeConfig, changeTheme, rememberTheme, nextWallpaper, normalizeProjects, projectFilter, rankProjects} from '../src/core.mjs';
import {createBreathing} from '../src/motion.mjs';
const reference = JSON.parse(fs.readFileSync(new URL('../src/reference.json', import.meta.url)));
const ids = ['stars','sunset'];

test('saved theme preferences survive mode changes, theme switching and restart', () => {
  const c = normalizeConfig({schemaVersion:3,theme:'plum',opacity:0,glow:31,glowMode:'manual',cardBlur:4},reference,ids);
  c.glowMode = 'breathe'; c.breathPeriod = 9; rememberTheme(c);
  changeTheme(c,'rose',reference.themes); assert.equal(c.glow,12); assert.equal(c.cardBlur,0);
  c.opacity = 85; c.glow = 18; c.cardBlur = 2; rememberTheme(c); changeTheme(c,'plum',reference.themes);
  assert.equal(c.glow,31); assert.equal(c.breathPeriod,9); assert.equal(c.cardBlur,4);
  const restarted = normalizeConfig(JSON.parse(JSON.stringify(c)),reference,ids);
  assert.equal(restarted.glow,31); assert.equal(restarted.themeAdjustments.rose.glow,18);
  assert.equal(restarted.opacity,0);assert.equal(restarted.themeAdjustments.rose.opacity,85);
  restarted.glowMode = 'manual'; assert.equal(restarted.glow,31);
});
test('legacy narrow welcome card cannot replace approved width; removed images recover', () => {
  const c = normalizeConfig({welcomeWidth:470,wallpaperIds:['missing'],wallpaperId:'missing',duration:-200,dim:900,theme:'__proto__'},reference,ids);
  assert.equal(c.welcomeWidth,760); assert.equal(c.duration,5); assert.equal(c.dim,60); assert.equal(c.theme,'plum');
  assert.deepEqual(c.wallpaperIds,ids); assert.equal(c.wallpaperId,'stars');
  assert.equal('current' in c,false); assert.equal('sidebar' in c,false);
});
test('shuffle never repeats the currently displayed image with multiple images', () => {
  const c = normalizeConfig({order:'random',wallpaperId:'stars'},reference,ids);
  assert.equal(nextWallpaper(c,1,()=>0),'sunset');
  assert.equal(nextWallpaper(c,1,()=>0.999999),'sunset');
});
test('existing settings retain their appearance while adding a persistent adjustable companion size', () => {
  const c = normalizeConfig({schemaVersion:4,theme:'rose',dim:10,opacity:30,cardBlur:1,enabled:false},reference,ids);
  assert.equal(c.companionSize,144); assert.equal(c.cardBlur,1); assert.equal(c.opacity,30); assert.equal(c.dim,10); assert.equal(c.enabled,false);
  c.companionSize=182; changeTheme(c,'plum',reference.themes);
  const reopened=normalizeConfig(c,reference,ids); assert.equal(reopened.companionSize,182);
  assert.equal(normalizeConfig({...c,companionSize:1000},reference,ids).companionSize,216);
  const ranked=rankProjects([{id:'new',threads:[]},{id:'active',threads:[{sourceRecencyAt:5}]}]);
  assert.deepEqual(ranked.map(p=>p.id),['active','new']);
});
test('project filters honor explicit assignments and projectless chats', () => {
  const p=normalizeProjects({one:{id:'one',name:'One',rootPaths:['D:\\One']}})[0];
  const f=projectFilter(p,{assignments:{a:'one',b:'two'},projectlessThreadIds:['c']});
  assert.deepEqual(f.includeThreadIds,['a']); assert.deepEqual(f.excludeThreadIds,['c','b']);
  assert.deepEqual(f.cwdValues,['D:\\One']);
  const ranked=rankProjects([0,1,2,3,4].map(n=>({id:String(n),threads:[{sourceRecencyAt:n+1}]})));
  assert.deepEqual(ranked.map(p=>p.id),['4','3','2','1']);
});
test('four independent pins survive restart and theme changes, while duplicates and invalid entries are discarded',()=>{
  const raw={schemaVersion:4,theme:'rose',opacity:41,companionSize:182,pinnedProjects:[{key:'chatgpt:chatgpt:g-one',name:'AI Learning'},null,{key:'local:local:a',name:'Local'},null]};
  const c=normalizeConfig(raw,reference,ids);assert.equal(c.schemaVersion,7);assert.equal(c.opacity,41);assert.deepEqual(c.pinnedProjects,raw.pinnedProjects);
  changeTheme(c,'plum',reference.themes);assert.deepEqual(normalizeConfig(JSON.parse(JSON.stringify(c)),reference,ids).pinnedProjects,raw.pinnedProjects);
  assert.deepEqual(normalizeConfig({...raw,pinnedProjects:[raw.pinnedProjects[0],raw.pinnedProjects[0],{key:'invalid'},'wrong']},reference,ids).pinnedProjects,[raw.pinnedProjects[0],null,null,null]);
});

test('v6 shared glass and playback migrate into both themes without overwriting independent values',()=>{
  const old={schemaVersion:6,theme:'rose',opacity:85,cardBlur:5,sidebarBlur:9,haloBlur:6,haloWidth:17,duration:60,dim:25,order:'random',playing:true,wallpaperId:'sunset',companionSize:196,themeAdjustments:{rose:{opacity:80,glow:18},plum:{opacity:10,cardBlur:2,glow:42}}};
  const c=normalizeConfig(old,reference,ids);assert.equal(c.opacity,85);
  changeTheme(c,'plum',reference.themes);
  assert.equal(c.opacity,10);assert.equal(c.glow,42);assert.equal(c.cardBlur,2);
  for(const key of ['sidebarBlur','haloBlur','haloWidth','duration','dim','order','playing','wallpaperId'])assert.equal(c[key],old[key],key);
  Object.assign(c,{opacity:0,sidebarBlur:1,haloBlur:0,haloWidth:30,duration:15,dim:0,order:'sequence',playing:false,wallpaperId:'stars'});
  changeTheme(c,'rose',reference.themes);assert.equal(c.opacity,85);
  for(const key of ['sidebarBlur','haloBlur','haloWidth','duration','dim','order','playing','wallpaperId'])assert.equal(c[key],old[key],key);
  const reopened=normalizeConfig(serializeConfig(c),reference,ids);changeTheme(reopened,'plum',reference.themes);
  assert.equal(reopened.opacity,0);assert.equal(reopened.sidebarBlur,1);assert.equal(reopened.haloBlur,0);assert.equal(reopened.haloWidth,30);
  assert.equal(reopened.duration,15);assert.equal(reopened.dim,0);assert.equal(reopened.order,'sequence');assert.equal(reopened.playing,false);assert.equal(reopened.wallpaperId,'stars');assert.equal(reopened.companionSize,196);
});

test('v7 per-theme settings win over stale active aliases and keep inactive folder image IDs',()=>{
  const c=normalizeConfig({schemaVersion:7,theme:'plum',opacity:90,wallpaperId:'stale',themeAdjustments:{plum:{opacity:0,wallpaperId:'stars'},rose:{opacity:87,wallpaperId:'other-folder-picture',playing:true}}},reference,ids);
  assert.equal(c.opacity,0);assert.equal(c.wallpaperId,'stars');assert.equal(c.themeAdjustments.rose.wallpaperId,'other-folder-picture');
  const saved=serializeConfig(c);assert.equal('wallpaperIds' in saved,false);
  changeTheme(c,'rose',reference.themes);assert.equal(c.opacity,87);assert.equal(c.wallpaperId,'other-folder-picture');
  assert.equal(normalizeConfig(serializeConfig(c),reference,[]).wallpaperId,'other-folder-picture');
});
test('breathing pauses cleanly, preserves phase and never writes manual brightness', () => {
  const frames=new Map();let key=0, level=-1, visible=true, reduced=false;
  const motion=createBreathing({requestFrame:fn=>{frames.set(++key,fn);return key;},cancelFrame:id=>frames.delete(id),write:v=>{level=v;},visible:()=>visible,reduced:()=>reduced});
  const c={enabled:true,glow:23,glowMode:'breathe',breathPeriod:6,breathPeak:100};
  const tick=time=>{const [id,fn]=frames.entries().next().value;frames.delete(id);fn(time);};
  motion.sync(c);motion.sync(c);assert.equal(frames.size,1);tick(0);tick(3000);assert.ok(Math.abs(level-1)<1e-8);
  visible=false;motion.sync(c);assert.equal(frames.size,0);
  visible=true;motion.sync(c);tick(9000);assert.ok(Math.abs(level-1)<1e-8);
  c.breathPeriod=12;motion.sync(c);assert.ok(Math.abs(level-1)<1e-8);
  reduced=true;motion.sync(c);assert.equal(level,.23);assert.equal(frames.size,0);assert.equal(c.glow,23);
  reduced=false;c.glowMode='manual';motion.sync(c);assert.equal(level,.23);
  c.glowMode='breathe';c.breathPeak=0;motion.sync(c);assert.equal(level,0);assert.equal(frames.size,0);
  motion.dispose();
});
