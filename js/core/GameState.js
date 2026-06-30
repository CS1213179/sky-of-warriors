/* <!--
  GameState
  - 게임 진행 상황(소지금, 보유 기체, 장착 기체, 업그레이드 레벨)을 단일 진실 공급원으로 관리합니다.
  - localStorage에 즉시 영속화하며, 개인 식별 정보(PII)는 일절 저장하지 않습니다.
  - PubSub 패턴으로 UI가 상태 변화를 구독합니다.

  파일 구조: file:// 환경 호환을 위해 IIFE + Sky 네임스페이스 패턴 사용.
--> */
(function (Sky) {
  'use strict';

function getStarterFighter() {
  const fighters = Sky.fighters?.FIGHTERS;
  if (Array.isArray(fighters) && fighters.length > 0) return fighters[0];
  return {
    id: 'fighter_001',
    modelName: 'Falcon-X',
    stats: { speed: 120, agility: 80, armor: 60, fuel: 100 },
    weapons: { primary: 'machine_gun', secondary: 4 },
    price: 0,
  };
}

function computeNewUnlocksSafe(bestKills, unlockedTier) {
  const fn = Sky.Achievements?.computeNewUnlocks;
  return typeof fn === 'function' ? fn(bestKills, unlockedTier) : [];
}

const STORAGE_KEY = 'sky_of_warriors:save:v1';

function defaultAchievements() {
  return {
    bestSingleBattleKills: 0,
    unlockedTier: 0,
  };
}

function defaultKmBuff() {
  return { type: null, level: 0 };
}

function defaultState() {
  const starter = getStarterFighter();
  const starterId = starter?.id || 'fighter_001';
  return {
    money: 500,
    km: 0,
    ownedFighters: [starterId],
    equippedFighterId: starterId,
    upgrades: {
      [starterId]: { speed: 0, agility: 0, armor: 0, firepower: 0 },
    },
    stats: { totalKills: 0, totalScore: 0, battlesPlayed: 0 },
    achievements: defaultAchievements(),
    kmBuff: defaultKmBuff(),
  };
}

function mergeState(parsed) {
  const base = defaultState();
  const merged = {
    ...base,
    ...parsed,
    stats: { ...base.stats, ...(parsed.stats ?? {}) },
    achievements: { ...defaultAchievements(), ...(parsed.achievements ?? {}) },
    kmBuff: { ...defaultKmBuff(), ...(parsed.kmBuff ?? {}) },
    upgrades: parsed.upgrades ?? base.upgrades,
    ownedFighters: Array.isArray(parsed.ownedFighters) && parsed.ownedFighters.length
      ? parsed.ownedFighters
      : base.ownedFighters,
  };
  if (!merged.ownedFighters.includes(merged.equippedFighterId)) {
    merged.equippedFighterId = merged.ownedFighters[0] ?? base.equippedFighterId;
  }
  if (typeof merged.km !== 'number' || Number.isNaN(merged.km)) {
    merged.km = Math.max(0, merged.achievements?.unlockedTier ?? 0);
  }
  return merged;
}

class GameStateStore {
  constructor() {
    this._listeners = new Set();
    this._accountId = null;
    this._lastBattleAchievements = null;
    this._state = this._load();
  }

  _storageKey() {
    return this._accountId ? `${STORAGE_KEY}:${this._accountId}` : STORAGE_KEY;
  }

  /* <!-- 로그인 계정별 진행 데이터를 분리 로드합니다. --> */
  bindAccount(accountId) {
    this._accountId = accountId || null;
    try {
      this._state = this._load();
    } catch (err) {
      console.warn('[GameState] account load failed, using defaults.', err);
      this._state = defaultState();
    }
    this._lastBattleAchievements = null;
    this._emit();
  }

  /* <!-- 계정 삭제 시 해당 파일럿의 localStorage 진행 데이터를 제거합니다. --> */
  deleteAccountSave(accountId) {
    if (!accountId) return;
    try {
      localStorage.removeItem(`${STORAGE_KEY}:${accountId}`);
    } catch (err) {
      console.warn('[GameState] account save delete failed', err);
    }
    if (this._accountId === accountId) {
      this._accountId = null;
      this._state = defaultState();
      this._lastBattleAchievements = null;
      this._emit();
    }
  }

  _load() {
    try {
      const raw = localStorage.getItem(this._storageKey());
      if (!raw) return defaultState();
      return mergeState(JSON.parse(raw));
    } catch (err) {
      console.warn('[GameState] save read failed, resetting.', err);
      return defaultState();
    }
  }

  _persist() {
    try {
      localStorage.setItem(this._storageKey(), JSON.stringify(this._state));
    } catch (err) {
      console.warn('[GameState] persist failed', err);
    }
  }

  _emit() {
    this._listeners.forEach((cb) => {
      try {
        cb(this._state);
      } catch (err) {
        console.warn('[GameState] subscriber error (game continues):', err);
      }
    });
  }

  subscribe(cb) {
    this._listeners.add(cb);
    cb(this._state);
    return () => this._listeners.delete(cb);
  }

  get state() { return this._state; }
  get money() { return this._state.money; }
  get km() { return this._state.km ?? 0; }
  get equippedFighterId() { return this._state.equippedFighterId; }
  get ownedFighters() {
    if (this._isWorker()) return this._allFighterIds();
    return this._state.ownedFighters.slice();
  }
  get achievements() { return { ...this._state.achievements }; }
  get lastBattleAchievements() { return this._lastBattleAchievements; }

  _allFighterIds() {
    const list = Sky.fighters?.FIGHTERS;
    if (!Array.isArray(list) || !list.length) return [getStarterFighter().id];
    return list.map((f) => f.id);
  }

  _isWorker() {
    return Sky.AuthManager?.isWorkerAccount?.() === true;
  }

  _fighterOwned(fighterId) {
    if (this._isWorker()) return this._allFighterIds().includes(fighterId);
    return this._state.ownedFighters.includes(fighterId);
  }

  getKmBuff() {
    const raw = this._state.kmBuff ?? defaultKmBuff();
    return Sky.KmBuffs?.normalizeKmBuff?.(raw) ?? { type: raw.type ?? null, level: raw.level ?? 0 };
  }

  /* <!-- KM 1 소비: 현재 버프와 동일 종류만 강화. 미선택 시 type 지정으로 최초 선택 --> */
  spendKmBuff(type) {
    const valid = Sky.KmBuffs?.BUFF_TYPES ?? [];
    if (!valid.includes(type)) return { ok: false, code: 'invalid_type' };
    if ((this._state.km ?? 0) < 1) return { ok: false, code: 'no_km' };

    const cur = this.getKmBuff();
    if (cur.type && cur.type !== type) {
      return { ok: false, code: 'type_mismatch', current: cur.type };
    }

    this._state.km = (this._state.km ?? 0) - 1;
    this._state.kmBuff = {
      type,
      level: (cur.type === type ? cur.level : 0) + 1,
    };
    this._persist();
    this._emit();
    return { ok: true, buff: this.getKmBuff() };
  }

  /* <!-- 버프 종류 변경: VS 5000, 레벨은 유지 --> */
  changeKmBuffType(newType) {
    const valid = Sky.KmBuffs?.BUFF_TYPES ?? [];
    if (!valid.includes(newType)) return { ok: false, code: 'invalid_type' };

    const cur = this.getKmBuff();
    if (!cur.type || cur.level <= 0) return { ok: false, code: 'no_buff' };
    if (cur.type === newType) return { ok: false, code: 'same_type' };

    const cost = Sky.KmBuffs?.CHANGE_BUFF_VS_COST ?? 5000;
    if (!this.spend(cost)) return { ok: false, code: 'no_vs' };

    this._state.kmBuff = { type: newType, level: cur.level };
    this._persist();
    this._emit();
    return { ok: true, buff: this.getKmBuff(), vsSpent: cost };
  }

  _unlockContext() {
    return {
      ownedIds: this.ownedFighters,
      getUpgrade: (id) => this.getUpgrade(id),
    };
  }

  /* <!-- 잔액 변경. 음수 금액 검증은 호출 측에서 수행합니다. --> */
  addMoney(delta) {
    this._state.money = Math.max(0, this._state.money + delta);
    this._persist();
    this._emit();
  }

  addKm(delta) {
    this._state.km = Math.max(0, (this._state.km ?? 0) + delta);
    this._persist();
    this._emit();
  }

  spend(amount) {
    if (this._state.money < amount) return false;
    this._state.money -= amount;
    this._persist();
    this._emit();
    return true;
  }

  buyFighter(fighter) {
    if (this._fighterOwned(fighter.id)) return false;
    if (!Sky.fighters.isFighterUnlocked(fighter, this._unlockContext())) return false;
    if (!this.spend(fighter.price)) return false;
    this._state.ownedFighters.push(fighter.id);
    if (!this._state.upgrades[fighter.id]) {
      this._state.upgrades[fighter.id] = { speed: 0, agility: 0, armor: 0, firepower: 0 };
    }
    this._persist();
    this._emit();
    return true;
  }

  equip(fighterId) {
    if (this._isWorker()) {
      if (!Sky.fighters?.findFighter?.(fighterId)) return false;
    } else if (!this._state.ownedFighters.includes(fighterId)) {
      return false;
    }
    this._state.equippedFighterId = fighterId;
    this._persist();
    this._emit();
    return true;
  }

  getUpgrade(fighterId) {
    return this._state.upgrades[fighterId] ?? { speed: 0, agility: 0, armor: 0, firepower: 0 };
  }

  upgradeStat(fighterId, key, cost) {
    if (!this._fighterOwned(fighterId)) return false;
    if (!this.spend(cost)) return false;
    const cur = this.getUpgrade(fighterId);
    this._state.upgrades[fighterId] = { ...cur, [key]: (cur[key] ?? 0) + 1 };
    this._persist();
    this._emit();
    return true;
  }

  improveFighter(currentId, targetId, cost) {
    if (!this._fighterOwned(currentId)) return false;
    if (this._fighterOwned(targetId)) return false;
    if (!this.spend(cost)) return false;

    this._state.ownedFighters.push(targetId);

    const carriedUpgrades = this.getUpgrade(currentId);
    if (!this._state.upgrades[targetId]) {
      this._state.upgrades[targetId] = { ...carriedUpgrades };
    }

    if (this._state.equippedFighterId === currentId) {
      this._state.equippedFighterId = targetId;
    }

    this._persist();
    this._emit();
    return true;
  }

  /* <!--
    단판 격추 업적: bestSingleBattleKills 가 갱신되면 잠금 해제 가능한 모든 티어를 한 번에 처리.
    신규 업적 1개당 KM 1 지급.
  --> */
  _processKillAchievements(battleKills) {
    const ach = this._state.achievements ?? defaultAchievements();
    const prevBest = ach.bestSingleBattleKills ?? 0;
    const prevUnlocked = ach.unlockedTier ?? 0;
    const newBest = Math.max(prevBest, Math.max(0, battleKills | 0));

    ach.bestSingleBattleKills = newBest;

    const pending = computeNewUnlocksSafe(newBest, prevUnlocked);
    const kmEarned = pending.length;
    if (kmEarned > 0) {
      ach.unlockedTier = prevUnlocked + kmEarned;
      this._state.km = (this._state.km ?? 0) + kmEarned;
    }

    this._state.achievements = ach;

    return {
      battleKills,
      prevBest,
      newBest,
      bestUpdated: newBest > prevBest,
      newUnlocks: pending,
      kmEarned,
      totalKm: this._state.km,
      unlockedTier: ach.unlockedTier,
    };
  }

  /* <!-- 전투 결과를 통계로 누적. 보상(VS)과 업적(KM)을 함께 처리합니다. --> */
  recordBattle({ kills, score, reward }) {
    this._state.stats.totalKills += kills;
    this._state.stats.totalScore += score;
    this._state.stats.battlesPlayed += 1;
    this._state.money += reward;

    const achResult = this._processKillAchievements(kills);
    this._lastBattleAchievements = achResult;

    this._persist();
    this._emit();
    return achResult;
  }
}

try {
  Sky.GameState = new GameStateStore();
} catch (err) {
  console.error('[GameState] init failed:', err);
}
})(window.Sky = window.Sky || {});
