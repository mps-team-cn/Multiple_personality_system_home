'use strict';

/*
 * 核心工具和渲染更新模块。
 * 这里连接配置、状态、持久化清洗和页面刷新，是其它业务模块的公共依赖。
 */

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function pickRandomItems(pool, count) {
  const copy = pool.slice();
  const picked = [];

  while (picked.length < count && copy.length > 0) {
    const index = Math.floor(Math.random() * copy.length);
    picked.push(copy.splice(index, 1)[0]);
  }

  return picked;
}

function formatPartType(type) {
  return PART_TYPE_LABELS[type] || type;
}

function normalizeRarity(rarity) {
  if (PART_RARITY_LABELS[rarity]) {
    return rarity;
  }
  if (PART_RARITY_MIGRATIONS[rarity]) {
    return PART_RARITY_MIGRATIONS[rarity];
  }
  return 'common';
}

function getPartRarity(part) {
  return normalizeRarity(part && part.rarity);
}

function formatPartRarity(part) {
  return PART_RARITY_LABELS[getPartRarity(part)];
}

function renderPartRarity(part) {
  const rarity = getPartRarity(part);
  return `<span class="part-badge part-quality part-quality-${rarity}">${PART_RARITY_LABELS[rarity]}</span>`;
}

function getPartLevel(part) {
  const level = PART_RARITY_ORDER.indexOf(getPartRarity(part)) + 1;
  return level > 0 ? level : 1;
}

function formatPartLevel(part) {
  return `Lv.${getPartLevel(part)}`;
}

function renderPartLevel(part) {
  const rarity = getPartRarity(part);
  return `<span class="part-level part-level-${rarity}">${formatPartLevel(part)}</span>`;
}

function renderPartBadges(part) {
  return `<span class="part-meta-badges">${renderPartRarity(part)}${renderPartLevel(part)}</span>`;
}

function renderPartInlineLabel(part, includeId = false) {
  return `${renderPartName(part, includeId)} ${renderPartLevel(part)}`;
}

function getPartRarityFrameClass(part) {
  return `part-rarity-frame part-rarity-frame-${getPartRarity(part)}`;
}

function renderPartName(part, includeId = false) {
  const rarity = getPartRarity(part);
  const name = formatPartNameWithUpgrade(part);
  const label = includeId ? `#${part.id} ${name}` : name;
  return `<span class="part-quality part-quality-${rarity}">${label}</span>`;
}

function renderPartOptionLabel(part, equippedPart = null) {
  const rarity = getPartRarity(part);
  return `<span class="part-quality part-quality-${rarity}">${formatPartOption(part, equippedPart)}</span>`;
}

function isMythicPart(part) {
  return Boolean(part && getPartRarity(part) === 'mythic');
}

function normalizeMythicUpgradeLevel(level) {
  return clamp(Math.floor(Number(level) || 0), 0, MYTHIC_UPGRADE_MAX_LEVEL);
}

function getMythicUpgradeLevel(partId) {
  if (!gameState.mythicUpgrades || typeof gameState.mythicUpgrades !== 'object') {
    return 0;
  }

  return normalizeMythicUpgradeLevel(gameState.mythicUpgrades[String(partId)]);
}

function getPartMythicUpgradeLevel(part) {
  return isMythicPart(part) && part && part.id ? getMythicUpgradeLevel(part.id) : 0;
}

function formatPartNameWithUpgrade(part) {
  if (!part) {
    return '';
  }

  const level = getPartMythicUpgradeLevel(part);
  return level > 0 ? `${part.name} +${level}` : part.name;
}

function getMythicUpgradeCost(part, level) {
  const currentLevel = normalizeMythicUpgradeLevel(level);
  const baseCost = Math.max(1800, Math.round((Number(part && part.price) || 0) * 0.4));
  return Math.round(baseCost * (1 + currentLevel * 0.45));
}

function getMythicUpgradeSuccessRate(level) {
  const currentLevel = normalizeMythicUpgradeLevel(level);
  return MYTHIC_UPGRADE_SUCCESS_RATES[currentLevel] ?? 0.25;
}

function formatMythicUpgradeSuccessRate(level) {
  return `${Math.round(getMythicUpgradeSuccessRate(level) * 100)}%`;
}

function applyMythicUpgradeBonus(part, upgradeLevel) {
  const level = normalizeMythicUpgradeLevel(upgradeLevel);
  if (!part || !isMythicPart(part) || level <= 0) {
    return part;
  }

  const multiplier = 1 + level * MYTHIC_UPGRADE_BONUS_PER_LEVEL;
  const upgraded = {
    ...part,
    changes: { ...(part.changes || {}) },
  };

  MYTHIC_UPGRADE_STAT_KEYS.forEach((key) => {
    const value = Number(upgraded.changes[key]);
    if (Number.isFinite(value) && value > 0) {
      upgraded.changes[key] = Math.round(value * multiplier);
    }
  });

  return upgraded;
}

function getEffectivePart(part) {
  return applyMythicUpgradeBonus(part, getPartMythicUpgradeLevel(part));
}

function getEffectivePartChanges(part) {
  const effectivePart = getEffectivePart(part);
  return effectivePart && effectivePart.changes ? effectivePart.changes : {};
}

function getPartStatValue(part, key) {
  const changes = getEffectivePartChanges(part);
  return Number((changes && changes[key]) || 0);
}

function getPartComparisonChanges(part, equippedPart) {
  return PART_STAT_ORDER.reduce((changes, key) => {
    const value =
      getPartStatValue(part, key) - (equippedPart ? getPartStatValue(equippedPart, key) : 0);

    if (value !== 0) {
      changes[key] = value;
    }

    return changes;
  }, {});
}

function getPartChangeTone(key, value) {
  if (value === 0) {
    return 'neutral';
  }

  if (key === 'weight') {
    return value < 0 ? 'good' : 'bad';
  }

  return value > 0 ? 'good' : 'bad';
}

function formatSignedPartChange(key, value) {
  const sign = value > 0 ? '+' : '';
  const unit = key === 'weight' ? 'kg' : '';
  return `${PART_STAT_LABELS[key] || key} ${sign}${value}${unit}`;
}

function formatPartChangeText(changes) {
  const items = PART_STAT_ORDER.filter((key) => changes[key]).map((key) =>
    formatSignedPartChange(key, changes[key])
  );

  return items.length > 0 ? items.join('，') : '属性无变化';
}

function renderPartChangeList(changes) {
  const items = PART_STAT_ORDER.filter((key) => changes[key]).reduce(
    (groups, key) => {
      const value = changes[key];
      const tone = getPartChangeTone(key, value);
      const item = `<span class="part-change part-change-${tone}">${formatSignedPartChange(
        key,
        value
      )}</span>`;

      groups[tone].push(item);
      return groups;
    },
    { good: [], bad: [], neutral: [] }
  );

  if (!items.good.length && !items.bad.length && !items.neutral.length) {
    return '<span class="part-change part-change-neutral">属性无变化</span>';
  }

  return `
    <div class="part-change-groups">
      ${
        items.good.length
          ? `<div class="part-change-group"><span>增益</span><div class="part-change-list">${items.good.join(
              ''
            )}</div></div>`
          : ''
      }
      ${
        items.bad.length
          ? `<div class="part-change-group"><span>代价</span><div class="part-change-list">${items.bad.join(
              ''
            )}</div></div>`
          : ''
      }
      ${
        items.neutral.length
          ? `<div class="part-change-group"><span>其它</span><div class="part-change-list">${items.neutral.join(
              ''
            )}</div></div>`
          : ''
      }
    </div>
  `;
}

