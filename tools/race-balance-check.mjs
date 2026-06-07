#!/usr/bin/env node
/* eslint-disable no-console */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const SOURCE_FILES = {
  config: path.join(ROOT_DIR, 'lab-public/race/scripts/config.js'),
  formulas: path.join(ROOT_DIR, 'lab-public/race/scripts/race-formulas.js'),
  core: path.join(ROOT_DIR, 'lab-public/race/scripts/core.js'),
  race: path.join(ROOT_DIR, 'lab-public/race/scripts/race.js'),
};

const DEFAULT_CHECKPOINTS = [0, 8, 18, 55];
const DEFAULT_REACTION_SECONDS = 0.38;
const DEFAULT_SAMPLE_COUNT = 320;
const DEFAULT_TOP_K = 24;
const DEFAULT_MYTHIC_LEVELS = [0];
const LATE_GAME_RACE_COUNT = 55;
const LATE_GAME_DIFFICULTY_KEYS = new Set(['nightmare']);
const DEFAULT_FOCUS = {
  easy: [8, 18],
  normal: [8, 18],
  hard: [18],
  expert: [18],
  nightmare: [18, 55],
};

const PERSONALITY_BY_ID = {
  2: 0.02,
  3: 0.05,
  4: -0.04,
  5: 0,
};

const MEAN_RANDOMS = {
  variance: 0.02,
  acceleration: 0.0005,
  launch: 0.025,
  mid: 0.01,
  stability: 0.5,
};

const DIFFICULTY_TARGETS = {
  easy: { stableWinRate: 0.62, budgetWinRate: 0.55, lateFloor: 0.52 },
  normal: { stableWinRate: 0.58, budgetWinRate: 0.5, lateFloor: 0.48 },
  hard: { stableWinRate: 0.48, budgetWinRate: 0.4, lateFloor: 0.42 },
  expert: { stableWinRate: 0.42, budgetWinRate: 0.36, lateFloor: 0.38 },
  nightmare: { stableWinRate: 0.34, budgetWinRate: 0.25, lateFloor: 0.3 },
};

const DEFAULT_MODE = 'enumerate';
const DEFAULT_PROFILE_BUILDS = ['initial', 'mid', 'late', 'mythic5', 'mythic10'];
const DEFAULT_PROFILE_RACE_COUNTS = [0, 15, 38, 55, 100];
const FULL_MYTHIC_PART_KEYS = [
  'Engine:航空燃料调校机',
  'Tire:赛道之神热熔胎',
  'Gearbox:零延迟序列变速箱',
  'Body:镁合金竞技壳',
  'Intake:赛用氮氧加速系统',
  'Exhaust:钛合金全段排气总成',
  'Turbo:军规增压核心',
  'Stability:主动液压悬挂系统',
];
const STABLE_MYTHIC_PART_KEYS = [
  'Engine:航空燃料调校机',
  'Tire:赛道之神热熔胎',
  'Gearbox:雪主任祖传扳手',
  'Body:轻量复合车门',
  'Intake:风洞调校进气盒',
  'Exhaust:钛合金全段排气总成',
  'Turbo:可变截面涡轮',
  'Stability:主动液压悬挂系统',
];
const MYTHIC5_STABLE_PART_KEYS = [
  'Engine:航空燃料调校机',
  'Tire:赛道之神热熔胎',
  'Gearbox:零延迟序列变速箱',
  'Body:碳纤维全车壳',
  'Intake:风洞调校进气盒',
  'Exhaust:钛合金全段排气总成',
  'Turbo:双涡管套件',
  'Stability:主动液压悬挂系统',
];
const MYTHIC10_STABLE_PART_KEYS = [
  'Engine:航空燃料调校机',
  'Tire:赛道之神热熔胎',
  'Gearbox:雪主任祖传扳手',
  'Body:轻量复合车门',
  'Intake:风洞调校进气盒',
  'Exhaust:钛合金全段排气总成',
  'Turbo:军规增压核心',
  'Stability:主动液压悬挂系统',
];
const BUILD_PROFILES = {
  initial: {
    label: '初始车',
    description: '空配基准车',
    partKeys: [],
  },
  mid: {
    label: '中期参考车',
    description: '5 件 hard 奖池主力件，保留明显压力但应看得到成长',
    partKeys: [
      'Engine:厂队封存红头机',
      'Tire:赛道热熔 slick',
      'Gearbox:雪主任祖传扳手',
      'Body:碳纤维全车壳',
      'Stability:碳陶刹车套装',
    ],
  },
  late: {
    label: '后期稳定强配',
    description: '神话版本后期强配，但保留稳定要求，不追求全槽位神话',
    partKeys: STABLE_MYTHIC_PART_KEYS,
    mythicUpgradeLevel: 0,
  },
  mythic5: {
    label: '神话 +5 稳定强配',
    description: '后期稳定强配中的神话件 +5，覆盖 50 场以后长期养成段',
    partKeys: MYTHIC5_STABLE_PART_KEYS,
    mythicUpgradeLevel: 5,
  },
  mythic10: {
    label: '神话 +10 稳定强配',
    description: '后期稳定强配中的神话件 +10，覆盖满强化强度上限',
    partKeys: MYTHIC10_STABLE_PART_KEYS,
    mythicUpgradeLevel: 10,
  },
  fullMythic: {
    label: '全神话对照车',
    description: '压力测试用：全槽位神话并不等于最强，稳定不足时会明显掉速',
    partKeys: FULL_MYTHIC_PART_KEYS,
    mythicUpgradeLevel: 10,
  },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value, digits = 2) {
  return Number(value).toFixed(digits);
}

function createHash(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createMulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBetween(rng, min, max) {
  return min + rng() * (max - min);
}

function parseIntegerList(rawValue) {
  return rawValue
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 0);
}

function parseUpgradeLevelList(rawValue) {
  return parseIntegerList(rawValue)
    .map((value) => clamp(value, 0, 10))
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort((left, right) => left - right);
}

