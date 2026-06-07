'use strict';

/*
 * 成就系统负责“判定、解锁、提示、档案页渲染”。
 * 比赛结算和商店操作只更新统计字段，再调用 checkAchievements。
 */

function hasCompletedAchievement(id) {
  return Boolean(gameState.achievements.completed[id]);
}

function getAchievementById(id) {
  return ACHIEVEMENTS.find((achievement) => achievement.id === id) || null;
}

function getCompletedAchievementCount() {
  return Object.keys(gameState.achievements.completed).length;
}

function summarizePlayerStatProfile(sourceStats = gameState.player) {
  const stats = sourceStats;
  const positives = {
    engine: Math.max(0, stats.engine - BASE_PLAYER_STATS.engine),
    tire: Math.max(0, stats.tire - BASE_PLAYER_STATS.tire),
    gearbox: Math.max(0, stats.gearbox - BASE_PLAYER_STATS.gearbox),
    stability: Math.max(0, stats.stability - BASE_PLAYER_STATS.stability),
    hp: Math.max(0, stats.hp - BASE_PLAYER_STATS.hp),
    weight: Math.max(0, BASE_PLAYER_STATS.weight - stats.weight),
  };

  const entries = Object.entries(positives);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  const [dominantStat, dominantValue] = entries.reduce(
    (best, current) => (current[1] > best[1] ? current : best),
    ['engine', 0]
  );

  return {
    positives,
    dominantStat,
    dominantShare: total > 0 ? dominantValue / total : 0,
  };
}

// 当前车辆构筑会被压缩为主属性，用于判定偏科型获胜成就。
function getWinningAchievementTagsFromCurrentBuild() {
  const profile = summarizePlayerStatProfile();
  const unlockedTags = [];

  if (profile.dominantStat === 'hp' && profile.dominantShare > 0.55) {
    unlockedTags.push('hpBeliever');
  }

  if (gameState.player.stability >= 28 && profile.dominantStat === 'stability') {
    unlockedTags.push('stableDriver');
  }

  return unlockedTags;
}

function getNightmareWinningAchievementTagsFromCurrentBuild(sourceStats = gameState.player) {
  const rating = RaceFormulaUtils.computePlayerRating(sourceStats);
  const unlockedTags = [];

  if (
    rating >= NIGHTMARE_GLASS_CANNON_RATING &&
    sourceStats.stability <= NIGHTMARE_GLASS_CANNON_MAX_STABILITY
  ) {
    unlockedTags.push('nightmareGlassCannon');
  }

  if (sourceStats.stability >= NIGHTMARE_STABLE_DOG_MIN_STABILITY) {
    unlockedTags.push('nightmareStableDog');
  }

  return unlockedTags;
}

function markNightmareBuildAchievementFlags(tags) {
  if (tags.includes('nightmareGlassCannon')) {
    gameState.stats.hasNightmareGlassCannonWin = true;
  }
  if (tags.includes('nightmareStableDog')) {
    gameState.stats.hasNightmareStableWin = true;
  }
}

function enqueueAchievementToast(achievement) {
  gameState.achievementToastQueue.push(achievement);
  if (gameState.achievementToastTimer) {
    return;
  }
  showNextAchievementToast();
}

function showNextAchievementToast() {
  if (!el.achievementToast) {
    gameState.achievementToastQueue = [];
    gameState.achievementToastTimer = null;
    return;
  }

  const next = gameState.achievementToastQueue.shift();
  if (!next) {
    el.achievementToast.classList.remove('is-visible');
    gameState.achievementToastTimer = null;
    return;
  }

  el.achievementToast.innerHTML = `
    <strong>成就达成：${next.name}</strong>
    <span>${next.flavor || next.description}</span>
  `;
  el.achievementToast.classList.add('is-visible');

  gameState.achievementToastTimer = setTimeout(() => {
    el.achievementToast.classList.remove('is-visible');
    gameState.achievementToastTimer = setTimeout(() => {
      gameState.achievementToastTimer = null;
      showNextAchievementToast();
    }, 180);
  }, 2400);
}

