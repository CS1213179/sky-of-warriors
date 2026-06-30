/* <!--
  ObjectPool
  - 미사일/탄환/파티클처럼 빈번하게 생성/파괴되는 객체의 재사용 풀.
  - 풀에 빈 슬롯이 없으면 새 객체를 생성하되, 호출 측은 항상 acquire/release만 사용합니다.

  파일 구조: file:// 환경 호환을 위해 IIFE + Sky 네임스페이스 패턴 사용.
--> */
(function (Sky) {
  'use strict';

class ObjectPool {
  constructor(factory, resetFn, initialSize = 0) {
    this._factory = factory;
    this._resetFn = resetFn;
    this._pool = [];
    this._active = new Set();
    for (let i = 0; i < initialSize; i++) {
      this._pool.push(this._factory());
    }
  }

  acquire() {
    const obj = this._pool.pop() ?? this._factory();
    this._active.add(obj);
    return obj;
  }

  release(obj) {
    if (!this._active.has(obj)) return;
    this._active.delete(obj);
    this._resetFn?.(obj);
    this._pool.push(obj);
  }

  forEachActive(cb) {
    this._active.forEach(cb);
  }

  get activeCount() { return this._active.size; }
  get pooledCount() { return this._pool.length; }
}

  Sky.ObjectPool = ObjectPool;
})(window.Sky = window.Sky || {});
