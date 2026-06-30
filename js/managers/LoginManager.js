/* LoginManager — login/register UI (ASCII-safe user messages via \\u escapes). */
(function (Sky) {
  'use strict';

  const Auth = Sky.AuthManager;
  const MSG = {
    NEED_INPUT: '\uCF5C\uC0AC\uC778\uACFC \uBE44\uBC00\uBC88\uD638(4\uC790 \uC774\uC0C1)\uB97C \uC785\uB825\uD558\uC138\uC694.',
    NO_AUTH: '\uC778\uC99D \uBAA8\uB4C8\uC744 \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uD398\uC774\uC9C0\uB97C \uC0C8\uB85C\uACE0\uCE68\uD558\uC138\uC694.',
    NO_GAMESTATE: '\uAC8C\uC784 \uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. Ctrl+F5\uB97C \uB20C\uB7EC \uC0C8\uB85C\uACE0\uCE68 \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD558\uC138\uC694.',
    FAIL: '\uB85C\uADF8\uC778\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.',
    TITLE_LOGIN: '\uD30C\uC77C\uB7FF \uB85C\uADF8\uC778',
    TITLE_REGISTER: '\uD30C\uC77C\uB7FF \uB4F1\uB85D',
    BTN_LOGIN: '\uB85C\uADF8\uC778',
    BTN_REGISTER: '\uB4F1\uB85D\uD558\uACE0 \uC2DC\uC791',
    BTN_TOGGLE_REGISTER: '\uC0C8 \uD30C\uC77C\uB7FF \uB4F1\uB85D',
    BTN_TOGGLE_LOGIN: '\uC774\uBBF8 \uACC4\uC815\uC774 \uC788\uB098\uC694? \uB85C\uADF8\uC778',
    BUSY_LOGIN: '\uB85C\uADF8\uC778 \uC911\u2026',
    BUSY_REGISTER: '\uB4F1\uB85D \uC911\u2026',
  };

  class LoginManager {
    constructor({ root, onAuthenticated }) {
      this._root = root;
      this._onAuthenticated = onAuthenticated;
      this._mode = 'login';
      this._bound = false;

      if (!root) {
        console.warn('[LoginManager] screen-login element not found');
        return;
      }

      this._form = root.querySelector('#login-form');
      this._callsign = root.querySelector('#login-callsign');
      this._password = root.querySelector('#login-password');
      this._error = root.querySelector('#login-error');
      this._title = root.querySelector('#login-title');
      this._submitBtn = root.querySelector('[data-action="login-submit"]');
      this._toggleBtn = root.querySelector('[data-action="login-register"]');

      this._bindEvents();
    }

    _bindEvents() {
      if (!this._root || this._bound) return;
      this._bound = true;

      this._root.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-action]');
        if (!btn || !this._root.contains(btn)) return;
        const action = btn.dataset.action;
        if (action === 'login-submit') {
          ev.preventDefault();
          this._submit();
        } else if (action === 'login-register') {
          ev.preventDefault();
          this._mode = this._mode === 'login' ? 'register' : 'login';
          this._syncModeUI();
        }
      });

      this._form?.addEventListener('submit', (ev) => {
        ev.preventDefault();
        this._submit();
      });
    }

    enter() {
      this._mode = 'login';
      this._syncModeUI();
      if (this._error) this._error.textContent = '';
      if (this._password) this._password.value = '';
      this._callsign?.focus();
    }

    exit() {}

    _label(el, mode) {
      if (!el?.dataset) return '';
      return mode === 'register' ? (el.dataset.textRegister || '') : (el.dataset.textLogin || '');
    }

    _syncModeUI() {
      const isRegister = this._mode === 'register';
      if (this._title) {
        this._title.textContent = this._label(this._title, this._mode)
          || (isRegister ? MSG.TITLE_REGISTER : MSG.TITLE_LOGIN);
      }
      if (this._submitBtn) {
        this._submitBtn.textContent = this._label(this._submitBtn, this._mode)
          || (isRegister ? MSG.BTN_REGISTER : MSG.BTN_LOGIN);
      }
      if (this._toggleBtn) {
        this._toggleBtn.textContent = this._label(this._toggleBtn, this._mode)
          || (isRegister ? MSG.BTN_TOGGLE_LOGIN : MSG.BTN_TOGGLE_REGISTER);
      }
    }

    async _submit() {
      if (!this._root) return;

      const callsign = this._callsign?.value?.trim() ?? '';
      const password = this._password?.value ?? '';
      if (this._error) this._error.textContent = '';

      if (!callsign || password.length < 4) {
        if (this._error) this._error.textContent = MSG.NEED_INPUT;
        return;
      }

      if (!Auth) {
        if (this._error) this._error.textContent = MSG.NO_AUTH;
        return;
      }

      if (this._submitBtn) {
        this._submitBtn.disabled = true;
        this._submitBtn.textContent = this._mode === 'register' ? MSG.BUSY_REGISTER : MSG.BUSY_LOGIN;
      }

      try {
        if (this._mode === 'register') {
          await Auth.register(callsign, password);
        } else {
          await Auth.login(callsign, password);
        }

        if (!Sky.GameState || typeof Sky.GameState.bindAccount !== 'function') {
          throw new Error(MSG.NO_GAMESTATE);
        }

        Sky.GameState.bindAccount(Auth.getAccountId());
        this._onAuthenticated?.();
      } catch (err) {
        if (this._error) {
          this._error.textContent = err?.message || MSG.FAIL;
        }
        console.error('[LoginManager]', err);
      } finally {
        this._syncModeUI();
        if (this._submitBtn) this._submitBtn.disabled = false;
      }
    }
  }

  Sky.LoginManager = LoginManager;
})(window.Sky = window.Sky || {});
