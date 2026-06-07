'use strict';

/*
 * 比赛流程模块。
 * 负责报名、灯号倒计时、起步判定、车辆逐帧推进和赛后结算。
 */

const RED_LIGHT_DURATION_MS = 900;
const GREEN_LIGHT_DELAY_MIN_MS = 450;
const GREEN_LIGHT_DELAY_MAX_MS = 1600;
const OPPONENT_REACTION_RANGES = {
  easy: { min: 0.45, max: 0.9 },
  normal: { min: 0.34, max: 0.72 },
  hard: { min: 0.24, max: 0.52 },
  expert: { min: 0.16, max: 0.26 },
  nightmare: { min: 0.08, max: 0.14 },
};

let raceAudioContext = null;
let raceAudioEnabled = getGameSettings().soundEnabled;

function rollGreenLightDelayMs() {
  return Math.round(randomBetween(GREEN_LIGHT_DELAY_MIN_MS, GREEN_LIGHT_DELAY_MAX_MS));
}

function rollOpponentReactionTime(difficulty) {
  const range = OPPONENT_REACTION_RANGES[difficulty] || OPPONENT_REACTION_RANGES.normal;
  const value = range.min + Math.random() * (range.max - range.min);
  return Number(value.toFixed(3));
}

function getCurrentOpponentReactionTime() {
  const reactionTime = Number(gameState.opponentReactionTime);
  return Number.isFinite(reactionTime) && reactionTime >= 0 ? reactionTime : null;
}

function formatReactionAdvantage(playerReaction, opponentReaction) {
  const delta = Number((opponentReaction - playerReaction).toFixed(3));
  const absDelta = Math.abs(delta).toFixed(3);

  if (Math.abs(delta) < 0.015) {
    return '起步优势：几乎同时起步';
  }

  if (delta > 0) {
    return `起步优势：你快了 ${absDelta} 秒`;
  }

  return `起步优势：电脑快了 ${absDelta} 秒`;
}

function getRaceAudioContext() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) {
    return null;
  }

  if (!raceAudioContext) {
    raceAudioContext = new AudioContext();
  }

  if (raceAudioContext.state === 'suspended') {
    raceAudioContext.resume().catch(() => {});
  }

  return raceAudioContext;
}

function ensureRaceAudioReady() {
  if (!raceAudioEnabled) {
    return;
  }

  getRaceAudioContext();
}

function playRaceBeep(frequency = 880, duration = 0.08, type = 'square', volume = 0.035) {
  if (!raceAudioEnabled) {
    return;
  }

  const ctx = getRaceAudioContext();
  if (!ctx) {
    return;
  }

  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  const startAt = ctx.currentTime;
  const stopAt = startAt + duration + 0.02;

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);

  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.addEventListener('ended', () => {
    oscillator.disconnect();
    gain.disconnect();
  });

  oscillator.start(startAt);
  oscillator.stop(stopAt);
}

function playLightBeep(light) {
  if (light === 'red') {
    playRaceBeep(440, 0.055, 'square', 0.028);
    return;
  }

  if (light === 'yellow') {
    playRaceBeep(660, 0.055, 'square', 0.03);
    return;
  }

  if (light === 'green') {
    playRaceBeep(980, 0.075, 'square', 0.04);
  }
}

function playFalseStartSound() {
  playRaceBeep(150, 0.14, 'sawtooth', 0.045);
}

function playRaceWinSound() {
  playRaceBeep(740, 0.055, 'square', 0.03);
  window.setTimeout(() => playRaceBeep(980, 0.08, 'square', 0.035), 70);
}

function playRaceLoseSound() {
  playRaceBeep(360, 0.07, 'triangle', 0.03);
  window.setTimeout(() => playRaceBeep(240, 0.1, 'triangle', 0.03), 80);
}

function setRaceAudioEnabled(enabled) {
  setGameSettings({ soundEnabled: Boolean(enabled) });
}

function syncRaceAudioFromSettings() {
  raceAudioEnabled = getGameSettings().soundEnabled;
  updateRaceAudioToggleText();
}

function updateRaceAudioToggleText() {
  updateSettingsControls();
}

