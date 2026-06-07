export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';

export type RacePartSlot =
  | 'Engine'
  | 'Tire'
  | 'Gearbox'
  | 'Body'
  | 'Intake'
  | 'Exhaust'
  | 'Turbo'
  | 'Stability';

export type RacePartStatKey = 'hp' | 'engine' | 'tire' | 'gearbox' | 'stability' | 'weight';

export type MythicUpgradeLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type MythicUpgradeInputLevel = Exclude<MythicUpgradeLevel, 10>;
export type MythicUpgradeTargetLevel = Exclude<MythicUpgradeLevel, 0>;

export interface RacePart {
  id: number;
  templateId?: string;
  name: string;
  type: RacePartSlot;
  slot?: RacePartSlot;
  rarity: Rarity;
  price: number;
  effectText?: string;
  changes: Partial<Record<RacePartStatKey, number>>;
  horsepower?: number;
  engine?: number;
  tire?: number;
  transmission?: number;
  stability?: number;
  weight?: number;
  risk?: number;
  [key: string]: unknown;
}

export interface GameSettings {
  soundEnabled: boolean;
  telemetryEnabled: boolean;
}

export interface AchievementState {
  completed: Record<string, string>;
  lastUnlocked: string[];
}

export interface RaceStats {
  totalRaces: number;
  totalWins: number;
  totalLosses: number;
  currentStreak: number;
  bestStreak: number;
  falseStartCount: number;
  practiceRaces: number;
  partsPurchasedCount: number;
  highestCash: number;
  winsByDifficulty: Record<string, number>;
  bestStreakByDifficulty: Record<string, number>;
  wonWithBuildAchievements: string[];
  wonWithSpecialParts: string[];
  [key: string]: unknown;
}

export interface RaceSaveData {
  cash: number;
  raceCount: number;
  lastRank: string;
  inventory: RacePart[];
  equippedParts: Record<RacePartSlot, number | null>;
  mythicUpgrades: Record<string, MythicUpgradeLevel>;
  settings: GameSettings;
  achievements: AchievementState;
  stats: RaceStats;
  nextPartId: number;
  [key: string]: unknown;
}

export interface GameState extends RaceSaveData {
  phase: string;
  ready: boolean;
  shopItems: RacePart[];
  activePage: 'race' | 'shop' | 'tuning' | 'profile' | 'atlas' | string;
}

export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  check: string;
  flavor?: string;
  hidden?: boolean;
}

export interface FinishedRaceTelemetry {
  difficulty: string;
  rank: string;
  reactionTime: number | null;
  opponentReactionTime: number | null;
  raceCount: number;
  isPractice: boolean;
  isAiAssist: boolean;
  money: number;
  winStreak: number;
  version: string;
}

export interface MythicUpgradeConfig {
  maxLevel: 10;
  bonusPerLevel: number;
  statKeys: readonly Extract<RacePartStatKey, 'hp' | 'engine' | 'tire' | 'gearbox' | 'stability'>[];
  levelBonusRates: Record<MythicUpgradeTargetLevel, number>;
  statWeights: Partial<Record<RacePartStatKey, number>>;
  successRates: Record<MythicUpgradeTargetLevel, number>;
  upgradeCost: Record<MythicUpgradeTargetLevel, number>;
}

export interface MythicUpgradeResultTelemetry {
  partId: string;
  templateId: string;
  slot: RacePartSlot;
  fromLevel: MythicUpgradeInputLevel;
  toLevel: MythicUpgradeLevel;
  success: boolean;
  cost: number;
  money: number;
  version: string;
}

export const DEFAULT_SETTINGS_CONTRACT = {
  soundEnabled: true,
  telemetryEnabled: true,
} as const satisfies GameSettings;

export const MYTHIC_UPGRADE_CONTRACT = {
  maxLevel: 10,
  bonusPerLevel: 0.0335,
  statKeys: ['hp', 'engine', 'tire', 'gearbox', 'stability'],
  levelBonusRates: {
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
  },
  statWeights: {
    hp: 0.65,
    engine: 0.75,
    tire: 1.1,
    gearbox: 1.15,
    stability: 1.45,
  },
  successRates: {
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
  },
  upgradeCost: {
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
  },
} as const satisfies MythicUpgradeConfig;
