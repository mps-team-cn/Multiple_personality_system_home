'use strict';

/*
 * 存档读写边界。
 * 只在这里直接接触 localStorage，读到的数据必须先经过 core.js 的 sanitizeSaveData。
 */

function clearStorageWriteBlock() {
  gameState.storageWriteBlockedReason = '';
}

function blockStorageWrites(reason) {
  gameState.storageWriteBlockedReason = reason || '存档读取失败。';
}

// 返回结构化状态，调用方根据 missing/invalid/access_error 决定是否阻止自动覆盖旧存档。
function readStoredGameData(options = {}) {
  let rawData = null;
  try {
    rawData = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    return {
      status: 'access_error',
      message: '浏览器拒绝访问 localStorage。',
    };
  }

  if (!rawData) {
    return { status: 'missing' };
  }

  let parsedData = null;
  try {
    parsedData = JSON.parse(rawData);
  } catch (error) {
    return {
      status: 'invalid',
      message: '存档数据格式损坏。',
    };
  }

  const saveData = sanitizeSaveData(parsedData);
  if (!saveData) {
    return {
      status: 'invalid',
      message: '存档数据不完整。',
    };
  }

  // GSafe 存档校验：失败时提示旧版本/本地损坏，不封禁。
  if (typeof gsafeVerifyChecksum === 'function') {
    try {
      if (parsedData._gsafeChecksum !== undefined) {
        if (!gsafeVerifyChecksum(parsedData)) {
          if (typeof gsafeFlagSaveIssue === 'function') {
            gsafeFlagSaveIssue('save checksum mismatch');
          }
          if (options.allowChecksumMismatch) {
            return {
              status: 'ok',
              saveData,
              repairedFromChecksumMismatch: true,
            };
          }
          return {
            status: 'checksum_mismatch',
            message: '存档校验失败，可能是旧版本或本地数据损坏。',
            saveData,
          };
        }
      }
    } catch (_) {}
  }

  return {
    status: 'ok',
    saveData,
  };
}

function repairLoadedSaveData(saveData) {
  applyLoadedGameState(saveData);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(createSaveData()));
    clearStorageWriteBlock();
    addLog('已尝试修复存档校验信息，并重新写入本地存档。');
    if (typeof openNoticeModal === 'function') {
      openNoticeModal('修复完成', '存档已重新保存。若仍反复出现校验失败，请下载本地数据后清理本地数据。');
    }
  } catch (error) {
    blockStorageWrites('浏览器拒绝写入修复后的存档。');
    addLog('修复失败：浏览器拒绝写入 localStorage。');
  }
}

function openSaveChecksumRecoveryModal(saveData) {
  const message =
    '存档校验失败，可能是旧版本或本地数据损坏。\n\n你可以先尝试修复；如果修复后仍无法读取，再清理本地数据。';

  if (typeof openNoticeModal === 'function') {
    openNoticeModal('存档校验失败', message, {
      showCancel: true,
      cancelText: '清理本地数据',
      confirmText: '尝试修复',
      onConfirm: () => repairLoadedSaveData(saveData),
      onCancel: performClearAllRaceLocalData,
    });
    return;
  }

  if (window.confirm(message + '\n\n点击“确定”尝试修复，点击“取消”不做处理。')) {
    repairLoadedSaveData(saveData);
  }
}

function applyLoadedGameState(saveData) {
  applyPersistentState(saveData);
  clearStorageWriteBlock();
  if (typeof checkAchievements === 'function') {
    checkAchievements({ source: 'loadMigration', silent: true });
  }
  refreshAfterPersistentChange();
}