function toggleRaceAudioEnabled() {
  setRaceAudioEnabled(!raceAudioEnabled);
  updateRaceAudioToggleText();

  if (raceAudioEnabled) {
    playRaceBeep(880, 0.06, 'square', 0.035);
  }
}

function initRaceAudioToggle() {
  const button = el.raceAudioToggleBtn || document.querySelector('[data-race-audio-toggle]');
  if (!button) {
    return;
  }

  updateRaceAudioToggleText();
  button.addEventListener('click', toggleRaceAudioEnabled);
}

function renderLanes() {
  el.lanes.innerHTML = '';
  gameState.cars.forEach((car, index) => {
    const lane = document.createElement('div');
    lane.className = 'lane';

    const label = document.createElement('span');
    label.className = 'lane-label';
    label.textContent = `车${index + 1}${car.isPlayer ? ' 我' : ''}`;

    const carNode = document.createElement('div');
    carNode.className = `car${car.isPlayer ? ' player-car' : ''}`;
    carNode.id = `car-${car.id}`;
    carNode.style.background = car.color;
    carNode.title = car.name;

    lane.appendChild(label);
    lane.appendChild(carNode);
    el.lanes.appendChild(lane);
  });

  updateCarPositions();
}

function updateCarPositions() {
  gameState.cars.forEach((car) => {
    const node = document.getElementById(`car-${car.id}`);
    if (!node) {
      return;
    }
    const percent = clamp(car.position, 0, FINISH);
    node.style.left = `calc(${percent}% - ${percent * 0.32}px)`;
  });
}

function resetCars() {
  gameState.cars = [
    createCar(1, '玩家小车', '#d00000', true),
    createCar(2, '电脑蓝车', '#0060c8', false),
    createCar(3, '电脑黄车', '#d8b000', false),
    createCar(4, '电脑绿车', '#008c28', false),
    createCar(5, '电脑灰车', '#707070', false),
  ];
  renderLanes();
}

function createCar(id, name, color, isPlayer) {
  return {
    id,
    name,
    color,
    isPlayer,
    position: 0,
    finishTime: null,
    currentSpeed: 0,
    started: false,
    reactionPenalty: 0,
    launchBonus: 0,
    power: isPlayer ? getPlayerPower() : getOpponentCarPower(id),
  };
}

function getPlayerPower() {
  return RaceFormulaUtils.computePlayerPower(gameState.player);
}

function getPlayerRating() {
  return RaceFormulaUtils.computePlayerRating(gameState.player);
}

function getOpponentPower() {
  const baseStrength = RaceFormulaUtils.computeOpponentStrength({
    raceCount: gameState.raceCount,
    difficulty: getDifficulty(),
    playerRating: getPlayerRating(),
    chaseStartRace: OPPONENT_CHASE_START_RACE,
    chaseRampRaces: OPPONENT_CHASE_RAMP_RACES,
    chaseCap: OPPONENT_CHASE_CAP,
  });
  const lossRelief = getLossStreakReliefConfig();
  const lossReliefMultiplier = lossRelief ? lossRelief.opponentMultiplier : 1;
  const practiceMultiplier = isPracticeRace() ? PRACTICE_OPPONENT_STRENGTH_MULTIPLIER : 1;

  return baseStrength * lossReliefMultiplier * practiceMultiplier;
}

function getOpponentCarPower(id) {
  return RaceFormulaUtils.computeOpponentCarPower({
    opponentStrength: getOpponentPower(),
    id,
    randomBetween,
  });
}

// AI 托管只模拟本场起步时机，不改玩家的手动反应纪录和操作类成就。
function rollAiReactionTime() {
  const [min, max] = AI_ASSIST_REACTION_RANGE_SECONDS;
  return Number((min + Math.random() * (max - min)).toFixed(3));
}

function handleAiAssistRaceButtonClick() {
  if (gameState.aiAssistLocked) {
    return;
  }

  gameState.aiAssistLocked = true;
  updateButtons();

  try {
    startAiAssistRace();
  } finally {
    setTimeout(() => {
      gameState.aiAssistLocked = false;
      updateButtons();
    }, 500);
  }
}

