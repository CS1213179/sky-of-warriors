/* <!--
  Achievements.js
  - 단판 격추 수 bestSingleBattleKills 기준 업적 해제.
  - 격추 임계: 1→2→3→5→7→10→15→20→25→ 이후 +5.
  - 업적 1개당 KM 1 지급(GameState에서 처리).
--> */
(function (Sky) {
  'use strict';

  const KILL_TIER_FIXED = [1, 2, 3, 5, 7, 10, 15, 20, 25];

  const KILL_ACHIEVEMENT_NAMES = [
    '\uCCAB \uACA9\uCD94',
    '\uB354\uBE08',
    '\uD504\uB85C',
    '\uC5D0\uC774\uC2A4',
    '\uD589\uC6B4\uC758 \uC870\uC885\uC0AC',
    '\uB354\uBE08 \uC5D0\uC774\uC2A4',
    '\uD2B8\uB9AC\uD508 \uC5D0\uC774\uC2A4',
    '\uC5D0\uC774\uC2A4 \uC624\uBE0C \uC5D0\uC774\uC2A4',
  ];

  function getKillThreshold(tierIndex) {
    if (tierIndex < KILL_TIER_FIXED.length) return KILL_TIER_FIXED[tierIndex];
    const step = tierIndex - KILL_TIER_FIXED.length + 1;
    return 25 + step * 5;
  }

  function getKillAchievementName(tierIndex) {
    const tier = Math.max(0, tierIndex | 0);
    if (tier < KILL_ACHIEVEMENT_NAMES.length) return KILL_ACHIEVEMENT_NAMES[tier];
    const sub = tier - KILL_ACHIEVEMENT_NAMES.length + 1;
    return `\uC5D0\uC774\uC2A4 \uC624\uBE0C \uC5D0\uC774\uC2A4 ${sub}`;
  }

  function computeNewUnlocks(bestKills, unlockedTier) {
    const prev = Math.max(0, unlockedTier | 0);
    const best = Math.max(0, bestKills | 0);
    const unlocks = [];
    let tier = prev;
    while (getKillThreshold(tier) <= best) {
      unlocks.push({
        tier,
        threshold: getKillThreshold(tier),
        name: getKillAchievementName(tier),
      });
      tier += 1;
    }
    return unlocks;
  }

  function isTierUnlocked(tierIndex, unlockedTier) {
    return tierIndex < Math.max(0, unlockedTier | 0);
  }

  const DISPLAY_TIER_COUNT = 24;

  /* <!-- localStorage 직접 읽기: GameState 참조 실패 시 업적 화면 복구용 --> */
  function readAchievementStateFallback() {
    try {
      const Auth = Sky.AuthManager;
      const accountId = Auth && typeof Auth.getAccountId === 'function' ? Auth.getAccountId() : null;
      const key = accountId ? `sky_of_warriors:save:v1:${accountId}` : 'sky_of_warriors:save:v1';
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const ach = parsed.achievements || {};
      return {
        km: typeof parsed.km === 'number' ? parsed.km : (ach.unlockedTier || 0),
        best: ach.bestSingleBattleKills || 0,
        unlocked: ach.unlockedTier || 0,
        kmBuff: parsed.kmBuff || { type: null, level: 0 },
      };
    } catch (err) {
      console.warn('[Achievements] save fallback read failed', err);
      return null;
    }
  }

  function resolveAchievementState() {
    const GS = Sky.GameState;
    if (GS) {
      const ach = GS.achievements || {};
      return {
        km: GS.km || 0,
        best: ach.bestSingleBattleKills || 0,
        unlocked: ach.unlockedTier || 0,
        getKmBuff: () => (GS.getKmBuff ? GS.getKmBuff() : { type: null, level: 0 }),
      };
    }
    const fb = readAchievementStateFallback();
    if (fb) {
      return {
        km: fb.km,
        best: fb.best,
        unlocked: fb.unlocked,
        getKmBuff: () => fb.kmBuff,
      };
    }
    return { km: 0, best: 0, unlocked: 0, getKmBuff: () => ({ type: null, level: 0 }) };
  }

  /* <!-- 업적 화면 DOM 갱신: main.js·AchievementManager·index.html 공통 진입점 --> */
  function paintAchievementsScreen(root) {
    const screen = root || document.getElementById('screen-achievements');
    if (!screen) {
      console.warn('[Achievements] paint skipped: screen missing');
      return false;
    }

    const state = resolveAchievementState();
    const best = state.best;
    const unlocked = state.unlocked;
    const km = state.km;

    const bestEl = screen.querySelector('#ach-best-kills');
    const kmEl = screen.querySelector('#ach-km');
    const unlockedEl = screen.querySelector('#ach-unlocked-count');
    const list = screen.querySelector('#ach-list');
    const summary = screen.querySelector('#ach-km-summary');

    if (bestEl) bestEl.textContent = String(best);
    if (kmEl) kmEl.textContent = String(km);
    if (unlockedEl) unlockedEl.textContent = String(unlocked);

    if (summary) {
      const buff = state.getKmBuff();
      let desc = '\uC120\uD0DD \uC804';
      if (Sky.KmBuffs && Sky.KmBuffs.describeBuff) {
        desc = Sky.KmBuffs.describeBuff(buff);
      } else if (buff.type && buff.level > 0) {
        desc = `${buff.type} Lv.${buff.level}`;
      }
      summary.textContent = `\uBCF4\uC720 KM ${km} \u00B7 ${desc}`;
    }

    if (list) {
      const frag = document.createDocumentFragment();
      for (let tier = 0; tier < DISPLAY_TIER_COUNT; tier += 1) {
        const threshold = getKillThreshold(tier);
        const done = isTierUnlocked(tier, unlocked);
        const li = document.createElement('li');
        li.className = 'ach-item' + (done ? ' unlocked' : '');
        li.innerHTML =
          '<span class="ach-status" aria-hidden="true">' + (done ? '\u2713' : '\u2013') + '</span>' +
          '<span class="ach-name">' + getKillAchievementName(tier) + '</span>' +
          '<span class="ach-reward">\uB2E8\uD310 ' + threshold + '\uACA9 \u00B7 +1 KM</span>';
        if (!done && best > 0) {
          const hint = document.createElement('span');
          hint.className = 'ach-hint';
          hint.textContent = best >= threshold
            ? '\uB2E4\uC74C \uC804\uD22C \uC2DC \uD574\uC81C \uC608\uC815'
            : '\uB2E8\uD310 ' + threshold + '\uACA9 \uD544\uC694 (\uD604\uC7AC \uCD5C\uACE0 ' + best + ')';
          li.appendChild(hint);
        }
        frag.appendChild(li);
      }
      list.innerHTML = '';
      list.appendChild(frag);
    }

    screen.setAttribute('data-ach-painted', String(Date.now()));
    return true;
  }

  Sky.Achievements = {
    KILL_TIER_FIXED,
    KILL_ACHIEVEMENT_NAMES,
    DISPLAY_TIER_COUNT,
    getKillThreshold,
    getKillAchievementName,
    computeNewUnlocks,
    isTierUnlocked,
    paintAchievementsScreen,
  };
  Sky.paintAchievementsScreen = paintAchievementsScreen;
})(window.Sky = window.Sky || {});
