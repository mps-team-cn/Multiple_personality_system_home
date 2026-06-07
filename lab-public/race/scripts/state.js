'use strict';

// 创建函数集中放在这里，保证新游戏、清档和读档迁移都能拿到同一套默认结构。
function createEmptyEquippedParts() {
  return EQUIPMENT_SLOTS.reduce((slots, type) => {
    slots[type] = null;
    return slots;
  }, {});
}

function createDifficultyStatsMap() {
  return DIFFICULTY_ORDER.reduce((stats, key) => {
    stats[key] = 0;
    return stats;
  }, {});
}

function createDefaultStats() {
  return {
    totalRaces: 0,
    totalWins: 0,
    totalLosses: 0,
    currentStreak: 0,
    bestStreak: 0,
    falseStartCount: 0,
    falseStartStreak: 0,
    secondPlaceStreak: 0,
    fifthPlaceStreak: 0,
    practiceRaces: 0,
    partsPurchasedCount: 0,
    highestCash: 1500,
    winsByDifficulty: createDifficultyStatsMap(),
    bestStreakByDifficulty: createDifficultyStatsMap(),
    hasFilledAllSlots: false,
    hasLowCashAfterRace: false,
    hasFinishedLast: false,
    hasNightmareSlowReactionWin: false,
    hasNightmareGlassCannonWin: false,
    hasNightmareStableWin: false,
    hasWonAfterSecondPlaceStreak: false,
    wonWithBuildAchievements: [],
    wonWithSpecialParts: [],
  };
}

function createDefaultAchievementsState() {
  return {
    completed: {},
    lastUnlocked: [],
  };
}

function readLegacyRaceAudioEnabled() {
  try {
    return localStorage.getItem(RACE_AUDIO_STORAGE_KEY) !== 'false';
  } catch (error) {
    return DEFAULT_SETTINGS.soundEnabled;
  }
}