function parseStringList(rawValue) {
  return rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const args = {
    mode: DEFAULT_MODE,
    checkpoints: DEFAULT_CHECKPOINTS.slice(),
    reactionSeconds: DEFAULT_REACTION_SECONDS,
    sampleCount: DEFAULT_SAMPLE_COUNT,
    topK: DEFAULT_TOP_K,
    mythicLevels: DEFAULT_MYTHIC_LEVELS.slice(),
    difficultyFilter: null,
    profileBuilds: DEFAULT_PROFILE_BUILDS.slice(),
    profileRaceCounts: DEFAULT_PROFILE_RACE_COUNTS.slice(),
    seed: 'race-balance-check',
  };

  argv.forEach((arg) => {
    if (arg.startsWith('--mode=')) {
      args.mode = arg.slice('--mode='.length).trim() || args.mode;
    } else if (arg.startsWith('--checkpoints=')) {
      args.checkpoints = parseIntegerList(arg.slice('--checkpoints='.length)).sort(
        (left, right) => left - right
      );
    } else if (arg.startsWith('--reaction=')) {
      const value = Number(arg.slice('--reaction='.length));
      if (Number.isFinite(value) && value >= 0) {
        args.reactionSeconds = value;
      }
    } else if (arg.startsWith('--samples=')) {
      const value = Number(arg.slice('--samples='.length));
      if (Number.isInteger(value) && value > 0) {
        args.sampleCount = value;
      }
    } else if (arg.startsWith('--top=')) {
      const value = Number(arg.slice('--top='.length));
      if (Number.isInteger(value) && value > 0) {
        args.topK = value;
      }
    } else if (arg.startsWith('--mythic-levels=')) {
      args.mythicLevels = parseUpgradeLevelList(arg.slice('--mythic-levels='.length));
    } else if (arg.startsWith('--difficulty=')) {
      const value = arg.slice('--difficulty='.length).trim();
      args.difficultyFilter = value || null;
    } else if (arg.startsWith('--builds=')) {
      args.profileBuilds = parseStringList(arg.slice('--builds='.length));
    } else if (arg.startsWith('--race-counts=')) {
      args.profileRaceCounts = parseIntegerList(arg.slice('--race-counts='.length));
    } else if (arg.startsWith('--seed=')) {
      args.seed = arg.slice('--seed='.length) || args.seed;
    }
  });

  if (args.checkpoints.length === 0) {
    args.checkpoints = DEFAULT_CHECKPOINTS.slice();
  }

  if (args.profileBuilds.length === 0) {
    args.profileBuilds = DEFAULT_PROFILE_BUILDS.slice();
  }

  if (args.profileRaceCounts.length === 0) {
    args.profileRaceCounts = DEFAULT_PROFILE_RACE_COUNTS.slice();
  }

  if (args.mythicLevels.length === 0) {
    args.mythicLevels = DEFAULT_MYTHIC_LEVELS.slice();
  }

  if (args.mode !== 'enumerate' && args.mode !== 'profiles') {
    throw new Error(`不支持的模式：${args.mode}`);
  }

  if (args.mode === 'profiles' && args.profileBuilds.length !== args.profileRaceCounts.length) {
    throw new Error('--builds 与 --race-counts 的数量必须一致');
  }

  return args;
}

function shouldCheckRaceCountForDifficulty(difficultyKey, raceCount) {
  return raceCount < LATE_GAME_RACE_COUNT || LATE_GAME_DIFFICULTY_KEYS.has(difficultyKey);
}

function resolveDifficultyCheckpoints(difficultyKey, checkpoints) {
  return checkpoints.filter((checkpoint) =>
    shouldCheckRaceCountForDifficulty(difficultyKey, checkpoint)
  );
}

function loadRaceData() {
  Object.values(SOURCE_FILES).forEach((filePath) => {
    fs.accessSync(filePath, fs.constants.R_OK);
  });

  const configCode = fs.readFileSync(SOURCE_FILES.config, 'utf8');
  const formulasCode = fs.readFileSync(SOURCE_FILES.formulas, 'utf8');
  const coreSource = fs.readFileSync(SOURCE_FILES.core, 'utf8');
  const raceSource = fs.readFileSync(SOURCE_FILES.race, 'utf8');
  const formulasSource = fs.readFileSync(SOURCE_FILES.formulas, 'utf8');

  const context = { console };
  vm.createContext(context);
  vm.runInContext(
    `${configCode}
${formulasCode}
globalThis.__raceBalanceData = {
  BASE_PLAYER_STATS,
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  ENTRY_FEE,
  EQUIPMENT_SLOTS,
  FINISH,
  LOOT_POOLS,
  MYTHIC_UPGRADE_BONUS_PER_LEVEL,
  MYTHIC_UPGRADE_MAX_LEVEL,
  MYTHIC_UPGRADE_STAT_KEYS,
  OPPONENT_CHASE_CAP,
  OPPONENT_CHASE_RAMP_RACES,
  OPPONENT_CHASE_START_RACE,
  PART_POOL,
  PRIZES,
  RaceFormulaUtils,
  TICK_MS,
};`,
    context,
    { filename: SOURCE_FILES.config }
  );

  return {
    ...context.__raceBalanceData,
    sourceText: {
      config: configCode,
      core: coreSource,
      formulas: formulasSource,
      race: raceSource,
    },
  };
}

function validateSourceTexts(sourceText) {
  const requiredConfigTokens = [
    'const MYTHIC_UPGRADE_MAX_LEVEL',
    'const MYTHIC_UPGRADE_BONUS_PER_LEVEL',
    'const MYTHIC_UPGRADE_STAT_KEYS',
  ];
  const requiredCoreTokens = [
    'function getDifficultyEntryFee',
    'Math.round((ENTRY_FEE * multiplier)',
    'function getMythicUpgradeCost',
    'function applyMythicUpgradeBonus',
  ];
  const requiredFormulaTokens = [
    'function computePlayerPower',
    'function computePlayerRating',
    'function computeOpponentStrength',
    'function computeOpponentCarPower',
    'function computeReactionOutcome',
  ];
  const requiredRaceTokens = ['function tickRace', 'function startPlayerCar'];

  requiredConfigTokens.forEach((token) => {
    if (!sourceText.config.includes(token)) {
      throw new Error(`未在 config.js 中找到神话强化配置片段：${token}`);
    }
  });

  requiredCoreTokens.forEach((token) => {
    if (!sourceText.core.includes(token)) {
      throw new Error(`未在 core.js 中找到关键公式片段：${token}`);
    }
  });

  requiredFormulaTokens.forEach((token) => {
    if (!sourceText.formulas.includes(token)) {
      throw new Error(`未在 race-formulas.js 中找到关键公式片段：${token}`);
    }
  });

  requiredRaceTokens.forEach((token) => {
    if (!sourceText.race.includes(token)) {
      throw new Error(`未在 race.js 中找到关键流程片段：${token}`);
    }
  });
}