function startAiAssistRace() {
  if (gameState.phase !== 'idle') {
    addLog('AI 托管只能在待机状态开始。');
    return false;
  }

  if (gameState.cash < getEntryFee()) {
    addLog('资金不足，AI 托管无法报名。');
    return false;
  }

  gameState.raceControl = 'ai';
  gameState.aiAssist = {
    active: true,
    reactionTime: rollAiReactionTime(),
  };

  addLog('AI 托管已接管本场比赛。');
  addLog('AI 正在等待绿灯……');
  registerRace();
  updateStats();
  return true;
}

function startPracticeRace() {
  if (!canStartPracticeRace()) {
    const minEntryFee = getMinEntryFee();
    const minDifficultyName = DIFFICULTIES[getMinEntryDifficultyKey()].name;

    if (gameState.cash >= minEntryFee) {
      addLog(`现金已够支付「${minDifficultyName}」模式报名费，练习赛暂不开放。`);
      openNoticeModal(
        '不能参加练习赛',
        `当前资金已达到「${minDifficultyName}」报名线，练习赛暂不开放。请切到「${minDifficultyName}」模式继续正式赛事。`
      );
    } else {
      addLog('练习赛只会在待机且现金不足最低报名费时开放。');
    }
    return false;
  }

  gameState.raceControl = 'manual';
  gameState.aiAssist = createDefaultAiAssistState();
  const started = registerRace({ raceType: 'practice' }) !== false;
  if (started) {
    unlockAchievementById('lianlian_low_power_fuel_pack', { source: 'practiceRecovery' });
  }
  updateStats();
  return started;
}

function showPracticeEntryNotice() {
  const minEntryFee = getMinEntryFee();
  const minDifficultyName = DIFFICULTIES[getMinEntryDifficultyKey()].name;

  openNoticeModal(
    '资金不足，进入练习赛',
    `当前资金低于「${minDifficultyName}」赛事报名费 ${minEntryFee} 元。本场可参加免费练习赛：奖金较低，不计入正式连胜和高难度成就。`,
    {
      confirmText: '开始练习赛',
      onConfirm: startPracticeRace,
    }
  );
}

function showPracticeRecoveryNotice() {
  const minEntryFee = getMinEntryFee();
  const minDifficultyName = DIFFICULTIES[getMinEntryDifficultyKey()].name;

  addLog(`现金已够支付「${minDifficultyName}」模式报名费，练习赛暂时关闭。`);
  openNoticeModal(
    '练习赛已关闭',
    `你已经攒够「${minDifficultyName}」赛事报名费了。建议先切到「${minDifficultyName}」模式跑正式比赛；练习赛只会在资金低于最低报名费时开放。`
  );
}

function takeOverAiAssistRace() {
  if (getCurrentRaceControl() !== 'ai') {
    return;
  }

  gameState.raceControl = 'manual';
  gameState.aiAssist = createDefaultAiAssistState();
  gameState.aiAssistLocked = false;
  addLog('已切换为人工操作，本场按手动比赛结算。');
  updateResultMessage();
  updateStats();
  updateButtons();
}

function onGreenLight() {
  setPhase('countdown_green');
  setLights('green');
  playLightBeep('green');
  gameState.greenAt = performance.now();
  addLog('绿灯！电脑车也在响应起步，快点“起步 / 踩油门”！');
  startRaceMotion();

  if (getCurrentRaceControl() !== 'ai' || !gameState.aiAssist.active) {
    return;
  }

  const reactionMs = Math.round(gameState.aiAssist.reactionTime * 1000);
  gameState.countdownTimers.push(
    setTimeout(() => {
      if (
        gameState.playerStarted ||
        !['countdown_green', 'racing'].includes(gameState.phase) ||
        getCurrentRaceControl() !== 'ai' ||
        !gameState.aiAssist.active
      ) {
        return;
      }

      pressStart({
        controlledBy: 'ai',
        reactionTime: gameState.aiAssist.reactionTime,
      });
    }, reactionMs)
  );
}