function downloadJsonFile(filename, data) {
  const payload = JSON.stringify(data, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function readRaceLocalStorageSnapshot() {
  const snapshot = {};
  getRaceLocalStorageKeys().forEach((key) => {
    snapshot[key] = localStorage.getItem(key);
  });
  return snapshot;
}

async function collectLocalDataExport() {
  const gsafeState =
    typeof gsafeGetState === 'function'
      ? gsafeGetState()
      : null;
  const gsafeEvidence =
    typeof gsafeReadEvidenceEntries === 'function'
      ? await gsafeReadEvidenceEntries()
      : [];

  return {
    exportedAt: new Date().toISOString(),
    gameVersion: typeof GAME_VERSION === 'string' ? GAME_VERSION : null,
    storageKey: STORAGE_KEY,
    localStorage: readRaceLocalStorageSnapshot(),
    currentSaveData: createSaveData(),
    gsafe: {
      state: gsafeState,
      evidenceTable: {
        database: 'mps-race-gsafe',
        store: 'evidence',
        records: gsafeEvidence,
      },
    },
  };
}

function downloadLocalData() {
  collectLocalDataExport()
    .then((data) => {
      downloadJsonFile('race-local-data-' + Date.now() + '.json', data);
      addLog('本地数据已导出为 JSON 文件。');
    })
    .catch(() => {
      addLog('导出本地数据失败：浏览器拒绝读取本地数据。');
    });
}

// 手动保存禁止发生在比赛锁定阶段，避免半场状态被写入存档。
function saveGame() {
  if (isRaceLockedPhase(gameState.phase)) {
    addLog('比赛进行中不能保存，请等本场结束。');
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(createSaveData()));
    clearStorageWriteBlock();
    addLog('存档已保存到浏览器。');
    if (typeof openNoticeModal === 'function') {
      openNoticeModal('保存成功', '当前进度已保存到本地浏览器。');
    }
  } catch (error) {
    addLog('存档失败：浏览器拒绝写入 localStorage。');
  }
}

// 读取失败时会阻塞后续自动保存，避免坏存档被无提示覆盖。
function loadGame() {
  if (isRaceLockedPhase(gameState.phase)) {
    addLog('比赛进行中不能读取，请等本场结束。');
    return;
  }

  const result = readStoredGameData();
  if (result.status === 'missing') {
    addLog('没有找到本地存档。');
    return;
  }
  if (result.status === 'access_error') {
    addLog(`读取失败：${result.message}`);
    return;
  }
  if (result.status === 'checksum_mismatch') {
    blockStorageWrites(result.message);
    addLog(`读取失败：${result.message}`);
    openSaveChecksumRecoveryModal(result.saveData);
    return;
  }
  if (result.status !== 'ok') {
    blockStorageWrites(result.message);
    addLog(`读取失败：${result.message}`);
    addLog('当前未覆盖原存档；如需重新开始，请点击“重开并清档”。');
    return;
  }

  applyLoadedGameState(result.saveData);
  addLog('存档已读取，图鉴、档案、商店、状态栏和日志已刷新。');
}

function autoLoadGameOnInit() {
  const result = readStoredGameData();

  if (result.status === 'ok') {
    applyLoadedGameState(result.saveData);
    return { status: 'loaded' };
  }

  if (result.status === 'invalid' || result.status === 'checksum_mismatch') {
    blockStorageWrites(result.message);
    return result;
  }

  clearStorageWriteBlock();
  return result;
}

// 清档会保留已解锁成就，这样玩家重开时仍能看到历史挑战记录。
function resetPersistentState(options = {}) {
  const achievements = options.preserveAchievements
    ? sanitizeAchievementsData(gameState.achievements)
    : createDefaultAchievementsState();
  const settings =
    options.preserveSettings === false
      ? createDefaultSettings()
      : sanitizeSettingsData(gameState.settings);

  gameState.cash = 1500;
  gameState.raceCount = 0;
  gameState.lastRank = '-';
  gameState.bestReactionTime = null;
  gameState.bestManualReactionTime = null;
  gameState.lastReactionTime = null;
  gameState.lastManualReactionTime = null;
  gameState.lastReactionControl = null;
  gameState.currentWinStreak = 0;
  gameState.currentLoseStreak = 0;
  gameState.bestWinStreak = 0;
  gameState.difficulty = DEFAULT_DIFFICULTY;
  gameState.greenAt = 0;
  gameState.reactionTime = null;
  gameState.playerStarted = false;
  gameState.raceControl = 'manual';
  gameState.lastRaceControl = null;
  gameState.activeRaceType = 'standard';
  gameState.lastRaceType = null;
  gameState.aiAssist = createDefaultAiAssistState();
  gameState.aiAssistLocked = false;
  gameState.manualRankStreak = createDefaultManualRankStreak();
  gameState.manualDifficultyWinStreak = createDefaultManualDifficultyWinStreak();
  gameState.panelReturnPhase = 'idle';
  gameState.atlasFilter = 'all';
  gameState.shopItems = [];
  gameState.inventory = [];
  gameState.equippedParts = createEmptyEquippedParts();
  gameState.mythicUpgrades = {};
  gameState.nextPartId = 1;
  gameState.stats = createDefaultStats();
  gameState.achievements = achievements;
  gameState.settings = settings;
  recalculatePlayerStats();
}

function performRestartGame() {
  clearRaceTimers();
  clearStorageWriteBlock();
  if (typeof gsafeResetSession === 'function') {
    gsafeResetSession();
  }
  resetPersistentState({ preserveAchievements: true });
  let saveFailed = false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(createSaveData()));
  } catch (error) {
    saveFailed = true;
  }

  el.logOutput.textContent = '';
  refreshAfterPersistentChange();
  if (saveFailed) {
    addLog('本地存档写入失败，但当前进度已重置。');
  }
  addLog('游戏已重开，已解锁成就和设置会保留。');
  addLog('先报名比赛，等绿灯后点“起步 / 踩油门”。');
}

