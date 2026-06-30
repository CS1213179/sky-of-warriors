/* <!--
  currency.js
  - Victory Sortie(VS): ?? ??·?? ??? ?? ?? ??.
  - KM: ?? ?? ?? ?? ? ???? ?? ??(??? ?? ?? ??).
--> */
(function (Sky) {
  'use strict';

  const VS = {
    code: 'VS',
    fullName: 'Victory Sortie',
    label: '?? ??',
  };

  const KM = {
    code: 'KM',
    fullName: 'Kill Merit',
    label: '?? ??',
  };

  function format(amount, unit) {
    const n = Math.max(0, Math.floor(Number(amount) || 0));
    return `${n.toLocaleString()} ${unit.code}`;
  }

  Sky.currency = {
    VS,
    KM,
    formatVS(amount) { return format(amount, VS); },
    formatKM(amount) { return format(amount, KM); },
  };
})(window.Sky = window.Sky || {});