// 报名后进入红黄绿灯倒计时；玩家在绿灯前点击会进入抢跑分支。
function registerRace(options = {}) {
  const raceType = options.raceType === 'practice' ? 'practice' : 'standard';
  const entryFee = raceType === 'practice' ? 0 : getEntryFee();
  const minEntryFee = getMinEntryFee();
  const minDifficultyKey = getMinEntryDifficultyKey();
  const minDifficultyName = DIFFICULTIES[minDifficultyKey].name;

  if (raceType === 'practice' && gameState.cash >= minEntryFee) {
    addLog(`现金已够支付「${minDifficultyName}」模式报名费，练习赛暂不开放。`);
    openNoticeModal(
      '不能参加练习赛',
      `当前资金已达到「${minDifficultyName}」报名线，练习赛暂不开放。请切到「${minDifficultyName}」模式继续正式赛事。`
    );
    return false;
  }

  if (raceType === 'standard' && gameState.cash < entryFee) {
    addLog(`现金不足以支付「${getDifficulty().name}」难度报名费 ${entryFee} 元。`);
    unlockAchievementById('broke_entry_attempt');

    if (gameState.cash >= minEntryFee) {
      addLog(`当前余额已够「${minDifficultyName}」模式报名费，请先降低难度。`);
      openNoticeModal(
        '建议降低难度',
        `当前资金不足以参加本难度赛事。你现在仍可参加「${minDifficultyName}」赛事，建议先切到「${minDifficultyName}」模式攒一两场。练习赛只会在资金低于最低报名费时开放。`
      );
      return false;
    }

    addLog(`当前余额低于最低报名费 ${minEntryFee} 元，可进入免费练习赛。`);
    showPracticeEntryNotice();
    return false;
  }

  clearRaceTimers();
  if (getCurrentRaceControl() !== 'ai') {
    resetRaceControlState();
  }
  gameState.activeRaceType = raceType;
  gameState.cash -= entryFee;
  gameState.reactionTime = null;
  gameState.opponentReactionTime = rollOpponentReactionTime(getDifficultyKey());
  gameState.playerStarted = false;
  gameState.lastRaceControl = null;
  gameState.lastRaceType = null;
  resetCars();
  updateStats();

  if (raceType === 'practice') {
    addLog('参加练习赛：无报名费，奖金较低，不计入正式连胜。');
  } else {
    addLog(`报名费 ${entryFee} 元`);
    if (getLossStreakReliefConfig()) {
      addLog('系统悄悄放宽了这一场的对手强度。');
    }
  }
  addLog('等待绿灯……红灯或黄灯点击“起步 / 踩油门”会抢跑，绿灯时机每场随机。');

  setPhase('countdown_red');
  setLights('red');
  playLightBeep('red');

  const greenLightDelayMs = RED_LIGHT_DURATION_MS + rollGreenLightDelayMs();

  gameState.countdownTimers.push(
    setTimeout(() => {
      setPhase('countdown_yellow');
      setLights('yellow');
      playLightBeep('yellow');
      addLog('黄灯……还不能踩，黄灯点击也算抢跑。');
    }, RED_LIGHT_DURATION_MS)
  );

  gameState.countdownTimers.push(
    setTimeout(() => {
      onGreenLight();
    }, greenLightDelayMs)
  );
}

// 玩家/AI 起步统一走这里，便于结算时区分 manual 和 ai 控制来源。
function pressStart(options = {}) {
  const controlledBy = options.controlledBy || getCurrentRaceControl();

  if (controlledBy === 'manual') {
    takeOverAiAssistRace();
  }

  if (['countdown_red', 'countdown_yellow'].includes(gameState.phase)) {
    if (controlledBy === 'ai') {
      return;
    }
    handleFalseStart();
    return;
  }

  if (!['countdown_green', 'racing'].includes(gameState.phase) || gameState.playerStarted) {
    return;
  }

  startPlayerCar(options);
}

function updateBestReactionRecord(reactionSeconds) {
  const manualReactionTime = normalizeManualReactionTime(reactionSeconds);
  if (manualReactionTime === null) {
    return;
  }

  if (
    gameState.bestManualReactionTime === null ||
    manualReactionTime < gameState.bestManualReactionTime
  ) {
    gameState.bestManualReactionTime = manualReactionTime;
    gameState.bestReactionTime = manualReactionTime;
    addLog(`刷新最快反应记录：${gameState.bestReactionTime.toFixed(3)} 秒！`);
  }
}

