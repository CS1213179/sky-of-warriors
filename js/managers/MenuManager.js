/* <!--
  MenuManager
  - 메인 메뉴 표시·라우팅 및 로그아웃·계정 삭제 확인 모달 처리.

  파일 구조: IIFE + Sky 네임스페이스.
--> */
(function (Sky) {
  'use strict';

  const { findFighter } = Sky.fighters;
  const GameState = Sky.GameState;
  const Auth = Sky.AuthManager;
  function fmtVS(amount) {
    return Sky.currency?.formatVS?.(amount) ?? `${Math.max(0, Number(amount) || 0).toLocaleString()} VS`;
  }
  function fmtKM(amount) {
    return Sky.currency?.formatKM?.(amount) ?? `${Math.max(0, Number(amount) || 0).toLocaleString()} KM`;
  }

  class MenuManager {
    constructor({ root, onBattleMenu, onShop, onAchievements, onLogoutConfirmed, onAccountDeleted }) {
      this._root = root;
      if (!root) {
        console.warn('[MenuManager] screen-menu 요소를 찾지 못했습니다.');
        return;
      }
      this._onLogoutConfirmed = onLogoutConfirmed;
      this._onAccountDeleted = onAccountDeleted;
      this._pilot = root.querySelector('#menu-pilot');
      this._money = root.querySelector('#menu-money');
      this._km = root.querySelector('#menu-km');
      this._fighter = root.querySelector('#menu-fighter');
      this._logoutModal = document.getElementById('logout-confirm-modal');
      this._deleteModal = document.getElementById('delete-account-modal');

      root.querySelector('[data-action="battle-menu"]')?.addEventListener('click', () => onBattleMenu?.());
      root.querySelector('[data-action="shop"]').addEventListener('click', () => onShop?.());
      root.querySelector('[data-action="achievements"]')?.addEventListener('click', () => onAchievements?.());
      root.querySelector('[data-action="logout"]').addEventListener('click', () => this._showLogoutConfirm());

      this._logoutModal?.querySelector('[data-action="logout-yes"]')
        ?.addEventListener('click', () => {
          this._hideLogoutConfirm();
          this._onLogoutConfirmed?.();
        });
      this._logoutModal?.querySelector('[data-action="logout-no"]')
        ?.addEventListener('click', () => this._hideLogoutConfirm());
      this._logoutModal?.querySelector('[data-action="logout-delete-account"]')
        ?.addEventListener('click', () => {
          this._hideLogoutConfirm();
          this._showDeleteConfirm();
        });

      this._deleteModal?.querySelector('[data-action="delete-account-yes"]')
        ?.addEventListener('click', () => {
          this._hideDeleteConfirm();
          this._onAccountDeleted?.();
        });
      this._deleteModal?.querySelector('[data-action="delete-account-no"]')
        ?.addEventListener('click', () => {
          this._hideDeleteConfirm();
          this._showLogoutConfirm();
        });

      GameState?.subscribe?.(() => {
        if (this._root?.classList.contains('active')) this._render();
      });
      Auth.subscribe(() => {
        if (this._root?.classList.contains('active')) this._render();
      });
    }

    enter() {
      this._hideDeleteConfirm();
      this._hideLogoutConfirm();
      this._render();
    }

    exit() {
      this._hideDeleteConfirm();
      this._hideLogoutConfirm();
    }

    _showLogoutConfirm() {
      this._hideDeleteConfirm();
      this._logoutModal?.classList.remove('hidden');
      this._logoutModal?.setAttribute('aria-hidden', 'false');
    }

    _hideLogoutConfirm() {
      this._logoutModal?.classList.add('hidden');
      this._logoutModal?.setAttribute('aria-hidden', 'true');
    }

    _showDeleteConfirm() {
      this._deleteModal?.classList.remove('hidden');
      this._deleteModal?.setAttribute('aria-hidden', 'false');
    }

    _hideDeleteConfirm() {
      this._deleteModal?.classList.add('hidden');
      this._deleteModal?.setAttribute('aria-hidden', 'true');
    }

    _render() {
      if (!this._root || !GameState) return;
      if (this._pilot) this._pilot.textContent = Auth.getCallsign() || '-';
      if (this._money) this._money.textContent = fmtVS(GameState.money).replace(' VS', '');
      if (this._km) this._km.textContent = fmtKM(GameState.km).replace(' KM', '');
      const fighter = findFighter(GameState.equippedFighterId);
      if (this._fighter) this._fighter.textContent = fighter?.modelName ?? '-';
    }
  }

  Sky.MenuManager = MenuManager;
})(window.Sky = window.Sky || {});
