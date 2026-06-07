'use strict';

/*
 * 赛车游戏的静态配置中心。
 * 这里维护文案、经济数值、难度、成就和零件池，运行时状态放在 state.js。
 */

// 阶段名只用于状态栏和日志展示，不直接驱动比赛流程。
const PHASE_LABELS = {
  idle: '待机',
  registered: '已报名',
  countdown_red: '红灯',
  countdown_yellow: '黄灯',
  countdown_green: '绿灯',
  racing: '比赛中',
  finished: '比赛结束',
  false_start: '抢跑犯规',
  shop: '商店',
  garage: '改装',
  game_over: '游戏失败',
};

const PRIZES = [1200, 800, 500, 200, 100];
const ENTRY_FEE = 200;
const PRACTICE_PRIZE_RATES = [0.7, 0.62, 0.55, 0.48, 0.42];
const PRACTICE_OPPONENT_STRENGTH_MULTIPLIER = 0.78;
const PART_SELL_RATE = 0.8;
const FINISH = 100;
const TICK_MS = 45;
const STORAGE_KEY = 'mpsteam-race-save-v1';
const RACE_AUDIO_STORAGE_KEY = 'raceAudioEnabled';
const RACE_LOCAL_LOG_STORAGE_KEY = 'mpsteam-race-local-logs-v1';
const RACE_LEGACY_STORAGE_KEYS = ['raceSave', 'raceSettings', 'raceAchievements', 'raceLocalLogs'];
const DEFAULT_SETTINGS = Object.freeze({
  soundEnabled: true,
  telemetryEnabled: true,
});
const GAME_VERSION = 'v2.0';
const GAME_VERSION_NOTE =
  '神话装备强化系统与设置更新：可强化神话装备，并新增信息收集与本地数据清理开关。';
const AI_ASSIST_REACTION_RANGE_SECONDS = [0.22, 0.4];
const MIN_MANUAL_REACTION_SECONDS = 0.001;
const LOSS_STREAK_RELIEF = {
  easy: {
    threshold: 3,
    opponentMultiplier: 0.88,
  },
  normal: {
    threshold: 4,
    opponentMultiplier: 0.94,
  },
};

const BASE_PLAYER_STATS = {
  engine: 10,
  tire: 10,
  gearbox: 10,
  stability: 10,
  weight: 1000,
  hp: 100,
};

const EQUIPMENT_SLOTS = [
  'Engine',
  'Tire',
  'Gearbox',
  'Body',
  'Intake',
  'Exhaust',
  'Turbo',
  'Stability',
];

const PART_TYPE_LABELS = {
  Engine: '引擎',
  Tire: '轮胎',
  Gearbox: '变速箱',
  Body: '车身',
  Intake: '进气',
  Exhaust: '排气',
  Turbo: '涡轮',
  Stability: '稳定件',
};

const PART_STAT_ORDER = ['engine', 'tire', 'gearbox', 'stability', 'weight', 'hp'];

const PART_STAT_LABELS = {
  engine: '引擎',
  tire: '轮胎',
  gearbox: '变速箱',
  stability: '稳定性',
  weight: '重量',
  hp: '马力',
};

const PART_RARITY_LABELS = {
  common: '普通',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
  mythic: '神话',
};

const PART_RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic'];

const PART_RARITY_WEIGHTS = {
  common: 70,
  rare: 22,
  epic: 6,
  legendary: 1.6,
  mythic: 0.4,
};

const SHOP_OWNED_PART_WEIGHT = 0.2;
const MYTHIC_UPGRADE_MAX_LEVEL = 10;
const MYTHIC_UPGRADE_BONUS_PER_LEVEL = 0.0335;
const MYTHIC_UPGRADE_STAT_KEYS = ['hp', 'engine', 'tire', 'gearbox', 'stability'];
const MYTHIC_UPGRADE_LEVEL_BONUS_RATES = {
  1: 1,
  2: 1,
  3: 1,
  4: 0.75,
  5: 0.75,
  6: 0.75,
  7: 0.75,
  8: 0.5,
  9: 0.5,
  10: 0.5,
};
const MYTHIC_STAT_WEIGHTS = {
  hp: 0.65,
  engine: 0.75,
  tire: 1.1,
  gearbox: 1.15,
  stability: 1.45,
};
const MYTHIC_UPGRADE_SUCCESS_RATES = {
  1: 1,
  2: 1,
  3: 0.9,
  4: 0.8,
  5: 0.7,
  6: 0.6,
  7: 0.5,
  8: 0.4,
  9: 0.32,
  10: 0.25,
};
const MYTHIC_UPGRADE_COST = {
  1: 1200,
  2: 1800,
  3: 2600,
  4: 3800,
  5: 5600,
  6: 7800,
  7: 10500,
  8: 13800,
  9: 17800,
  10: 22800,
};
const OPPONENT_CHASE_START_RACE = 6;
const OPPONENT_CHASE_RAMP_RACES = 14;
const OPPONENT_CHASE_CAP = 1.05;
const NIGHTMARE_SLOW_REACTION_SECONDS = 0.6;
const NEURAL_LINK_REACTION_SECONDS = 0.01;
const SLEEPY_START_REACTION_SECONDS = 1;
const NIGHTMARE_GLASS_CANNON_RATING = 3.2;
const NIGHTMARE_GLASS_CANNON_MAX_STABILITY = 8;
const NIGHTMARE_STABLE_DOG_MIN_STABILITY = 50;