function updateWinStreak(playerRank, race) {
  if (!isManualRace(race) || isPracticeRace(race)) {
    return;
  }

  if (playerRank === 1) {
    gameState.currentWinStreak += 1;
    gameState.bestWinStreak = Math.max(gameState.bestWinStreak, gameState.currentWinStreak);
    return;
  }

  gameState.currentWinStreak = 0;
}

function updateManualDifficultyWinStreak(playerRank, race) {
  if (!isManualRace(race) || isPracticeRace(race)) {
    return;
  }

  if (playerRank !== 1) {
    gameState.manualDifficultyWinStreak = createDefaultManualDifficultyWinStreak();
    return;
  }

  const difficultyKey = race.difficultyKey;
  const previous = gameState.manualDifficultyWinStreak || createDefaultManualDifficultyWinStreak();
  const nextCount = previous.difficultyKey === difficultyKey ? previous.count + 1 : 1;

  gameState.manualDifficultyWinStreak = {
    difficultyKey,
    count: nextCount,
  };
  gameState.stats.bestStreakByDifficulty[difficultyKey] = Math.max(
    gameState.stats.bestStreakByDifficulty[difficultyKey] || 0,
    nextCount
  );
}

function updateManualRankStreak(playerRank, race) {
  if (!isManualRace(race) || isPracticeRace(race)) {
    return;
  }

  const previous = gameState.manualRankStreak || createDefaultManualRankStreak();
  const nextCount = previous.rank === playerRank ? previous.count + 1 : 1;
  gameState.manualRankStreak = {
    rank: playerRank,
    count: nextCount,
  };
  gameState.stats.secondPlaceStreak = playerRank === 2 ? nextCount : 0;
  gameState.stats.fifthPlaceStreak = playerRank === 5 ? nextCount : 0;
}

function addReactionReport(race) {
  const playerReaction = Number(race.reactionTime);
  const opponentReaction = Number(race.opponentReactionTime);

  if (!Number.isFinite(playerReaction) || !Number.isFinite(opponentReaction)) {
    return;
  }

  const controlSuffix = isAiRace(race) ? '（AI托管）' : '';
  addLog(`你的反应：${playerReaction.toFixed(3)} 秒${controlSuffix}`);
  addLog(`电脑反应：${opponentReaction.toFixed(3)} 秒`);
  addLog(formatReactionAdvantage(playerReaction, opponentReaction));
}

function handleFalseStart() {
  const falseStartPhase = gameState.phase;
  const practiceRace = isPracticeRace();
  clearRaceTimers();
  playFalseStartSound();
  gameState.reactionTime = null;
  gameState.opponentReactionTime = null;
  gameState.lastReactionTime = null;
  gameState.lastReactionControl = null;
  gameState.playerStarted = false;
  if (!practiceRace) {
    gameState.currentWinStreak = 0;
    gameState.currentLoseStreak += 1;
    gameState.manualRankStreak = createDefaultManualRankStreak();
    gameState.manualDifficultyWinStreak = createDefaultManualDifficultyWinStreak();
    gameState.stats.falseStartCount = (gameState.stats.falseStartCount || 0) + 1;
    gameState.stats.falseStartStreak = (gameState.stats.falseStartStreak || 0) + 1;
    gameState.stats.secondPlaceStreak = 0;
    gameState.stats.fifthPlaceStreak = 0;
  }
  syncProgressStats();
  gameState.lastRank = practiceRace ? '练习犯规' : '犯规';
  gameState.lastRaceType = practiceRace ? 'practice' : 'standard';
  setPhase('false_start');
  setLights('red');
  addLog(`${falseStartPhase === 'countdown_yellow' ? '黄灯' : '红灯'}抢跑犯规！`);
  addLog(practiceRace ? '本场练习作废，奖金 0 元。' : '本场成绩无效，奖金 0 元，报名费不退。');
  if (!practiceRace && typeof checkAchievements === 'function') {
    checkAchievements({ source: 'falseStart' });
  }
  finishPostRace({ refreshShopAfterRace: false });
  autoSaveGame();
}

