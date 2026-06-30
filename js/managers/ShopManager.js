/* <!--
  ShopManager
  - 전투기 목록을 카드 형태로 렌더링하고 구매/장착/업그레이드/개량을 처리합니다.
  - 국가 탭(전체/미국/러시아/유럽/한국/중국)을 제공하며 선택된 국가의 기체만 노출합니다.
  - 미니 3D 썸네일은 BattleManager와 동일한 buildAircraftMesh 헬퍼를 재사용해
    데이터 1소스를 유지합니다.
  - 보유한 기체의 "관리" 버튼을 누르면 모달이 열리며,
    업그레이드(4스탯 강화)와 개량(Su-27→Su-30→…) 을 한 화면에서 처리합니다.

  파일 구조: file:// 환경 호환을 위해 IIFE + Sky 네임스페이스 패턴 사용.
            THREE 는 글로벌(UMD) 로 로드되어 있다고 가정합니다.
--> */
(function (Sky, THREE) {
  'use strict';

const {
  COUNTRIES,
  findFighter,
  UPGRADE_CONFIG,
  upgradeCost,
  computeFinalStats,
  getImprovementTarget,
  getShopFighters,
  getFighterUnlockStatus,
} = Sky.fighters;
const GameState = Sky.GameState;
const { buildAircraftMesh } = Sky.Aircraft;
function fmtVS(amount) {
  return Sky.currency?.formatVS?.(amount) ?? `${Math.max(0, Number(amount) || 0).toLocaleString()} VS`;
}

class ShopManager {
  constructor({ root, onBack }) {
    this._root = root;
    if (!root) {
      console.warn('[ShopManager] screen-shop 요소를 찾지 못했습니다.');
      return;
    }
    this._tabs = root.querySelector('#shop-tabs');
    this._grid = root.querySelector('#shop-grid');
    this._empty = root.querySelector('#shop-empty');
    this._moneyEl = root.querySelector('#shop-money');
    this._kmEl = root.querySelector('#shop-km');
    this._modal = root.querySelector('#manage-modal');
    this._modalBody = root.querySelector('#manage-body');
    this._modalTitle = root.querySelector('#manage-title');
    this._onBack = onBack;
    this._thumbs = [];        // 그리드 카드의 3D 썸네일 컨텍스트
    this._modalThumbs = [];   // 관리 모달의 3D 썸네일 컨텍스트(현재/개량 후 비교)
    this._selectedCountry = 'ALL';
    this._manageId = null;    // 현재 관리 모달에 표시 중인 기체 ID
    this._modelReadyUnsub = null;

    root.querySelector('[data-action="back"]')?.addEventListener('click', () => onBack?.());
    root.querySelector('[data-action="close-manage"]')?.addEventListener('click', () => this._closeManage());
    this._modal?.addEventListener('click', (e) => {
      if (e.target === this._modal) this._closeManage();
    });

    if (this._tabs) this._renderTabs();

    GameState?.subscribe?.(() => {
      if (this._isActive()) {
        this._render();
        if (this._manageId) this._renderManage();
      }
    });
  }

  _isActive() { return this._root?.classList.contains('active'); }

  enter() {
    this._render();
    requestAnimationFrame(() => {
      if (this._isActive()) this._render();
    });
    if (!this._modelReadyUnsub && Sky.AircraftModelLoader?.whenReady) {
      this._modelReadyUnsub = Sky.AircraftModelLoader.whenReady(() => {
        if (this._isActive()) this._render();
      });
    }
  }
  exit() {
    this._closeManage();
    this._disposeThumbs();
  }

  _disposeThumbs() {
    this._thumbs.forEach((t) => {
      t.dispose?.();
      t.canvas.remove();
    });
    this._thumbs = [];
  }

  _disposeModalThumbs() {
    this._modalThumbs.forEach((t) => {
      t.dispose?.();
      t.canvas.remove();
    });
    this._modalThumbs = [];
  }

  /* <!-- 국가 탭은 한 번만 구성. 활성 상태는 _render 에서 갱신합니다. --> */
  _renderTabs() {
    if (!this._tabs) return;
    this._tabs.innerHTML = '';
    COUNTRIES.forEach((country) => {
      const btn = document.createElement('button');
      btn.className = 'country-tab';
      btn.dataset.code = country.code;
      btn.innerHTML = `<span class="flag" aria-hidden="true">${country.flag}</span><span class="lbl">${country.label}</span>`;
      btn.addEventListener('click', () => {
        if (this._selectedCountry === country.code) return;
        this._selectedCountry = country.code;
        this._render();
      });
      this._tabs.appendChild(btn);
    });
  }

  _render() {
    if (!this._root || !GameState) return;
    this._disposeThumbs();
    if (this._moneyEl) this._moneyEl.textContent = fmtVS(GameState.money).replace(' VS', '');
    if (this._kmEl) {
      this._kmEl.textContent = (Sky.currency?.formatKM?.(GameState.km) ?? `${GameState.km} KM`).replace(' KM', '');
    }

    /* 활성 탭 표시 */
    this._tabs?.querySelectorAll('.country-tab').forEach((el) => {
      el.classList.toggle('active', el.dataset.code === this._selectedCountry);
    });

    /* 개량 전용 변형 + 잠금 해제 대상 기체 노출 */
    const unlockCtx = {
      ownedIds: GameState.ownedFighters,
      getUpgrade: (id) => GameState.getUpgrade(id),
    };
    const list = getShopFighters(this._selectedCountry, GameState.ownedFighters, unlockCtx);
    if (!this._grid) return;
    this._grid.innerHTML = '';
    this._empty?.classList.toggle('hidden', list.length > 0);

    list.forEach((fighter) => {
      const owned = GameState.ownedFighters.includes(fighter.id);
      const equipped = GameState.equippedFighterId === fighter.id;
      const isPurchasable = fighter.purchasable !== false;
      const unlockStatus = getFighterUnlockStatus(fighter, unlockCtx);
      const isLocked = !owned && !!fighter.unlock && !unlockStatus.unlocked;

      const card = document.createElement('div');
      card.className = 'shop-card' + (owned ? ' owned' : '') + (equipped ? ' equipped' : '') + (isLocked ? ' locked' : '');

      const countryMeta = COUNTRIES.find((c) => c.code === fighter.country);
      const countryTag = countryMeta ? `<span class="country-chip">${countryMeta.flag} ${countryMeta.label}</span>` : '';

      /* 개량으로만 얻을 수 있는 변형은 카드 상단에 별도 안내 칩을 노출 */
      const variantBadge = !isPurchasable
        ? `<span class="variant-chip" title="개량 전용 변형">개량형</span>`
        : '';
      const lockBadge = isLocked
        ? `<span class="lock-chip" title="잠금 해제 조건 미충족">🔒 잠금</span>`
        : '';

      card.innerHTML = `
        <div class="shop-thumb"></div>
        ${equipped ? '<span class="badge">장착중</span>' : owned ? '<span class="badge owned-badge">보유</span>' : ''}
        <div class="shop-name">${fighter.modelName} ${countryTag} ${variantBadge} ${lockBadge}</div>
        <div class="shop-tag">${fighter.description}</div>
        <div class="stat-grid">
          <div class="row"><span>속도</span><b>${fighter.stats.speed}</b></div>
          <div class="row"><span>기동성</span><b>${fighter.stats.agility}</b></div>
          <div class="row"><span>장갑</span><b>${fighter.stats.armor}</b></div>
          <div class="row"><span>미사일</span><b>${fighter.weapons.secondary}</b></div>
        </div>
        <div class="shop-actions"></div>
      `;

      const actions = card.querySelector('.shop-actions');
      if (!owned) {
        if (isLocked) {
          const lockBtn = document.createElement('button');
          lockBtn.className = 'btn';
          lockBtn.disabled = true;
          const reqName = unlockStatus.requiresFighter?.modelName ?? '선행 기체';
          lockBtn.textContent = `${reqName} MAX ${unlockStatus.maxed}/${unlockStatus.required}`;
          actions.appendChild(lockBtn);
        } else if (isPurchasable) {
          const buyBtn = document.createElement('button');
          buyBtn.className = 'btn btn-primary';
          buyBtn.textContent = `구매 · ${fmtVS(fighter.price)}`;
          buyBtn.disabled = GameState.money < fighter.price;
          buyBtn.addEventListener('click', () => GameState.buyFighter(fighter));
          actions.appendChild(buyBtn);
        } else {
          /* 개량 전용이면서 미보유 상태(필터 우회) — 실제로는 노출되지 않지만 안전망 */
          const tag = document.createElement('button');
          tag.className = 'btn';
          tag.disabled = true;
          tag.textContent = '이전 단계 기체에서 개량';
          actions.appendChild(tag);
        }
      } else {
        if (!equipped) {
          const eq = document.createElement('button');
          eq.className = 'btn';
          eq.textContent = '장착';
          eq.addEventListener('click', () => GameState.equip(fighter.id));
          actions.appendChild(eq);
        } else {
          const tag = document.createElement('button');
          tag.className = 'btn';
          tag.disabled = true;
          tag.textContent = '장착 완료';
          actions.appendChild(tag);
        }
        /* 보유 기체는 관리(업그레이드+개량) 버튼 추가 */
        const manage = document.createElement('button');
        manage.className = 'btn btn-primary';
        manage.textContent = '관리';
        manage.addEventListener('click', () => this._openManage(fighter.id));
        actions.appendChild(manage);
      }

      this._grid.appendChild(card);
      this._mountThumb(card.querySelector('.shop-thumb'), fighter, this._thumbs);
    });
  }

  /* ============================ 관리 모달 ============================ */

  _openManage(fighterId) {
    this._manageId = fighterId;
    this._modal.classList.remove('hidden');
    this._modal.setAttribute('aria-hidden', 'false');
    this._renderManage();
  }

  _closeManage() {
    this._manageId = null;
    this._disposeModalThumbs();
    this._modal.classList.add('hidden');
    this._modal.setAttribute('aria-hidden', 'true');
    this._modalBody.innerHTML = '';
  }

  _renderManage() {
    const fighter = findFighter(this._manageId);
    if (!fighter || !GameState.ownedFighters.includes(fighter.id)) {
      this._closeManage();
      return;
    }
    this._disposeModalThumbs();
    this._modalTitle.textContent = `${fighter.modelName} · 관리`;

    const upgrades = GameState.getUpgrade(fighter.id);
    const final = computeFinalStats(fighter, upgrades);

    /* ===== 업그레이드 행 ===== */
    const rows = Object.entries(UPGRADE_CONFIG).map(([key, cfg]) => {
      const lv = upgrades[key] ?? 0;
      const maxed = lv >= cfg.maxLevel;
      const cost = upgradeCost(key, lv);
      const finalVal = key === 'firepower'
        ? `x${final.firepower.toFixed(2)}`
        : Math.round(final[key] ?? fighter.stats[key] ?? 0);
      const meterPct = Math.round((lv / cfg.maxLevel) * 100);
      return `
        <div class="upgrade-row" data-key="${key}">
          <div class="lbl">${cfg.label}</div>
          <div class="meter" title="Lv ${lv}/${cfg.maxLevel}"><i style="width:${meterPct}%"></i></div>
          <div class="val">${finalVal} (Lv ${lv})</div>
          <button class="btn ${maxed ? '' : 'btn-primary'}" data-up="${key}" ${maxed || GameState.money < cost ? 'disabled' : ''}>
            ${maxed ? 'MAX' : fmtVS(cost)}
          </button>
        </div>
      `;
    }).join('');

    /* ===== 개량 섹션 ===== */
    const improvement = getImprovementTarget(fighter, GameState.ownedFighters);
    let improveEmptyMsg = '이 기체는 개량 트리가 없거나 최종 단계입니다.';
    if (fighter.upgradePath?.to) {
      const nextId = fighter.upgradePath.to;
      if (GameState.ownedFighters.includes(nextId)) {
        const nextName = findFighter(nextId).modelName;
        improveEmptyMsg = `${nextName} 을(를) 이미 보유 중입니다. 상점 카드에서 「장착」으로 출격 기체를 바꿀 수 있습니다.`;
      }
    }
    const improveSection = improvement
      ? this._renderImproveSection(fighter, improvement)
      : `<div class="improve-empty hint">${improveEmptyMsg}</div>`;

    const unlockBanner = this._renderUnlockBanner(fighter);

    this._modalBody.innerHTML = `
      ${unlockBanner}
      <section class="manage-section">
        <h4 class="manage-h">업그레이드</h4>
        <p class="hint" style="margin:0 0 10px;">현재 기체의 4가지 스탯을 한 단계씩 강화합니다. 누적 강화 레벨은 개량 후에도 유지됩니다.</p>
        <div class="upgrade-rows">${rows}</div>
      </section>
      <section class="manage-section improve-section">
        <h4 class="manage-h">개량 (Modernization)</h4>
        ${improveSection}
      </section>
    `;

    /* 업그레이드 핸들러 */
    this._modalBody.querySelectorAll('[data-up]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.up;
        const lv = upgrades[key] ?? 0;
        const cost = upgradeCost(key, lv);
        GameState.upgradeStat(fighter.id, key, cost);
      });
    });

    /* 개량 핸들러 + 비교 썸네일 마운트 */
    if (improvement) {
      const improveBtn = this._modalBody.querySelector('[data-improve]');
      improveBtn?.addEventListener('click', () => {
        const tgt = improvement.target;
        if (!confirm(`${fighter.modelName} 에서 ${tgt.modelName} 개량형을 추가합니다.\n비용 ${fmtVS(improvement.cost)} · ${fighter.modelName} 은 계속 보유·출격할 수 있습니다.\n계속하시겠습니까?`)) return;
        const ok = GameState.improveFighter(fighter.id, tgt.id, improvement.cost);
        if (ok) this._openManage(tgt.id); // 개량 결과로 모달 자동 갱신
      });
      const fromHost = this._modalBody.querySelector('[data-thumb="from"]');
      const toHost   = this._modalBody.querySelector('[data-thumb="to"]');
      if (fromHost) this._mountThumb(fromHost, fighter, this._modalThumbs);
      if (toHost)   this._mountThumb(toHost, improvement.target, this._modalThumbs);
    }
  }

  _renderUnlockBanner(fighter) {
    if (fighter.id !== 'f14') return '';
    const fa18 = findFighter('fa18');
    if (GameState.ownedFighters.includes('fa18')) {
      return `<div class="unlock-banner unlocked"><span class="unlock-icon">✓</span> F/A-18 Super Hornet 구매 잠금이 해제되었습니다. 상점에서 구매할 수 있습니다.</div>`;
    }
    const unlockCtx = {
      ownedIds: GameState.ownedFighters,
      getUpgrade: (id) => GameState.getUpgrade(id),
    };
    const status = getFighterUnlockStatus(fa18, unlockCtx);
    const pct = Math.round((status.maxed / status.required) * 100);
    if (status.unlocked) {
      return `<div class="unlock-banner unlocked"><span class="unlock-icon">✓</span> F/A-18 Super Hornet 구매 가능! 상점에서 <b>${fmtVS(fa18.price)}</b>에 구매하세요.</div>`;
    }
    return `
      <div class="unlock-banner pending">
        <div class="unlock-title">🔒 F/A-18 Super Hornet 잠금 해제</div>
        <p class="unlock-desc">F-14 관리에서 스탯 <b>${status.required}개 이상</b>을 MAX로 강화하면 상점에서 구매할 수 있습니다.</p>
        <div class="unlock-meter" title="MAX 스탯 ${status.maxed}/${status.required}">
          <i style="width:${pct}%"></i>
        </div>
        <div class="unlock-progress">MAX 스탯 <b>${status.maxed}</b> / ${status.required}</div>
      </div>
    `;
  }

  _renderImproveSection(fighter, { target, cost }) {
    const canAfford = GameState.money >= cost;
    /* 개량 전후 스탯 차이를 시각화: + / - / · 로 표시 */
    const diffRow = (label, before, after, suffix = '') => {
      const delta = after - before;
      const sign = delta > 0 ? `<span class="delta up">+${Math.round(delta)}</span>`
        : delta < 0 ? `<span class="delta down">${Math.round(delta)}</span>`
        : `<span class="delta">·</span>`;
      return `
        <div class="diff-row">
          <span class="diff-lbl">${label}</span>
          <span class="diff-vals">${Math.round(before)}${suffix} → <b>${Math.round(after)}${suffix}</b></span>
          ${sign}
        </div>
      `;
    };

    const a = fighter.stats;
    const b = target.stats;
    return `
      <div class="improve-card">
        <div class="improve-thumbs">
          <figure class="improve-thumb">
            <div class="thumb-host" data-thumb="from"></div>
            <figcaption>${fighter.modelName}</figcaption>
          </figure>
          <div class="improve-arrow" aria-hidden="true">➜</div>
          <figure class="improve-thumb">
            <div class="thumb-host" data-thumb="to"></div>
            <figcaption>${target.modelName}</figcaption>
          </figure>
        </div>
        <p class="improve-desc">${target.description}</p>
        <div class="improve-diff">
          ${diffRow('속도',   a.speed,   b.speed)}
          ${diffRow('기동성', a.agility, b.agility)}
          ${diffRow('장갑',   a.armor,   b.armor)}
          ${diffRow('연료',   a.fuel,    b.fuel)}
          ${diffRow('미사일', fighter.weapons.secondary, target.weapons.secondary, '발')}
        </div>
        <div class="improve-cta">
          <span class="improve-cost">개량 비용 <b>${fmtVS(cost)}</b></span>
          <button class="btn btn-primary" data-improve ${canAfford ? '' : 'disabled'}>
            ${canAfford ? `${target.modelName} 으로 개량` : '소지금 부족'}
          </button>
        </div>
        <p class="hint" style="margin:8px 0 0;">개량 시 상위 기체가 추가되며, 이전 기체도 보유합니다. 업그레이드 레벨은 새 기체에 복사됩니다.</p>
      </div>
    `;
  }

  /* ============================ 3D 썸네일 ============================ */

  _mountThumb(host, fighter, bucket) {
    if (!host) return;
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);

    const w = Math.max(host.clientWidth || 0, 280);
    const h = Math.max(host.clientHeight || 0, 130);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);

    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const key = new THREE.DirectionalLight(0xffffff, 1.05);
    key.position.set(5, 8, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xa8c0e0, 0.45);
    fill.position.set(-4, 2, -3);
    scene.add(fill);

    const mesh = buildAircraftMesh(fighter, { thrust: false });
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    mesh.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const dist = maxDim * 2.1;
    camera.position.set(dist * 0.85, dist * 0.35, dist * 0.85);
    camera.lookAt(0, 0, 0);
    mesh.rotation.y = Math.PI * 0.2;
    scene.add(mesh);

    const resize = () => {
      const rw = Math.max(host.clientWidth || 0, 280);
      const rh = Math.max(host.clientHeight || 0, 130);
      renderer.setSize(rw, rh, false);
      camera.aspect = rw / rh;
      camera.updateProjectionMatrix();
    };

    let raf = 0;
    const tick = () => {
      mesh.rotation.y += 0.008;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();
    requestAnimationFrame(resize);

    bucket.push({
      renderer,
      canvas,
      resize,
      dispose: () => {
        cancelAnimationFrame(raf);
        scene.traverse((obj) => {
          obj.geometry?.dispose?.();
          if (obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach((m) => m.dispose?.());
          }
        });
        renderer.dispose();
        renderer.forceContextLoss?.();
      },
    });
  }
}

  Sky.ShopManager = ShopManager;
})(window.Sky = window.Sky || {}, window.THREE);
