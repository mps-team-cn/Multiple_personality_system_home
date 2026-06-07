'use strict';

// 兼容旧页面入口：这里按依赖顺序加载拆分后的业务脚本。
const RACE_GAME_SCRIPTS = [
  'config.js',
  'race-formulas.js',
  'telemetry.js',
  'state.js',
  'core.js',
  'achievements.js',
  'race.js',
  'parts.js',
  'storage.js',
  'main.js',
  'gsafe.js',
];

const raceGameEntryScript =
  document.currentScript || document.querySelector('script[src$="game.js"]');
const raceGameScriptBaseUrl = new URL(
  './scripts/',
  raceGameEntryScript ? raceGameEntryScript.src : window.location.href
);

// 使用 Promise 串行加载，确保后续脚本能访问前面脚本挂到全局的常量和函数。
function loadRaceGameScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');

    script.src = new URL(src, raceGameScriptBaseUrl).href;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load race game script: ${src}`));
    document.head.appendChild(script);
  });
}

RACE_GAME_SCRIPTS.reduce(
  (chain, src) => chain.then(() => loadRaceGameScript(src)),
  Promise.resolve()
).catch((error) => {
  console.error(error);
});
