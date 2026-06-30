/* <!--
  NetManager
  - 온라인 PvP: WebSocket 대기열 매칭 및 전투 중 릴레이.
  - file:// 로컬 테스트 시 ws://localhost:8787/ws 사용.
  - 배포 시 같은 호스트의 /ws (또는 window.SKY_WS_URL) 로 연결.

  파일 구조: IIFE + Sky 네임스페이스.
--> */
(function (Sky) {
  'use strict';

  let _instance = null;

  class NetManager {
    constructor() {
      this.ws = null;
      this.slot = null;
      this.roomId = null;
      this.opponentFighterId = null;
      this._handlers = new Map();
      this._matchPromise = null;
      this._matchReject = null;
    }

    static getInstance() {
      if (!_instance) _instance = new NetManager();
      return _instance;
    }

    static resolveWsUrl() {
      if (typeof window.SKY_WS_URL === 'string' && window.SKY_WS_URL) {
        return window.SKY_WS_URL;
      }
      if (window.location.protocol === 'file:') {
        return 'ws://127.0.0.1:8787/ws';
      }
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname || '127.0.0.1';
      const port = window.location.port || (proto === 'wss:' ? '443' : '80');
      if (port === '80' || port === '443') {
        return `${proto}//${host}/ws`;
      }
      return `${proto}//${host}:${port}/ws`;
    }

    static resolveHealthUrl() {
      if (typeof window.SKY_HEALTH_URL === 'string' && window.SKY_HEALTH_URL) {
        return window.SKY_HEALTH_URL;
      }
      if (window.location.protocol === 'file:') {
        return 'http://127.0.0.1:8787/health';
      }
      if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
        return `${window.location.origin}/health`;
      }
      return null;
    }

    static checkServer() {
      const url = NetManager.resolveHealthUrl();
      if (!url) return Promise.resolve({ ok: false, reason: 'no_url' });
      return fetch(url, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad_status'))))
        .then((data) => ({ ok: true, data }))
        .catch(() => ({ ok: false, reason: 'offline' }));
    }

    _emit(type, data) {
      const list = this._handlers.get(type);
      if (!list) return;
      list.forEach((fn) => fn(data));
    }

    on(type, fn) {
      if (!this._handlers.has(type)) this._handlers.set(type, new Set());
      this._handlers.get(type).add(fn);
      return () => this._handlers.get(type)?.delete(fn);
    }

    off(type, fn) {
      this._handlers.get(type)?.delete(fn);
    }

    connect() {
      if (this.ws && this.ws.readyState <= WebSocket.OPEN) {
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        const url = NetManager.resolveWsUrl();
        const ws = new WebSocket(url);
        this.ws = ws;

        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error('서버에 연결할 수 없습니다.'));
        ws.onclose = () => {
          this._emit('disconnected', {});
          if (this._matchReject) {
            this._matchReject(new Error('연결이 끊어졌습니다.'));
            this._matchReject = null;
            this._matchPromise = null;
          }
        };
        ws.onmessage = (ev) => {
          let msg;
          try {
            msg = JSON.parse(ev.data);
          } catch {
            return;
          }
          this._handleMessage(msg);
        };
      });
    }

    _handleMessage(msg) {
      switch (msg.type) {
        case 'queued':
          this._emit('status', { text: `매칭 대기 중… (${msg.position}번째)` });
          break;
        case 'matched':
          this.slot = msg.slot;
          this.roomId = msg.roomId;
          this.opponentFighterId = msg.opponentFighterId;
          this._emit('status', { text: '매칭 완료! 출격합니다.' });
          if (this._matchPromise) {
            this._matchPromise({
              slot: this.slot,
              roomId: this.roomId,
              opponentFighterId: this.opponentFighterId,
            });
            this._matchPromise = null;
            this._matchReject = null;
          }
          break;
        case 'relay':
          this._emit('relay', { from: msg.from, payload: msg.payload });
          break;
        case 'opponent_left':
          this._emit('opponent_left', {});
          break;
        case 'queue_cancelled':
          this._emit('status', { text: '매칭 취소됨' });
          break;
        default:
          break;
      }
    }

    startMatchmaking({ fighterId, queueMode = 'ffa', callsign, onStatus }) {
      this.cancelMatchmaking();
      return new Promise(async (resolve, reject) => {
        this._matchPromise = resolve;
        this._matchReject = reject;
        this.on('status', onStatus);
        try {
          await this.connect();
          onStatus?.({ text: '서버 연결됨. 상대를 찾는 중…' });
          this.ws.send(JSON.stringify({
            type: 'queue',
            fighterId,
            queueMode: queueMode === 'team' ? 'team' : 'ffa',
            callsign: String(callsign || 'pilot').slice(0, 16),
          }));
        } catch (err) {
          this._matchPromise = null;
          this._matchReject = null;
          reject(err);
        }
      });
    }

    cancelMatchmaking() {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'cancel_queue' }));
      }
      if (this._matchReject) {
        this._matchReject(new Error('매칭 취소'));
        this._matchReject = null;
        this._matchPromise = null;
      }
    }

    sendRelay(payload) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.roomId) return;
      this.ws.send(JSON.stringify({ type: 'relay', payload }));
    }

    leaveBattle() {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'leave_room' }));
      }
      this.roomId = null;
      this.slot = null;
      this.opponentFighterId = null;
    }

    disconnect() {
      this.leaveBattle();
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
    }
  }

  Sky.NetManager = NetManager;
})(window.Sky = window.Sky || {});
