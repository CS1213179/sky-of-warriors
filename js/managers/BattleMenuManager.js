/* <!--
  BattleMenuManager
  - ?? ?? 3??(???�??�???) ??.
  - ??? ?? ? ?? ??(??? ???�??? ??)? ?????.

  ?? ??: IIFE + Sky ??????.
--> */
(function (Sky) {
  'use strict';

  class BattleMenuManager {
    constructor({ root, onBack, onSoloFfa, onSoloTeam, onOnlineFfa, onOnlineTeam }) {
      this._root = root;
      this._onlineModal = root.querySelector('#online-mode-modal');
      this._fighter = root.querySelector('#battle-menu-fighter');

      root.querySelector('[data-action="battle-back"]')?.addEventListener('click', () => onBack?.());
      root.querySelector('[data-action="battle-ffa"]')?.addEventListener('click', () => onSoloFfa?.());
      root.querySelector('[data-action="battle-team"]')?.addEventListener('click', () => onSoloTeam?.());
      root.querySelector('[data-action="battle-online"]')?.addEventListener('click', () => this._openOnlineModal());
      root.querySelector('[data-action="online-ffa"]')?.addEventListener('click', () => {
        this._closeOnlineModal();
        onOnlineFfa?.();
      });
      root.querySelector('[data-action="online-team"]')?.addEventListener('click', () => {
        this._closeOnlineModal();
        onOnlineTeam?.();
      });
      root.querySelector('[data-action="online-cancel"]')?.addEventListener('click', () => this._closeOnlineModal());

      Sky.GameState.subscribe(() => {
        if (this._root.classList.contains('active')) this._render();
      });
    }

    enter() {
      this._closeOnlineModal();
      this._render();
    }

    exit() {
      this._closeOnlineModal();
    }

    _openOnlineModal() {
      this._onlineModal?.classList.remove('hidden');
      this._onlineModal?.setAttribute('aria-hidden', 'false');
    }

    _closeOnlineModal() {
      this._onlineModal?.classList.add('hidden');
      this._onlineModal?.setAttribute('aria-hidden', 'true');
    }

    _render() {
      const fighter = Sky.fighters.findFighter(Sky.GameState.equippedFighterId);
      if (this._fighter) this._fighter.textContent = fighter.modelName;
    }
  }

  Sky.BattleMenuManager = BattleMenuManager;
})(window.Sky = window.Sky || {});
