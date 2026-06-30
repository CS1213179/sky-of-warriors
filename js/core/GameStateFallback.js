/* GameStateFallback: GameState.js load failure safety net (ASCII-only). */
(function (Sky) {
  'use strict';

  if (Sky.GameState && typeof Sky.GameState.bindAccount === 'function') return;

  console.warn('[GameStateFallback] primary GameState missing  using fallback store');

  const STORAGE_KEY = 'sky_of_warriors:save:v1';

  function starterId() {
    const list = Sky.fighters?.FIGHTERS;
    if (Array.isArray(list) && list.length > 0) return list[0].id;
    return 'fighter_001';
  }

  function defaultState() {
    const id = starterId();
    return {
      money: 500,
      km: 0,
      ownedFighters: [id],
      equippedFighterId: id,
      upgrades: { [id]: { speed: 0, agility: 0, armor: 0, firepower: 0 } },
      stats: { totalKills: 0, totalScore: 0, battlesPlayed: 0 },
      achievements: { bestSingleBattleKills: 0, unlockedTier: 0 },
      kmBuff: { type: null, level: 0 },
    };
  }

  function mergeState(parsed) {
    const base = defaultState();
    const merged = Object.assign({}, base, parsed || {});
    merged.stats = Object.assign({}, base.stats, parsed?.stats || {});
    merged.achievements = Object.assign({}, base.achievements, parsed?.achievements || {});
    merged.kmBuff = Object.assign({}, base.kmBuff, parsed?.kmBuff || {});
    merged.upgrades = parsed?.upgrades || base.upgrades;
    merged.ownedFighters = Array.isArray(parsed?.ownedFighters) && parsed.ownedFighters.length
      ? parsed.ownedFighters
      : base.ownedFighters;
    if (!merged.ownedFighters.includes(merged.equippedFighterId)) {
      merged.equippedFighterId = merged.ownedFighters[0] || base.equippedFighterId;
    }
    if (typeof merged.km !== 'number' || isNaN(merged.km)) {
      merged.km = Math.max(0, (merged.achievements && merged.achievements.unlockedTier) || 0);
    }
    return merged;
  }

  function computeUnlocks(best, unlocked) {
    const fn = Sky.Achievements?.computeNewUnlocks;
    return typeof fn === 'function' ? fn(best, unlocked) : [];
  }

  class FallbackStore {
    constructor() {
      this._listeners = new Set();
      this._accountId = null;
      this._lastBattleAchievements = null;
      this._state = defaultState();
    }

    _storageKey() {
      return this._accountId ? STORAGE_KEY + ':' + this._accountId : STORAGE_KEY;
    }

    _load() {
      try {
        const raw = localStorage.getItem(this._storageKey());
        return raw ? mergeState(JSON.parse(raw)) : defaultState();
      } catch (err) {
        return defaultState();
      }
    }

    _persist() {
      try {
        localStorage.setItem(this._storageKey(), JSON.stringify(this._state));
      } catch (err) { /* ignore */ }
    }

    _emit() {
      this._listeners.forEach((cb) => {
        try { cb(this._state); } catch (err) { /* ignore */ }
      });
    }

    bindAccount(accountId) {
      this._accountId = accountId || null;
      this._state = this._load();
      this._lastBattleAchievements = null;
      this._emit();
    }

    deleteAccountSave(accountId) {
      if (!accountId) return;
      try { localStorage.removeItem(STORAGE_KEY + ':' + accountId); } catch (err) { /* ignore */ }
      if (this._accountId === accountId) {
        this._accountId = null;
        this._state = defaultState();
        this._lastBattleAchievements = null;
        this._emit();
      }
    }

    subscribe(cb) {
      this._listeners.add(cb);
      cb(this._state);
      return () => this._listeners.delete(cb);
    }

    get money() { return this._state.money; }
    get km() { return this._state.km || 0; }
    get equippedFighterId() { return this._state.equippedFighterId; }
    get ownedFighters() { return this._state.ownedFighters.slice(); }
    get achievements() { return Object.assign({}, this._state.achievements); }
    get lastBattleAchievements() { return this._lastBattleAchievements; }

    getKmBuff() {
      const raw = this._state.kmBuff || { type: null, level: 0 };
      return Sky.KmBuffs?.normalizeKmBuff?.(raw) || { type: raw.type || null, level: raw.level || 0 };
    }

    spendKmBuff(type) {
      const valid = Sky.KmBuffs?.BUFF_TYPES || [];
      if (valid.indexOf(type) < 0) return { ok: false, code: 'invalid_type' };
      if ((this._state.km || 0) < 1) return { ok: false, code: 'no_km' };
      const cur = this.getKmBuff();
      if (cur.type && cur.type !== type) return { ok: false, code: 'type_mismatch', current: cur.type };
      this._state.km = (this._state.km || 0) - 1;
      this._state.kmBuff = { type, level: (cur.type === type ? cur.level : 0) + 1 };
      this._persist();
      this._emit();
      return { ok: true, buff: this.getKmBuff() };
    }

    changeKmBuffType(newType) {
      const valid = Sky.KmBuffs?.BUFF_TYPES || [];
      if (valid.indexOf(newType) < 0) return { ok: false, code: 'invalid_type' };
      const cur = this.getKmBuff();
      if (!cur.type || cur.level <= 0) return { ok: false, code: 'no_buff' };
      if (cur.type === newType) return { ok: false, code: 'same_type' };
      const cost = Sky.KmBuffs?.CHANGE_BUFF_VS_COST || 5000;
      if (!this.spend(cost)) return { ok: false, code: 'no_vs' };
      this._state.kmBuff = { type: newType, level: cur.level };
      this._persist();
      this._emit();
      return { ok: true, buff: this.getKmBuff(), vsSpent: cost };
    }

    getUpgrade(fighterId) {
      return this._state.upgrades[fighterId] || { speed: 0, agility: 0, armor: 0, firepower: 0 };
    }

    spend(amount) {
      if (this._state.money < amount) return false;
      this._state.money -= amount;
      this._persist();
      this._emit();
      return true;
    }

    buyFighter(fighter) {
      if (this._state.ownedFighters.includes(fighter.id)) return false;
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
      if (!this._state.ownedFighters.includes(fighterId)) return false;
      this._state.equippedFighterId = fighterId;
      this._persist();
      this._emit();
      return true;
    }

    upgradeStat(fighterId, key, cost) {
      if (!this._state.ownedFighters.includes(fighterId)) return false;
      if (!this.spend(cost)) return false;
      const cur = this.getUpgrade(fighterId);
      this._state.upgrades[fighterId] = Object.assign({}, cur, { [key]: (cur[key] || 0) + 1 });
      this._persist();
      this._emit();
      return true;
    }

    improveFighter(currentId, targetId, cost) {
      if (!this._state.ownedFighters.includes(currentId)) return false;
      if (this._state.ownedFighters.includes(targetId)) return false;
      if (!this.spend(cost)) return false;
      this._state.ownedFighters.push(targetId);
      if (!this._state.upgrades[targetId]) {
        this._state.upgrades[targetId] = Object.assign({}, this.getUpgrade(currentId));
      }
      if (this._state.equippedFighterId === currentId) this._state.equippedFighterId = targetId;
      this._persist();
      this._emit();
      return true;
    }

    recordBattle({ kills, score, reward }) {
      this._state.stats.totalKills += kills;
      this._state.stats.totalScore += score;
      this._state.stats.battlesPlayed += 1;
      this._state.money += reward;
      const ach = this._state.achievements || { bestSingleBattleKills: 0, unlockedTier: 0 };
      const prevBest = ach.bestSingleBattleKills || 0;
      const prevUnlocked = ach.unlockedTier || 0;
      const newBest = Math.max(prevBest, Math.max(0, kills | 0));
      ach.bestSingleBattleKills = newBest;
      const pending = computeUnlocks(newBest, prevUnlocked);
      if (pending.length > 0) {
        ach.unlockedTier = prevUnlocked + pending.length;
        this._state.km = (this._state.km || 0) + pending.length;
      }
      this._state.achievements = ach;
      this._lastBattleAchievements = {
        battleKills: kills,
        prevBest,
        newBest,
        bestUpdated: newBest > prevBest,
        newUnlocks: pending,
        kmEarned: pending.length,
        totalKm: this._state.km,
        unlockedTier: ach.unlockedTier,
      };
      this._persist();
      this._emit();
      return this._lastBattleAchievements;
    }
  }

  Sky.GameState = new FallbackStore();
})(window.Sky = window.Sky || {});
