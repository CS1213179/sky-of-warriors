/* <!--
  InputManager
  - 키보드/마우스 입력을 정규화해 BattleManager가 매 프레임 폴링할 수 있도록 합니다.
  - 메뉴/배틀 등 컨텍스트가 바뀔 때 setEnabled로 토글합니다.

  파일 구조: file:// 환경 호환을 위해 IIFE + Sky 네임스페이스 패턴 사용.
--> */
(function (Sky) {
  'use strict';

class InputManager {
  constructor() {
    this.keys = new Set();
    this.mouseButtons = new Set();
    this.enabled = false;

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      /* <!-- 페이지 스크롤 방지: 게임에서 사용하는 키 전체에 대해 기본 동작 차단. --> */
      if ([
        'Space', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyF', 'KeyH', 'KeyQ', 'KeyE',
        'KeyR', 'KeyT', 'KeyV', 'KeyC', 'ShiftLeft', 'AltLeft', 'ControlLeft',
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      ].includes(e.code)) {
        e.preventDefault();
      }
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
    };
    this._onMouseDown = (e) => {
      if (!this.enabled) return;
      this.mouseButtons.add(e.button);
      e.preventDefault();
    };
    this._onMouseUp = (e) => {
      this.mouseButtons.delete(e.button);
    };
    this._onContext = (e) => { if (this.enabled) e.preventDefault(); };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('contextmenu', this._onContext);
    window.addEventListener('blur', () => this.clear());
  }

  setEnabled(v) { this.enabled = v; if (!v) this.clear(); }
  clear() { this.keys.clear(); this.mouseButtons.clear(); }

  isDown(code) { return this.keys.has(code); }
  isMouse(btn) { return this.mouseButtons.has(btn); }

  /* <!--
    비행 + 무장 입력을 정규화합니다.
    P1 매핑:
      - 엘리베이터(피치):  ↑/↓
      - 러더(요):          ←/→ (자동 뱅크 최대 45°)
      - 에일러론(롤):      Q/E
      - 기관총:            Space / 좌클릭
      - 스로틀:            W/S (속도 조절)
      - 미사일:            A · 플레어: D · 부스트: Shift · 코브라: C · 시점: V
    P2 매핑 (2인 로컬):
      - 피치: W/S · 러더: A/D · 에일러론: F/H
      - 기관총: Ctrl · 미사일: R · 플레어: T · 부스트: Alt
  --> */
  getFlightAxes(profile = 'p1') {
    const k = (c) => (this.keys.has(c) ? 1 : 0);
    if (profile === 'p2') {
      return {
        pitch: k('KeyS') - k('KeyW'),
        yaw: k('KeyD') - k('KeyA'),
        roll: k('KeyH') - k('KeyF'),
        boost: k('AltLeft') || k('AltRight') ? 1 : 0,
        fireMG: k('ControlLeft') || k('ControlRight') ? 1 : 0,
        fireMissile: k('KeyR') ? 1 : 0,
        fireFlare: k('KeyT') ? 1 : 0,
      };
    }
    return {
      pitch: k('ArrowDown') - k('ArrowUp'),
      yaw: k('ArrowRight') - k('ArrowLeft'),
      roll: k('KeyE') - k('KeyQ'),
      throttle: k('KeyW') - k('KeyS'),
      boost: k('ShiftLeft') || k('ShiftRight') ? 1 : 0,
      fireMG: this.isMouse(0) || this.isDown('Space') ? 1 : 0,
      fireMissile: this.isDown('KeyA') ? 1 : 0,
      fireFlare: this.isDown('KeyD') ? 1 : 0,
    };
  }
}

  Sky.InputManager = InputManager;
})(window.Sky = window.Sky || {});