function completeAchievement(achievement, options = {}) {
  if (!achievement || hasCompletedAchievement(achievement.id)) {
    return false;
  }

  const completedAt = new Date().toISOString();
  gameState.achievements.completed[achievement.id] = completedAt;
  gameState.achievements.lastUnlocked = [
    achievement.id,
    ...gameState.achievements.lastUnlocked.filter((id) => id !== achievement.id),
  ].slice(0, 8);

  if (!options.silent) {
    addLog(`成就达成：${achievement.name}`);
    enqueueAchievementToast(achievement);
    if (typeof trackRaceEvent === 'function') {
      trackRaceEvent('lab_race_achievement_unlock', {
        achievementId: achievement.id,
        category: achievement.category,
        source: typeof options.source === 'string' ? options.source : 'unknown',
        version: GAME_VERSION,
      });
    }
  }

  return true;
}

function unlockAchievementById(id, options = {}) {
  const achievement = getAchievementById(id);
  if (!achievement) {
    return false;
  }

  const unlocked = completeAchievement(achievement, options);

  if (unlocked) {
    autoSaveGame();
  }

  renderProfile();
  return unlocked;
}

// 成就条件集中映射，避免把具体判定散落在比赛、商店和渲染代码里。
function checkAchievementCondition(achievement) {
  const stats = gameState.stats;

  switch (achievement.check) {
    case 'firstRace':
      return stats.totalRaces >= 1;
    case 'firstWin':
      return stats.totalWins >= 1;
    case 'firstPart':
      return gameState.inventory.length >= 1;
    case 'firstEquip':
      return EQUIPMENT_SLOTS.some((type) => Boolean(gameState.equippedParts[type]));
    case 'fullSlots':
      return stats.hasFilledAllSlots || isAllSlotsFilled();
    case 'firstMythicUpgrade':
      return hasAnyMythicUpgradeAtLeast(1);
    case 'harukawaCatSticker':
      return false;
    case 'anyMythicUpgradeMaxed':
      return hasAnyMythicUpgradeAtLeast(MYTHIC_UPGRADE_MAX_LEVEL);
    case 'allMythicTemplatesUpgradeMaxed':
      return isAllMythicTemplatesUpgradeMaxed();
    case 'normalWin':
      return (stats.winsByDifficulty.normal || 0) >= 1;
    case 'hardWin':
      return (stats.winsByDifficulty.hard || 0) >= 1;
    case 'expertWin':
      return (stats.winsByDifficulty.expert || 0) >= 1;
    case 'nightmareWin':
      return (stats.winsByDifficulty.nightmare || 0) >= 1;
    case 'nightmareStreak3':
      return (stats.bestStreakByDifficulty.nightmare || 0) >= 3;
    case 'win10':
      return stats.totalWins >= 10;
    case 'race30':
      return stats.totalRaces >= 30;
    case 'cash5000':
      return stats.highestCash >= 5000;
    case 'cash20000':
      return stats.highestCash >= 20000;
    case 'streak3':
      return stats.bestStreak >= 3;
    case 'streak5':
      return stats.bestStreak >= 5;
    case 'hpBeliever':
      return stats.wonWithBuildAchievements.includes('hpBeliever');
    case 'stableDriver':
      return stats.wonWithBuildAchievements.includes('stableDriver');
    case 'xueWrenchWin':
      return stats.wonWithSpecialParts.includes('gearbox_xue_wrench');
    case 'xiaoyuSponsorWin':
      return stats.wonWithSpecialParts.includes('stability_xiaoyu_sponsor');
    case 'brokeEntryAttempt':
      return false;
    case 'lianlianLowPowerFuelPack':
      return false;
    case 'falseStartHotTofu':
      return stats.falseStartCount >= 1;
    case 'falseStartCount10':
      return stats.falseStartCount >= 10;
    case 'falseStartStreak3':
      return stats.falseStartStreak >= 3;
    case 'neuralLinkReaction':
      return (
        gameState.bestManualReactionTime !== null &&
        gameState.bestManualReactionTime <= NEURAL_LINK_REACTION_SECONDS
      );
    case 'sleepyStartReaction':
      return (
        gameState.lastManualReactionTime !== null &&
        gameState.lastManualReactionTime >= SLEEPY_START_REACTION_SECONDS
      );
    case 'lowCashAfterRace':
      return Boolean(stats.hasLowCashAfterRace);
    case 'partsPurchased10':
      return stats.partsPurchasedCount >= 10;
    case 'racingEnthusiast50Races':
      return stats.totalRaces >= 50;
    case 'fiveFifthPlaces':
      return stats.fifthPlaceStreak >= 5;
    case 'lastPlaceFinish':
      return Boolean(stats.hasFinishedLast);
    case 'nightmareSlowReactionWin':
      return Boolean(stats.hasNightmareSlowReactionWin);
    case 'nightmareGlassCannonWin':
      return Boolean(stats.hasNightmareGlassCannonWin);
    case 'nightmareStableWin':
      return Boolean(stats.hasNightmareStableWin);
    case 'engineerSmile':
      return stats.hasFilledAllSlots || isAllSlotsFilled();
    case 'totalRaces100':
      return stats.totalRaces >= 100;
    case 'nightmareGraduate':
      return (stats.winsByDifficulty.nightmare || 0) >= 1;
    case 'tenSecondPlaces':
      return stats.secondPlaceStreak >= 10 || Boolean(stats.hasWonAfterSecondPlaceStreak);
    case 'comebackAfterSecondPlaces':
      return Boolean(stats.hasWonAfterSecondPlaceStreak);
    default:
      return false;
  }
}