function normalizeMythicUpgradeLevel(raceData, level) {
  return clamp(Math.floor(Number(level) || 0), 0, raceData.MYTHIC_UPGRADE_MAX_LEVEL);
}

function isMythicPart(part) {
  return Boolean(part && part.rarity === 'mythic');
}

function getMythicUpgradeCost(raceData, part, level) {
  const currentLevel = normalizeMythicUpgradeLevel(raceData, level);
  const baseCost = Math.max(1800, Math.round((Number(part && part.price) || 0) * 0.4));
  return Math.round(baseCost * (1 + currentLevel * 0.45));
}

function getTotalMythicUpgradeCost(raceData, part, targetLevel) {
  const level = normalizeMythicUpgradeLevel(raceData, targetLevel);
  let total = 0;

  for (let currentLevel = 0; currentLevel < level; currentLevel += 1) {
    total += getMythicUpgradeCost(raceData, part, currentLevel);
  }

  return total;
}

function applyMythicUpgradeBonus(raceData, part, upgradeLevel) {
  const level = normalizeMythicUpgradeLevel(raceData, upgradeLevel);
  if (!isMythicPart(part) || level <= 0) {
    return part;
  }

  const multiplier = 1 + level * raceData.MYTHIC_UPGRADE_BONUS_PER_LEVEL;
  const upgraded = {
    ...part,
    changes: { ...(part.changes || {}) },
  };

  raceData.MYTHIC_UPGRADE_STAT_KEYS.forEach((key) => {
    const value = Number(upgraded.changes[key]);
    if (Number.isFinite(value) && value > 0) {
      upgraded.changes[key] = Math.round(value * multiplier);
    }
  });

  return upgraded;
}

function createPartOption(raceData, slot, part, upgradeLevel = 0) {
  const normalizedUpgradeLevel = isMythicPart(part)
    ? normalizeMythicUpgradeLevel(raceData, upgradeLevel)
    : 0;
  const effectivePart = applyMythicUpgradeBonus(raceData, part, normalizedUpgradeLevel);
  const upgradeCost = isMythicPart(part)
    ? getTotalMythicUpgradeCost(raceData, part, normalizedUpgradeLevel)
    : 0;
  const upgradeSuffix = normalizedUpgradeLevel > 0 ? `+${normalizedUpgradeLevel}` : '';

  return {
    slot,
    key: `${slot}:${part.name}${upgradeSuffix}`,
    name: part.name,
    rarity: part.rarity,
    upgradeLevel: normalizedUpgradeLevel,
    basePrice: part.price,
    upgradeCost,
    price: part.price + upgradeCost,
    engine: Number(effectivePart.changes.engine || 0),
    tire: Number(effectivePart.changes.tire || 0),
    gearbox: Number(effectivePart.changes.gearbox || 0),
    stability: Number(effectivePart.changes.stability || 0),
    weight: Number(effectivePart.changes.weight || 0),
    hp: Number(effectivePart.changes.hp || 0),
  };
}

function buildDifficultyOptions(raceData, difficultyKey, mythicLevels = DEFAULT_MYTHIC_LEVELS) {
  const allowedRarities = new Set(raceData.LOOT_POOLS[difficultyKey] || []);
  const normalizedMythicLevels = mythicLevels
    .map((level) => normalizeMythicUpgradeLevel(raceData, level))
    .filter((level, index, levels) => levels.indexOf(level) === index);
  const effectiveMythicLevels =
    normalizedMythicLevels.length > 0 ? normalizedMythicLevels : DEFAULT_MYTHIC_LEVELS;

  return raceData.EQUIPMENT_SLOTS.map((slot) => {
    const options = [
      {
        slot,
        key: `${slot}:none`,
        name: '-',
        rarity: 'none',
        price: 0,
        engine: 0,
        tire: 0,
        gearbox: 0,
        stability: 0,
        weight: 0,
        hp: 0,
      },
    ];

    raceData.PART_POOL.forEach((part) => {
      if (part.type !== slot || !allowedRarities.has(part.rarity)) {
        return;
      }

      const upgradeLevels = isMythicPart(part) ? effectiveMythicLevels : [0];
      upgradeLevels.forEach((upgradeLevel) => {
        options.push(createPartOption(raceData, slot, part, upgradeLevel));
      });
    });

    return options;
  });
}

function computeEntryFee(raceData, difficultyKey) {
  const difficulty = raceData.DIFFICULTIES[difficultyKey];
  const multiplier =
    difficulty && difficulty.entryFeeMultiplier ? difficulty.entryFeeMultiplier : 1;
  return Math.round((raceData.ENTRY_FEE * multiplier) / 10) * 10;
}

function computePlayerStats(raceData, totals) {
  return {
    engine: totals.engine,
    tire: totals.tire,
    gearbox: totals.gearbox,
    stability: clamp(totals.stability, 1, 80),
    weight: clamp(totals.weight, 760, 1250),
    hp: totals.hp,
  };
}

function findPartByKey(raceData, partKey) {
  const [slot, ...nameParts] = partKey.split(':');
  const name = nameParts.join(':');

  return raceData.PART_POOL.find((part) => part.type === slot && part.name === name) || null;
}

function getProfileMythicUpgradeLevel(raceData, profile, part) {
  if (!isMythicPart(part)) {
    return 0;
  }

  const partKey = `${part.type}:${part.name}`;
  if (profile.mythicUpgradeLevels && partKey in profile.mythicUpgradeLevels) {
    return normalizeMythicUpgradeLevel(raceData, profile.mythicUpgradeLevels[partKey]);
  }

  return normalizeMythicUpgradeLevel(raceData, profile.mythicUpgradeLevel || 0);
}

function summarizeMythicUpgradeOptions(options) {
  const mythicOptions = options.filter((option) => option.rarity === 'mythic');
  if (mythicOptions.length === 0) {
    return '-';
  }

  const levelCounts = mythicOptions.reduce((counts, option) => {
    const level = Number(option.upgradeLevel) || 0;
    counts[level] = (counts[level] || 0) + 1;
    return counts;
  }, {});

  return Object.keys(levelCounts)
    .map(Number)
    .sort((left, right) => left - right)
    .map((level) => `+${level}×${levelCounts[level]}`)
    .join(' / ');
}

