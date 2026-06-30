/* <!--
  AuthManager
  - ??? ???(???) + ???? ?? ?? ??.
  - ??????? ? PII ? ???? ???, ????? ??+??? localStorage ? ?????.
  - file:// ????? Web Crypto ? ?? ? ?? ??? FNV ??? ?????.

  ?? ??: IIFE + Sky ??????.
--> */
(function (Sky) {
  'use strict';

  const ACCOUNTS_KEY = 'sky_of_warriors:accounts:v1';
  const SESSION_KEY = 'sky_of_warriors:session:v1';
  const CALLSIGN_RE = /^[a-zA-Z0-9\uAC00-\uD7A3_]{3,16}$/;

  /* <!-- ??? ?? ?? ??: ???? ??, ???? ?? --> */
  const WORKER_CALLSIGN = 'AceofAce';
  const WORKER_CALLSIGN_KEY = WORKER_CALLSIGN.toLowerCase();
  const WORKER_SALT = 'sky_of_warriors:worker:v1';

  const AUTH_MSG = {
    CALLSIGN_INVALID: '\uCF5C\uC0AC\uC778\uC740 3~16\uC790 (\uD55C\uAE00\u00B7\uC601\uBB38\u00B7\uC22B\uC790\u00B7_) \uB9CC \uC0AC\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.',
    PASSWORD_SHORT: '\uBE44\uBC00\uBC88\uD638\uB294 4\uC790 \uC774\uC0C1\uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4.',
    PASSWORD_LONG: '\uBE44\uBC00\uBC88\uD638\uB294 64\uC790 \uC774\uD558\uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4.',
    CALLSIGN_TAKEN: '\uC774\uBBF8 \uC0AC\uC6A9 \uC911\uC778 \uCF5C\uC0AC\uC778\uC785\uB2C8\uB2E4.',
    RESERVED_ACCOUNT: '\uC774\uBBF8 \uC788\uB294 \uACC4\uC815\uC785\uB2C8\uB2E4.',
    LOGIN_FAILED: '\uCF5C\uC0AC\uC778 \uB610\uB294 \uBE44\uBC00\uBC88\uD638\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.',
  };

  function fnv1a(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  function makeSalt() {
    if (window.crypto?.getRandomValues) {
      const buf = new Uint8Array(16);
      crypto.getRandomValues(buf);
      return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    return fnv1a(String(Math.random()) + Date.now());
  }

  async function hashPassword(password, salt) {
    const payload = `${salt}:${password}`;
    if (window.crypto?.subtle && window.isSecureContext) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
      return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
    }
    return fnv1a(payload);
  }

  function accountIdFromCallsign(callsign) {
    return fnv1a(`sky-pilot:${callsign.toLowerCase()}`);
  }

  class AuthManager {
    constructor() {
      this._listeners = new Set();
      this._session = this._loadSession();
      this._workerHashPromise = null;
      this._purgeWorkerImpostorAccounts();
    }

    _isWorkerCallsign(callsign) {
      return String(callsign ?? '').trim().toLowerCase() === WORKER_CALLSIGN_KEY;
    }

    _purgeWorkerImpostorAccounts() {
      const accounts = this._loadAccounts();
      if (!accounts[WORKER_CALLSIGN_KEY]) return;
      delete accounts[WORKER_CALLSIGN_KEY];
      this._saveAccounts(accounts);
    }

    async _getWorkerPasswordHash() {
      if (!this._workerHashPromise) {
        this._workerHashPromise = hashPassword('maker1213', WORKER_SALT);
      }
      return this._workerHashPromise;
    }

    async _loginWorker(callsign, password) {
      const errPw = this.validatePassword(password);
      if (errPw) throw new Error(errPw);

      const hash = await hashPassword(password, WORKER_SALT);
      const expected = await this._getWorkerPasswordHash();
      if (hash !== expected) throw new Error(AUTH_MSG.LOGIN_FAILED);

      const accountId = accountIdFromCallsign(WORKER_CALLSIGN);
      this._saveSession({
        accountId,
        callsign: WORKER_CALLSIGN,
        loggedInAt: Date.now(),
        worker: true,
      });
      return this.getSession();
    }

    _loadAccounts() {
      try {
        const raw = localStorage.getItem(ACCOUNTS_KEY);
        return raw ? JSON.parse(raw) : {};
      } catch {
        return {};
      }
    }

    _saveAccounts(accounts) {
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
    }

    _loadSession() {
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    }

    _saveSession(session) {
      this._session = session;
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
      this._emit();
    }

    _emit() {
      this._listeners.forEach((cb) => cb(this.getSession()));
    }

    subscribe(cb) {
      this._listeners.add(cb);
      cb(this.getSession());
      return () => this._listeners.delete(cb);
    }

    getSession() {
      if (!this._session?.accountId) return null;
      return { ...this._session };
    }

    isLoggedIn() {
      return !!this._session?.accountId;
    }

    getCallsign() {
      return this._session?.callsign ?? null;
    }

    getAccountId() {
      return this._session?.accountId ?? null;
    }

    isWorkerAccount() {
      return !!this._session?.worker;
    }

    validateCallsign(callsign) {
      const trimmed = String(callsign ?? '').trim();
      if (!CALLSIGN_RE.test(trimmed)) {
        return AUTH_MSG.CALLSIGN_INVALID;
      }
      return null;
    }

    validatePassword(password) {
      if (String(password ?? '').length < 4) {
        return AUTH_MSG.PASSWORD_SHORT;
      }
      if (String(password).length > 64) {
        return AUTH_MSG.PASSWORD_LONG;
      }
      return null;
    }

    async register(callsign, password) {
      const trimmed = String(callsign ?? '').trim();
      const errCall = this.validateCallsign(trimmed);
      if (errCall) throw new Error(errCall);
      const errPw = this.validatePassword(password);
      if (errPw) throw new Error(errPw);

      if (this._isWorkerCallsign(trimmed)) {
        throw new Error(AUTH_MSG.RESERVED_ACCOUNT);
      }

      const accounts = this._loadAccounts();
      const key = trimmed.toLowerCase();
      if (accounts[key]) throw new Error(AUTH_MSG.CALLSIGN_TAKEN);

      const salt = makeSalt();
      const hash = await hashPassword(password, salt);
      const accountId = accountIdFromCallsign(trimmed);
      accounts[key] = { accountId, callsign: trimmed, salt, hash, createdAt: Date.now() };
      this._saveAccounts(accounts);

      this._saveSession({ accountId, callsign: trimmed, loggedInAt: Date.now() });
      return this.getSession();
    }

    async login(callsign, password) {
      const trimmed = String(callsign ?? '').trim();
      const errCall = this.validateCallsign(trimmed);
      if (errCall) throw new Error(errCall);
      const errPw = this.validatePassword(password);
      if (errPw) throw new Error(errPw);

      if (this._isWorkerCallsign(trimmed)) {
        return this._loginWorker(trimmed, password);
      }

      const accounts = this._loadAccounts();
      const rec = accounts[trimmed.toLowerCase()];
      if (!rec) throw new Error(AUTH_MSG.LOGIN_FAILED);

      const hash = await hashPassword(password, rec.salt);
      if (hash !== rec.hash) throw new Error(AUTH_MSG.LOGIN_FAILED);

      this._saveSession({ accountId: rec.accountId, callsign: rec.callsign, loggedInAt: Date.now() });
      return this.getSession();
    }

    logout() {
      this._saveSession(null);
    }

    /* <!-- ?? ??? ??? ???? ????? ??? ?????. --> */
    deleteCurrentAccount() {
      const callsign = this.getCallsign();
      const accountId = this.getAccountId();
      if (!callsign || !accountId) return null;

      const accounts = this._loadAccounts();
      delete accounts[callsign.toLowerCase()];
      this._saveAccounts(accounts);
      this._saveSession(null);
      return accountId;
    }
  }

  Sky.AuthManager = new AuthManager();
})(window.Sky = window.Sky || {});