function startRaceMotion() {
  if (gameState.raceTimer) {
    return;
  }

  gameState.raceStartedAt = performance.now();
  gameState.lastRaceTickAt = gameState.raceStartedAt;
  gameState.raceAccumulator = 0;

  setPhase('racing');
  scheduleOpponentStart();
  gameState.raceTimer = requestAnimationFrame(raceLoop);
}

function startOpponentCars() {
  gameState.cars.forEach((car) => {
    if (!car.isPlayer && !car.started) {
      car.started = true;
      car.launchBonus = car.power.launch;
    }
  });
}

function scheduleOpponentStart() {
  const opponentReactionTime = getCurrentOpponentReactionTime();
  const reactionMs = Math.max(0, Math.round((opponentReactionTime || 0) * 1000));

  if (reactionMs === 0) {
    startOpponentCars();
    return;
  }

  gameState.countdownTimers.push(
    setTimeout(() => {
      if (!gameState.raceTimer || gameState.phase !== 'racing') {
        return;
      }

      startOpponentCars();
    }, reactionMs)
  );
}

// 使用 requestAnimationFrame 承载动画，内部通过 TICK_MS 固定步长推进数值。
function raceLoop(now) {
  if (!gameState.raceTimer || gameState.phase !== 'racing') {
    return;
  }

  gameState.raceAccumulator += now - gameState.lastRaceTickAt;
  gameState.lastRaceTickAt = now;

  while (
    gameState.raceAccumulator >= TICK_MS &&
    gameState.raceTimer &&
    gameState.phase === 'racing'
  ) {
    tickRace();
    gameState.raceAccumulator -= TICK_MS;
  }

  if (gameState.raceTimer && gameState.phase === 'racing') {
    gameState.raceTimer = requestAnimationFrame(raceLoop);
  }
}

function startPlayerCar(options = {}) {
  const playerCar = gameState.cars.find((car) => car.isPlayer);
  const now = performance.now();
  const controlledBy = options.controlledBy || getCurrentRaceControl();
  const reactionSeconds =
    controlledBy === 'ai' && Number.isFinite(options.reactionTime)
      ? options.reactionTime
      : (now - gameState.greenAt) / 1000;
  const reaction = RaceFormulaUtils.computeReactionOutcome({
    reactionSeconds,
    reactionGrace: getDifficulty().reactionGrace || 0,
  });

  gameState.reactionTime = reactionSeconds;
  gameState.playerStarted = true;
  playerCar.started = true;
  playerCar.reactionPenalty = reaction.slowPenalty;
  playerCar.launchBonus = playerCar.power.launch + reaction.reactionBonus;
  if (controlledBy === 'ai') {
    gameState.lastReactionTime = normalizeReactionTime(reactionSeconds);
    gameState.lastReactionControl = 'ai';
    addLog(`AI 以 ${reactionSeconds.toFixed(3)} 秒反应起步。`);
    addLog('本场为 AI 托管，操作类成就不会解锁。');
  } else {
    const manualReactionTime = normalizeManualReactionTime(reactionSeconds);
    gameState.lastReactionTime = manualReactionTime;
    gameState.lastManualReactionTime = manualReactionTime;
    gameState.lastReactionControl = 'manual';
    updateBestReactionRecord(manualReactionTime);
    addLog(`你起步反应时间：${reactionSeconds.toFixed(3)} 秒`);
    if (reactionSeconds < 0.25) {
      addLog('无违规，起步完美！');
    } else if (reactionSeconds < 0.55) {
      addLog('合法起步，反应还行。');
    } else {
      addLog('起步偏慢，电脑车已经拉开。');
    }
  }
  updateResultMessage();
  updateButtons();
  if (controlledBy === 'manual' && isFormalRace() && typeof checkAchievements === 'function') {
    checkAchievements({ source: 'validStart' });
  }
}

