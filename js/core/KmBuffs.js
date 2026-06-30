/* <!--
  KmBuffs.js
  - KM ??? ???? ?? ??(?????????? ??).
  - ?? ?? ?? ? VS 5000 ??(GameState.changeKmBuffType).
--> */
(function (Sky) {
  'use strict';

  const CHANGE_BUFF_VS_COST = 5000;

  const BUFF_DEFS = {
    speed: {
      id: 'speed',
      label: '\uC18D\uB3C4 \uC99D\uAC00',
      desc: '\uB2E8\uBCC4 \uC218\uC900 +4% \uCD5C\uB300 \uC18D\uB3C4',
      perLevel: { speedMul: 0.04 },
    },
    armor: {
      id: 'armor',
      label: '\uCCB4\uB825 \uC99D\uAC00',
      desc: '\uB2E8\uBCC4 \uC218\uC900 +6% \uC5D0\uC5B4\uD504\uB808\uC784(HULL)',
      perLevel: { hpMul: 0.06 },
    },
    reload: {
      id: 'reload',
      label: '\uC7AC\uC7A5\uC804 \uAC00\uC18D',
      desc: '\uB2E8\uBCC4 \uC218\uC900 \uAE30\uC9C0 \uC7AC\uC7A5\uC804 \uC2DC\uAC04 -10%',
      perLevel: { reloadMul: 0.10 },
    },
    evasion: {
      id: 'evasion',
      label: '\uBBF8\uC0AC\uC77C \uD68C\uD53C',
      desc: '\uB2E8\uBCC4 \uC218\uC900 \uD50C\uB798\uC5B4 \uC720\uB3C4 +8% \u00B7\uBBF8\uC0AC\uC77C \uD68C\uD53C +3%',
      perLevel: { flareBonus: 0.08, evadeChance: 0.03 },
    },
  };

  const BUFF_TYPES = Object.keys(BUFF_DEFS);

  const NEUTRAL = {
    speedMul: 1,
    hpMul: 1,
    reloadTimeMul: 1,
    flareLureBonus: 0,
    missileEvadeChance: 0,
  };

  function normalizeKmBuff(raw) {
    const type = raw?.type && BUFF_DEFS[raw.type] ? raw.type : null;
    const level = Math.max(0, raw?.level | 0);
    return { type, level: type ? level : 0 };
  }

  function getModifiers(kmBuff) {
    const buff = normalizeKmBuff(kmBuff);
    if (!buff.type || buff.level <= 0) return { ...NEUTRAL };

    const def = BUFF_DEFS[buff.type];
    const lv = buff.level;
    const out = { ...NEUTRAL };

    if (def.perLevel.speedMul) {
      out.speedMul = 1 + def.perLevel.speedMul * lv;
    }
    if (def.perLevel.hpMul) {
      out.hpMul = 1 + def.perLevel.hpMul * lv;
    }
    if (def.perLevel.reloadMul) {
      out.reloadTimeMul = Math.max(0.35, 1 - def.perLevel.reloadMul * lv);
    }
    if (def.perLevel.flareBonus) {
      out.flareLureBonus = Math.min(0.45, def.perLevel.flareBonus * lv);
    }
    if (def.perLevel.evadeChance) {
      out.missileEvadeChance = Math.min(0.35, def.perLevel.evadeChance * lv);
    }
    return out;
  }

  function getBuffLabel(type) {
    return BUFF_DEFS[type]?.label ?? type;
  }

  function describeBuff(kmBuff) {
    const buff = normalizeKmBuff(kmBuff);
    if (!buff.type || buff.level <= 0) {
      return '\uC120\uD0DD \uC804 (\uC544\uB798\uC11C \uBC84\uD504 \uC120\uD0DD \uD6C4 KM 1 \uC18C\uBE44)';
    }
    return `${getBuffLabel(buff.type)} Lv.${buff.level}`;
  }

  Sky.KmBuffs = {
    CHANGE_BUFF_VS_COST,
    BUFF_DEFS,
    BUFF_TYPES,
    NEUTRAL,
    normalizeKmBuff,
    getModifiers,
    getBuffLabel,
    describeBuff,
  };
})(window.Sky = window.Sky || {});