function renderPartChangeTags(changes, emptyText = '属性无变化') {
  const items = PART_STAT_ORDER.filter((key) => changes[key]).map((key) => {
    const value = changes[key];
    const tone = getPartChangeTone(key, value);
    return `<span class="part-change part-change-${tone}">${formatSignedPartChange(
      key,
      value
    )}</span>`;
  });

  if (!items.length) {
    return `
      <div class="part-change-list part-change-list-compact">
        <span class="part-change part-change-neutral">${emptyText}</span>
      </div>
    `;
  }

  return `<div class="part-change-list part-change-list-compact">${items.join('')}</div>`;
}

function renderPartComparison(part, equippedPart) {
  const isCurrent = equippedPart && equippedPart.id === part.id;
  const referencePart = isCurrent ? null : equippedPart;
  const label = isCurrent ? '当前效果' : equippedPart ? '相对当前' : '自身效果';
  const changes = getPartComparisonChanges(part, referencePart);

  return `
    <div class="part-compare">
      <small class="part-compare-label">${label}</small>
      ${renderPartChangeList(changes)}
    </div>
  `;
}

function formatPartOption(part, equippedPart = null) {
  if (equippedPart && equippedPart.id === part.id) {
    return `[${formatPartRarity(part)} ${formatPartLevel(part)}] #${part.id} ${part.name}（当前已装备）`;
  }

  return `[${formatPartRarity(part)} ${formatPartLevel(part)}] #${part.id} ${part.name}（${formatPartChangeText(
    getPartComparisonChanges(part, equippedPart)
  )}）`;
}

// 比赛层级只用于展示，不影响难度公式；实际强度由 RaceFormulaUtils 计算。
function getRaceTier() {
  return (
    RACE_TIERS.slice()
      .reverse()
      .find((tier) => gameState.raceCount >= tier.minRaceCount) || RACE_TIERS[0]
  );
}

function getDifficultyKey() {
  return DIFFICULTIES[gameState.difficulty] ? gameState.difficulty : DEFAULT_DIFFICULTY;
}

function getDifficulty() {
  return DIFFICULTIES[getDifficultyKey()];
}

function isNightmareDifficulty(key = getDifficultyKey()) {
  return key === 'nightmare';
}

function formatOpponentStrengthCap(config) {
  return Number.isFinite(config && config.maxOpponentStrength)
    ? config.maxOpponentStrength.toFixed(2)
    : '∞';
}

function formatDifficultyMeta(key) {
  const config = DIFFICULTIES[key] || DIFFICULTIES[DEFAULT_DIFFICULTY];
  const floorText = Number.isFinite(config.minOpponentStrength)
    ? ` · 下限${config.minOpponentStrength.toFixed(2)}`
    : '';
  return `报名${getDifficultyEntryFee(key)}元 · 奖金×${config.rewardMultiplier} · 强度×${config.opponentMultiplier}${floorText} · 上限${formatOpponentStrengthCap(config)}`;
}

// 报名费按当前难度倍率缩放，向上取整到 10 元。
function getEntryFee() {
  return getDifficultyEntryFee(getDifficultyKey());
}

// 指定难度的报名费（用于按钮对比展示）。
function getDifficultyEntryFee(key) {
  const config = DIFFICULTIES[key] || DIFFICULTIES[DEFAULT_DIFFICULTY];
  const multiplier = (config && config.entryFeeMultiplier) || 1;
  return Math.round((ENTRY_FEE * multiplier) / 10) * 10;
}

// 全难度最低报名费：判定真正失败用最低值，避免高难度报名费把可降难度的进度误判为失败。
function getMinEntryFee() {
  return Math.min(...DIFFICULTY_ORDER.map((key) => getDifficultyEntryFee(key)));
}

function getMinEntryDifficultyKey() {
  return DIFFICULTY_ORDER.reduce((minKey, key) => {
    return getDifficultyEntryFee(key) < getDifficultyEntryFee(minKey) ? key : minKey;
  }, DIFFICULTY_ORDER[0] || DEFAULT_DIFFICULTY);
}

function getCurrentLootPool() {
  return LOOT_POOLS[getDifficultyKey()] || LOOT_POOLS[DEFAULT_DIFFICULTY];
}

// 当前难度商店基础出现率：仅由 LOOT_POOLS + PART_RARITY_WEIGHTS 决定，
// 不参与 dropRateMultiplier，也不包含“已拥有零件降权”影响。
function getRarityShopRate(rarity) {
  const pool = getCurrentLootPool();
  if (!pool.includes(rarity)) {
    return 0;
  }
  const totalWeight = pool.reduce((sum, key) => sum + (PART_RARITY_WEIGHTS[key] || 0), 0);
  if (totalWeight <= 0) {
    return 0;
  }
  return ((PART_RARITY_WEIGHTS[rarity] || 0) / totalWeight) * 100;
}

// 单件商店基础出现率 = 该稀有度出现率 / 当前池内同稀有度零件数。
function getPartShopRate(part) {
  const rarity = getPartRarity(part);
  const pool = getCurrentLootPool();
  if (!pool.includes(rarity)) {
    return 0;
  }
  const sameRarityCount = PART_POOL.filter((item) => getPartRarity(item) === rarity).length;
  if (sameRarityCount <= 0) {
    return 0;
  }
  return getRarityShopRate(rarity) / sameRarityCount;
}

function formatShopRate(rate) {
  if (rate <= 0) {
    return '0%';
  }
  if (rate < 0.1) {
    return '<0.1%';
  }
  return `${rate.toFixed(rate < 1 ? 2 : 1)}%`;
}

function formatReactionControlSuffix(control) {
  return control === 'ai' ? '（AI托管）' : '';
}

function formatReactionTime(reactionTime, control = null) {
  return reactionTime === null
    ? '--'
    : `${reactionTime.toFixed(3)} 秒${formatReactionControlSuffix(control)}`;
}

function formatCompactReactionTime(reactionTime, control = null) {
  return reactionTime === null
    ? '--'
    : `${reactionTime.toFixed(3)}s${formatReactionControlSuffix(control)}`;
}

function formatReactionRecordText(bestReactionTime, lastReactionTime, lastReactionControl = null) {
  return `${formatReactionTime(bestReactionTime)} / ${formatReactionTime(
    lastReactionTime,
    lastReactionControl
  )}`;
}

function formatWinStreakText(currentWinStreak, bestWinStreak) {
  return `当前 ${currentWinStreak} / 最高 ${bestWinStreak}`;
}

function isAiRace(race) {
  return Boolean(race && race.controlledBy === 'ai');
}

function isManualRace(race) {
  return Boolean(race && race.controlledBy === 'manual');
}

function getActiveRaceType() {
  return gameState.activeRaceType === 'practice' ? 'practice' : 'standard';
}

function isPracticeRace(race = null) {
  if (race) {
    return race.raceType === 'practice';
  }
  return getActiveRaceType() === 'practice';
}

function isFormalRace(race = null) {
  return !isPracticeRace(race);
}

function getPracticePrize(playerRank) {
  const rankIndex = Math.max(0, Math.min(PRACTICE_PRIZE_RATES.length - 1, playerRank - 1));
  return Math.floor(getMinEntryFee() * PRACTICE_PRIZE_RATES[rankIndex]);
}

function canRecoverWithPractice() {
  return gameState.cash < getMinEntryFee();
}

function canStartPracticeRace() {
  return (
    canRecoverWithPractice() &&
    gameState.phase === 'idle' &&
    !isRaceLockedPhase(gameState.phase) &&
    gameState.phase !== 'game_over'
  );
}