function tickRace() {
  const now = performance.now();
  const elapsed = (now - gameState.raceStartedAt) / 1000;

  gameState.cars.forEach((car) => {
    if (!car.started || car.finishTime !== null) {
      return;
    }

    const stabilityNoise =
      (18 - clamp(car.power.stability, 1, 18)) * randomBetween(-0.0018, 0.0024);
    const midBoost = car.position > 34 && car.position < 78 ? car.power.mid * 0.012 : 0;
    const launchFade = Math.max(0, 1 - elapsed / 1.2) * car.launchBonus * 0.08;

    // The formula is intentionally blunt so upgrades visibly move the car faster.
    car.currentSpeed += car.power.acceleration + stabilityNoise;
    car.currentSpeed = clamp(car.currentSpeed, 0.28, 2.2);
    car.position +=
      car.power.base + car.currentSpeed + midBoost + launchFade - car.reactionPenalty * 0.035;

    if (car.position >= FINISH) {
      car.position = FINISH;
      car.finishTime = now;
      addLog(`${car.name} 冲线。`);
    }
  });

  updateCarPositions();

  const playerCar = gameState.cars.find((car) => car.isPlayer);
  const opponentsFinished = gameState.cars.every((car) => car.isPlayer || car.finishTime !== null);
  if (playerCar && !playerCar.started && opponentsFinished) {
    el.resultMessage.textContent = '电脑车已完赛，仍可点击起步完成本场。';
  }

  if (gameState.cars.every((car) => car.finishTime !== null)) {
    completeRace();
  }
}

function normalizeTelemetrySeconds(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : null;
}

function trackRaceFinish(finishedRace) {
  if (typeof trackRaceEvent !== 'function') {
    return;
  }

  trackRaceEvent('lab_race_finish', {
    difficulty: finishedRace.difficultyKey,
    rank: finishedRace.rank,
    reactionTime: normalizeTelemetrySeconds(finishedRace.reactionTime),
    opponentReactionTime: normalizeTelemetrySeconds(finishedRace.opponentReactionTime),
    raceCount: gameState.raceCount,
    isPractice: finishedRace.raceType === 'practice',
    isAiAssist: isAiRace(finishedRace),
    money: gameState.cash,
    winStreak: gameState.currentWinStreak,
    version: GAME_VERSION,
  });
}