function checkAchievements(options = {}) {
  syncProgressStats();
  const unlocked = [];

  ACHIEVEMENTS.forEach((achievement) => {
    if (hasCompletedAchievement(achievement.id)) {
      return;
    }
    if (!checkAchievementCondition(achievement)) {
      return;
    }
    if (completeAchievement(achievement, options)) {
      unlocked.push(achievement.id);
    }
  });

  if (unlocked.length && !options.silent) {
    autoSaveGame();
  }
  renderProfile();
  return unlocked;
}

// 档案页渲染只展示成就状态，不在这里触发新的解锁逻辑。
function renderAchievements() {
  if (!el.achievementsBody) {
    return;
  }

  el.achievementsBody.innerHTML = '';

  ACHIEVEMENTS.forEach((achievement) => {
    const completedAt = gameState.achievements.completed[achievement.id];
    const completed = Boolean(completedAt);
    const hidden = Boolean(achievement.hidden && !completed);
    const card = document.createElement('article');
    card.className = `achievement-card${completed ? ' is-complete' : ' is-incomplete'}${
      hidden ? ' is-hidden' : ''
    }`;
    card.innerHTML = `
      <div class="achievement-head">
        <strong>${hidden ? '？？？' : achievement.name}</strong>
        <span>${achievement.category}</span>
      </div>
      <p>${hidden ? '达成某个奇怪条件后解锁。' : achievement.description}</p>
      <small>${completed ? `已完成 · ${formatDateTime(completedAt)}` : '未完成'}</small>
    `;
    el.achievementsBody.appendChild(card);
  });
}

function renderProfile() {
  syncProgressStats();
  const ownedTemplates = Object.keys(getOwnedPartCounts()).length;
  const totalTemplates = PART_POOL.length;

  if (el.achievementsCountText) {
    el.achievementsCountText.textContent = `已完成 ${getCompletedAchievementCount()} / ${ACHIEVEMENTS.length}`;
  }
  if (el.statsTotalRaces) {
    el.statsTotalRaces.textContent = String(gameState.stats.totalRaces);
  }
  if (el.statsPracticeRaces) {
    el.statsPracticeRaces.textContent = String(gameState.stats.practiceRaces || 0);
  }
  if (el.statsTotalWins) {
    el.statsTotalWins.textContent = String(gameState.stats.totalWins);
  }
  if (el.statsTotalLosses) {
    el.statsTotalLosses.textContent = String(gameState.stats.totalLosses);
  }
  if (el.statsCurrentStreak) {
    el.statsCurrentStreak.textContent = String(gameState.stats.currentStreak);
  }
  if (el.statsBestStreak) {
    el.statsBestStreak.textContent = String(gameState.stats.bestStreak);
  }
  if (el.statsDifficultyWins) {
    el.statsDifficultyWins.textContent = formatDifficultyStatMap(gameState.stats.winsByDifficulty);
  }
  if (el.statsDifficultyBestStreaks) {
    el.statsDifficultyBestStreaks.textContent = formatDifficultyStatMap(
      gameState.stats.bestStreakByDifficulty
    );
  }
  if (el.statsHighestCash) {
    el.statsHighestCash.textContent = `${gameState.stats.highestCash} 元`;
  }
  if (el.statsCollectionProgress) {
    el.statsCollectionProgress.textContent = `已收集 ${ownedTemplates} / ${totalTemplates} 件`;
  }

  renderAchievements();
}