// 旧存档/旧数据的稀有度迁移表：uncommon 统一并入 rare。
const PART_RARITY_MIGRATIONS = {
  uncommon: 'rare',
};

// 难度配置会同时影响报名费、奖金、电脑追赶速度和商店奖池范围。
const DIFFICULTIES = {
  easy: {
    name: '休闲',
    opponentMultiplier: 0.92,
    rewardMultiplier: 0.8,
    dropRateMultiplier: 1.2,
    entryFeeMultiplier: 0.8,
    chaseRate: 0.015,
    opponentChaseCap: 0.7,
    maxOpponentStrength: 1.5,
    opponentChaseStartRace: 6,
    opponentChaseRampRaces: 14,
    earlyRaceAssist: 0.2,
    reactionGrace: 0.06,
  },
  normal: {
    name: '标准',
    opponentMultiplier: 1.04,
    rewardMultiplier: 1.0,
    dropRateMultiplier: 1.0,
    entryFeeMultiplier: 1.0,
    chaseRate: 0.045,
    opponentChaseCap: 0.85,
    maxOpponentStrength: 1.8,
    opponentChaseStartRace: 6,
    opponentChaseRampRaces: 14,
    earlyRaceAssist: 0.18,
    reactionGrace: 0.04,
  },
  hard: {
    name: '挑战',
    opponentMultiplier: 1.2,
    rewardMultiplier: 1.25,
    dropRateMultiplier: 0.85,
    entryFeeMultiplier: 1.3,
    chaseRate: 0.12,
    opponentChaseCap: 0.95,
    maxOpponentStrength: 3.45,
    opponentChaseStartRace: 6,
    opponentChaseRampRaces: 14,
  },
  expert: {
    name: '专家',
    opponentMultiplier: 1.42,
    rewardMultiplier: 1.6,
    dropRateMultiplier: 0.65,
    entryFeeMultiplier: 1.7,
    chaseRate: 0.24,
    opponentChaseCap: 1.0,
    minOpponentStrength: 2.15,
    maxOpponentStrength: 4.35,
    opponentChaseStartRace: 7,
    opponentChaseRampRaces: 16,
  },
  nightmare: {
    name: '噩梦',
    opponentMultiplier: 1.56,
    rewardMultiplier: 2.2,
    dropRateMultiplier: 0.45,
    entryFeeMultiplier: 2.4,
    chaseRate: 0.25,
    opponentChaseCap: 1.0,
    minOpponentStrength: 2.65,
    maxOpponentStrength: null,
    opponentChaseStartRace: 10,
    opponentChaseRampRaces: 24,
  },
};

const DIFFICULTY_ORDER = ['easy', 'normal', 'hard', 'expert', 'nightmare'];
const DEFAULT_DIFFICULTY = 'normal';

// 各难度商店奖池允许出现的稀有度范围。
// 商店出现概率仅由 LOOT_POOLS + PART_RARITY_WEIGHTS 决定；
// dropRateMultiplier 不参与商店概率，预留给后续比赛掉落系统。
const LOOT_POOLS = {
  easy: ['common', 'rare'],
  normal: ['common', 'rare', 'epic'],
  hard: ['rare', 'epic', 'legendary'],
  expert: ['rare', 'epic', 'legendary'],
  nightmare: ['epic', 'legendary', 'mythic'],
};

const RACE_TIERS = [
  { minRaceCount: 0, label: '街边练习赛' },
  { minRaceCount: 5, label: '城郊挑战赛' },
  { minRaceCount: 12, label: '地下高速赛' },
];

const PART_TEMPLATE_ID_OVERRIDES = {
  'Gearbox:雪主任祖传扳手': 'gearbox_xue_wrench',
  'Stability:小雨小报赞助': 'stability_xiaoyu_sponsor',
};

// templateId 需要跨版本稳定，用于旧存档把“同款零件”重新映射到当前零件池。
function createPartTemplateSeed(part) {
  return `${part.type}|${part.name}|${part.rarity}|${part.price}|${part.effectText}`;
}