// 结算集中处理排名、奖金、连胜、特殊成就标记和失败检测。
function completeRace() {
  clearRaceTimers();

  const ranked = gameState.cars.slice().sort((a, b) => {
    if (a.finishTime === null && b.finishTime === null) return 0;
    if (a.finishTime === null) return 1;
    if (b.finishTime === null) return -1;
    return a.finishTime - b.finishTime;
  });

  const playerRank = ranked.findIndex((car) => car.isPlayer) + 1;
  const practiceRace = isPracticeRace();
  const basePrize = PRIZES[playerRank - 1] || 0;
  const rewardMultiplier = practiceRace ? 1 : getDifficulty().rewardMultiplier;
  let prize = practiceRace
    ? getPracticePrize(playerRank)
    : Math.floor(basePrize * rewardMultiplier);
  if (!practiceRace && getDifficultyKey() === 'easy' && playerRank === 5) {
    prize = Math.max(prize, Math.floor(getEntryFee() * 0.7));
  }
  const finishedRace = {
    controlledBy: getCurrentRaceControl(),
    reactionTime: gameState.reactionTime,
    opponentReactionTime: getCurrentOpponentReactionTime(),
    rank: playerRank,
    prize,
    rewardMultiplier,
    difficultyKey: getDifficultyKey(),
    raceType: practiceRace ? 'practice' : 'standard',
  };

  gameState.cash += prize;
  gameState.lastRank = practiceRace ? `练习第 ${playerRank} 名` : `第 ${playerRank} 名`;
  gameState.lastRaceControl = finishedRace.controlledBy;
  gameState.lastRaceType = finishedRace.raceType;
  if (playerRank === 1) {
    playRaceWinSound();
  } else {
    playRaceLoseSound();
  }

  if (practiceRace) {
    gameState.stats.practiceRaces = (gameState.stats.practiceRaces || 0) + 1;
  } else {
    gameState.raceCount += 1;
    updateWinStreak(playerRank, finishedRace);
    updateManualDifficultyWinStreak(playerRank, finishedRace);
    gameState.stats.falseStartStreak = 0;
    const secondPlaceStreakBeforeRace = gameState.stats.secondPlaceStreak || 0;
    if (isManualRace(finishedRace) && playerRank === 1 && secondPlaceStreakBeforeRace >= 10) {
      gameState.stats.hasWonAfterSecondPlaceStreak = true;
    }
    if (isManualRace(finishedRace)) {
      updateManualRankStreak(playerRank, finishedRace);
    }
    gameState.stats.totalRaces += 1;
    gameState.stats.hasFinishedLast =
      gameState.stats.hasFinishedLast || playerRank === ranked.length;
    gameState.stats.hasLowCashAfterRace =
      gameState.stats.hasLowCashAfterRace || gameState.cash < 100;
    if (playerRank === 1) {
      const difficultyKey = finishedRace.difficultyKey;
      const equippedTemplateIds = EQUIPMENT_SLOTS.map((type) => getEquippedPart(type))
        .filter(Boolean)
        .map((part) => getPartTemplateId(part));
      const wonWithBuildAchievements =
        typeof getWinningAchievementTagsFromCurrentBuild === 'function'
          ? getWinningAchievementTagsFromCurrentBuild()
          : [];

      gameState.currentLoseStreak = 0;
      gameState.stats.totalWins += 1;
      gameState.stats.winsByDifficulty[difficultyKey] += 1;
      if (isNightmareDifficulty(difficultyKey)) {
        if (
          isManualRace(finishedRace) &&
          Number.isFinite(gameState.lastManualReactionTime) &&
          gameState.lastManualReactionTime >= NIGHTMARE_SLOW_REACTION_SECONDS
        ) {
          gameState.stats.hasNightmareSlowReactionWin = true;
        }
        if (typeof getNightmareWinningAchievementTagsFromCurrentBuild === 'function') {
          markNightmareBuildAchievementFlags(getNightmareWinningAchievementTagsFromCurrentBuild());
        }
      }
      wonWithBuildAchievements.forEach((achievementId) => {
        if (!gameState.stats.wonWithBuildAchievements.includes(achievementId)) {
          gameState.stats.wonWithBuildAchievements.push(achievementId);
        }
      });

      ['gearbox_xue_wrench', 'stability_xiaoyu_sponsor'].forEach((templateId) => {
        if (
          equippedTemplateIds.includes(templateId) &&
          !gameState.stats.wonWithSpecialParts.includes(templateId)
        ) {
          gameState.stats.wonWithSpecialParts.push(templateId);
        }
      });
    } else {
      gameState.currentLoseStreak += 1;
      gameState.stats.totalLosses += 1;
    }
  }
  syncProgressStats();
  setPhase('finished');
  setLights('none');

  addLog('比赛结束！');
  addLog(`本场排名：${gameState.lastRank}`);
  addReactionReport(finishedRace);
  if (practiceRace) {
    addLog('练习赛奖金按最低报名费的小比例结算。');
    addLog('练习赛不会刷新商店。');
  } else {
    addLog(`难度「${getDifficulty().name}」奖金×${rewardMultiplier}`);
  }
  addLog(`获得奖金 ${prize} 元`);
  if (isAiRace(finishedRace)) {
    addLog('AI 托管完成本场比赛。');
    addLog('本场为 AI 托管，操作类成就不会解锁。');
  }
  finishPostRace({ refreshShopAfterRace: !practiceRace });
  trackRaceFinish(finishedRace);
  if (practiceRace && gameState.cash >= getMinEntryFee()) {
    showPracticeRecoveryNotice();
  }
  if (!practiceRace && typeof checkAchievements === 'function') {
    checkAchievements({ source: 'raceEnd', race: finishedRace });
  }
  resetRaceControlState({ preserveLastRaceControl: true });
  autoSaveGame();
}

function finishPostRace(options = {}) {
  const refreshShopAfterRace = options.refreshShopAfterRace !== false;
  if (refreshShopAfterRace) {
    refreshShop('race-finished');
    addLog('商店已刷新');
  }
  addLog(`现金余额：${gameState.cash} 元`);
  updateStats();
}

function nextRace() {
  clearRaceTimers();
  gameState.reactionTime = null;
  gameState.opponentReactionTime = null;
  gameState.playerStarted = false;
  gameState.panelReturnPhase = 'idle';
  gameState.activeRaceType = 'standard';
  resetRaceControlState();
  resetCars();
  setLights('none');
  setPhase('idle');
  addLog('下一场准备完毕，请报名比赛。');
  updateStats();
}