function createProfileCandidate(raceData, difficultyKey, profileKey) {
  const profile = BUILD_PROFILES[profileKey];

  if (!profile) {
    throw new Error(`未定义的 build profile：${profileKey}`);
  }

  const totals = { ...raceData.BASE_PLAYER_STATS };
  const options = profile.partKeys.map((partKey) => {
    const part = findPartByKey(raceData, partKey);

    if (!part) {
      throw new Error(`未找到 build profile 零件：${partKey}`);
    }

    const option = createPartOption(
      raceData,
      part.type,
      part,
      getProfileMythicUpgradeLevel(raceData, profile, part)
    );

    totals.engine += option.engine;
    totals.tire += option.tire;
    totals.gearbox += option.gearbox;
    totals.stability += option.stability;
    totals.weight += option.weight;
    totals.hp += option.hp;

    return option;
  });
  const stats = computePlayerStats(raceData, totals);
  const playerRating = raceData.RaceFormulaUtils.computePlayerRating(stats);
  const playerPower = raceData.RaceFormulaUtils.computePlayerPower(stats);

  return {
    difficultyKey,
    profileKey,
    profileLabel: profile.label,
    profileDescription: profile.description,
    configKey: options.map((option) => option.key).join('|') || 'empty',
    options,
    stats,
    totalCost: options.reduce((sum, option) => sum + option.price, 0),
    upgradeCost: options.reduce((sum, option) => sum + option.upgradeCost, 0),
    mythicUpgradeSummary: summarizeMythicUpgradeOptions(options),
    playerRating,
    playerPower,
    simulations: {},
  };
}

function computeMeanOpponentPower(opponentStrength, id) {
  const lateBoost = Math.max(0, opponentStrength - 2.2);

  return {
    base:
      0.53 +
      opponentStrength * 0.092 +
      lateBoost * 0.048 +
      MEAN_RANDOMS.variance +
      (PERSONALITY_BY_ID[id] || 0),
    acceleration:
      0.021 + opponentStrength * 0.0023 + lateBoost * 0.0008 + MEAN_RANDOMS.acceleration,
    launch: 0.1 + opponentStrength * 0.017 + lateBoost * 0.0045 + MEAN_RANDOMS.launch,
    mid: 0.08 + opponentStrength * 0.023 + lateBoost * 0.009 + MEAN_RANDOMS.mid,
    stability: 10 + opponentStrength * 2.2 + lateBoost * 2.7 + MEAN_RANDOMS.stability,
  };
}

function computePowerScore(power) {
  return (
    power.base * 1000 +
    power.acceleration * 42000 +
    power.launch * 140 +
    power.mid * 260 +
    power.stability * 0.4
  );
}

function computeProxyMargins(raceData, difficultyKey, checkpoints, playerRating, playerPower) {
  const playerScore = computePowerScore(playerPower);

  return checkpoints.reduce((margins, checkpoint) => {
    const opponentStrength = raceData.RaceFormulaUtils.computeOpponentStrength({
      raceCount: checkpoint,
      difficulty: raceData.DIFFICULTIES[difficultyKey],
      playerRating,
      chaseStartRace: raceData.OPPONENT_CHASE_START_RACE,
      chaseRampRaces: raceData.OPPONENT_CHASE_RAMP_RACES,
      chaseCap: raceData.OPPONENT_CHASE_CAP,
    });
    const meanOpponentScore =
      [2, 3, 4, 5].reduce((sum, id) => {
        return sum + computePowerScore(computeMeanOpponentPower(opponentStrength, id));
      }, 0) / 4;

    margins[checkpoint] = {
      playerScore,
      opponentScore: meanOpponentScore,
      gap: playerScore - meanOpponentScore,
      opponentStrength,
    };
    return margins;
  }, {});
}