function createStableToken(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function createPartTemplateId(part) {
  const overrideKey = `${part.type}:${part.name}`;
  if (PART_TEMPLATE_ID_OVERRIDES[overrideKey]) {
    return PART_TEMPLATE_ID_OVERRIDES[overrideKey];
  }

  return `${part.type.toLowerCase()}_${createStableToken(createPartTemplateSeed(part))}`;
}

// 成就条件只保存 check key，实际判定集中在 achievements.js。
const ACHIEVEMENTS = [
  {
    id: 'firstRace',
    name: '初次上路',
    description: '完成第一场比赛。',
    category: '入门',
    check: 'firstRace',
    flavor: '第一张参赛单终于不是空白。',
  },
  {
    id: 'firstWin',
    name: '第一桶金',
    description: '首次赢得一场比赛。',
    category: '入门',
    check: 'firstWin',
    flavor: '奖金到账，车队账本终于不是纯亏损了。',
  },
  {
    id: 'firstPart',
    name: '改装开始',
    description: '首次购买零件。',
    category: '入门',
    check: 'firstPart',
    flavor: '车库里第一次传出了拧螺丝的声音。',
  },
  {
    id: 'firstEquip',
    name: '拧上去了',
    description: '首次装备零件。',
    category: '入门',
    check: 'firstEquip',
    flavor: '总之先装上，跑起来再说。',
  },
  {
    id: 'fullSlots',
    name: '装满再说',
    description: '首次装满全部槽位。',
    category: '入门',
    check: 'fullSlots',
    flavor: '这下每个位置都塞进东西了。',
  },
  {
    id: 'mythic_upgrade_first',
    name: '神话开刃',
    description: '第一次成功强化神话装备。',
    category: '神话强化',
    check: 'firstMythicUpgrade',
    flavor: '神话件第一次留下了强化刻痕。',
  },
  {
    id: 'harukawa_cat_sticker',
    name: '晴川猫猫贴纸',
    description: '外交官亲自贴上的猫猫贴纸，据说能让赛车看起来更容易被原谅。',
    category: '彩蛋',
    check: 'harukawaCatSticker',
    flavor: '晴川：失败也没关系啦，至少车现在看起来比较可爱。',
  },
  {
    id: 'mythic_upgrade_ten',
    name: '十阶神装',
    description: '将任意一件神话装备强化到 +10。',
    category: '神话强化',
    check: 'anyMythicUpgradeMaxed',
    flavor: '这件神话装备已经被打磨到顶。',
  },
  {
    id: 'mythic_upgrade_resonance',
    name: '全神话 +10',
    description: '所有可强化神话部件都达到 +10。',
    category: '神话强化',
    check: 'allMythicTemplatesUpgradeMaxed',
    flavor: '车库里每一种神话部件都完成了终局调校。',
  },
  {
    id: 'normalWin',
    name: '标准车手',
    description: '在标准难度赢得一场比赛。',
    category: '难度',
    check: 'normalWin',
    flavor: '标准难度的门票算是拿稳了。',
  },
  {
    id: 'hardWin',
    name: '挑战者',
    description: '在挑战难度赢得一场比赛。',
    category: '难度',
    check: 'hardWin',
    flavor: '开始有人认真看你这台车了。',
  },
  {
    id: 'expertWin',
    name: '专家入场券',
    description: '在专家难度赢得一场比赛。',
    category: '难度',
    check: 'expertWin',
    flavor: '再往上，已经不是随便乱跑的局了。',
  },
  {
    id: 'nightmareWin',
    name: '噩梦执照',
    description: '在噩梦难度赢得一场比赛。',
    category: '难度',
    check: 'nightmareWin',
    flavor: '雪主任在文件角落签了个名。',
  },
  {
    id: 'nightmareStreak3',
    name: '噩梦不是梦',
    description: '在噩梦难度达成 3 连胜。',
    category: '难度',
    check: 'nightmareStreak3',
    flavor: '连噩梦局都开始像固定节目了。',
  },
  {
    id: 'win10',
    name: '十胜车手',
    description: '累计赢得 10 场比赛。',
    category: '经营',
    check: 'win10',
    flavor: '奖杯还不多，胜场已经像样了。',
  },
  {
    id: 'race30',
    name: '再来一局',
    description: '累计完成 30 场比赛。',
    category: '经营',
    check: 'race30',
    flavor: '今天最后一把这种话，已经没人信了。',
  },
  {
    id: 'cash5000',
    name: '小有积蓄',
    description: '资金首次达到 5000。',
    category: '经营',
    check: 'cash5000',
    flavor: '账面终于有点样子了。',
  },
  {
    id: 'cash20000',
    name: '王都富婆车队',
    description: '资金首次达到 20000。',
    category: '经营',
    check: 'cash20000',
    flavor: '财务看着余额，语气都稳了不少。',
  },
  {
    id: 'streak3',
    name: '手感来了',
    description: '达成 3 连胜。',
    category: '经营',
    check: 'streak3',
    flavor: '这两天上赛道，方向盘都顺手了。',
  },
  {
    id: 'streak5',
    name: '一路狂飙',
    description: '达成 5 连胜。',
    category: '经营',
    check: 'streak5',
    flavor: '维修站已经开始默认你会赢。',
  },
  {
    id: 'hpBeliever',
    name: '大马力信仰',
    description: '以 hp 主属性倾向超过 55% 的配置赢得一场比赛。',
    category: '整活',
    check: 'hpBeliever',
    flavor: '所有问题，都被试着用马力解决了。',
  },
  {
    id: 'stableDriver',
    name: '稳字当头',
    description: '以高稳定配置赢得一场比赛。',
    category: '整活',
    check: 'stableDriver',
    flavor: '方向稳了，心态也跟着稳了。',
  },
  {
    id: 'xueWrenchWin',
    name: '雪主任认可',
    description: '装备“雪主任祖传扳手”并赢得一场比赛。',
    category: '整活',
    hidden: true,
    check: 'xueWrenchWin',
    flavor: '扳手上那层旧漆，好像真的带点玄学。',
  },
  {
    id: 'xiaoyuSponsorWin',
    name: '小雨小报头条',
    description: '装备“小雨小报赞助”并赢得一场比赛。',
    category: '整活',
    hidden: true,
    check: 'xiaoyuSponsorWin',
    flavor: '明天小报标题已经想好了。',
  },
  {
    id: 'broke_entry_attempt',
    name: '家财散尽',
    description: '余额不足报名费时，仍然点击报名。',
    category: '经济行为',
    hidden: true,
    check: 'brokeEntryAttempt',
    flavor: '报名费都凑不齐了，但梦想还是热的。',
  },
  {
    id: 'lianlian_low_power_fuel_pack',
    name: '脸脸低电量省油包',
    description: '低电量驾驶专用补给包。跑不快没关系，能省一点是一点。',
    category: '彩蛋',
    check: 'lianlianLowPowerFuelPack',
    flavor: '脸脸：没电了，先省着跑。',
  },
  {
    id: 'false_start_hot_tofu',
    name: '心急吃不了热豆腐',
    description: '首次抢跑 / 犯规。',
    category: '比赛表现',
    hidden: true,
    check: 'falseStartHotTofu',
    flavor: '灯还没绿，车已经替你做决定了。',
  },
  {
    id: 'red_light_warrior',
    name: '红灯战神',
    description: '累计抢跑 10 次。',
    category: '比赛表现',
    check: 'falseStartCount10',
    flavor: '红灯不是阻碍，是你的起跑信号。',
  },
  {
    id: 'slippery_hand',
    name: '手滑了吧',
    description: '连续 3 场抢跑。',
    category: '比赛表现',
    check: 'falseStartStreak3',
    flavor: '连续三次提前出发。裁判已经开始认识你了。',
  },
  {
    id: 'neural_link',
    name: '神经直连',
    description: '单场有效反应时间 ≤ 0.010 秒。',
    category: '比赛表现',
    check: 'neuralLinkReaction',
    flavor: '这已经不像反应，像车和大脑签了协议。',
  },
  {
    id: 'sleepy_start',
    name: '睡着了？',
    description: '单场有效起步反应时间 ≥ 1.000 秒。',
    category: '比赛表现',
    check: 'sleepyStartReaction',
    flavor: '灯都绿这么久了，你刚醒吗？',
  },
  {
    id: 'moonlight_driver',
    name: '月光车手',
    description: '比赛结算后余额低于 100。',
    category: '经济行为',
    check: 'lowCashAfterRace',
    flavor: '钱没剩多少，但车还在响。',
  },
  {
    id: 'buy_buy_buy',
    name: '买买买',
    description: '累计购买 10 个零件。',
    category: '经济行为',
    check: 'partsPurchased10',
    flavor: '商店老板看你的眼神变亲切了。',
  },
  {
    id: 'racing_enthusiast_50_wins',
    name: '竞速爱好者',
    description: '累计比赛 50 场。',
    category: '长期游玩',
    check: 'racingEnthusiast50Races',
    flavor: '你已经不是路过玩玩了。',
  },
  {
    id: 'five_fifth_places',
    name: '五五大顺',
    description: '连续 5 场获得第 5 名。',
    category: '比赛表现',
    hidden: true,
    check: 'fiveFifthPlaces',
    flavor: '连续五场第五名。稳定，但有点微妙。',
  },
  {
    id: 'last_place_finish',
    name: '垫底也是抵达终点',
    description: '首次获得最后一名。',
    category: '比赛表现',
    check: 'lastPlaceFinish',
    flavor: '至少你完整地抵达了终点。',
  },
  {
    id: 'how_did_that_win',
    name: '这也能赢？',
    description: '噩梦难度下，反应时间很差但仍获得第一名。',
    category: '比赛表现',
    hidden: true,
    check: 'nightmareSlowReactionWin',
    flavor: '起步慢了点，但结局很倔强。',
  },
  {
    id: 'glass_cannon_nightmare',
    name: '玻璃大炮',
    description: '噩梦难度下，使用高性能、低稳定配置获胜。',
    category: '改装风格',
    hidden: true,
    check: 'nightmareGlassCannonWin',
    flavor: '快是真的快，散也是真的散。',
  },
  {
    id: 'stable_dog_nightmare',
    name: '稳如老狗',
    description: '噩梦难度下，使用高稳定配置获胜。',
    category: '改装风格',
    hidden: true,
    check: 'nightmareStableWin',
    flavor: '不一定最猛，但稳得让人安心。',
  },
  {
    id: 'engineer_smile',
    name: '工程师的微笑',
    description: '所有可装备槽位都已安装配件。',
    category: '改装风格',
    check: 'engineerSmile',
    flavor: '每个槽位都有东西，雪雪看了会点头。',
  },
  {
    id: 'old_driver_100',
    name: '老车手',
    description: '累计比赛 100 场。',
    category: '长期游玩',
    check: 'totalRaces100',
    flavor: '方向盘记住了你的手感。',
  },
  {
    id: 'nightmare_graduate',
    name: '噩梦毕业生',
    description: '在噩梦难度下首次获胜。',
    category: '长期游玩',
    check: 'nightmareGraduate',
    flavor: '噩梦难度，也不过如此……大概。',
  },
  {
    id: 'ten_second_places',
    name: '望尘莫及',
    description: '连续 10 场止步第二名。',
    category: '趣味',
    check: 'tenSecondPlaces',
    flavor: '前车的尾灯看得很清楚，就是追不上。',
  },
  {
    id: 'comeback_after_second_places',
    name: '逆袭登顶',
    description: '连续 10 场止步第二名后获得第 1 名。',
    category: '挑战',
    check: 'comebackAfterSecondPlaces',
    flavor: '看了十场背影，终于把终点线先收入眼底。',
  },
];

// 原始零件池只描述基础属性；下方 PART_POOL 会补充稳定 templateId。
const RAW_PART_POOL = [
  {
    name: '便宜机油',
    type: 'Engine',
    price: 180,
    rarity: 'common',
    effectText: '引擎 +2，稳定性 -1',
    changes: { engine: 2, stability: -1 },
  },
  {
    name: '二手引擎',
    type: 'Engine',
    price: 350,
    rarity: 'common',
    effectText: '引擎 +5，稳定性 -3',
    changes: { engine: 5, stability: -3 },
  },
  {
    name: '高压火花塞',
    type: 'Engine',
    price: 600,
    rarity: 'common',
    effectText: '引擎 +8，稳定性 -2',
    changes: { engine: 8, stability: -2 },
  },
  {
    name: '强化缸垫',
    type: 'Engine',
    price: 850,
    rarity: 'rare',
    effectText: '引擎 +7，马力 +6，重量 +4kg',
    changes: { engine: 7, hp: 6, weight: 4 },
  },
  {
    name: '高压燃油泵',
    type: 'Engine',
    price: 1250,
    rarity: 'epic',
    effectText: '引擎 +10，马力 +10，稳定性 -3',
    changes: { engine: 10, hp: 10, stability: -3 },
  },
  {
    name: '竞速引擎',
    type: 'Engine',
    price: 1800,
    rarity: 'rare',
    effectText: '引擎 +13，马力 +16，稳定性 -5',
    changes: { engine: 13, hp: 16, stability: -5 },
  },
  {
    name: '厂队封存红头机',
    type: 'Engine',
    price: 3600,
    rarity: 'legendary',
    effectText: '引擎 +22，马力 +30，稳定性 -9，重量 +20kg',
    changes: { engine: 22, hp: 30, stability: -9, weight: 20 },
  },

  {
    name: '翻新街胎',
    type: 'Tire',
    price: 260,
    rarity: 'common',
    effectText: '轮胎 +3，稳定性 -1',
    changes: { tire: 3, stability: -1 },
  },
  {
    name: '运动轮胎',
    type: 'Tire',
    price: 750,
    rarity: 'common',
    effectText: '轮胎 +6，稳定性 +1',
    changes: { tire: 6, stability: 1 },
  },
  {
    name: '宽胎',
    type: 'Tire',
    price: 700,
    rarity: 'common',
    effectText: '轮胎 +5，稳定性 +3，重量 +10kg',
    changes: { tire: 5, stability: 3, weight: 10 },
  },
  {
    name: '半热熔胎',
    type: 'Tire',
    price: 1100,
    rarity: 'epic',
    effectText: '轮胎 +10，稳定性 +2，重量 +6kg',
    changes: { tire: 10, stability: 2, weight: 6 },
  },
  {
    name: '窄胎省钱套',
    type: 'Tire',
    price: 220,
    rarity: 'common',
    effectText: '轮胎 +2，重量 -6kg，稳定性 -2',
    changes: { tire: 2, weight: -6, stability: -2 },
  },
  {
    name: '雨战花纹胎',
    type: 'Tire',
    price: 1500,
    rarity: 'rare',
    effectText: '轮胎 +8，稳定性 +5，重量 +10kg',
    changes: { tire: 8, stability: 5, weight: 10 },
  },
  {
    name: '赛道热熔 slick',
    type: 'Tire',
    price: 2900,
    rarity: 'legendary',
    effectText: '轮胎 +18，稳定性 +5，重量 +12kg',
    changes: { tire: 18, stability: 5, weight: 12 },
  },

  {
    name: '短尾牙',
    type: 'Gearbox',
    price: 580,
    rarity: 'common',
    effectText: '变速箱 +4，轮胎 +2',
    changes: { gearbox: 4, tire: 2 },
  },
  {
    name: '轻量化飞轮',
    type: 'Gearbox',
    price: 650,
    rarity: 'common',
    effectText: '变速箱 +5，重量 -20kg，稳定性 -1',
    changes: { gearbox: 5, weight: -20, stability: -1 },
  },
  {
    name: '改装变速箱',
    type: 'Gearbox',
    price: 900,
    rarity: 'rare',
    effectText: '变速箱 +8',
    changes: { gearbox: 8 },
  },
  {
    name: '焊死差速器',
    type: 'Gearbox',
    price: 420,
    rarity: 'common',
    effectText: '变速箱 +5，稳定性 -4',
    changes: { gearbox: 5, stability: -4 },
  },
  {
    name: '密齿齿比组',
    type: 'Gearbox',
    price: 1350,
    rarity: 'epic',
    effectText: '变速箱 +11，马力 +3，重量 +5kg',
    changes: { gearbox: 11, hp: 3, weight: 5 },
  },
  {
    name: '序列式拨片盒',
    type: 'Gearbox',
    price: 2400,
    rarity: 'rare',
    effectText: '变速箱 +15，稳定性 -3，重量 +8kg',
    changes: { gearbox: 15, stability: -3, weight: 8 },
  },
  {
    name: '雪主任祖传扳手',
    type: 'Gearbox',
    price: 3100,
    rarity: 'legendary',
    effectText: '变速箱 +20，引擎 +8，稳定性 -3',
    changes: { gearbox: 20, engine: 8, stability: -3 },
  },

  {
    name: '塑料机盖',
    type: 'Body',
    price: 430,
    rarity: 'common',
    effectText: '重量 -18kg，稳定性 -1',
    changes: { weight: -18, stability: -1 },
  },
  {
    name: '拆空后座',
    type: 'Body',
    price: 240,
    rarity: 'common',
    effectText: '重量 -25kg，稳定性 -3',
    changes: { weight: -25, stability: -3 },
  },
  {
    name: '车身补强杆',
    type: 'Body',
    price: 520,
    rarity: 'common',
    effectText: '稳定性 +6，重量 +12kg',
    changes: { stability: 6, weight: 12 },
  },
  {
    name: '玻璃纤维门板',
    type: 'Body',
    price: 980,
    rarity: 'rare',
    effectText: '重量 -32kg，稳定性 -4',
    changes: { weight: -32, stability: -4 },
  },
  {
    name: '铆钉宽体套件',
    type: 'Body',
    price: 1200,
    rarity: 'rare',
    effectText: '稳定性 +5，轮胎 +3，重量 +18kg',
    changes: { stability: 5, tire: 3, weight: 18 },
  },
  {
    name: '晴川猫猫贴纸',
    type: 'Body',
    price: 888,
    rarity: 'rare',
    effectText: '稳定性 +4，重量 -2kg',
    changes: { stability: 4, weight: -2 },
  },
  {
    name: '轻量复合车门',
    type: 'Body',
    price: 2100,
    rarity: 'epic',
    effectText: '重量 -45kg，稳定性 -3，马力 +3',
    changes: { weight: -45, stability: -3, hp: 3 },
  },
  {
    name: '碳纤维全车壳',
    type: 'Body',
    price: 3400,
    rarity: 'legendary',
    effectText: '重量 -70kg，稳定性 -5，马力 +6',
    changes: { weight: -70, stability: -5, hp: 6 },
  },

  {
    name: '空气滤清器',
    type: 'Intake',
    price: 300,
    rarity: 'common',
    effectText: '马力 +3',
    changes: { hp: 3 },
  },
  {
    name: '街边进气套件',
    type: 'Intake',
    price: 620,
    rarity: 'common',
    effectText: '马力 +7，稳定性 -1',
    changes: { hp: 7, stability: -1 },
  },
  {
    name: '短管进气',
    type: 'Intake',
    price: 520,
    rarity: 'common',
    effectText: '马力 +6，重量 -4kg，稳定性 -1',
    changes: { hp: 6, weight: -4, stability: -1 },
  },
  {
    name: '冷风箱',
    type: 'Intake',
    price: 980,
    rarity: 'rare',
    effectText: '马力 +10，稳定性 +1，重量 +5kg',
    changes: { hp: 10, stability: 1, weight: 5 },
  },
  {
    name: '大口径节气门',
    type: 'Intake',
    price: 1300,
    rarity: 'epic',
    effectText: '马力 +14，引擎 +4，稳定性 -3',
    changes: { hp: 14, engine: 4, stability: -3 },
  },
  {
    name: '脸脸低电量省油包',
    type: 'Intake',
    price: 760,
    rarity: 'rare',
    effectText: '重量 -10kg，稳定性 +3，马力 -2',
    changes: { weight: -10, stability: 3, hp: -2 },
  },
  {
    name: '风洞调校进气盒',
    type: 'Intake',
    price: 2800,
    rarity: 'legendary',
    effectText: '马力 +20，引擎 +7，稳定性 -3',
    changes: { hp: 20, engine: 7, stability: -3 },
  },

  {
    name: '排气管',
    type: 'Exhaust',
    price: 500,
    rarity: 'common',
    effectText: '马力 +5，重量 +2kg',
    changes: { hp: 5, weight: 2 },
  },
  {
    name: '破洞直通尾段',
    type: 'Exhaust',
    price: 260,
    rarity: 'common',
    effectText: '马力 +6，稳定性 -2',
    changes: { hp: 6, stability: -2 },
  },
  {
    name: '轻量中段',
    type: 'Exhaust',
    price: 720,
    rarity: 'common',
    effectText: '马力 +7，重量 -8kg，稳定性 -1',
    changes: { hp: 7, weight: -8, stability: -1 },
  },
  {
    name: '回压调校排气',
    type: 'Exhaust',
    price: 960,
    rarity: 'rare',
    effectText: '马力 +9，稳定性 +2，重量 +4kg',
    changes: { hp: 9, stability: 2, weight: 4 },
  },
  {
    name: '钛合金尾段',
    type: 'Exhaust',
    price: 1600,
    rarity: 'rare',
    effectText: '马力 +13，重量 -14kg，稳定性 -1',
    changes: { hp: 13, weight: -14, stability: -1 },
  },
  {
    name: '赛用等长头段',
    type: 'Exhaust',
    price: 2100,
    rarity: 'rare',
    effectText: '马力 +16，引擎 +4，稳定性 -4',
    changes: { hp: 16, engine: 4, stability: -4 },
  },
  {
    name: '静音高流量排气',
    type: 'Exhaust',
    price: 1850,
    rarity: 'epic',
    effectText: '马力 +15，引擎 +4，稳定性 -2，重量 -4kg',
    changes: { hp: 15, engine: 4, stability: -2, weight: -4 },
  },
  {
    name: '午夜噪声投诉套件',
    type: 'Exhaust',
    price: 3200,
    rarity: 'legendary',
    effectText: '马力 +22，引擎 +6，稳定性 -6，重量 -4kg',
    changes: { hp: 22, engine: 6, stability: -6, weight: -4 },
  },

  {
    name: '旧货市场涡轮',
    type: 'Turbo',
    price: 1100,
    rarity: 'common',
    effectText: '引擎 +10，马力 +12，稳定性 -4',
    changes: { engine: 10, hp: 12, stability: -4 },
  },
  {
    name: '小号涡轮',
    type: 'Turbo',
    price: 900,
    rarity: 'common',
    effectText: '马力 +10，引擎 +4，稳定性 -2',
    changes: { hp: 10, engine: 4, stability: -2 },
  },
  {
    name: '拆车厂增压器',
    type: 'Turbo',
    price: 680,
    rarity: 'common',
    effectText: '马力 +12，稳定性 -6，重量 +8kg',
    changes: { hp: 12, stability: -6, weight: 8 },
  },
  {
    name: '双涡管套件',
    type: 'Turbo',
    price: 1850,
    rarity: 'epic',
    effectText: '马力 +20，引擎 +8，稳定性 -5，重量 +12kg',
    changes: { hp: 20, engine: 8, stability: -5, weight: 12 },
  },
  {
    name: '低延迟滚珠涡轮',
    type: 'Turbo',
    price: 2500,
    rarity: 'rare',
    effectText: '马力 +20，引擎 +8，稳定性 -5，重量 +9kg',
    changes: { hp: 20, engine: 8, stability: -5, weight: 9 },
  },
  {
    name: '大蜗牛高压套',
    type: 'Turbo',
    price: 2900,
    rarity: 'rare',
    effectText: '马力 +30，引擎 +10，稳定性 -10，重量 +18kg',
    changes: { hp: 30, engine: 10, stability: -10, weight: 18 },
  },
  {
    name: '禁区增压黑盒',
    type: 'Turbo',
    price: 4300,
    rarity: 'legendary',
    effectText: '马力 +42，引擎 +16，稳定性 -15，重量 +22kg',
    changes: { hp: 42, engine: 16, stability: -15, weight: 22 },
  },

  {
    name: '钻孔刹车盘',
    type: 'Stability',
    price: 480,
    rarity: 'common',
    effectText: '稳定性 +4，重量 -3kg',
    changes: { stability: 4, weight: -3 },
  },
  {
    name: '加粗防倾杆',
    type: 'Stability',
    price: 620,
    rarity: 'common',
    effectText: '稳定性 +7，重量 +8kg',
    changes: { stability: 7, weight: 8 },
  },
  {
    name: '二手避震',
    type: 'Stability',
    price: 320,
    rarity: 'common',
    effectText: '稳定性 +3，重量 +4kg，轮胎 -1',
    changes: { stability: 3, weight: 4, tire: -1 },
  },
  {
    name: '四轮定位券',
    type: 'Stability',
    price: 760,
    rarity: 'rare',
    effectText: '稳定性 +8，轮胎 +2',
    changes: { stability: 8, tire: 2 },
  },
  {
    name: '防火墙补强板',
    type: 'Stability',
    price: 950,
    rarity: 'epic',
    effectText: '稳定性 +10，重量 +18kg',
    changes: { stability: 10, weight: 18 },
  },
  {
    name: '街赛稳定套件',
    type: 'Stability',
    price: 1650,
    rarity: 'rare',
    effectText: '稳定性 +11，轮胎 +3，重量 +10kg',
    changes: { stability: 11, tire: 3, weight: 10 },
  },
  {
    name: '小雨小报赞助',
    type: 'Stability',
    price: 666,
    rarity: 'rare',
    effectText: '稳定性 +6，重量 +3kg，马力 +2',
    changes: { stability: 6, weight: 3, hp: 2 },
  },
  {
    name: '拉力赛防滚架',
    type: 'Stability',
    price: 2600,
    rarity: 'legendary',
    effectText: '稳定性 +22，重量 +42kg，轮胎 +4',
    changes: { stability: 22, weight: 42, tire: 4 },
  },

  // ===== v1.4 新增改装件：均带取舍副作用，优先补 epic / legendary / mythic =====
  {
    name: '锻造高压活塞',
    type: 'Engine',
    price: 2050,
    rarity: 'epic',
    effectText: '引擎 +16，马力 +10，稳定性 -8',
    changes: { engine: 16, hp: 10, stability: -8 },
  },
  {
    name: '航空燃料调校机',
    type: 'Engine',
    price: 5200,
    rarity: 'mythic',
    effectText: '引擎 +29，马力 +38，稳定性 -18，重量 +24kg',
    changes: { engine: 29, hp: 38, stability: -18, weight: 24 },
  },
  {
    name: '全热熔光头胎',
    type: 'Tire',
    price: 2150,
    rarity: 'epic',
    effectText: '轮胎 +14，稳定性 +7，重量 +12kg',
    changes: { tire: 14, stability: 7, weight: 12 },
  },
  {
    name: '碳陶刹车套装',
    type: 'Stability',
    price: 3300,
    rarity: 'legendary',
    effectText: '稳定性 +18，重量 -8kg，马力 -3',
    changes: { stability: 18, weight: -8, hp: -3 },
  },
  {
    name: '主动差速控制器',
    type: 'Gearbox',
    price: 2300,
    rarity: 'epic',
    effectText: '变速箱 +15，稳定性 +3，重量 +8kg',
    changes: { gearbox: 15, stability: 3, weight: 8 },
  },
  {
    name: '镁合金竞技壳',
    type: 'Body',
    price: 4600,
    rarity: 'mythic',
    effectText: '重量 -90kg，稳定性 -8，马力 +8',
    changes: { weight: -90, stability: -8, hp: 8 },
  },
  {
    name: '一级方程式头段',
    type: 'Exhaust',
    price: 3600,
    rarity: 'legendary',
    effectText: '马力 +25，引擎 +8，稳定性 -8，重量 -8kg',
    changes: { hp: 25, engine: 8, stability: -8, weight: -8 },
  },
  {
    name: '氮气加速瓶',
    type: 'Intake',
    price: 2400,
    rarity: 'epic',
    effectText: '马力 +20，引擎 +5，稳定性 -11',
    changes: { hp: 20, engine: 5, stability: -11 },
  },
  {
    name: '可变截面涡轮',
    type: 'Turbo',
    price: 3700,
    rarity: 'epic',
    effectText: '马力 +27，引擎 +10，稳定性 -7，重量 +11kg',
    changes: { hp: 27, engine: 10, stability: -7, weight: 11 },
  },
  {
    name: '军规增压核心',
    type: 'Turbo',
    price: 6200,
    rarity: 'mythic',
    effectText: '马力 +52，引擎 +20，稳定性 -22，重量 +26kg',
    changes: { hp: 52, engine: 20, stability: -22, weight: 26 },
  },

  // ===== 各类型神话补全：轮胎 / 变速箱 / 进气 / 排气 / 稳定件 =====
  {
    name: '赛道之神热熔胎',
    type: 'Tire',
    price: 5400,
    rarity: 'mythic',
    effectText: '轮胎 +24，稳定性 +16，重量 +20kg',
    changes: { tire: 24, stability: 16, weight: 20 },
  },
  {
    name: '零延迟序列变速箱',
    type: 'Gearbox',
    price: 5600,
    rarity: 'mythic',
    effectText: '变速箱 +30，引擎 +10，稳定性 -12，重量 +6kg',
    changes: { gearbox: 30, engine: 10, stability: -12, weight: 6 },
  },
  {
    name: '赛用氮氧加速系统',
    type: 'Intake',
    price: 5400,
    rarity: 'mythic',
    effectText: '马力 +46，引擎 +12，稳定性 -22，重量 +4kg',
    changes: { hp: 46, engine: 12, stability: -22, weight: 4 },
  },
  {
    name: '钛合金全段排气总成',
    type: 'Exhaust',
    price: 5800,
    rarity: 'mythic',
    effectText: '马力 +40，引擎 +16，稳定性 -13，重量 -16kg',
    changes: { hp: 40, engine: 16, stability: -13, weight: -16 },
  },
  {
    name: '主动液压悬挂系统',
    type: 'Stability',
    price: 5600,
    rarity: 'mythic',
    effectText: '稳定性 +32，轮胎 +6，重量 +34kg，马力 -4',
    changes: { stability: 32, tire: 6, weight: 34, hp: -4 },
  },
];

// 运行时统一使用带 templateId 的零件池，避免存档直接依赖数组位置。
const PART_POOL = RAW_PART_POOL.map((part) => ({
  ...part,
  templateId: part.templateId || createPartTemplateId(part),
}));

const PART_POOL_BY_TEMPLATE_ID = PART_POOL.reduce((map, part) => {
  map[part.templateId] = part;
  return map;
}, {});