function normalizeBooleanSetting(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function createDefaultSettings() {
  return {
    ...DEFAULT_SETTINGS,
    soundEnabled: readLegacyRaceAudioEnabled(),
  };
}

function sanitizeSettingsData(data, legacyData = null) {
  const settings = data && typeof data === 'object' ? data : {};
  const legacy = legacyData && typeof legacyData === 'object' ? legacyData : {};
  const defaults = createDefaultSettings();
  const legacySoundEnabled = normalizeBooleanSetting(legacy.soundEnabled, defaults.soundEnabled);

  return {
    soundEnabled: normalizeBooleanSetting(settings.soundEnabled, legacySoundEnabled),
    telemetryEnabled: normalizeBooleanSetting(
      settings.telemetryEnabled,
      DEFAULT_SETTINGS.telemetryEnabled
    ),
  };
}

function createDefaultAiAssistState() {
  return {
    active: false,
    reactionTime: null,
  };
}

function createDefaultManualRankStreak() {
  return {
    rank: null,
    count: 0,
  };
}

function createDefaultManualDifficultyWinStreak() {
  return {
    difficultyKey: null,
    count: 0,
  };
}

// 单页游戏的唯一运行时状态；可持久化字段会由 core.js/createSaveData 统一筛选。
const gameState = {
  phase: 'idle',
  cash: 1500,
  raceCount: 0,
  lastRank: '-',
  bestReactionTime: null,
  bestManualReactionTime: null,
  lastReactionTime: null,
  lastManualReactionTime: null,
  lastReactionControl: null,
  currentWinStreak: 0,
  currentLoseStreak: 0,
  bestWinStreak: 0,
  difficulty: DEFAULT_DIFFICULTY,
  ready: false,
  greenAt: 0,
  reactionTime: null,
  opponentReactionTime: null,
  playerStarted: false,
  raceControl: 'manual',
  lastRaceControl: null,
  activeRaceType: 'standard',
  lastRaceType: null,
  aiAssist: createDefaultAiAssistState(),
  aiAssistLocked: false,
  manualRankStreak: createDefaultManualRankStreak(),
  manualDifficultyWinStreak: createDefaultManualDifficultyWinStreak(),
  countdownTimers: [],
  raceTimer: null,
  raceStartedAt: 0,
  lastRaceTickAt: 0,
  raceAccumulator: 0,
  shopItems: [],
  panelReturnPhase: 'idle',
  activePage: 'race',
  atlasFilter: 'all',
  inventory: [],
  equippedParts: createEmptyEquippedParts(),
  mythicUpgrades: {},
  settings: createDefaultSettings(),
  nextPartId: 1,
  cars: [],
  materials: [],
  craftingRecipes: [],
  player: { ...BASE_PLAYER_STATS },
  stats: createDefaultStats(),
  achievements: createDefaultAchievementsState(),
  achievementToastQueue: [],
  achievementToastTimer: null,
  noticeModalConfig: null,
  storageWriteBlockedReason: '',
};

// DOM 引用集中缓存，后续模块通过 el 访问页面节点，避免重复 querySelector。
const el = {
  registerBtn: document.getElementById('registerBtn'),
  startBtn: document.getElementById('startBtn'),
  aiAssistRaceButton: document.getElementById('aiAssistRaceButton'),
  saveBtn: document.getElementById('saveBtn'),
  loadBtn: document.getElementById('loadBtn'),
  downloadLocalDataBtn: document.getElementById('downloadLocalDataBtn'),
  restartBtn: document.getElementById('restartBtn'),
  clearLocalDataBtn: document.getElementById('clearLocalDataBtn'),
  raceAudioToggleBtn: document.querySelector('[data-race-audio-toggle]'),
  telemetryToggleBtn: document.getElementById('telemetryToggleBtn'),
  shopTab: document.getElementById('shopTab'),
  tabs: Array.from(document.querySelectorAll('.page-tabs button')),
  pages: Array.from(document.querySelectorAll('.app-page')),
  lanes: document.getElementById('lanes'),
  shopPanel: document.getElementById('shopPanel'),
  shopBody: document.getElementById('shopBody'),
  garageSlotsBody: document.getElementById('garageSlotsBody'),
  tuningEquippedBody: document.getElementById('tuningEquippedBody'),
  tuningUnequippedBody: document.getElementById('tuningUnequippedBody'),
  difficultyChoices: document.getElementById('difficultyChoices'),
  difficultyOpenBtn: document.getElementById('difficultyOpenBtn'),
  difficultyCloseBtn: document.getElementById('difficultyCloseBtn'),
  difficultyOpenButtons: Array.from(document.querySelectorAll('[data-action="open-difficulty"]')),
  difficultyModal: document.getElementById('difficultyModal'),
  noticeModal: document.getElementById('noticeModal'),
  noticeModalTitle: document.getElementById('noticeModalTitle'),
  noticeModalMessage: document.getElementById('noticeModalMessage'),
  noticeModalCloseBtn: document.getElementById('noticeModalCloseBtn'),
  noticeModalCancelBtn: document.getElementById('noticeModalCancelBtn'),
  noticeModalConfirmBtn: document.getElementById('noticeModalConfirmBtn'),
  difficultyCurrentName: document.getElementById('difficultyCurrentName'),
  difficultyCurrentMeta: document.getElementById('difficultyCurrentMeta'),
  atlasBody: document.getElementById('atlasBody'),
  atlasDifficultyText: document.getElementById('atlasDifficultyText'),
  atlasCashStat: document.getElementById('atlasCashStat'),
  atlasFilters: Array.from(document.querySelectorAll('[data-atlas-filter]')),
  atlasSummaryText: document.getElementById('atlasSummaryText'),
  logOutput: document.getElementById('logOutput'),
  redLight: document.getElementById('redLight'),
  yellowLight: document.getElementById('yellowLight'),
  greenLight: document.getElementById('greenLight'),
  lightLabel: document.getElementById('lightLabel'),
  phaseText: document.getElementById('phaseText'),
  raceTierText: document.getElementById('raceTierText'),
  entryFeeText: document.getElementById('entryFeeText'),
  bestReactionText: document.getElementById('bestReactionText'),
  winStreakText: document.getElementById('winStreakText'),
  raceRoundText: document.getElementById('raceRoundText'),
  opponentPowerText: document.getElementById('opponentPowerText'),
  raceControlHint: document.getElementById('raceControlHint'),
  raceReportEmptyText: document.getElementById('raceReportEmptyText'),
  raceReportStats: document.getElementById('raceReportStats'),
  raceCurrentWinStreakStat: document.getElementById('raceCurrentWinStreakStat'),
  raceBestWinStreakStat: document.getElementById('raceBestWinStreakStat'),
  engineStat: document.getElementById('engineStat'),
  tireStat: document.getElementById('tireStat'),
  gearboxStat: document.getElementById('gearboxStat'),
  stabilityStat: document.getElementById('stabilityStat'),
  weightStat: document.getElementById('weightStat'),
  hpStat: document.getElementById('hpStat'),
  cashStat: document.getElementById('cashStat'),
  raceCountStat: document.getElementById('raceCountStat'),
  lastRankStat: document.getElementById('lastRankStat'),
  lastReactionStat: document.getElementById('lastReactionStat'),
  currentVehicleText: document.getElementById('currentVehicleText'),
  resultMessage: document.getElementById('resultMessage'),
  resultSubMessage: document.getElementById('resultSubMessage'),
  shopCashStat: document.getElementById('shopCashStat'),
  shopAdviceText: document.getElementById('shopAdviceText'),
  tuningCashStat: document.getElementById('tuningCashStat'),
  tuningAdviceText: document.getElementById('tuningAdviceText'),
  profileCashStat: document.getElementById('profileCashStat'),
  profileDifficultyName: document.getElementById('profileDifficultyName'),
  profileDifficultyMeta: document.getElementById('profileDifficultyMeta'),
  achievementsBody: document.getElementById('achievementsBody'),
  achievementsCountText: document.getElementById('achievementsCountText'),
  statsTotalRaces: document.getElementById('statsTotalRaces'),
  statsPracticeRaces: document.getElementById('statsPracticeRaces'),
  statsTotalWins: document.getElementById('statsTotalWins'),
  statsTotalLosses: document.getElementById('statsTotalLosses'),
  statsCurrentStreak: document.getElementById('statsCurrentStreak'),
  statsBestStreak: document.getElementById('statsBestStreak'),
  statsDifficultyWins: document.getElementById('statsDifficultyWins'),
  statsDifficultyBestStreaks: document.getElementById('statsDifficultyBestStreaks'),
  statsHighestCash: document.getElementById('statsHighestCash'),
  statsCollectionProgress: document.getElementById('statsCollectionProgress'),
  headerContact: document.getElementById('headerContact'),
  versionText: document.getElementById('versionText'),
  versionQqText: document.getElementById('versionQqText'),
  versionNote: document.getElementById('versionNote'),
  statusVersionText: document.getElementById('statusVersionText'),
  achievementToast: document.getElementById('achievementToast'),
};