function getLossStreakReliefConfig() {
  const config = LOSS_STREAK_RELIEF[getDifficultyKey()];
  if (!config || gameState.currentLoseStreak < config.threshold) {
    return null;
  }
  return config;
}

function normalizeReactionTime(value) {
  const reactionTime = Number(value);
  return Number.isFinite(reactionTime) && reactionTime >= MIN_MANUAL_REACTION_SECONDS
    ? reactionTime
    : null;
}

function normalizeManualReactionTime(value) {
  return normalizeReactionTime(value);
}

function getCurrentRaceControl() {
  return gameState.raceControl === 'ai' ? 'ai' : 'manual';
}

function getAiAssistDescription() {
  return '模拟人类反应自动跑完本场，保留动画；托管比赛不会解锁反应、连胜等操作类成就。';
}

function resetRaceControlState(options = {}) {
  gameState.raceControl = 'manual';
  gameState.aiAssist = createDefaultAiAssistState();
  gameState.aiAssistLocked = false;
  if (!options.preserveLastRaceControl) {
    gameState.lastRaceControl = null;
  }
}

function formatRaceRoundText(raceCount) {
  return raceCount > 0 ? `第 ${raceCount} 场比赛` : '尚未参赛';
}

function formatLastRankReportText(lastRank) {
  if (!lastRank || lastRank === '-') {
    return '等待报名';
  }
  if (lastRank === '第 1 名') {
    return '上场冠军';
  }
  return `上场${lastRank}`;
}

function setDifficulty(key) {
  if (!DIFFICULTIES[key]) {
    return;
  }
  if (isRaceLockedPhase(gameState.phase) || gameState.phase === 'game_over') {
    return;
  }
  if (gameState.difficulty === key) {
    return;
  }

  gameState.difficulty = key;
  addLog(`难度切换为「${DIFFICULTIES[key].name}」。`);
  renderDifficulty();
  renderAtlas();
  updateStats();
  autoSaveGame();
}

function openDifficultyModal() {
  if (!el.difficultyModal) {
    return;
  }
  if (isRaceLockedPhase(gameState.phase) || gameState.phase === 'game_over') {
    return;
  }
  el.difficultyModal.hidden = false;
}

function closeDifficultyModal() {
  if (el.difficultyModal) {
    el.difficultyModal.hidden = true;
  }
}

function isModalOpen(node) {
  return Boolean(node && !node.hidden);
}

function isAnyModalOpen() {
  return isModalOpen(el.difficultyModal) || isModalOpen(el.noticeModal);
}

function openNoticeModal(title, message, options = {}) {
  if (!el.noticeModal) {
    return;
  }

  gameState.noticeModalConfig = {
    showCancel: Boolean(options.showCancel),
    confirmText: options.confirmText || '确定',
    cancelText: options.cancelText || '取消',
    onConfirm: typeof options.onConfirm === 'function' ? options.onConfirm : null,
    onCancel: typeof options.onCancel === 'function' ? options.onCancel : null,
  };

  if (el.noticeModalTitle) {
    el.noticeModalTitle.textContent = title || '提示';
  }

  if (el.noticeModalMessage) {
    el.noticeModalMessage.textContent = message || '';
  }

  if (el.noticeModalCancelBtn) {
    el.noticeModalCancelBtn.hidden = !gameState.noticeModalConfig.showCancel;
    el.noticeModalCancelBtn.textContent = gameState.noticeModalConfig.cancelText;
  }

  if (el.noticeModalConfirmBtn) {
    el.noticeModalConfirmBtn.textContent = gameState.noticeModalConfig.confirmText;
  }

  el.noticeModal.hidden = false;

  const focusTarget =
    gameState.noticeModalConfig.showCancel && el.noticeModalCancelBtn
      ? el.noticeModalCancelBtn
      : el.noticeModalConfirmBtn;

  if (focusTarget) {
    requestAnimationFrame(() => {
      focusTarget.focus();
    });
  }
}

function closeNoticeModal(action = 'cancel') {
  const noticeModalConfig = gameState.noticeModalConfig || null;
  gameState.noticeModalConfig = null;

  if (el.noticeModal) {
    el.noticeModal.hidden = true;
  }

  if (el.noticeModalCancelBtn) {
    el.noticeModalCancelBtn.hidden = true;
    el.noticeModalCancelBtn.textContent = '取消';
  }

  if (el.noticeModalConfirmBtn) {
    el.noticeModalConfirmBtn.textContent = '确定';
  }

  if (action === 'confirm' && noticeModalConfig && noticeModalConfig.onConfirm) {
    noticeModalConfig.onConfirm();
    return;
  }

  if (action !== 'confirm' && noticeModalConfig && noticeModalConfig.onCancel) {
    noticeModalConfig.onCancel();
  }
}

function getPartById(partId) {
  return gameState.inventory.find((part) => part.id === partId) || null;
}

function getEquippedPart(type) {
  const partId = gameState.equippedParts[type];
  return partId ? getPartById(partId) : null;
}

function recalculatePlayerStats() {
  const totals = { ...BASE_PLAYER_STATS };

  EQUIPMENT_SLOTS.forEach((type) => {
    const part = getEquippedPart(type);
    if (!part) {
      return;
    }

    const changes = getEffectivePartChanges(part);
    Object.keys(changes).forEach((key) => {
      totals[key] += changes[key];
    });
  });

  totals.stability = clamp(totals.stability, 1, 80);
  totals.weight = clamp(totals.weight, 760, 1250);
  gameState.player = totals;
}

function createOwnedPart(part) {
  return {
    ...part,
    id: gameState.nextPartId++,
  };
}

function getPartSellPrice(part) {
  return Math.floor(part.price * PART_SELL_RATE);
}

function isSamePart(part, ownedPart) {
  return part.name === ownedPart.name && part.type === ownedPart.type;
}

function hasOwnedPart(part) {
  return gameState.inventory.some((ownedPart) => isSamePart(part, ownedPart));
}

function getPartTemplate(part) {
  if (!part) {
    return null;
  }
  if (part.templateId && PART_POOL_BY_TEMPLATE_ID[part.templateId]) {
    return PART_POOL_BY_TEMPLATE_ID[part.templateId];
  }
  return (
    PART_POOL.find(
      (candidate) =>
        candidate.type === part.type &&
        candidate.name === part.name &&
        candidate.price === part.price &&
        getPartRarity(candidate) === getPartRarity(part)
    ) ||
    PART_POOL.find((candidate) => candidate.type === part.type && candidate.name === part.name) ||
    null
  );
}

function getPartTemplateId(part) {
  const template = getPartTemplate(part);
  if (template) {
    return template.templateId;
  }
  if (part && part.templateId) {
    return part.templateId;
  }
  return part ? createPartTemplateId(part) : '';
}

function getOwnedPartCounts() {
  return gameState.inventory.reduce((counts, part) => {
    const templateId = getPartTemplateId(part);
    if (!templateId) {
      return counts;
    }
    counts[templateId] = (counts[templateId] || 0) + 1;
    return counts;
  }, {});
}

function isAllSlotsFilled() {
  return EQUIPMENT_SLOTS.every((type) => Boolean(gameState.equippedParts[type]));
}

function hasAnyMythicUpgradeAtLeast(level) {
  const targetLevel = normalizeMythicUpgradeLevel(level);
  return gameState.inventory.some(
    (part) => isMythicPart(part) && getMythicUpgradeLevel(part.id) >= targetLevel
  );
}

function isAllEquippedMythicUpgradeMaxed() {
  return EQUIPMENT_SLOTS.every((type) => {
    const part = getEquippedPart(type);
    return isMythicPart(part) && getMythicUpgradeLevel(part.id) >= MYTHIC_UPGRADE_MAX_LEVEL;
  });
}