function summarizeStatProfile(raceData, stats) {
  const positives = {
    engine: Math.max(0, stats.engine - raceData.BASE_PLAYER_STATS.engine),
    tire: Math.max(0, stats.tire - raceData.BASE_PLAYER_STATS.tire),
    gearbox: Math.max(0, stats.gearbox - raceData.BASE_PLAYER_STATS.gearbox),
    stability: Math.max(0, stats.stability - raceData.BASE_PLAYER_STATS.stability),
    hp: Math.max(0, stats.hp - raceData.BASE_PLAYER_STATS.hp),
    weight: Math.max(0, raceData.BASE_PLAYER_STATS.weight - stats.weight),
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

function createCandidateSnapshot({
  raceData,
  difficultyKey,
  checkpoints,
  focusCheckpoints,
  selectedOptions,
  totals,
  totalCost,
}) {
  const stats = computePlayerStats(raceData, totals);
  const playerRating = raceData.RaceFormulaUtils.computePlayerRating(stats);
  const playerPower = raceData.RaceFormulaUtils.computePlayerPower(stats);
  const proxyMargins = computeProxyMargins(
    raceData,
    difficultyKey,
    checkpoints,
    playerRating,
    playerPower
  );
  const focusGaps = focusCheckpoints.map((checkpoint) => proxyMargins[checkpoint].gap);
  const profile = summarizeStatProfile(raceData, stats);

  return {
    difficultyKey,
    configKey: selectedOptions.map((option) => option.key).join('|'),
    options: selectedOptions.map((option) => ({
      slot: option.slot,
      name: option.name,
      rarity: option.rarity,
      upgradeLevel: option.upgradeLevel || 0,
      basePrice: option.basePrice || option.price,
      upgradeCost: option.upgradeCost || 0,
      price: option.price,
    })),
    stats,
    totalCost,
    playerRating,
    playerPower,
    proxyMargins,
    focus: {
      averageGap: focusGaps.reduce((sum, value) => sum + value, 0) / focusGaps.length,
      minimumGap: Math.min(...focusGaps),
    },
    profile,
    upgradeCost: selectedOptions.reduce((sum, option) => sum + (option.upgradeCost || 0), 0),
    mythicUpgradeSummary: summarizeMythicUpgradeOptions(selectedOptions),
    simulations: {},
  };
}

function maybePushTop(list, size, score, snapshot) {
  if (list.length < size) {
    list.push({ score, snapshot });
    list.sort((left, right) => left.score - right.score);
    return;
  }

  if (score <= list[0].score) {
    return;
  }

  list[0] = { score, snapshot };
  list.sort((left, right) => left.score - right.score);
}

function maybePushBudget(list, size, snapshot) {
  if (snapshot.focus.minimumGap < 0) {
    return;
  }

  list.push(snapshot);
  list.sort((left, right) => {
    if (left.totalCost !== right.totalCost) {
      return left.totalCost - right.totalCost;
    }
    return right.focus.minimumGap - left.focus.minimumGap;
  });

  const seen = new Set();
  const deduped = [];

  for (const candidate of list) {
    if (seen.has(candidate.configKey)) {
      continue;
    }
    seen.add(candidate.configKey);
    deduped.push(candidate);
    if (deduped.length >= size) {
      break;
    }
  }

  list.length = 0;
  list.push(...deduped);
}

function simulateRace(raceData, candidate, difficultyKey, raceCount, seed, reactionSeconds) {
  const rng = createMulberry32(seed);
  const difficulty = raceData.DIFFICULTIES[difficultyKey] || {};
  const opponentStrength = raceData.RaceFormulaUtils.computeOpponentStrength({
    raceCount,
    difficulty,
    playerRating: candidate.playerRating,
    chaseStartRace: raceData.OPPONENT_CHASE_START_RACE,
    chaseRampRaces: raceData.OPPONENT_CHASE_RAMP_RACES,
    chaseCap: raceData.OPPONENT_CHASE_CAP,
  });
  const playerPower = candidate.playerPower;
  const reaction = raceData.RaceFormulaUtils.computeReactionOutcome({
    reactionSeconds,
    reactionGrace: difficulty.reactionGrace || 0,
  });
  const startTick = Math.max(0, Math.ceil(reactionSeconds / (raceData.TICK_MS / 1000)));

  const cars = [
    {
      id: 1,
      isPlayer: true,
      position: 0,
      currentSpeed: 0,
      started: false,
      finishTick: null,
      reactionPenalty: reaction.slowPenalty,
      launchBonus: playerPower.launch + reaction.reactionBonus,
      power: playerPower,
    },
    ...[2, 3, 4, 5].map((id) => ({
      id,
      isPlayer: false,
      position: 0,
      currentSpeed: 0,
      started: true,
      finishTick: null,
      reactionPenalty: 0,
      launchBonus: 0,
      power: raceData.RaceFormulaUtils.computeOpponentCarPower({
        opponentStrength,
        id,
        randomBetween: (min, max) => randomBetween(rng, min, max),
      }),
    })),
  ];

  for (let tick = 0; tick < 600; tick += 1) {
    const elapsed = (tick * raceData.TICK_MS) / 1000;
    if (!cars[0].started && tick >= startTick) {
      cars[0].started = true;
    }

    cars.forEach((car) => {
      if (!car.started || car.finishTick !== null) {
        return;
      }

      const stabilityNoise =
        (18 - clamp(car.power.stability, 1, 18)) * randomBetween(rng, -0.0018, 0.0024);
      const midBoost = car.position > 34 && car.position < 78 ? car.power.mid * 0.012 : 0;
      const launchFade = Math.max(0, 1 - elapsed / 1.2) * car.launchBonus * 0.08;

      car.currentSpeed += car.power.acceleration + stabilityNoise;
      car.currentSpeed = clamp(car.currentSpeed, 0.28, 2.2);
      car.position +=
        car.power.base + car.currentSpeed + midBoost + launchFade - car.reactionPenalty * 0.035;

      if (car.position >= raceData.FINISH) {
        car.position = raceData.FINISH;
        car.finishTick = tick;
      }
    });

    if (cars.every((car) => car.finishTick !== null)) {
      break;
    }
  }

  const ranked = cars
    .slice()
    .sort(
      (left, right) =>
        (left.finishTick ?? Number.MAX_SAFE_INTEGER) - (right.finishTick ?? Number.MAX_SAFE_INTEGER)
    );
  const playerRank = ranked.findIndex((car) => car.isPlayer) + 1;
  const prize = raceData.PRIZES[playerRank - 1] || 0;

  return {
    playerRank,
    prize,
    finishSeconds: ((cars[0].finishTick ?? 600) * raceData.TICK_MS) / 1000,
    opponentStrength,
  };
}

function simulateCandidate({
  raceData,
  candidate,
  checkpoints,
  sampleCount,
  seedPrefix,
  reactionSeconds,
}) {
  checkpoints.forEach((checkpoint) => {
    let winCount = 0;
    let topTwoCount = 0;
    let totalRank = 0;
    let totalPrize = 0;

    for (let sample = 0; sample < sampleCount; sample += 1) {
      const seed = createHash(
        `${seedPrefix}|${candidate.difficultyKey}|${candidate.configKey}|${checkpoint}|${sample}`
      );
      const result = simulateRace(
        raceData,
        candidate,
        candidate.difficultyKey,
        checkpoint,
        seed,
        reactionSeconds
      );

      totalRank += result.playerRank;
      totalPrize += result.prize;
      if (result.playerRank === 1) {
        winCount += 1;
      }
      if (result.playerRank <= 2) {
        topTwoCount += 1;
      }
    }

    const entryFee = computeEntryFee(raceData, candidate.difficultyKey);
    candidate.simulations[checkpoint] = {
      winRate: winCount / sampleCount,
      topTwoRate: topTwoCount / sampleCount,
      averageRank: totalRank / sampleCount,
      expectedPrize: totalPrize / sampleCount,
      expectedValue: totalPrize / sampleCount - entryFee,
      repairRiskCost: 0,
    };
  });

  return candidate;
}

function simulateProfileScenario({
  raceData,
  candidate,
  difficultyKey,
  raceCount,
  sampleCount,
  seedPrefix,
  reactionSeconds,
}) {
  let winCount = 0;
  let topThreeCount = 0;
  let totalRank = 0;
  let totalFinishSeconds = 0;
  let totalOpponentStrength = 0;

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const seed = createHash(
      `${seedPrefix}|${difficultyKey}|${candidate.profileKey}|${raceCount}|${sample}`
    );
    const result = simulateRace(
      raceData,
      candidate,
      difficultyKey,
      raceCount,
      seed,
      reactionSeconds
    );

    totalRank += result.playerRank;
    totalFinishSeconds += result.finishSeconds;
    totalOpponentStrength += result.opponentStrength;
    if (result.playerRank === 1) {
      winCount += 1;
    }
    if (result.playerRank <= 3) {
      topThreeCount += 1;
    }
  }

  return {
    build: candidate.profileKey,
    buildLabel: candidate.profileLabel,
    buildDescription: candidate.profileDescription,
    raceCount,
    playerRating: candidate.playerRating,
    averageRank: totalRank / sampleCount,
    winRate: winCount / sampleCount,
    topThreeRate: topThreeCount / sampleCount,
    averageFinishSeconds: totalFinishSeconds / sampleCount,
    averageOpponentStrength: totalOpponentStrength / sampleCount,
    opponentPlayerRatio: totalOpponentStrength / sampleCount / candidate.playerRating,
    totalCost: candidate.totalCost,
    upgradeCost: candidate.upgradeCost || 0,
    mythicUpgradeSummary: candidate.mythicUpgradeSummary || '-',
    config: formatConfig(candidate),
  };
}

function getFocusStats(candidate, focusCheckpoints) {
  const simulations = focusCheckpoints.map((checkpoint) => candidate.simulations[checkpoint]);

  return {
    averageWinRate: simulations.reduce((sum, item) => sum + item.winRate, 0) / simulations.length,
    minimumWinRate: Math.min(...simulations.map((item) => item.winRate)),
    averageExpectedValue:
      simulations.reduce((sum, item) => sum + item.expectedValue, 0) / simulations.length,
    averageRank: simulations.reduce((sum, item) => sum + item.averageRank, 0) / simulations.length,
  };
}

function resolveFocusCheckpoints(difficultyKey, checkpoints) {
  const preferred = DEFAULT_FOCUS[difficultyKey] || checkpoints;
  const filtered = preferred.filter((checkpoint) => checkpoints.includes(checkpoint));
  const lateCheckpoints = LATE_GAME_DIFFICULTY_KEYS.has(difficultyKey)
    ? checkpoints.filter((checkpoint) => checkpoint >= LATE_GAME_RACE_COUNT)
    : [];
  const merged = [...new Set([...filtered, ...lateCheckpoints])].sort((left, right) => left - right);

  return merged.length > 0 ? merged : checkpoints;
}

function enumerateDifficulty({ raceData, difficultyKey, checkpoints, topK, mythicLevels }) {
  const focusCheckpoints = resolveFocusCheckpoints(difficultyKey, checkpoints);
  const slotOptions = buildDifficultyOptions(raceData, difficultyKey, mythicLevels);
  const selectedOptions = new Array(slotOptions.length);
  const totals = {
    engine: raceData.BASE_PLAYER_STATS.engine,
    tire: raceData.BASE_PLAYER_STATS.tire,
    gearbox: raceData.BASE_PLAYER_STATS.gearbox,
    stability: raceData.BASE_PLAYER_STATS.stability,
    weight: raceData.BASE_PLAYER_STATS.weight,
    hp: raceData.BASE_PLAYER_STATS.hp,
  };

  const tracker = {
    comboCount: 0,
    checkpointProxyPassCount: Object.fromEntries(checkpoints.map((checkpoint) => [checkpoint, 0])),
    focusProxyPassCount: 0,
    strongest: [],
    stablest: [],
    value: [],
    budget: [],
    emptyConfig: null,
  };

  function visitSlot(slotIndex, totalCost) {
    if (slotIndex >= slotOptions.length) {
      tracker.comboCount += 1;
      const snapshot = createCandidateSnapshot({
        raceData,
        difficultyKey,
        checkpoints,
        focusCheckpoints,
        selectedOptions,
        totals,
        totalCost,
      });

      checkpoints.forEach((checkpoint) => {
        if (snapshot.proxyMargins[checkpoint].gap >= 0) {
          tracker.checkpointProxyPassCount[checkpoint] += 1;
        }
      });

      if (snapshot.focus.minimumGap >= 0) {
        tracker.focusProxyPassCount += 1;
      }

      if (snapshot.options.every((option) => option.name === '-')) {
        tracker.emptyConfig = snapshot;
      }

      const strongestScore = snapshot.focus.averageGap;
      const stableScore = snapshot.focus.minimumGap;
      const valueScore = snapshot.focus.averageGap / Math.max(snapshot.totalCost, 120);

      maybePushTop(tracker.strongest, topK, strongestScore, snapshot);
      maybePushTop(tracker.stablest, topK, stableScore, snapshot);
      maybePushTop(tracker.value, topK, valueScore, snapshot);
      maybePushBudget(tracker.budget, topK, snapshot);
      return;
    }

    slotOptions[slotIndex].forEach((option) => {
      selectedOptions[slotIndex] = option;
      totals.engine += option.engine;
      totals.tire += option.tire;
      totals.gearbox += option.gearbox;
      totals.stability += option.stability;
      totals.weight += option.weight;
      totals.hp += option.hp;

      visitSlot(slotIndex + 1, totalCost + option.price);

      totals.engine -= option.engine;
      totals.tire -= option.tire;
      totals.gearbox -= option.gearbox;
      totals.stability -= option.stability;
      totals.weight -= option.weight;
      totals.hp -= option.hp;
    });
  }

  visitSlot(0, 0);

  return {
    difficultyKey,
    focusCheckpoints,
    slotOptionCounts: Object.fromEntries(
      raceData.EQUIPMENT_SLOTS.map((slot, index) => [slot, slotOptions[index].length])
    ),
    ...tracker,
  };
}

function collectUniqueCandidates(result) {
  const byKey = new Map();

  [
    ...result.strongest.map((item) => item.snapshot),
    ...result.stablest.map((item) => item.snapshot),
    ...result.value.map((item) => item.snapshot),
    ...result.budget,
    result.emptyConfig,
  ]
    .filter(Boolean)
    .forEach((candidate) => {
      byKey.set(candidate.configKey, candidate);
    });

  return [...byKey.values()];
}

function pickBestCandidate(candidates, focusCheckpoints, scoreGetter) {
  return candidates
    .slice()
    .sort(
      (left, right) => scoreGetter(right, focusCheckpoints) - scoreGetter(left, focusCheckpoints)
    )[0];
}

function formatConfig(candidate) {
  return (
    candidate.options
      .filter((option) => option.name !== '-')
      .map((option) => {
        const upgradeSuffix = option.upgradeLevel > 0 ? ` +${option.upgradeLevel}` : '';
        return `${option.slot}=${option.name}${upgradeSuffix}`;
      })
      .join(' / ') || '全空配'
  );
}

function buildDifficultyDiagnosis({ result, simulatedCandidates }) {
  const focusCheckpoints = result.focusCheckpoints;
  const target = DIFFICULTY_TARGETS[result.difficultyKey] || DIFFICULTY_TARGETS.normal;
  const strongest = pickBestCandidate(
    simulatedCandidates,
    focusCheckpoints,
    (candidate, focus) => getFocusStats(candidate, focus).averageWinRate
  );
  const stablest = pickBestCandidate(
    simulatedCandidates,
    focusCheckpoints,
    (candidate, focus) =>
      getFocusStats(candidate, focus).minimumWinRate * 100 -
      getFocusStats(candidate, focus).averageRank
  );
  const valuePool = simulatedCandidates.filter((candidate) => {
    const focusStats = getFocusStats(candidate, focusCheckpoints);
    return (
      focusStats.averageExpectedValue > 0 &&
      focusStats.minimumWinRate >= Math.max(0.18, target.budgetWinRate)
    );
  });
  const value = pickBestCandidate(valuePool, focusCheckpoints, (candidate, focus) => {
    const focusStats = getFocusStats(candidate, focus);
    return (
      focusStats.averageExpectedValue / Math.max(candidate.totalCost, 120) +
      focusStats.averageWinRate * 0.01
    );
  });
  const budget = simulatedCandidates
    .filter(
      (candidate) =>
        getFocusStats(candidate, focusCheckpoints).minimumWinRate >= target.budgetWinRate
    )
    .sort((left, right) => {
      if (left.totalCost !== right.totalCost) {
        return left.totalCost - right.totalCost;
      }
      return (
        getFocusStats(right, focusCheckpoints).minimumWinRate -
        getFocusStats(left, focusCheckpoints).minimumWinRate
      );
    })[0];
  const emptyStats = result.emptyConfig
    ? getFocusStats(result.emptyConfig, focusCheckpoints)
    : null;
  const strongestFocus = strongest ? getFocusStats(strongest, focusCheckpoints) : null;
  const stablestFocus = stablest ? getFocusStats(stablest, focusCheckpoints) : null;
  const valueFocus = value ? getFocusStats(value, focusCheckpoints) : null;
  const lateCheckpoint = Math.max(...focusCheckpoints);
  const lateStrongestRate = strongest ? strongest.simulations[lateCheckpoint].winRate : 0;
  const earlyCheckpoint = Math.min(...DEFAULT_CHECKPOINTS);
  const earlyStrongestRate =
    strongest && strongest.simulations[earlyCheckpoint]
      ? strongest.simulations[earlyCheckpoint].winRate
      : 0;
  const obviousBrailsThreshold =
    result.difficultyKey === 'nightmare' ? 0.68 : result.difficultyKey === 'hard' ? 0.78 : 0.9;
  const brainless =
    Boolean(budget) &&
    getFocusStats(budget, focusCheckpoints).minimumWinRate >= obviousBrailsThreshold;
  const impossibleGap =
    !strongest || lateStrongestRate < target.lateFloor || result.focusProxyPassCount === 0;

  return {
    strongest,
    stablest,
    value: value || strongest || stablest || null,
    budget,
    emptyStats,
    strongestFocus,
    stablestFocus,
    valueFocus,
    findings: {
      brainless,
      impossibleGap,
      nightmareEarlyOverrun: result.difficultyKey === 'nightmare' && earlyStrongestRate >= 0.7,
      singleStatSmash:
        Boolean(strongest) &&
        ['hard', 'expert', 'nightmare'].includes(result.difficultyKey) &&
        strongest.profile.dominantShare >= 0.48 &&
        strongestFocus &&
        strongestFocus.averageWinRate >= 0.55,
    },
  };
}

function printDifficultyReport({ raceData, result, diagnosis, checkpoints }) {
  const difficulty = raceData.DIFFICULTIES[result.difficultyKey];
  const focusCheckpoints = result.focusCheckpoints;
  const positiveShare = result.focusProxyPassCount / result.comboCount;
  const baseRow = {
    难度: `${result.difficultyKey} / ${difficulty.name}`,
    组合数: result.comboCount,
    焦点检查点: focusCheckpoints.join(', '),
    代理过线占比: formatPercent(positiveShare),
    报名费: computeEntryFee(raceData, result.difficultyKey),
  };

  console.log(`\n=== ${difficulty.name} (${result.difficultyKey}) ===`);
  console.table([baseRow]);
  console.table(
    checkpoints.map((checkpoint) => ({
      检查点: checkpoint,
      代理过线组合占比: formatPercent(
        result.checkpointProxyPassCount[checkpoint] / result.comboCount
      ),
    }))
  );

  const rows = [
    ['最强配置', diagnosis.strongest, diagnosis.strongestFocus],
    ['最稳配置', diagnosis.stablest, diagnosis.stablestFocus],
    ['性价比配置', diagnosis.value, diagnosis.valueFocus],
  ]
    .filter(([, candidate, focus]) => candidate && focus)
    .map(([label, candidate, focus]) => {
      const lateCheckpoint = Math.max(...focusCheckpoints);
      const earlyCheckpoint = Math.min(...checkpoints);
      return {
        类型: label,
        成本: candidate.totalCost,
        强化成本: candidate.upgradeCost || 0,
        神话强化: candidate.mythicUpgradeSummary || '-',
        Rating: formatNumber(candidate.playerRating, 3),
        焦点平均胜率: formatPercent(focus.averageWinRate),
        焦点最低胜率: formatPercent(focus.minimumWinRate),
        焦点平均收益: formatNumber(focus.averageExpectedValue, 1),
        早期胜率: candidate.simulations[earlyCheckpoint]
          ? formatPercent(candidate.simulations[earlyCheckpoint].winRate)
          : '-',
        后期胜率: candidate.simulations[lateCheckpoint]
          ? formatPercent(candidate.simulations[lateCheckpoint].winRate)
          : '-',
        主属性倾向: `${candidate.profile.dominantStat} ${formatPercent(
          candidate.profile.dominantShare
        )}`,
      };
    });

  console.table(rows);

  [
    ['最强配置', diagnosis.strongest],
    ['最稳配置', diagnosis.stablest],
    ['性价比配置', diagnosis.value],
    ['低成本过线参考', diagnosis.budget],
  ]
    .filter(([, candidate]) => candidate)
    .forEach(([label, candidate]) => {
      console.log(`${label}: ${formatConfig(candidate)}`);
    });

  const notes = [];
  if (diagnosis.emptyStats) {
    notes.push(`空配焦点平均胜率 ${formatPercent(diagnosis.emptyStats.averageWinRate)}`);
  }
  notes.push(`维修风险成本按 0 计（当前 race 逻辑无维修/耐久扣费公式，脚本只验算现有玩法）`);

  if (diagnosis.findings.brainless) {
    notes.push('存在明显无脑通关配置：低成本过线参考在焦点检查点仍保持极高胜率');
  } else {
    notes.push('未发现明显无脑通关配置');
  }

  if (diagnosis.findings.impossibleGap) {
    notes.push('存在断层风险：顶配后期胜率或代理过线占比仍偏低');
  } else {
    notes.push('未发现明显断层：至少存在一段可达配置区间');
  }

  if (diagnosis.findings.nightmareEarlyOverrun) {
    notes.push('噩梦难度前期过强：顶配在早期检查点已接近轻松碾压');
  }

  if (diagnosis.findings.singleStatSmash) {
    notes.push('高难度存在单一属性碾压倾向：最强配置主属性占比过高');
  }

  notes.forEach((note) => {
    console.log(`- ${note}`);
  });
}

function printProfileReport({
  raceData,
  difficultyKey,
  scenarios,
  sampleCount,
  reactionSeconds,
  skippedLateScenarioCount = 0,
}) {
  const difficulty = raceData.DIFFICULTIES[difficultyKey];

  console.log(`\n=== ${difficulty.name} (${difficultyKey}) / 固定 build 回归 ===`);
  console.table([
    {
      来源: 'lab-public/race/scripts/{config,core,race-formulas,race}.js',
      样本数: sampleCount,
      反应时间: `${reactionSeconds}s`,
      报名费: computeEntryFee(raceData, difficultyKey),
    },
  ]);
  console.table(
    scenarios.map((scenario) => ({
      Build: `${scenario.build} / ${scenario.buildLabel}`,
      描述: scenario.buildDescription,
      raceCount: scenario.raceCount,
      成本: scenario.totalCost,
      强化成本: scenario.upgradeCost,
      神话强化: scenario.mythicUpgradeSummary,
      玩家Rating: formatNumber(scenario.playerRating, 3),
      对手均强: formatNumber(scenario.averageOpponentStrength, 3),
      强度比: formatNumber(scenario.opponentPlayerRatio, 3),
      平均名次: formatNumber(scenario.averageRank, 3),
      胜率: formatPercent(scenario.winRate),
      前三率: formatPercent(scenario.topThreeRate),
      平均完赛: `${formatNumber(scenario.averageFinishSeconds, 3)}s`,
    }))
  );

  scenarios.forEach((scenario) => {
    console.log(`${scenario.buildLabel}: ${scenario.config}`);
  });

  if (skippedLateScenarioCount > 0) {
    console.log(
      `- 已跳过 ${skippedLateScenarioCount} 个 ${LATE_GAME_RACE_COUNT}+ 场场景：55 场以后只检测噩梦难度`
    );
  }
}

function main() {
  const startedAt = performance.now();
  const args = parseArgs(process.argv.slice(2));
  const raceData = loadRaceData();
  validateSourceTexts(raceData.sourceText);

  const difficultyKeys = raceData.DIFFICULTY_ORDER.filter((key) => {
    if (!args.difficultyFilter) {
      return true;
    }
    return key === args.difficultyFilter;
  });

  if (difficultyKeys.length === 0) {
    throw new Error(`未找到难度：${args.difficultyFilter}`);
  }

  console.log('Race balance check');
  if (args.mode === 'profiles') {
    console.table([
      {
        模式: 'profiles',
        难度: difficultyKeys.join(', '),
        Builds: args.profileBuilds.join(', '),
        raceCount: args.profileRaceCounts.join(', '),
        样本数: args.sampleCount,
        反应时间: `${args.reactionSeconds}s`,
      },
    ]);

    difficultyKeys.forEach((difficultyKey) => {
      let skippedLateScenarioCount = 0;
      const scenarios = args.profileBuilds
        .map((profileKey, index) => ({
          profileKey,
          raceCount: args.profileRaceCounts[index],
        }))
        .filter(({ raceCount }) => {
          const shouldCheck = shouldCheckRaceCountForDifficulty(difficultyKey, raceCount);
          if (!shouldCheck) {
            skippedLateScenarioCount += 1;
          }
          return shouldCheck;
        })
        .map(({ profileKey, raceCount }) =>
          simulateProfileScenario({
            raceData,
            candidate: createProfileCandidate(raceData, difficultyKey, profileKey),
            difficultyKey,
            raceCount,
            sampleCount: args.sampleCount,
            seedPrefix: args.seed,
            reactionSeconds: args.reactionSeconds,
          })
        );

      if (scenarios.length === 0) {
        console.log(
          `\n=== ${raceData.DIFFICULTIES[difficultyKey].name} (${difficultyKey}) / 固定 build 回归 ===`
        );
        console.log(`- 已跳过全部场景：55 场以后只检测噩梦难度`);
        return;
      }

      printProfileReport({
        raceData,
        difficultyKey,
        scenarios,
        sampleCount: args.sampleCount,
        reactionSeconds: args.reactionSeconds,
        skippedLateScenarioCount,
      });
    });
  } else {
    console.table([
      {
        来源: 'lab-public/race/scripts/{config,core,race-formulas,race}.js',
        检查点: args.checkpoints.join(', '),
        '55+检查难度': [...LATE_GAME_DIFFICULTY_KEYS].join(', '),
        神话强化档: args.mythicLevels.map((level) => `+${level}`).join(', '),
        样本数: args.sampleCount,
        候选保留数: args.topK,
        反应时间: `${args.reactionSeconds}s`,
        维修风险成本: '0',
      },
    ]);

    difficultyKeys.forEach((difficultyKey) => {
      const difficultyCheckpoints = resolveDifficultyCheckpoints(difficultyKey, args.checkpoints);
      if (difficultyCheckpoints.length === 0) {
        console.log(
          `\n=== ${raceData.DIFFICULTIES[difficultyKey].name} (${difficultyKey}) ===`
        );
        console.log(`- 已跳过：55 场以后只检测噩梦难度`);
        return;
      }

      const enumerated = enumerateDifficulty({
        raceData,
        difficultyKey,
        checkpoints: difficultyCheckpoints,
        topK: args.topK,
        mythicLevels: args.mythicLevels,
      });

      const candidates = collectUniqueCandidates(enumerated).map((candidate) =>
        simulateCandidate({
          raceData,
          candidate,
          checkpoints: difficultyCheckpoints,
          sampleCount: args.sampleCount,
          seedPrefix: args.seed,
          reactionSeconds: args.reactionSeconds,
        })
      );

      const diagnosis = buildDifficultyDiagnosis({
        result: enumerated,
        simulatedCandidates: candidates,
      });

      printDifficultyReport({
        raceData,
        result: enumerated,
        diagnosis,
        checkpoints: difficultyCheckpoints,
      });
    });
  }

  console.log(`\n耗时 ${(performance.now() - startedAt).toFixed(1)} ms`);
}

main();
