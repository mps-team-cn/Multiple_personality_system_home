'use strict';

/*
 * GSafe 反作弊系统 v1.0
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
 * 硬标记 -> 立即封禁
 * 软标记 -> 累计 3 条封禁
 * 封禁通过 cookie 下发，有效期 1 年
 */

const GSafe = (() => {
  /* ═══ 字符串编码（避免静态搜索） ═══ */
  const _s = (arr) => arr.map((c) => String.fromCharCode(c)).join('');
  const TAG = _s([91, 71, 83, 97, 102, 101, 93]); // [GSafe]
  const BAN_KEY = _s([103, 115, 97, 102, 101, 95, 98, 97, 110]); // gsafe_ban
  const FP_KEY = _s([103, 115, 102, 112]); // gsfp
  const VER = '1.0';

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

  /* ═══ 证据收集 ═══ */
  const evidence = [];
  let softCount = 0;

  function flag(code, detail, hard) {
    const entry = { flag: code, ts: Date.now(), detail: detail || '' };
    evidence.push(entry);
    console.warn(TAG + ' ' + code + ': ' + (detail || ''));
    if (hard) {
      ban(code);
    } else {
      softCount++;
      if (softCount >= 3) ban(code);
    }
  }

  /* ═══ 生成封禁代码 ═══ */
  function genBanCode(reason) {
    const ts = Date.now().toString(36);
    const rh = fnv1a(reason + ts).toString(36).toUpperCase().slice(0, 6);
    return 'GS-' + ts.toUpperCase().slice(-4) + '-' + rh;
  }

  /* ═══ 浏览器指纹 ═══ */
  function getFingerprint() {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 50;
      const ctx = canvas.getContext('2d');
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillText('GSafe-fingerprint', 2, 2);
      const canvasHash = fnv1a(canvas.toDataURL());
      const ua = fnv1a(navigator.userAgent || '');
      const screen_ = fnv1a(screen.width + 'x' + screen.height);
      const lang = fnv1a(navigator.language || '');
      return ((canvasHash ^ ua ^ screen_ ^ lang) >>> 0).toString(36);
    } catch (_) {
      return fnv1a(navigator.userAgent + screen.width).toString(36);
    }
  }

  /* ═══ Cookie 读写 ═══ */
  function setCookie(name, value, maxAge) {
    document.cookie = name + '=' + encodeURIComponent(value) + ';path=/;max-age=' + maxAge + ';SameSite=Strict';
  }

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  /* ═══ 封禁系统 ═══ */
  let banned = false;
  let banCode = '';

  function ban(reason) {
    if (banned) return;
    banned = true;
    banCode = genBanCode(reason);
    const fp = getFingerprint();
    const payload = JSON.stringify({
      v: 1,
      ts: Date.now(),
      reason: reason,
      code: banCode,
      evidence: evidence.slice(-20),
      fp: fp,
    });
    setCookie(BAN_KEY, payload, 31536000);
    try { sessionStorage.setItem(FP_KEY, fp); } catch (_) {}
    showBanOverlay(reason, banCode);
    console.error(TAG + ' Game suspended. Code: ' + banCode + ' Reason: ' + reason);
  }

  function checkExistingBan() {
    const raw = getCookie(BAN_KEY);
    if (raw) {
      try {
        const data = JSON.parse(raw);
        if (data && data.reason) {
          banned = true;
          banCode = data.code || genBanCode(data.reason);
          showBanOverlay(data.reason, banCode);
          return true;
        }
      } catch (_) {}
    }
    return false;
  }

  /* ═══ 封禁遮罩 UI ═══ */
  function showBanOverlay(reason, code) {
    if (document.getElementById('gsafe-overlay')) return;

    const css = document.createElement('style');
    css.id = 'gsafe-ban-css';
    css.textContent =
      '#gsafe-overlay{position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;font-family:"Segoe UI","Microsoft YaHei",sans-serif}' +
      '#gsafe-card{background:#fff;border:2px solid #808080;box-shadow:4px 4px 0 #000;max-width:400px;width:90%}' +
      '#gsafe-titlebar{background:#b71c1c;color:#fff;padding:5px 8px;font-size:12px;font-weight:700;display:flex;justify-content:space-between;align-items:center}' +
      '#gsafe-body{padding:20px 16px;text-align:center}' +
      '#gsafe-body p{margin:0 0 10px;font-size:14px;color:#333;line-height:1.6}' +
      '#gsafe-body .gs-code{display:inline-block;margin:8px 0;padding:6px 16px;background:#f5f5f5;border:1px solid #ddd;border-radius:4px;font-family:monospace;font-size:13px;color:#b71c1c;letter-spacing:1px;user-select:all}' +
      '#gsafe-body .gs-reason{font-size:11px;color:#999;margin-top:6px}' +
      '#gsafe-actions{padding:8px 16px 16px;text-align:center}' +
      '#gsafe-actions button{background:#d4d0c8;border:2px outset #fff;padding:4px 28px;font-size:12px;cursor:pointer;font-family:inherit}' +
      '#gsafe-actions button:active{border-style:inset}';
    document.head.appendChild(css);

    const overlay = document.createElement('div');
    overlay.id = 'gsafe-overlay';
    overlay.innerHTML =
      '<div id="gsafe-card">' +
        '<div id="gsafe-titlebar"><span>GSafe v' + VER + ' - 安全警告</span><span>&#10006;</span></div>' +
        '<div id="gsafe-body">' +
          '<p>你已被封禁，如有问题请申诉。</p>' +
          '<div class="gs-code">' + (code || 'N/A') + '</div>' +
          '<div class="gs-reason">原因：' + (reason || '未知') + '</div>' +
        '</div>' +
        '<div id="gsafe-actions"><button id="gsafe-ok">确定</button></div>' +
      '</div>';
    document.body.appendChild(overlay);

    document.getElementById('gsafe-ok').addEventListener('click', function () {
      location.reload();
    });

    // 拦截键盘（允许 F5 / Ctrl+R 刷新）
    document.addEventListener('keydown', function (e) {
      if (!banned) return;
      if (e.key === 'F5') return;
      if (e.ctrlKey && (e.key === 'r' || e.key === 'R')) return;
      e.preventDefault();
      e.stopPropagation();
    }, true);

    // 拦截鼠标
    document.addEventListener('click', function (e) {
      if (!banned) return;
      if (e.target.id === 'gsafe-ok') return;
      e.preventDefault();
      e.stopPropagation();
    }, true);
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
          flag('FN_OVERRIDE', w.path + ' has been replaced', true);
          return;
        }
      } catch (_) {}
    }
    try {
      if (Function.prototype.toString.call(Math.random) !== fnSigs['Math.random']) {
        flag('MATH_RANDOM_HOOK', 'Math.random replaced', true);
      }
    } catch (_) {}
    try {
      if (Function.prototype.toString.call(performance.now) !== fnSigs['performance.now']) {
        flag('PERFORMANCE_NOW_HOOK', 'performance.now replaced', true);
      }
    } catch (_) {}
    try {
      if (Function.prototype.toString.call(Date.now) !== fnSigs['Date.now']) {
        flag('DATE_NOW_HOOK', 'Date.now replaced', true);
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
      flag('CASH_ANOMALY', 'cash ' + p.cash + ' -> ' + cur.cash, false);
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
        flag('CASH_FARMING', abnormalCount + ' abnormal cash jumps in ' + cashHistory.length + ' snapshots', false);
        cashHistory = [];
      }
    }

    // ─── 场次篡改 ───
    if (cur.raceCount < p.raceCount) {
      flag('RACE_COUNT_ANOMALY', 'raceCount ' + p.raceCount + ' -> ' + cur.raceCount, true);
    }
    if (cur.raceCount - p.raceCount > 1 && p.phase === 'idle') {
      flag('RACE_COUNT_ANOMALY', 'raceCount jumped ' + p.raceCount + ' -> ' + cur.raceCount, false);
    }

    // ─── 统计数据篡改 ───
    if (cur.statsTotalWins > cur.statsTotalRaces) {
      flag('STATS_MISMATCH', 'wins(' + cur.statsTotalWins + ') > races(' + cur.statsTotalRaces + ')', true);
    }
    if (cur.statsTotalRaces < p.statsTotalRaces) {
      flag('STATS_ROLLBACK', 'totalRaces ' + p.statsTotalRaces + ' -> ' + cur.statsTotalRaces, true);
    }

    // ─── 属性突破理论上限 ───
    ['engine', 'tire', 'gearbox', 'hp'].forEach(function (k) {
      if (statCeilings[k] && cur[k] > statCeilings[k]) {
        flag('STAT_CEILING_BREACH', k + '=' + cur[k] + ' > max ' + statCeilings[k], true);
      }
    });
    if (cur.stability > 80) flag('STAT_CLAMP_BREACH', 'stability=' + cur.stability + ' > 80', true);
    if (cur.weight < 760) flag('STAT_CLAMP_BREACH', 'weight=' + cur.weight + ' < 760', true);

    // ─── 刷成就检测 ───
    const achvDelta = cur.achvCount - p.achvCount;
    if (achvDelta > 2) {
      flag('ACHIEVEMENT_INJECTION', achvDelta + ' achievements at once', false);
    }
    achvHistory.push(achvDelta);
    if (achvHistory.length > 5) achvHistory.shift();
    if (achvHistory.length >= 3) {
      const totalRecentAchv = achvHistory.reduce((a, b) => a + Math.max(0, b), 0);
      if (totalRecentAchv >= 5) {
        flag('ACHIEVEMENT_FARMING', totalRecentAchv + ' achievements in ' + achvHistory.length + ' checks', false);
        achvHistory = [];
      }
    }

    // ─── 库存异常 ───
    if (cur.invLen - p.invLen > 3 && p.phase !== 'idle') {
      flag('INVENTORY_ANOMALY', 'inventory +' + (cur.invLen - p.invLen) + ' outside shop', false);
    }

    // ─── 阶段非法值 ───
    if (typeof PHASE_LABELS !== 'undefined' && cur.phase && !PHASE_LABELS[cur.phase] && cur.phase !== 'gsafe_banned') {
      flag('PHASE_INVALID', 'phase=' + cur.phase, true);
    }

    // ─── 阶段跳转合法性 ───
    checkPhaseTransition(p.phase, cur.phase);
  }

  const VALID_TRANSITIONS = {
    idle: ['countdown_red', 'game_over'],
    countdown_red: ['countdown_yellow', 'false_start'],
    countdown_yellow: ['countdown_green', 'false_start'],
    countdown_green: ['racing', 'false_start'],
    racing: ['finished'],
    finished: ['idle'],
    false_start: ['idle'],
    game_over: ['idle'],
  };

  function checkPhaseTransition(from, to) {
    if (!from || !to || from === to) return;
    const valid = VALID_TRANSITIONS[from];
    if (valid && valid.indexOf(to) === -1) {
      flag('PHASE_SKIP', from + ' -> ' + to, true);
    }
  }

  /* ═══ 3. 反应时间校验 ═══ */
  let prevReactionCheck = { time: null, control: null };
  let suspiciousReactionCount = 0;

  function checkReaction() {
    if (typeof gameState === 'undefined') return;
    const t = gameState.lastReactionTime;
    const c = gameState.lastReactionControl;
    if (t === null || t === prevReactionCheck.time || c !== 'manual') {
      prevReactionCheck = { time: t, control: c };
      return;
    }
    prevReactionCheck = { time: t, control: c };
    if (t < 0.050) {
      flag('REACTION_INHUMAN', 'reaction=' + t.toFixed(3) + 's', false);
      suspiciousReactionCount++;
    } else if (t < 0.100) {
      suspiciousReactionCount++;
      if (suspiciousReactionCount >= 3) {
        flag('REACTION_CONSISTENTLY_SUSPICIOUS', suspiciousReactionCount + ' sub-0.1s reactions', false);
        suspiciousReactionCount = 0;
      }
    } else {
      suspiciousReactionCount = Math.max(0, suspiciousReactionCount - 1);
    }
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
        flag('SCRIPT_REMOVED', 'gsafe.js script element removed', true);
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
          flag('AUTO_START_DETECTED', fastStartCount + ' sub-80ms starts', false);
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
          flag('EVAL_USAGE', 'eval() called ' + consoleUsageCount + ' times', false);
        }
        return origEval.apply(this, arguments);
      };
    } catch (_) {}
  }

  /* ═══ 主循环 ═══ */
  function jitter(ms) {
    return Math.floor(ms * (0.7 + Math.random() * 0.6));
  }

  function startMonitoring() {
    function loopFnCheck() {
      if (banned) return;
      checkFnIntegrity();
      checkSelfIntegrity();
      setTimeout(loopFnCheck, jitter(5000));
    }
    setTimeout(loopFnCheck, jitter(3000));

    function loopSnap() {
      if (banned) return;
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
    if (checkExistingBan()) return;
    initSelfProtect();
    computeCeilings();
    initFnChecks();
    initConsoleDetection();
    prevSnap = takeSnap();
    startMonitoring();
    try { sessionStorage.setItem('_gs', '1'); } catch (_) {}
    console.log(TAG + ' Anti-cheat v' + VER + ' initialized.');
  }

  return {
    init: init,
    isBanned: function () { return banned; },
    getBanCode: function () { return banCode; },
    version: VER,
  };
})();

GSafe.init();
