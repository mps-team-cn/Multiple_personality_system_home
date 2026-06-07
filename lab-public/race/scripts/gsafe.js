'use strict';

/*
 * GSafe 异常检测系统 v1.1
 *
 * Powered by Guoge
 * GitHub  : https://github.com/CHINAGUOGE
 * 主页    : https://me.51320721.xyz
 *
 * 检测维度：
 *   1. 关键函数完整性 (toString 签名校验)
 *   2. Math.random / performance.now / Date.now 原生函数替换
 *   3. gameState 属性快照差分 (不可能的状态突变)
 *   4. 反应时间合理性 (低于人类极限)
 *   5. 存档数据校验和 (FNV-1a 哈希)
 *   6. 脚本自保护 (检测自身是否被移除)
 *   7. 阶段跳转合法性
 *   8. 刷钱检测 (连续异常现金增长)
 *   9. 刷成就检测 (批量解锁)
 *  10. 参数篡改检测 (属性突破理论上限)
 *  11. 脚本注入检测 (控制台操作痕迹)
 *  12. 存档哈希链 (防批量篡改)
 *
 * GSafe 只保护本局成绩、成就和日志可信度，不做永久封禁。
 */

const GSafe = (() => {
  /* ═══ 字符串编码（避免静态搜索） ═══ */
  const _s = (arr) => arr.map((c) => String.fromCharCode(c)).join('');
  const TAG = _s([91, 71, 83, 97, 102, 101, 93]); // [GSafe]
  const LEGACY_BAN_KEY = _s([103, 115, 97, 102, 101, 95, 98, 97, 110]); // gsafe_ban
  const LEGACY_FP_KEY = _s([103, 115, 102, 112]); // gsfp
  const VER = '1.1';
  const RISK_NOTICE_ID = 'gsafe-overlay';
  const EVIDENCE_DB_NAME = 'mps-race-gsafe';
  const EVIDENCE_DB_VERSION = 1;
  const EVIDENCE_STORE_NAME = 'evidence';

  const RISK_WEIGHTS = Object.freeze({
    REACTION_INHUMAN: 2,
    REACTION_SUSPICIOUS: 1,
    REACTION_CONSISTENTLY_SUSPICIOUS: 2,
    AUTO_START_DETECTED: 3,
    CASH_ANOMALY: 2,
    CASH_FARMING: 3,
    ACHIEVEMENT_INJECTION: 1,
    ACHIEVEMENT_FARMING: 2,
    INVENTORY_ANOMALY: 2,
    PHASE_INVALID: 4,
    FN_OVERRIDE: 5,
    MATH_RANDOM_HOOK: 5,
    PERFORMANCE_NOW_HOOK: 5,
    DATE_NOW_HOOK: 5,
    STAT_CEILING_BREACH: 5,
    STAT_CLAMP_BREACH: 5,
    STATS_MISMATCH: 5,
    STATS_ROLLBACK: 5,
    SCRIPT_REMOVED: 5,
    RACE_COUNT_ANOMALY: 4,
    SAVE_CHECKSUM_MISMATCH: 3,
    EVAL_USAGE: 2,
  });

  const RACE_ACHIEVEMENT_SOURCES = new Set([
    'validStart',
    'falseStart',
    'raceEnd',
    'practiceRecovery',
  ]);

  const gsafeState = {
    riskScore: 0,
    invalidCurrentRace: false,
    achievementLocked: false,
    evidence: [],
  };

  let riskNoticeShown = false;
  let safetyNoticeShown = false;
  let evidenceDbPromise = null;

  /* ═══ FNV-1a 32 位哈希 ═══ */
  function fnv1a(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h;
  }

  /* ═══ 排序 JSON 序列化（确定性） ═══ */
  function sortedJSON(obj) {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return '[' + obj.map(sortedJSON).join(',') + ']';
    const keys = Object.keys(obj).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + sortedJSON(obj[k])).join(',') + '}';
  }

  /* ═══ 暴露校验和函数供 core.js / storage.js 调用 ═══ */
  globalThis.gsafeChecksum = function (data) {
    return fnv1a(sortedJSON(data));
  };

  globalThis.gsafeVerifyChecksum = function (data) {
    if (!data || typeof data._gsafeChecksum !== 'number') return false;
    const copy = {};
    for (const k in data) {
      if (k !== '_gsafeChecksum') copy[k] = data[k];
    }
    return fnv1a(sortedJSON(copy)) === data._gsafeChecksum;
  };

  function removeCookie(name) {
    document.cookie = name + '=;path=/;max-age=0;SameSite=Strict';
    document.cookie = name + '=;path=/;expires=Thu, 01 Jan 1970 00:00:00 GMT;SameSite=Strict';
  }

  function escapeHTML(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fallbackRaceStorageKeys() {
    const keys = [];
    if (typeof STORAGE_KEY !== 'undefined') keys.push(STORAGE_KEY);
    if (typeof RACE_AUDIO_STORAGE_KEY !== 'undefined') keys.push(RACE_AUDIO_STORAGE_KEY);
    if (typeof RACE_SESSION_STORAGE_KEY !== 'undefined') keys.push(RACE_SESSION_STORAGE_KEY);
    if (typeof RACE_LOCAL_LOG_STORAGE_KEY !== 'undefined') keys.push(RACE_LOCAL_LOG_STORAGE_KEY);
    if (typeof RACE_LEGACY_STORAGE_KEYS !== 'undefined' && Array.isArray(RACE_LEGACY_STORAGE_KEYS)) {
      keys.push.apply(keys, RACE_LEGACY_STORAGE_KEYS);
    }
    return keys;
  }

  function clearLocalDataAndReload() {
    try {
      if (typeof clearAllRaceLocalData === 'function') {
        clearAllRaceLocalData();
      } else {
        fallbackRaceStorageKeys().forEach(function (key) {
          localStorage.removeItem(key);
        });
      }
      localStorage.removeItem(LEGACY_BAN_KEY);
    } catch (error) {
      return {
        ok: false,
        message: '浏览器拒绝访问 localStorage。',
      };
    }

    try { sessionStorage.removeItem(LEGACY_FP_KEY); } catch (_) {}
    removeCookie(LEGACY_BAN_KEY);

    return { ok: true };
  }

  function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(text);
    }

    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', 'readonly');
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.select();

    try {
      document.execCommand('copy');
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    } finally {
      document.body.removeChild(input);
    }
  }

  function getAppealGroupText() {
    return typeof RACE_QQ_GROUP !== 'undefined' ? RACE_QQ_GROUP : '未配置';
  }

  function getRiskWeight(code, weight) {
    if (typeof weight === 'number' && Number.isFinite(weight) && weight > 0) {
      return weight;
    }
    return RISK_WEIGHTS[code] || 1;
  }

  function cloneState() {
    return {
      riskScore: gsafeState.riskScore,
      invalidCurrentRace: gsafeState.invalidCurrentRace,
      achievementLocked: gsafeState.achievementLocked,
      evidence: gsafeState.evidence.slice(),
    };
  }

  function openEvidenceDb() {
    if (!('indexedDB' in window)) {
      return Promise.reject(new Error('IndexedDB unavailable'));
    }

    if (evidenceDbPromise) {
      return evidenceDbPromise;
    }

    evidenceDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(EVIDENCE_DB_NAME, EVIDENCE_DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        const store = db.objectStoreNames.contains(EVIDENCE_STORE_NAME)
          ? request.transaction.objectStore(EVIDENCE_STORE_NAME)
          : db.createObjectStore(EVIDENCE_STORE_NAME, {
              keyPath: 'id',
              autoIncrement: true,
            });

        if (!store.indexNames.contains('ts')) {
          store.createIndex('ts', 'ts', { unique: false });
        }
        if (!store.indexNames.contains('flag')) {
          store.createIndex('flag', 'flag', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Failed to open evidence db'));
    }).catch((error) => {
      evidenceDbPromise = null;
      throw error;
    });

    return evidenceDbPromise;
  }

  function writeEvidenceEntry(entry) {
    openEvidenceDb()
      .then((db) => {
        const tx = db.transaction(EVIDENCE_STORE_NAME, 'readwrite');
        tx.objectStore(EVIDENCE_STORE_NAME).add({
          ...entry,
          version: VER,
          createdAt: new Date(entry.ts).toISOString(),
        });
      })
      .catch(() => {});
  }

  function readEvidenceEntries() {
    return openEvidenceDb()
      .then(
        (db) =>
          new Promise((resolve, reject) => {
            const tx = db.transaction(EVIDENCE_STORE_NAME, 'readonly');
            const request = tx.objectStore(EVIDENCE_STORE_NAME).getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error || new Error('Failed to read evidence'));
          })
      )
      .catch(() => gsafeState.evidence.slice());
  }

  function invalidateCurrentRace(reason) {
    if (!gsafeState.invalidCurrentRace && typeof addLog === 'function') {
      addLog('GSafe 检测到本局数据异常：本局成绩不会计入成就或连胜。');
    }
    gsafeState.invalidCurrentRace = true;
    showRiskOverlay(reason);
  }

  function enterSafetyMode(reason) {
    if (!gsafeState.achievementLocked && typeof addLog === 'function') {
      addLog('GSafe 已进入安全模式：成就解锁暂停，刷新或重开后恢复。');
    }
    gsafeState.achievementLocked = true;
    showRiskOverlay(reason, true);
  }

  function flag(code, detail, weight) {
    const score = getRiskWeight(code, weight);
    const entry = {
      flag: code,
      ts: Date.now(),
      detail: detail || '',
      weight: score,
      riskScore: gsafeState.riskScore + score,
    };
    gsafeState.riskScore += score;
    gsafeState.evidence.push(entry);
    writeEvidenceEntry(entry);
    if (gsafeState.evidence.length > 50) {
      gsafeState.evidence.shift();
    }

    console.warn(
      TAG +
        ' ' +
        code +
        ' +' +
        score +
        ' risk=' +
        gsafeState.riskScore +
        ': ' +
        (detail || '')
    );

    if (gsafeState.riskScore >= 6) {
      invalidateCurrentRace(code);
    }
    if (gsafeState.riskScore >= 10) {
      enterSafetyMode(code);
    }

    return entry;
  }

  function resetRaceRisk() {
    if (!gsafeState.achievementLocked) {
      gsafeState.riskScore = 0;
    }
    gsafeState.invalidCurrentRace = false;
    riskNoticeShown = false;
  }

  function resetSessionRisk() {
    gsafeState.riskScore = 0;
    gsafeState.invalidCurrentRace = false;
    gsafeState.achievementLocked = false;
    gsafeState.evidence = [];
    riskNoticeShown = false;
    safetyNoticeShown = false;
    consecutiveFastReactionCount = 0;
  }

  function canUnlockAchievement(achievement, options = {}) {
    if (gsafeState.achievementLocked) {
      return false;
    }

    const source = typeof options.source === 'string' ? options.source : '';
    if (gsafeState.invalidCurrentRace && RACE_ACHIEVEMENT_SOURCES.has(source)) {
      return false;
    }

    return Boolean(achievement);
  }

  function exportEvidenceLog() {
    return readEvidenceEntries().then((records) => {
      const payload = JSON.stringify(
        {
          version: VER,
          generatedAt: new Date().toISOString(),
          state: cloneState(),
          evidenceTable: {
            database: EVIDENCE_DB_NAME,
            store: EVIDENCE_STORE_NAME,
            indexes: ['ts', 'flag'],
            records,
          },
          userAgent: navigator.userAgent || '',
        },
        null,
        2
      );
      const filename = 'gsafe-evidence-' + Date.now() + '.json';

      try {
        const blob = new Blob([payload], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        return Promise.resolve();
      } catch (error) {
        return copyText(payload);
      }
    });
  }

  function clearLegacyBanState() {
    try { localStorage.removeItem(LEGACY_BAN_KEY); } catch (_) {}
    try { sessionStorage.removeItem(LEGACY_FP_KEY); } catch (_) {}
    removeCookie(LEGACY_BAN_KEY);
  }

  /* ═══ 异常提示 UI ═══ */
  function showRiskOverlay(reason, safetyMode) {
    if (document.getElementById(RISK_NOTICE_ID)) return;
    if (safetyMode) {
      if (safetyNoticeShown) return;
      safetyNoticeShown = true;
    } else if (riskNoticeShown) {
      return;
    } else {
      riskNoticeShown = true;
    }

    if (!document.getElementById('gsafe-risk-css')) {
      const css = document.createElement('style');
      css.id = 'gsafe-risk-css';
      css.textContent =
        '#gsafe-overlay{position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,.58);display:flex;align-items:center;justify-content:center;font-family:"Segoe UI","Microsoft YaHei",sans-serif}' +
        '#gsafe-card{background:#fff;border:2px solid #808080;box-shadow:4px 4px 0 #000;max-width:440px;width:90%}' +
        '#gsafe-titlebar{background:#1f4f82;color:#fff;padding:5px 8px;font-size:12px;font-weight:700;display:flex;justify-content:space-between;align-items:center}' +
        '#gsafe-body{padding:20px 16px 12px;text-align:center}' +
        '#gsafe-body p{margin:0 0 10px;font-size:14px;color:#333;line-height:1.6}' +
        '#gsafe-body .gs-code{display:inline-block;margin:8px 0;padding:6px 16px;background:#f5f5f5;border:1px solid #ddd;border-radius:4px;font-family:monospace;font-size:13px;color:#b71c1c;letter-spacing:1px;user-select:all}' +
        '#gsafe-body .gs-reason{font-size:11px;color:#999;margin-top:6px}' +
        '#gsafe-body .gs-appeal{margin-top:10px;font-size:12px;color:#333}' +
        '#gsafe-body .gs-appeal span{font-family:monospace;color:#1d4ed8;user-select:all}' +
        '#gsafe-actions{padding:8px 16px 16px;display:flex;flex-wrap:wrap;gap:8px;justify-content:center}' +
        '#gsafe-actions button{background:#d4d0c8;border:2px outset #fff;padding:5px 14px;min-height:30px;font-size:12px;cursor:pointer;font-family:inherit}' +
        '#gsafe-actions button:active{border-style:inset}' +
        '#gsafe-actions .gs-danger{background:#f2c7c7;color:#7f1111}';
      document.head.appendChild(css);
    }

    const overlay = document.createElement('div');
    const appealGroup = getAppealGroupText();
    overlay.id = RISK_NOTICE_ID;
    overlay.innerHTML =
      '<div id="gsafe-card">' +
        '<div id="gsafe-titlebar"><span>GSafe v' + VER + ' - 异常检测</span><span>&#9888;</span></div>' +
        '<div id="gsafe-body">' +
          '<p>检测到本局数据异常，本局成绩不会计入成就或连胜。</p>' +
          '<p>如果你没有修改数据，可能是浏览器、旧存档或版本更新导致。</p>' +
          (safetyMode ? '<p>当前已进入安全模式，刷新或重开后恢复成就检测。</p>' : '') +
          '<div class="gs-code">风险分：' + escapeHTML(gsafeState.riskScore) + '</div>' +
          '<div class="gs-reason">原因：' + escapeHTML(reason || '未知') + '</div>' +
          '<div class="gs-appeal">反馈QQ群：<span>' + escapeHTML(appealGroup) + '</span></div>' +
        '</div>' +
        '<div id="gsafe-actions">' +
          '<button id="gsafe-continue" data-gsafe-action="continue" type="button">继续游戏</button>' +
          '<button id="gsafe-export" data-gsafe-action="export" type="button">导出异常日志</button>' +
          '<button id="gsafe-download" data-gsafe-action="download" type="button">下载本地数据</button>' +
          '<button id="gsafe-clear" class="gs-danger" data-gsafe-action="clear" type="button">清理本地数据</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    document.getElementById('gsafe-continue').addEventListener('click', function () {
      overlay.remove();
    });

    document.getElementById('gsafe-export').addEventListener('click', function (event) {
      const button = event.currentTarget;
      exportEvidenceLog()
        .then(function () {
          button.textContent = '已导出';
        })
        .catch(function () {
          button.textContent = '导出失败';
        });
    });

    document.getElementById('gsafe-download').addEventListener('click', function (event) {
      const button = event.currentTarget;
      if (typeof downloadLocalData === 'function') {
        downloadLocalData();
        button.textContent = '已开始下载';
        return;
      }
      exportEvidenceLog()
        .then(function () {
          button.textContent = '已导出日志';
        })
        .catch(function () {
          button.textContent = '下载失败';
        });
    });

    document.getElementById('gsafe-clear').addEventListener('click', function () {
      const confirmed = window.confirm('确定要清理本地 Race 数据并重新开始吗？此操作不可恢复。');
      if (!confirmed) return;

      const result = clearLocalDataAndReload();
      if (!result.ok) {
        window.alert('清理失败：' + result.message);
        return;
      }

      location.reload();
    });
  }

  /* ═══ 1. 函数完整性检查 ═══ */
  const fnSigs = {};
  const fnWatch = [];

  function captureFn(obj, key, path) {
    try {
      const fn = obj ? obj[key] : undefined;
      if (typeof fn === 'function') {
        fnSigs[path] = Function.prototype.toString.call(fn);
        fnWatch.push({ obj: obj, key: key, path: path });
      }
    } catch (_) {}
  }

  function initFnChecks() {
    captureFn(globalThis, 'pressStart', 'pressStart');
    captureFn(globalThis, 'onGreenLight', 'onGreenLight');
    captureFn(globalThis, 'completeRace', 'completeRace');
    captureFn(globalThis, 'startPlayerCar', 'startPlayerCar');
    captureFn(globalThis, 'setPhase', 'setPhase');
    captureFn(globalThis, 'recalculatePlayerStats', 'recalculatePlayerStats');
    captureFn(globalThis, 'sanitizeSaveData', 'sanitizeSaveData');
    captureFn(globalThis, 'createSaveData', 'createSaveData');
    captureFn(globalThis, 'autoSaveGame', 'autoSaveGame');
    captureFn(globalThis, 'saveGame', 'saveGame');
    captureFn(globalThis, 'loadGame', 'loadGame');
    captureFn(globalThis, 'checkAchievements', 'checkAchievements');
    captureFn(globalThis, 'unlockAchievementById', 'unlockAchievementById');
    captureFn(globalThis, 'rollOpponentReactionTime', 'rollOpponentReactionTime');
    captureFn(globalThis, 'handleFalseStart', 'handleFalseStart');
    captureFn(globalThis, 'registerRace', 'registerRace');
    captureFn(globalThis, 'startRaceMotion', 'startRaceMotion');
    captureFn(globalThis, 'tickRace', 'tickRace');
    captureFn(globalThis, 'buyPart', 'buyPart');
    captureFn(globalThis, 'changeEquipment', 'changeEquipment');
    captureFn(globalThis, 'refreshShop', 'refreshShop');
    captureFn(globalThis, 'setDifficulty', 'setDifficulty');
    captureFn(globalThis, 'applyPersistentState', 'applyPersistentState');
    captureFn(globalThis, 'resetPersistentState', 'resetPersistentState');

    if (typeof RaceFormulaUtils === 'object' && RaceFormulaUtils) {
      captureFn(RaceFormulaUtils, 'computePlayerPower', 'RFU.computePlayerPower');
      captureFn(RaceFormulaUtils, 'computeOpponentStrength', 'RFU.computeOpponentStrength');
      captureFn(RaceFormulaUtils, 'computeReactionOutcome', 'RFU.computeReactionOutcome');
      captureFn(RaceFormulaUtils, 'computeOpponentCarPower', 'RFU.computeOpponentCarPower');
      captureFn(RaceFormulaUtils, 'computePlayerRating', 'RFU.computePlayerRating');
    }

    // 原生函数
    fnSigs['Math.random'] = Function.prototype.toString.call(Math.random);
    fnSigs['performance.now'] = Function.prototype.toString.call(performance.now);
    fnSigs['Date.now'] = Function.prototype.toString.call(Date.now);
  }

  function checkFnIntegrity() {
    for (let i = 0; i < fnWatch.length; i++) {
      const w = fnWatch[i];
      try {
        const current = Function.prototype.toString.call(w.obj[w.key]);
        if (current !== fnSigs[w.path]) {
          flag('FN_OVERRIDE', w.path + ' has been replaced');
          return;
        }
      } catch (_) {}
    }
    try {
      if (Function.prototype.toString.call(Math.random) !== fnSigs['Math.random']) {
        flag('MATH_RANDOM_HOOK', 'Math.random replaced');
      }
    } catch (_) {}
    try {
      if (Function.prototype.toString.call(performance.now) !== fnSigs['performance.now']) {
        flag('PERFORMANCE_NOW_HOOK', 'performance.now replaced');
      }
    } catch (_) {}
    try {
      if (Function.prototype.toString.call(Date.now) !== fnSigs['Date.now']) {
        flag('DATE_NOW_HOOK', 'Date.now replaced');
      }
    } catch (_) {}
  }

  /* ═══ 2. 状态快照差分 ═══ */
  let prevSnap = null;
  let cashHistory = []; // 最近 10 次现金快照
  let achvHistory = []; // 最近成就计数

  let statCeilings = {};
  function computeCeilings() {
    if (typeof BASE_PLAYER_STATS !== 'object' || typeof PART_POOL === 'undefined' || typeof EQUIPMENT_SLOTS === 'undefined') {
      statCeilings = { engine: 500, tire: 500, gearbox: 500, stability: 80, weight: 760, hp: 500 };
      return;
    }
    const base = Object.assign({}, BASE_PLAYER_STATS);
    const maxBySlot = {};
    EQUIPMENT_SLOTS.forEach(function (slot) {
      maxBySlot[slot] = {};
      PART_POOL.forEach(function (part) {
        if (part.type !== slot) return;
        Object.keys(part.changes || {}).forEach(function (k) {
          const v = part.changes[k];
          if (typeof maxBySlot[slot][k] === 'undefined' || v > maxBySlot[slot][k]) {
            maxBySlot[slot][k] = v;
          }
        });
      });
    });
    const ce = Object.assign({}, base);
    EQUIPMENT_SLOTS.forEach(function (slot) {
      Object.keys(maxBySlot[slot] || {}).forEach(function (k) {
        ce[k] = (ce[k] || 0) + maxBySlot[slot][k];
      });
    });
    ce.stability = Math.min(ce.stability, 80);
    ce.weight = Math.max(ce.weight, 760);
    Object.keys(ce).forEach(function (k) {
      ce[k] = Math.ceil(ce[k] * 1.1);
    });
    statCeilings = ce;
  }

  function takeSnap() {
    if (typeof gameState === 'undefined' || !gameState) return null;
    try {
      const p = gameState.player || {};
      return {
        cash: gameState.cash,
        raceCount: gameState.raceCount,
        winStreak: gameState.currentWinStreak,
        phase: gameState.phase,
        achvCount: Object.keys(gameState.achievements && gameState.achievements.completed || {}).length,
        invLen: (gameState.inventory || []).length,
        engine: p.engine,
        tire: p.tire,
        gearbox: p.gearbox,
        stability: p.stability,
        weight: p.weight,
        hp: p.hp,
        equipped: JSON.stringify(gameState.equippedParts || {}),
        statsTotalWins: (gameState.stats || {}).totalWins || 0,
        statsTotalRaces: (gameState.stats || {}).totalRaces || 0,
      };
    } catch (_) {
      return null;
    }
  }

  function diffSnap(cur) {
    if (!prevSnap || !cur) return;
    const p = prevSnap;

    // ─── 刷钱检测 ───
    const cashDelta = cur.cash - p.cash;
    if (cashDelta > 3000 && p.phase !== 'finished') {
      flag('CASH_ANOMALY', 'cash ' + p.cash + ' -> ' + cur.cash);
    }
    // 连续异常增长
    cashHistory.push({ ts: Date.now(), cash: cur.cash });
    if (cashHistory.length > 10) cashHistory.shift();
    if (cashHistory.length >= 3) {
      let abnormalCount = 0;
      for (let i = 1; i < cashHistory.length; i++) {
        const d = cashHistory[i].cash - cashHistory[i - 1].cash;
        if (d > 3000) abnormalCount++;
      }
      if (abnormalCount >= 2) {
        flag('CASH_FARMING', abnormalCount + ' abnormal cash jumps in ' + cashHistory.length + ' snapshots');
        cashHistory = [];
      }
    }

    // ─── 场次篡改 ───
    if (cur.raceCount < p.raceCount) {
      flag('RACE_COUNT_ANOMALY', 'raceCount ' + p.raceCount + ' -> ' + cur.raceCount);
    }
    if (cur.raceCount - p.raceCount > 1 && p.phase === 'idle') {
      flag('RACE_COUNT_ANOMALY', 'raceCount jumped ' + p.raceCount + ' -> ' + cur.raceCount);
    }

    // ─── 统计数据篡改 ───
    if (cur.statsTotalWins > cur.statsTotalRaces) {
      flag('STATS_MISMATCH', 'wins(' + cur.statsTotalWins + ') > races(' + cur.statsTotalRaces + ')');
    }
    if (cur.statsTotalRaces < p.statsTotalRaces) {
      flag('STATS_ROLLBACK', 'totalRaces ' + p.statsTotalRaces + ' -> ' + cur.statsTotalRaces);
    }

    // ─── 属性突破理论上限 ───
    ['engine', 'tire', 'gearbox', 'hp'].forEach(function (k) {
      if (statCeilings[k] && cur[k] > statCeilings[k]) {
        flag('STAT_CEILING_BREACH', k + '=' + cur[k] + ' > max ' + statCeilings[k]);
      }
    });
    if (cur.stability > 80) flag('STAT_CLAMP_BREACH', 'stability=' + cur.stability + ' > 80');
    if (cur.weight < 760) flag('STAT_CLAMP_BREACH', 'weight=' + cur.weight + ' < 760');

    // ─── 刷成就检测 ───
    const achvDelta = cur.achvCount - p.achvCount;
    if (achvDelta > 2) {
      flag('ACHIEVEMENT_INJECTION', achvDelta + ' achievements at once');
    }
    achvHistory.push(achvDelta);
    if (achvHistory.length > 5) achvHistory.shift();
    if (achvHistory.length >= 3) {
      const totalRecentAchv = achvHistory.reduce((a, b) => a + Math.max(0, b), 0);
      if (totalRecentAchv >= 5) {
        flag('ACHIEVEMENT_FARMING', totalRecentAchv + ' achievements in ' + achvHistory.length + ' checks');
        achvHistory = [];
      }
    }

    // ─── 库存异常 ───
    if (cur.invLen - p.invLen > 3 && p.phase !== 'idle') {
      flag('INVENTORY_ANOMALY', 'inventory +' + (cur.invLen - p.invLen) + ' outside shop');
    }

    // ─── 阶段非法值 ───
    if (typeof PHASE_LABELS !== 'undefined' && cur.phase && !PHASE_LABELS[cur.phase]) {
      flag('PHASE_INVALID', 'phase=' + cur.phase);
    }

    // 阶段跳变不在快照层评分：轮询可能漏掉红黄绿、完赛和下一场准备等合法中间态。
  }

  /* ═══ 3. 反应时间校验 ═══ */
  let prevReactionCheck = { time: null, control: null };
  let consecutiveFastReactionCount = 0;

  function evaluateManualReaction(t) {
    if (!Number.isFinite(t)) return;

    if (t < 0.030) {
      flag('REACTION_INHUMAN', 'reaction=' + t.toFixed(3) + 's');
      invalidateCurrentRace('REACTION_INHUMAN');
      consecutiveFastReactionCount++;
      return;
    }

    if (t < 0.080) {
      consecutiveFastReactionCount++;
      flag('REACTION_SUSPICIOUS', 'reaction=' + t.toFixed(3) + 's');
      if (consecutiveFastReactionCount >= 3) {
        flag(
          'REACTION_CONSISTENTLY_SUSPICIOUS',
          consecutiveFastReactionCount + ' consecutive sub-0.08s reactions'
        );
        invalidateCurrentRace('REACTION_CONSISTENTLY_SUSPICIOUS');
      }
      return;
    }

    consecutiveFastReactionCount = 0;
  }

  function checkReaction() {
    if (typeof gameState === 'undefined') return;
    const t = gameState.lastReactionTime;
    const c = gameState.lastReactionControl;
    if (t === null || t === prevReactionCheck.time || c !== 'manual') {
      prevReactionCheck = { time: t, control: c };
      return;
    }
    prevReactionCheck = { time: t, control: c };
    evaluateManualReaction(t);
  }

  /* ═══ 4. 脚本自保护 ═══ */
  let selfScript = null;

  function initSelfProtect() {
    try {
      selfScript = document.currentScript;
    } catch (_) {}
  }

  function checkSelfIntegrity() {
    if (!selfScript) return;
    try {
      if (!document.contains(selfScript)) {
        flag('SCRIPT_REMOVED', 'gsafe.js script element removed');
      }
    } catch (_) {}
  }

  /* ═══ 5. 自动发车检测 ═══ */
  let fastStartCount = 0;
  let lastGreenAt = 0;
  let lastPlayerStarted = false;

  function checkAutoStart() {
    if (typeof gameState === 'undefined') return;
    if (gameState.greenAt !== lastGreenAt && gameState.greenAt > 0) {
      lastGreenAt = gameState.greenAt;
      lastPlayerStarted = false;
    }
    if (gameState.playerStarted && !lastPlayerStarted && gameState.lastReactionControl === 'manual') {
      lastPlayerStarted = true;
      const t = gameState.lastReactionTime;
      if (t !== null && t < 0.080) {
        fastStartCount++;
        if (fastStartCount >= 3) {
          flag('AUTO_START_DETECTED', fastStartCount + ' sub-80ms starts');
          fastStartCount = 0;
        }
      } else {
        fastStartCount = Math.max(0, fastStartCount - 1);
      }
    }
  }

  /* ═══ 6. 控制台注入痕迹检测 ═══ */
  let consoleUsageCount = 0;

  function initConsoleDetection() {
    // 重写 eval 使其可被追踪
    try {
      const origEval = window.eval;
      window.eval = function () {
        consoleUsageCount++;
        if (consoleUsageCount > 5) {
          flag('EVAL_USAGE', 'eval() called ' + consoleUsageCount + ' times');
        }
        return origEval.apply(this, arguments);
      };
    } catch (_) {}
  }

  /* ═══ 主循环 ═══ */
  function jitter(ms) {
    return Math.floor(ms * (0.7 + Math.random() * 0.6));
  }

  function isGameReady() {
    return typeof gameState !== 'undefined' && gameState && gameState.ready;
  }

  function startMonitoring() {
    function loopFnCheck() {
      checkFnIntegrity();
      checkSelfIntegrity();
      setTimeout(loopFnCheck, jitter(5000));
    }
    setTimeout(loopFnCheck, jitter(3000));

    function loopSnap() {
      if (!isGameReady()) {
        setTimeout(loopSnap, jitter(1000));
        return;
      }
      const cur = takeSnap();
      diffSnap(cur);
      prevSnap = cur;
      checkReaction();
      checkAutoStart();
      setTimeout(loopSnap, jitter(3000));
    }
    setTimeout(loopSnap, jitter(2000));
  }

  /* ═══ 初始化 ═══ */
  function init() {
    clearLegacyBanState();
    initSelfProtect();
    computeCeilings();
    initFnChecks();
    initConsoleDetection();
    prevSnap = null;
    startMonitoring();
    try { sessionStorage.setItem('_gs', '1'); } catch (_) {}
    console.log(TAG + ' Anomaly detector v' + VER + ' initialized.');
  }

  globalThis.gsafeBeginRace = resetRaceRisk;
  globalThis.gsafeResetSession = resetSessionRisk;
  globalThis.gsafeGetState = cloneState;
  globalThis.gsafeReadEvidenceEntries = readEvidenceEntries;
  globalThis.gsafeIsCurrentRaceInvalid = function () {
    return gsafeState.invalidCurrentRace;
  };
  globalThis.gsafeIsAchievementLocked = function () {
    return gsafeState.achievementLocked;
  };
  globalThis.gsafeCanUnlockAchievement = canUnlockAchievement;
  globalThis.gsafeRecordManualReaction = function (reactionSeconds) {
    evaluateManualReaction(reactionSeconds);
    prevReactionCheck = { time: reactionSeconds, control: 'manual' };
  };
  globalThis.gsafeFlagSaveIssue = function (detail) {
    flag('SAVE_CHECKSUM_MISMATCH', detail || 'save checksum mismatch');
  };

  return {
    init: init,
    isBanned: function () { return false; },
    getState: cloneState,
    isCurrentRaceInvalid: function () { return gsafeState.invalidCurrentRace; },
    isAchievementLocked: function () { return gsafeState.achievementLocked; },
    version: VER,
  };
})();

GSafe.init();