function formatDateTime(value) {
  if (!value) {
    return '--';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatDifficultyStatMap(values) {
  return DIFFICULTY_ORDER.map((key) => `${DIFFICULTIES[key].name} ${values[key] || 0}`).join(' / ');
}

function normalizeDifficultyStatMap(source) {
  const next = createDifficultyStatsMap();
  const raw = source && typeof source === 'object' ? source : {};
  DIFFICULTY_ORDER.forEach((key) => {
    next[key] = Math.max(0, Math.floor(Number(raw[key]) || 0));
  });
  return next;
}

function estimateMigratedTotalWins(data, totalRaces) {
  const inferredWin = String(data.lastRank || '-') === '第 1 名' ? 1 : 0;
  const streakFloor = Math.max(
    0,
    Math.floor(Number(data.bestWinStreak) || 0),
    Math.floor(Number(data.currentWinStreak) || 0),
    inferredWin
  );
  return Math.min(totalRaces, streakFloor);
}

// 旧存档字段可能缺失或含有历史格式，所有统计值都在这里归一化。
function sanitizeStatsData(data, fallback = {}) {
  const totalRaces = Math.max(
    0,
    Math.floor(Number((data && data.totalRaces) ?? fallback.totalRaces) || 0)
  );
  const totalWins = Math.max(
    0,
    Math.floor(Number((data && data.totalWins) ?? fallback.totalWins) || 0)
  );
  const totalLosses = Math.max(
    0,
    Math.floor(Number((data && data.totalLosses) ?? fallback.totalLosses) || 0)
  );
  const currentStreak = Math.max(
    0,
    Math.floor(Number((data && data.currentStreak) ?? fallback.currentStreak) || 0)
  );
  const bestStreak = Math.max(
    currentStreak,
    Math.floor(Number((data && data.bestStreak) ?? fallback.bestStreak) || 0)
  );
  const falseStartCount = Math.max(
    0,
    Math.floor(Number((data && data.falseStartCount) ?? fallback.falseStartCount) || 0)
  );
  const falseStartStreak = Math.max(
    0,
    Math.floor(Number((data && data.falseStartStreak) ?? fallback.falseStartStreak) || 0)
  );
  const secondPlaceStreak = Math.max(
    0,
    Math.floor(Number((data && data.secondPlaceStreak) ?? fallback.secondPlaceStreak) || 0)
  );
  const fifthPlaceStreak = Math.max(
    0,
    Math.floor(Number((data && data.fifthPlaceStreak) ?? fallback.fifthPlaceStreak) || 0)
  );
  const practiceRaces = Math.max(
    0,
    Math.floor(Number((data && data.practiceRaces) ?? fallback.practiceRaces) || 0)
  );
  const partsPurchasedCount = Math.max(
    0,
    Math.floor(Number((data && data.partsPurchasedCount) ?? fallback.partsPurchasedCount) || 0)
  );
  const highestCash = Math.max(
    0,
    Math.floor(Number((data && data.highestCash) ?? fallback.highestCash) || 0)
  );
  const winsByDifficulty = normalizeDifficultyStatMap(
    (data && data.winsByDifficulty) || fallback.winsByDifficulty
  );
  const bestStreakByDifficulty = normalizeDifficultyStatMap(
    (data && data.bestStreakByDifficulty) || fallback.bestStreakByDifficulty
  );
  DIFFICULTY_ORDER.forEach((key) => {
    bestStreakByDifficulty[key] = Math.min(bestStreakByDifficulty[key], winsByDifficulty[key]);
  });
  const wonWithBuildAchievements = Array.isArray(data && data.wonWithBuildAchievements)
    ? Array.from(
        new Set(
          data.wonWithBuildAchievements.map((value) => String(value || '').trim()).filter(Boolean)
        )
      )
    : Array.isArray(fallback.wonWithBuildAchievements)
      ? Array.from(new Set(fallback.wonWithBuildAchievements))
      : [];
  const wonWithSpecialParts = Array.isArray(data && data.wonWithSpecialParts)
    ? Array.from(
        new Set(data.wonWithSpecialParts.map((value) => String(value || '').trim()).filter(Boolean))
      )
    : Array.isArray(fallback.wonWithSpecialParts)
      ? Array.from(new Set(fallback.wonWithSpecialParts))
      : [];

  return {
    totalRaces,
    totalWins: Math.min(totalRaces, totalWins),
    totalLosses: Math.min(totalRaces, totalLosses),
    currentStreak,
    bestStreak,
    falseStartCount,
    falseStartStreak,
    secondPlaceStreak,
    fifthPlaceStreak,
    practiceRaces,
    partsPurchasedCount,
    highestCash,
    winsByDifficulty,
    bestStreakByDifficulty,
    hasFilledAllSlots: Boolean((data && data.hasFilledAllSlots) ?? fallback.hasFilledAllSlots),
    hasLowCashAfterRace: Boolean(
      (data && data.hasLowCashAfterRace) ?? fallback.hasLowCashAfterRace
    ),
    hasFinishedLast: Boolean((data && data.hasFinishedLast) ?? fallback.hasFinishedLast),
    hasNightmareSlowReactionWin: Boolean(
      (data && data.hasNightmareSlowReactionWin) ?? fallback.hasNightmareSlowReactionWin
    ),
    hasNightmareGlassCannonWin: Boolean(
      (data && data.hasNightmareGlassCannonWin) ?? fallback.hasNightmareGlassCannonWin
    ),
    hasNightmareStableWin: Boolean(
      (data && data.hasNightmareStableWin) ?? fallback.hasNightmareStableWin
    ),
    hasWonAfterSecondPlaceStreak: Boolean(
      (data && data.hasWonAfterSecondPlaceStreak) ?? fallback.hasWonAfterSecondPlaceStreak
    ),
    wonWithBuildAchievements,
    wonWithSpecialParts,
  };
}

function sanitizeAchievementsData(data) {
  const completed = {};
  const rawCompleted = data && typeof data.completed === 'object' ? data.completed : {};

  ACHIEVEMENTS.forEach((achievement) => {
    const completedAt = rawCompleted[achievement.id];
    if (typeof completedAt === 'string' && completedAt.trim()) {
      completed[achievement.id] = completedAt;
    }
  });

  const lastUnlocked = Array.isArray(data && data.lastUnlocked)
    ? data.lastUnlocked
        .map((value) => String(value || '').trim())
        .filter((value) => Boolean(completed[value]))
        .slice(0, 8)
    : [];

  return {
    completed,
    lastUnlocked,
  };
}

function sanitizeAiAssistData(data) {
  const reactionTime = Number(data && data.reactionTime);
  const normalizedReactionTime =
    Number.isFinite(reactionTime) && reactionTime >= 0 ? reactionTime : null;

  return {
    active: Boolean(data && data.active && normalizedReactionTime !== null),
    reactionTime: normalizedReactionTime,
  };
}

function sanitizeManualRankStreakData(data) {
  const rank = Math.max(1, Math.floor(Number(data && data.rank) || 0));
  const count = Math.max(0, Math.floor(Number(data && data.count) || 0));

  if (rank > PRIZES.length || count <= 0) {
    return createDefaultManualRankStreak();
  }

  return {
    rank,
    count,
  };
}

function sanitizeManualDifficultyWinStreakData(data) {
  const difficultyKey = data && DIFFICULTIES[data.difficultyKey] ? data.difficultyKey : null;
  const count = Math.max(0, Math.floor(Number(data && data.count) || 0));

  if (!difficultyKey || count <= 0) {
    return createDefaultManualDifficultyWinStreak();
  }

  return {
    difficultyKey,
    count,
  };
}

function sanitizeMythicUpgradesData(data, inventory = null) {
  const raw = data && typeof data === 'object' ? data : {};
  const inventoryById = Array.isArray(inventory)
    ? inventory.reduce((map, part) => {
        map[String(part.id)] = part;
        return map;
      }, {})
    : null;
  const sanitized = {};

  Object.entries(raw).forEach(([partId, rawLevel]) => {
    const numericPartId = Number(partId);
    if (!Number.isInteger(numericPartId) || numericPartId <= 0) {
      return;
    }

    if (inventoryById) {
      const part = inventoryById[String(numericPartId)];
      if (!part || !isMythicPart(part)) {
        return;
      }
    }

    const level = normalizeMythicUpgradeLevel(rawLevel);
    if (level > 0) {
      sanitized[String(numericPartId)] = level;
    }
  });

  return sanitized;
}

function syncProgressStats() {
  if (!gameState.stats) {
    gameState.stats = createDefaultStats();
  }

  gameState.stats.currentStreak = gameState.currentWinStreak;
  gameState.stats.bestStreak = Math.max(gameState.stats.bestStreak, gameState.bestWinStreak);
  gameState.stats.highestCash = Math.max(gameState.stats.highestCash, gameState.cash);
  gameState.stats.hasFilledAllSlots = gameState.stats.hasFilledAllSlots || isAllSlotsFilled();
}

function isVehicleStripped() {
  return EQUIPMENT_SLOTS.every((type) => !gameState.equippedParts[type]);
}

function hasSellableInventory() {
  return gameState.inventory.some(
    (part) => gameState.equippedParts[part.type] !== part.id && getPartSellPrice(part) > 0
  );
}

function shouldFailForNoEntryFee() {
  return (
    gameState.cash < getMinEntryFee() &&
    !canRecoverWithPractice() &&
    isVehicleStripped() &&
    !hasSellableInventory()
  );
}

function checkGameFailure() {
  if (!shouldFailForNoEntryFee()) {
    return false;
  }

  if (gameState.phase !== 'game_over') {
    setPhase('game_over');
    setLights('none');
    addLog('游戏失败：车辆已无装备和可出售库存，现金不足以支付最低难度报名费。');
    addLog('请点击“重开并清档”重新开始。');
  }

  return true;
}

// 存档只输出可恢复的长期进度，排除进行中的动画、计时器和弹窗状态。
function createSaveData() {
  syncProgressStats();
  const bestManualReactionTime = normalizeManualReactionTime(gameState.bestManualReactionTime);
  const lastReactionTime = normalizeReactionTime(gameState.lastReactionTime);
  const lastManualReactionTime = normalizeManualReactionTime(gameState.lastManualReactionTime);
  const lastReactionControl =
    lastReactionTime === null ? null : gameState.lastReactionControl === 'ai' ? 'ai' : 'manual';
  return {
    cash: gameState.cash,
    raceCount: gameState.raceCount,
    lastRank: gameState.lastRank,
    bestReactionTime: bestManualReactionTime,
    bestManualReactionTime,
    lastReactionTime,
    lastManualReactionTime,
    lastReactionControl,
    currentWinStreak: gameState.currentWinStreak,
    currentLoseStreak: gameState.currentLoseStreak,
    bestWinStreak: gameState.bestWinStreak,
    difficulty: getDifficultyKey(),
    raceControl: getCurrentRaceControl(),
    lastRaceControl:
      gameState.lastRaceControl === 'ai' || gameState.lastRaceControl === 'manual'
        ? gameState.lastRaceControl
        : null,
    lastRaceType: gameState.lastRaceType === 'practice' ? 'practice' : 'standard',
    aiAssist: {
      active: Boolean(gameState.aiAssist && gameState.aiAssist.active),
      reactionTime:
        gameState.aiAssist && Number.isFinite(gameState.aiAssist.reactionTime)
          ? gameState.aiAssist.reactionTime
          : null,
    },
    manualRankStreak: {
      rank: gameState.manualRankStreak.rank,
      count: gameState.manualRankStreak.count,
    },
    manualDifficultyWinStreak: {
      difficultyKey: gameState.manualDifficultyWinStreak.difficultyKey,
      count: gameState.manualDifficultyWinStreak.count,
    },
    inventory: gameState.inventory.map((part) => ({
      id: part.id,
      templateId: getPartTemplateId(part),
      name: part.name,
      type: part.type,
      rarity: getPartRarity(part),
      price: part.price,
      effectText: part.effectText,
      changes: { ...part.changes },
    })),
    equippedParts: { ...gameState.equippedParts },
    mythicUpgrades: sanitizeMythicUpgradesData(gameState.mythicUpgrades, gameState.inventory),
    settings: sanitizeSettingsData(gameState.settings),
    nextPartId: gameState.nextPartId,
    stats: {
      ...gameState.stats,
      winsByDifficulty: { ...gameState.stats.winsByDifficulty },
      bestStreakByDifficulty: { ...gameState.stats.bestStreakByDifficulty },
      wonWithBuildAchievements: gameState.stats.wonWithBuildAchievements.slice(),
      wonWithSpecialParts: gameState.stats.wonWithSpecialParts.slice(),
    },
    achievements: {
      completed: { ...gameState.achievements.completed },
      lastUnlocked: gameState.achievements.lastUnlocked.slice(),
    },
  };

  // GSafe 存档校验和：防篡改
  if (typeof gsafeChecksum === 'function') {
    try {
      result._gsafeChecksum = gsafeChecksum(result);
    } catch (_) {}
  }

  return result;
}

// 读档防御层：丢弃非法零件、修正装备槽、迁移旧字段并保护异常反应纪录。
function sanitizeSaveData(data) {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const inventory = Array.isArray(data.inventory)
    ? data.inventory.reduce((parts, part) => {
        if (!part || typeof part !== 'object' || !EQUIPMENT_SLOTS.includes(part.type)) {
          return parts;
        }

        const id = Number(part.id);
        const price = Number(part.price);
        if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(price) || price < 0) {
          return parts;
        }

        const changes = {};
        Object.keys(BASE_PLAYER_STATS).forEach((key) => {
          const value = Number(part.changes && part.changes[key]);
          if (Number.isFinite(value) && value !== 0) {
            changes[key] = value;
          }
        });

        parts.push({
          id,
          templateId: getPartTemplateId(part),
          name: String(part.name || '未命名零件'),
          type: part.type,
          rarity: normalizeRarity(part.rarity),
          price: Math.floor(price),
          effectText: String(part.effectText || '-'),
          changes,
        });
        return parts;
      }, [])
    : [];

  const equippedParts = createEmptyEquippedParts();
  const equippedData =
    data.equippedParts && typeof data.equippedParts === 'object' ? data.equippedParts : {};
  EQUIPMENT_SLOTS.forEach((type) => {
    const partId = Number(equippedData[type]);
    const part = inventory.find((item) => item.id === partId && item.type === type);
    equippedParts[type] = part ? part.id : null;
  });
  const mythicUpgrades = sanitizeMythicUpgradesData(data.mythicUpgrades, inventory);
  const settings = sanitizeSettingsData(data.settings, data);

  const maxPartId = inventory.reduce((maxId, part) => Math.max(maxId, part.id), 0);
  const nextPartId = Math.max(Number(data.nextPartId) || 1, maxPartId + 1);
  const totalRaces = Math.max(0, Math.floor(Number(data.raceCount) || 0));
  const fallbackStats = {
    totalRaces,
    totalWins: estimateMigratedTotalWins(data, totalRaces),
    totalLosses: Math.max(0, totalRaces - estimateMigratedTotalWins(data, totalRaces)),
    currentStreak: Math.max(0, Math.floor(Number(data.currentWinStreak) || 0)),
    bestStreak: Math.max(0, Math.floor(Number(data.bestWinStreak) || 0)),
    falseStartCount: 0,
    falseStartStreak: 0,
    secondPlaceStreak: 0,
    fifthPlaceStreak: 0,
    practiceRaces: 0,
    partsPurchasedCount: inventory.length,
    highestCash: Math.max(1500, Math.floor(Number(data.cash) || 0)),
    winsByDifficulty: createDifficultyStatsMap(),
    bestStreakByDifficulty: createDifficultyStatsMap(),
    hasFilledAllSlots: EQUIPMENT_SLOTS.every((type) => Boolean(equippedParts[type])),
    hasLowCashAfterRace: false,
    hasFinishedLast: false,
    hasNightmareSlowReactionWin: false,
    hasNightmareGlassCannonWin: false,
    hasNightmareStableWin: false,
    hasWonAfterSecondPlaceStreak: false,
    wonWithBuildAchievements: [],
    wonWithSpecialParts: [],
  };
  const bestManualReactionTime =
    normalizeManualReactionTime(data.bestManualReactionTime) ??
    normalizeManualReactionTime(data.bestReactionTime);
  const savedLastReactionTime = normalizeReactionTime(data.lastReactionTime);
  const savedLastManualReactionTime = normalizeManualReactionTime(data.lastManualReactionTime);
  const rawLastReactionControl =
    data.lastReactionControl === 'ai' || data.lastReactionControl === 'manual'
      ? data.lastReactionControl
      : null;
  const lastReactionTime = savedLastReactionTime ?? savedLastManualReactionTime;
  const lastManualReactionTime =
    savedLastManualReactionTime ??
    (rawLastReactionControl === 'ai' ? null : normalizeManualReactionTime(data.lastReactionTime));
  const lastReactionControl = lastReactionTime === null ? null : rawLastReactionControl || 'manual';
  const achievements = sanitizeAchievementsData(data.achievements);
  const hasZeroBestReactionRecord = [data.bestManualReactionTime, data.bestReactionTime].some(
    (value) => Number(value) === 0
  );
  if (bestManualReactionTime === null && hasZeroBestReactionRecord) {
    delete achievements.completed.neural_link;
    achievements.lastUnlocked = achievements.lastUnlocked.filter((id) => id !== 'neural_link');
  }
  const lastRaceControl =
    data.lastRaceControl === 'ai' || data.lastRaceControl === 'manual'
      ? data.lastRaceControl
      : null;
  const lastRaceType = data.lastRaceType === 'practice' ? 'practice' : 'standard';
  const manualDifficultyWinStreak = sanitizeManualDifficultyWinStreakData(
    data.manualDifficultyWinStreak
  );
  const stats = sanitizeStatsData(data.stats, fallbackStats);
  if (manualDifficultyWinStreak.difficultyKey) {
    manualDifficultyWinStreak.count = Math.min(
      manualDifficultyWinStreak.count,
      stats.bestStreakByDifficulty[manualDifficultyWinStreak.difficultyKey] || 0
    );
    if (manualDifficultyWinStreak.count <= 0) {
      manualDifficultyWinStreak.difficultyKey = null;
    }
  }

  return {
    cash: Math.max(0, Math.floor(Number(data.cash) || 0)),
    raceCount: totalRaces,
    lastRank: String(data.lastRank || '-'),
    bestReactionTime: bestManualReactionTime,
    bestManualReactionTime,
    lastReactionTime,
    lastManualReactionTime,
    lastReactionControl,
    currentWinStreak: Math.max(0, Math.floor(Number(data.currentWinStreak) || 0)),
    currentLoseStreak: Math.max(0, Math.floor(Number(data.currentLoseStreak) || 0)),
    bestWinStreak: Math.max(0, Math.floor(Number(data.bestWinStreak) || 0)),
    difficulty: DIFFICULTIES[data.difficulty] ? data.difficulty : DEFAULT_DIFFICULTY,
    raceControl: data.raceControl === 'ai' ? 'ai' : 'manual',
    lastRaceControl,
    lastRaceType,
    aiAssist: sanitizeAiAssistData(data.aiAssist),
    manualRankStreak: sanitizeManualRankStreakData(data.manualRankStreak),
    manualDifficultyWinStreak,
    inventory,
    equippedParts,
    mythicUpgrades,
    settings,
    nextPartId,
    stats,
    achievements,
  };
}

function applyPersistentState(data) {
  gameState.cash = data.cash;
  gameState.raceCount = data.raceCount;
  gameState.lastRank = data.lastRank;
  gameState.bestReactionTime = data.bestReactionTime ?? data.bestManualReactionTime ?? null;
  gameState.bestManualReactionTime = data.bestManualReactionTime ?? data.bestReactionTime ?? null;
  gameState.lastReactionTime = data.lastReactionTime ?? null;
  gameState.lastManualReactionTime = data.lastManualReactionTime ?? null;
  gameState.lastReactionControl = data.lastReactionControl || null;
  gameState.currentWinStreak = data.currentWinStreak ?? 0;
  gameState.currentLoseStreak = data.currentLoseStreak ?? 0;
  gameState.bestWinStreak = Math.max(gameState.currentWinStreak, data.bestWinStreak ?? 0);
  gameState.difficulty = DIFFICULTIES[data.difficulty] ? data.difficulty : DEFAULT_DIFFICULTY;
  gameState.raceControl = data.raceControl === 'ai' ? 'ai' : 'manual';
  gameState.lastRaceControl =
    data.lastRaceControl === 'ai' || data.lastRaceControl === 'manual'
      ? data.lastRaceControl
      : null;
  gameState.activeRaceType = 'standard';
  gameState.lastRaceType = data.lastRaceType === 'practice' ? 'practice' : 'standard';
  gameState.aiAssist = sanitizeAiAssistData(data.aiAssist);
  gameState.aiAssistLocked = false;
  gameState.manualRankStreak = sanitizeManualRankStreakData(data.manualRankStreak);
  gameState.manualDifficultyWinStreak = sanitizeManualDifficultyWinStreakData(
    data.manualDifficultyWinStreak
  );
  gameState.inventory = data.inventory;
  gameState.equippedParts = data.equippedParts;
  gameState.mythicUpgrades = sanitizeMythicUpgradesData(data.mythicUpgrades, data.inventory);
  gameState.settings = sanitizeSettingsData(data.settings);
  gameState.nextPartId = data.nextPartId;
  gameState.stats = sanitizeStatsData(data.stats, data.stats);
  gameState.achievements = sanitizeAchievementsData(data.achievements);
  recalculatePlayerStats();
  syncProgressStats();
  updateSettingsControls();
  if (typeof syncRaceAudioFromSettings === 'function') {
    syncRaceAudioFromSettings();
  }
}

// 读档、清档或外部状态变动后统一刷新页面，避免各模块各自漏更新。
function refreshAfterPersistentChange() {
  clearRaceTimers();
  gameState.reactionTime = null;
  gameState.playerStarted = false;
  gameState.panelReturnPhase = 'idle';
  gameState.raceControl = 'manual';
  gameState.activeRaceType = 'standard';
  gameState.aiAssist = createDefaultAiAssistState();
  gameState.aiAssistLocked = false;
  if (el.restartBtn) {
    el.restartBtn.textContent = '重开并清档';
  }
  updateSettingsControls();
  resetCars();
  refreshShop('load-or-reset');
  renderGarage();
  renderDifficulty();
  renderAtlas();
  if (typeof renderProfile === 'function') {
    renderProfile();
  }
  setLights('none');
  setPhase('idle');
  updateStats();
}

function isRaceLockedPhase(phase) {
  return ['countdown_red', 'countdown_yellow', 'countdown_green', 'racing'].includes(phase);
}

function isPostRacePhase(phase) {
  return ['finished', 'false_start'].includes(phase);
}

function canUseShop() {
  return !isRaceLockedPhase(gameState.phase) && gameState.phase !== 'game_over';
}

function canManageTuning() {
  return (
    gameState.activePage === 'tuning' &&
    !isRaceLockedPhase(gameState.phase) &&
    gameState.phase !== 'game_over'
  );
}

// phase 是 UI 按钮、灯号、快捷键和比赛锁定逻辑的共同状态源。
function setPhase(phase) {
  gameState.phase = phase;
  el.phaseText.textContent = PHASE_LABELS[phase];
  updateResultMessage();
  updateButtons();
}

function setActivePage(page) {
  gameState.activePage = page;

  el.tabs.forEach((tab) => {
    const active = tab.dataset.page === page;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  el.pages.forEach((pageNode) => {
    const active = pageNode.dataset.page === page;
    pageNode.classList.toggle('is-active', active);
    pageNode.hidden = !active;
  });

  if (page === 'atlas') {
    renderAtlas();
  }

  if (page === 'profile' && typeof renderProfile === 'function') {
    renderProfile();
  }

  updateButtons();
}

function getGameSettings() {
  gameState.settings = sanitizeSettingsData(gameState.settings);
  return gameState.settings;
}

function persistLegacyRaceAudioSetting(enabled) {
  try {
    localStorage.setItem(RACE_AUDIO_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch (error) {
    // Ignore storage failures; the unified save still carries the current setting.
  }
}

function updateSettingsControls() {
  const settings = getGameSettings();

  if (el.raceAudioToggleBtn) {
    el.raceAudioToggleBtn.textContent = settings.soundEnabled ? '开启' : '关闭';
    el.raceAudioToggleBtn.setAttribute('aria-pressed', settings.soundEnabled ? 'true' : 'false');
  }

  if (el.telemetryToggleBtn) {
    el.telemetryToggleBtn.textContent = settings.telemetryEnabled ? '开启' : '关闭';
    el.telemetryToggleBtn.setAttribute(
      'aria-pressed',
      settings.telemetryEnabled ? 'true' : 'false'
    );
  }
}

function setGameSettings(patch = {}) {
  const current = getGameSettings();
  gameState.settings = sanitizeSettingsData({ ...current, ...patch });
  persistLegacyRaceAudioSetting(gameState.settings.soundEnabled);

  if (typeof syncRaceAudioFromSettings === 'function') {
    syncRaceAudioFromSettings();
  }

  updateSettingsControls();
  autoSaveGame();
}

function toggleTelemetryEnabled() {
  const nextEnabled = !getGameSettings().telemetryEnabled;
  setGameSettings({ telemetryEnabled: nextEnabled });
  addLog(`接受信息收集已${nextEnabled ? '开启' : '关闭'}。`);
}

function addLog(message) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  el.logOutput.textContent += `[${time}] ${message}\n`;
  el.logOutput.scrollTop = el.logOutput.scrollHeight;
}

function updateButtons() {
  const phase = gameState.phase;
  const countdownOrRace = isRaceLockedPhase(phase);
  const canPrepareNextRace = isPostRacePhase(phase);
  const gameOver = phase === 'game_over';

  el.registerBtn.disabled = phase !== 'idle' && !canPrepareNextRace;
  if (canPrepareNextRace) {
    el.registerBtn.textContent = '下一场比赛';
  } else if (canStartPracticeRace()) {
    el.registerBtn.textContent = '参加练习赛（免费）';
  } else {
    el.registerBtn.textContent = `报名比赛（${getEntryFee()} 元）`;
  }
  el.startBtn.disabled = !countdownOrRace || gameState.playerStarted;
  if (el.aiAssistRaceButton) {
    el.aiAssistRaceButton.textContent = window.matchMedia('(max-width: 640px)').matches
      ? 'AI托管'
      : 'AI 托管一场';
    el.aiAssistRaceButton.title = getAiAssistDescription();
    el.aiAssistRaceButton.disabled =
      phase !== 'idle' || gameOver || gameState.cash < getEntryFee() || gameState.aiAssistLocked;
  }
  if (el.saveBtn) {
    el.saveBtn.disabled = countdownOrRace || gameOver;
  }
  if (el.loadBtn) {
    el.loadBtn.disabled = countdownOrRace;
  }
  if (el.restartBtn) {
    el.restartBtn.disabled = countdownOrRace;
  }
  if (el.clearLocalDataBtn) {
    el.clearLocalDataBtn.disabled = countdownOrRace;
  }

  Array.from(el.shopBody.querySelectorAll('button')).forEach((button) => {
    const index = Number(button.dataset.index);
    const part = gameState.shopItems[index];
    const reasonNode = button.closest('.shop-card').querySelector('.card-reason');
    const alreadyOwned = part && (part.bought || hasOwnedPart(part));
    const notEnoughCash = part && gameState.cash < part.price;
    const adviceLabel =
      part && typeof getPartAdviceLabel === 'function' ? getPartAdviceLabel(part) : '';
    const adviceText = adviceLabel || '查看属性变化';

    button.disabled = !canUseShop() || !part || alreadyOwned || notEnoughCash;

    if (alreadyOwned) {
      button.textContent = '已拥有';
      reasonNode.textContent = '原因：已经拥有';
    } else if (notEnoughCash) {
      button.textContent = '现金不足';
      reasonNode.textContent = `${adviceText} · 还差 ${part.price - gameState.cash} 元`;
    } else if (!canUseShop()) {
      button.textContent = countdownOrRace ? '比赛中' : '不可购买';
      reasonNode.textContent = countdownOrRace
        ? `${adviceText} · 比赛中不能购买`
        : `${adviceText} · 当前状态不可购买`;
    } else {
      button.textContent = '购买';
      reasonNode.textContent = adviceText;
    }
  });

  Array.from(el.garageSlotsBody.querySelectorAll('select')).forEach((select) => {
    select.disabled = !canManageTuning() || select.options.length <= 1;
  });

  Array.from(el.garageSlotsBody.querySelectorAll('[data-action="equip-slot"]')).forEach(
    (button) => {
      const part = getPartById(Number(button.dataset.partId));
      const equipped = part && gameState.equippedParts[part.type] === part.id;
      button.disabled = !canManageTuning() || !part || equipped;
    }
  );

  Array.from(el.garageSlotsBody.querySelectorAll('[data-action="unequip-slot"]')).forEach(
    (button) => {
      const part = getEquippedPart(button.dataset.slot);
      button.disabled = !canManageTuning() || !part;
    }
  );

  const inventoryButtons = [
    ...el.tuningEquippedBody.querySelectorAll('button'),
    ...el.tuningUnequippedBody.querySelectorAll('button'),
  ];
  inventoryButtons.forEach((button) => {
    const part = getPartById(Number(button.dataset.partId));
    const equipped = part && gameState.equippedParts[part.type] === part.id;
    const mythicUpgradeMaxed =
      part && getMythicUpgradeLevel(part.id) >= MYTHIC_UPGRADE_MAX_LEVEL;
    button.disabled =
      !canManageTuning() ||
      !part ||
      (button.dataset.action === 'sell' && equipped) ||
      (button.dataset.action === 'unequip' && !equipped) ||
      (button.dataset.action === 'upgrade-mythic' &&
        (!equipped || !isMythicPart(part) || mythicUpgradeMaxed));
  });

  if (el.difficultyChoices) {
    const canChangeDifficulty = !countdownOrRace && !gameOver;
    el.difficultyOpenButtons.forEach((button) => {
      button.disabled = !canChangeDifficulty;
    });
    if (!canChangeDifficulty) {
      closeDifficultyModal();
    }
    Array.from(el.difficultyChoices.querySelectorAll('button')).forEach((button) => {
      const isActive = button.dataset.difficulty === getDifficultyKey();
      button.disabled = !canChangeDifficulty || isActive;
    });
  }
}

function updateResultMessage() {
  const messages = {
    idle: '先报名比赛，等绿灯后点击起步。',
    registered: '已报名，等待发车。',
    countdown_red: '红灯，先别踩油门。',
    countdown_yellow: '黄灯，继续等待绿灯。',
    countdown_green: '绿灯，可以起步。',
    racing: gameState.playerStarted ? '比赛进行中。' : '电脑车已起跑，立即点击起步。',
    finished: `比赛结束，上场名次：${gameState.lastRank}。`,
    false_start: '抢跑犯规，本场成绩无效。',
    game_over: '游戏失败：现金不足且无可出售库存，请重开。',
  };
  el.resultMessage.textContent = messages[gameState.phase] || PHASE_LABELS[gameState.phase];

  if (el.resultSubMessage) {
    const showPracticeResultHint =
      isPostRacePhase(gameState.phase) && gameState.lastRaceType === 'practice';
    const showAiResultHint =
      (getCurrentRaceControl() === 'ai' && gameState.phase !== 'idle') ||
      (isPostRacePhase(gameState.phase) && gameState.lastRaceControl === 'ai');
    el.resultSubMessage.hidden = !showPracticeResultHint && !showAiResultHint;
    if (showPracticeResultHint) {
      el.resultSubMessage.textContent = '练习赛无报名费，奖金较低，不计入正式连胜和高难度成就。';
    } else {
      el.resultSubMessage.textContent =
        gameState.phase === 'finished'
          ? '本场由 AI 托管完成，操作类成就不会解锁。'
          : '本场为 AI 托管，操作类成就不会解锁。';
    }
  }
}

function setLights(active) {
  el.redLight.classList.toggle('active', active === 'red');
  el.yellowLight.classList.toggle('active', active === 'yellow');
  el.greenLight.classList.toggle('active', active === 'green');

  const labels = {
    none: '未报名',
    red: '红灯',
    yellow: '黄灯',
    green: '绿灯',
  };
  el.lightLabel.textContent = labels[active] || labels.none;
}

function updateStats() {
  syncProgressStats();
  const player = gameState.player;
  el.engineStat.textContent = player.engine;
  el.tireStat.textContent = player.tire;
  el.gearboxStat.textContent = player.gearbox;
  el.stabilityStat.textContent = player.stability;
  el.weightStat.textContent = `${player.weight} kg`;
  el.hpStat.textContent = `${player.hp} hp`;
  el.cashStat.textContent = `${gameState.cash} 元`;
  el.shopCashStat.textContent = `${gameState.cash} 元`;
  el.tuningCashStat.textContent = `${gameState.cash} 元`;
  if (el.profileCashStat) {
    el.profileCashStat.textContent = `${gameState.cash} 元`;
  }
  if (el.atlasCashStat) {
    el.atlasCashStat.textContent = `${gameState.cash} 元`;
  }
  if (el.raceCountStat) {
    el.raceCountStat.textContent = gameState.raceCount;
  }
  if (el.raceRoundText) {
    el.raceRoundText.textContent = formatRaceRoundText(gameState.raceCount);
  }
  if (el.raceTierText) {
    el.raceTierText.textContent = getRaceTier().label;
  }
  if (el.lastRankStat) {
    el.lastRankStat.textContent = formatLastRankReportText(gameState.lastRank);
  }
  if (el.lastReactionStat) {
    el.lastReactionStat.textContent = formatCompactReactionTime(
      gameState.lastReactionTime,
      gameState.lastReactionControl
    );
  }
  if (el.entryFeeText) {
    el.entryFeeText.textContent = getEntryFee();
  }
  if (el.bestReactionText) {
    el.bestReactionText.textContent = formatReactionRecordText(
      gameState.bestManualReactionTime,
      gameState.lastReactionTime,
      gameState.lastReactionControl
    );
  }
  if (el.winStreakText) {
    el.winStreakText.textContent = formatWinStreakText(
      gameState.currentWinStreak,
      gameState.bestWinStreak
    );
  }
  if (el.raceCurrentWinStreakStat) {
    el.raceCurrentWinStreakStat.textContent = gameState.currentWinStreak;
  }
  if (el.raceBestWinStreakStat) {
    el.raceBestWinStreakStat.textContent = gameState.bestWinStreak;
  }
  if (el.raceReportEmptyText && el.raceReportStats) {
    const hasRaceReport = gameState.lastRank !== '-' || gameState.lastReactionTime !== null;
    el.raceReportEmptyText.hidden = hasRaceReport;
    el.raceReportStats.hidden = !hasRaceReport;
  }
  el.registerBtn.textContent = `报名比赛（${getEntryFee()} 元）`;
  el.opponentPowerText.textContent = getOpponentPower().toFixed(2);
  el.currentVehicleText.textContent = '玩家小车';
  if (el.versionText) {
    el.versionText.textContent = GAME_VERSION;
  }
  if (el.versionNote) {
    el.versionNote.textContent = GAME_VERSION_NOTE;
  }
  if (el.statusVersionText) {
    el.statusVersionText.textContent = GAME_VERSION;
  }
  updateSettingsControls();
  if (typeof renderBuildAdvice === 'function') {
    renderBuildAdvice();
  }
  renderDifficulty();
  if (typeof renderProfile === 'function') {
    renderProfile();
  }
  updateButtons();
}

function renderDifficulty() {
  const activeKey = getDifficultyKey();
  const activeConfig = DIFFICULTIES[activeKey];

  if (el.difficultyCurrentName && activeConfig) {
    el.difficultyCurrentName.textContent = activeConfig.name;
  }
  if (el.difficultyCurrentMeta && activeConfig) {
    el.difficultyCurrentMeta.textContent = formatDifficultyMeta(activeKey);
  }
  if (el.profileDifficultyName && activeConfig) {
    el.profileDifficultyName.textContent = activeConfig.name;
  }
  if (el.profileDifficultyMeta && activeConfig) {
    el.profileDifficultyMeta.textContent = formatDifficultyMeta(activeKey);
  }

  if (!el.difficultyChoices) {
    return;
  }

  el.difficultyChoices.innerHTML = '';

  DIFFICULTY_ORDER.forEach((key) => {
    const config = DIFFICULTIES[key];
    if (!config) {
      return;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.difficulty = key;
    button.className = `difficulty-button${key === activeKey ? ' is-active' : ''}`;
    button.setAttribute('aria-pressed', key === activeKey ? 'true' : 'false');
    button.innerHTML = `
      <span class="difficulty-name">${config.name}</span>
      <span class="difficulty-meta">${formatDifficultyMeta(key)}</span>
    `;
    el.difficultyChoices.appendChild(button);
  });

  updateButtons();
}

// 安全自动保存：失败只写日志，不阻塞游戏；比赛锁定阶段或初始化未完成时跳过。
function autoSaveGame() {
  if (
    !gameState.ready ||
    isRaceLockedPhase(gameState.phase) ||
    gameState.storageWriteBlockedReason
  ) {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(createSaveData()));
  } catch (error) {
    addLog('自动保存失败：浏览器拒绝写入本地存档。');
  }
}