function confirmRestartGame() {
  const message = '确定要重置当前游戏进度并重新开始吗？已解锁成就、音效设置和信息收集设置会保留。';

  if (typeof openNoticeModal === 'function') {
    openNoticeModal('确认清档', message, {
      showCancel: true,
      cancelText: '取消',
      confirmText: '确认删除并重开',
      onConfirm: performRestartGame,
    });
    return;
  }

  if (window.confirm(message)) {
    performRestartGame();
  }
}

function restartGame() {
  if (isRaceLockedPhase(gameState.phase)) {
    addLog('比赛进行中不能重开，请等本场结束。');
    return;
  }

  confirmRestartGame();
}

function getRaceLocalStorageKeys() {
  return [
    STORAGE_KEY,
    RACE_AUDIO_STORAGE_KEY,
    RACE_SESSION_STORAGE_KEY,
    RACE_LOCAL_LOG_STORAGE_KEY,
    ...RACE_LEGACY_STORAGE_KEYS,
  ];
}

function clearAllRaceLocalData() {
  getRaceLocalStorageKeys().forEach((key) => {
    localStorage.removeItem(key);
  });
}

function performClearAllRaceLocalData() {
  clearRaceTimers();
  clearStorageWriteBlock();

  try {
    clearAllRaceLocalData();
  } catch (error) {
    addLog('清理本地数据失败：浏览器拒绝访问 localStorage。');
    return;
  }

  window.location.reload();
}

function confirmClearAllRaceLocalData() {
  const message =
    '确认清理本地数据吗？\n\n这会删除本浏览器内的所有 Race 数据，包括：\n\n- 当前存档\n- 已拥有零件\n- 已装备零件\n- 神话强化等级\n- 成就\n- 图鉴 / 收藏记录\n- 音效设置\n- 信息收集设置\n\n此操作不可恢复。';

  if (typeof openNoticeModal === 'function') {
    openNoticeModal('确认清理本地数据', message, {
      showCancel: true,
      cancelText: '取消',
      confirmText: '确认清理',
      onConfirm: performClearAllRaceLocalData,
    });
    return;
  }

  if (window.confirm(message)) {
    performClearAllRaceLocalData();
  }
}

function clearLocalData() {
  if (isRaceLockedPhase(gameState.phase)) {
    addLog('比赛进行中不能清理本地数据，请等本场结束。');
    return;
  }

  confirmClearAllRaceLocalData();
}

function clearRaceTimers() {
  gameState.countdownTimers.forEach((timer) => clearTimeout(timer));
  gameState.countdownTimers = [];

  if (gameState.raceTimer) {
    cancelAnimationFrame(gameState.raceTimer);
    gameState.raceTimer = null;
  }
  gameState.lastRaceTickAt = 0;
  gameState.raceAccumulator = 0;
}
