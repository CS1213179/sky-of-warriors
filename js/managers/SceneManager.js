/* <!--
  SceneManager
  - DOM 스크린(menu/shop/battle)을 전환하고,
    각 스크린에서 사용할 매니저의 enter/exit 라이프사이클을 호출합니다.
  - BattleManager처럼 3D 리소스를 가진 매니저는 exit 시점에 반드시 정리해야 합니다.

  파일 구조: file:// 환경 호환을 위해 IIFE + Sky 네임스페이스 패턴 사용.
--> */
(function (Sky) {
  'use strict';

class SceneManager {
  constructor() {
    this._screens = new Map();
    this._current = null;
    this._activeManager = null;
  }

  register(name, { element, manager }) {
    this._screens.set(name, { element, manager });
  }

  show(name, payload) {
    const entry = this._screens.get(name);
    if (!entry) {
      console.warn('[SceneManager] 등록되지 않은 스크린:', name);
      return;
    }
    if (this._activeManager?.exit) this._activeManager.exit();
    this._screens.forEach(({ element }) => element?.classList?.remove('active'));
    if (!entry.element) {
      console.warn('[SceneManager] 화면 DOM이 없습니다:', name);
      return;
    }
    entry.element.classList.add('active');
    this._current = name;
    this._activeManager = entry.manager ?? null;
    if (this._activeManager?.enter) {
      try {
        this._activeManager.enter(payload);
      } catch (err) {
        console.error(`[SceneManager] enter failed (${name}):`, err);
      }
    } else if (!entry.manager) {
      console.warn(`[SceneManager] manager missing for screen: ${name}`);
    }

    /* <!-- 업적 화면: 매니저 유무와 관계없이 DOM을 즉시 갱신 (file://·캐시 대응) --> */
    if (name === 'achievements') {
      const paint = Sky.paintAchievementsScreen || Sky.Achievements?.paintAchievementsScreen;
      if (typeof paint === 'function') {
        try {
          paint(entry.element);
          requestAnimationFrame(function () { paint(entry.element); });
        } catch (err) {
          console.error('[SceneManager] achievements paint failed:', err);
        }
      }
    }
  }

  get current() { return this._current; }
}

  Sky.SceneManager = SceneManager;
})(window.Sky = window.Sky || {});
