/* <!--
  AchievementManager
  - 업적 현황은 Achievements.paintAchievementsScreen 으로 그림.
  - KM 업그레이드(버프) 패널만 이 매니저가 담당.
--> */
(function (Sky) {
  'use strict';

  const Km = Sky.KmBuffs || {};
  const paint = () => Sky.paintAchievementsScreen || Sky.Achievements?.paintAchievementsScreen;

  const MSG = {
    pickType: '\uAC15\uD654\uD560 \uBC84\uD504 \uC885\uB958\uB97C \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.',
    noKm: 'KM\uAC00 \uBD80\uC871\uD569\uB2C8\uB2E4. \uC5C5\uC801\uC744 \uB2EC\uC131\uD574 KM\uB97C \uBC1B\uC73C\uC138\uC694.',
    noVs: 'VS\uAC00 \uBD80\uC871\uD569\uB2C8\uB2E4. \uC804\uD22C\uB97C \uC218\uD589\uD574 VS\uB97C \uBC1B\uC73C\uC138\uC694.',
    upgraded: '\uBC84\uD504\uAC00 \uAC15\uD654\uB418\uC5C8\uC2B5\uB2C8\uB2E4.',
    changed: '\uBC84\uD504 \uC885\uB958\uAC00 \uBCC0\uACBD\uB418\uC5C8\uC2B5\uB2C8\uB2E4. (\uB808\uBDF0 \uC720\uC9C0)',
    typeMismatch: '\uB2E4\uB978 \uBC84\uD504\uB97C \uBC14\uAFB8\uB824\uBA74 \u201C\uBC84\uD504 \uBCC0\uACBD\u201D \uBC84\uD2BC\uC744 \uC0AC\uC6A9\uD558\uC138\uC694.',
    sameType: '\uC774\uBBF8 \uC801\uC6A9 \uC911\uC778 \uBC84\uD504\uC785\uB2C8\uB2E4.',
    noBuff: '\uC544\uC9C1 \uBC84\uD504\uAC00 \uC120\uD0DD\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.',
  };

  function getGS() {
    return Sky.GameState || null;
  }

  function fmtVS(amount) {
    return Sky.currency?.formatVS?.(amount) || (Math.max(0, Number(amount) || 0).toLocaleString() + ' VS');
  }

  class AchievementManager {
    constructor({ root, onBack }) {
      this._root = root;
      this._onBack = onBack;
      this._selectedType = null;
      this._msgTimer = null;
      this._upgradeOpen = false;
      this._unsubscribe = null;

      if (!root) {
        console.warn('[AchievementManager] screen-achievements missing');
        return;
      }

      this._bindDom();
      root.querySelector('[data-action="ach-back"]')?.addEventListener('click', () => onBack?.());
      root.addEventListener('click', (e) => {
        const action = e.target.closest('[data-action]')?.dataset?.action;
        if (!action) return;
        if (action === 'ach-open-upgrade') this._openUpgrade();
        else if (action === 'ach-close-upgrade') this._closeUpgrade();
        else if (action === 'km-buff-spend') this._onSpendKm();
        else if (action === 'km-buff-change') this._onChangeType();
      });
      this._subscribeState();
    }

    _bindDom() {
      const root = this._root;
      if (!root) return;
      this._openUpgradeBtn = root.querySelector('#ach-open-upgrade');
      this._buffPanel = root.querySelector('#km-buff-panel');
      this._buffStatus = root.querySelector('#km-buff-status');
      this._buffCards = root.querySelector('#km-buff-cards');
      this._buffSpendBtn = root.querySelector('#km-buff-spend');
      this._buffChangeBtn = root.querySelector('#km-buff-change');
      this._buffMsg = root.querySelector('#km-buff-msg');
    }

    _subscribeState() {
      const GS = getGS();
      if (!GS || !GS.subscribe) return;
      if (this._unsubscribe) this._unsubscribe();
      this._unsubscribe = GS.subscribe(() => {
        if (this._root?.classList.contains('active')) this._render();
      });
    }

    enter() {
      this._bindDom();
      this._subscribeState();
      this._closeUpgrade(false);
      this._render();
    }

    exit() {
      this._closeUpgrade(false);
      this._clearMsg();
    }

    _openUpgrade() {
      this._upgradeOpen = true;
      if (this._buffPanel) {
        this._buffPanel.classList.remove('hidden');
        this._buffPanel.hidden = false;
      }
      this._openUpgradeBtn?.classList.add('hidden');
      this._renderBuffPanel();
    }

    _closeUpgrade(render) {
      if (render === undefined) render = true;
      this._upgradeOpen = false;
      if (this._buffPanel) {
        this._buffPanel.classList.add('hidden');
        this._buffPanel.hidden = true;
      }
      this._openUpgradeBtn?.classList.remove('hidden');
      this._clearMsg();
      if (render) this._render();
    }

    _setMsg(text, isError) {
      if (!this._buffMsg) return;
      this._buffMsg.textContent = text || '';
      this._buffMsg.classList.toggle('error', !!isError);
      clearTimeout(this._msgTimer);
      if (text) this._msgTimer = setTimeout(() => this._clearMsg(), 4200);
    }

    _clearMsg() {
      clearTimeout(this._msgTimer);
      if (this._buffMsg) {
        this._buffMsg.textContent = '';
        this._buffMsg.classList.remove('error');
      }
    }

    _onSelectType(type) {
      this._selectedType = type;
      this._renderBuffPanel();
    }

    _onSpendKm() {
      const GS = getGS();
      const type = this._selectedType;
      if (!type || !GS) {
        this._setMsg(MSG.pickType, true);
        return;
      }
      const cur = GS.getKmBuff?.() || { type: null, level: 0 };
      if (cur.type && cur.type !== type) {
        this._setMsg(MSG.typeMismatch, true);
        return;
      }
      const res = GS.spendKmBuff?.(type);
      if (!res || !res.ok) {
        if (res && res.code === 'no_km') this._setMsg(MSG.noKm, true);
        else if (res && res.code === 'type_mismatch') this._setMsg(MSG.typeMismatch, true);
        else this._setMsg('\uAC15\uD654\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.', true);
        return;
      }
      this._setMsg(MSG.upgraded);
      this._render();
    }

    _onChangeType() {
      const GS = getGS();
      const type = this._selectedType;
      if (!type || !GS) {
        this._setMsg(MSG.pickType, true);
        return;
      }
      const cur = GS.getKmBuff?.() || { type: null, level: 0 };
      if (!cur.type || cur.level <= 0) {
        this._setMsg(MSG.noBuff, true);
        return;
      }
      if (cur.type === type) {
        this._setMsg(MSG.sameType, true);
        return;
      }
      const cost = Km.CHANGE_BUFF_VS_COST || 5000;
      const label = (Km.getBuffLabel && Km.getBuffLabel(type)) || type;
      if (!window.confirm('\uBC84\uD504\uB97C ' + label + '(\uC73C)\uB85C \uBCC0\uACBD\uD569\uB2C8\uB274?\n\uBE44\uC6A9: ' + fmtVS(cost) + ' (\uB808\uBDF0 ' + cur.level + ' \uC720\uC9C0)')) {
        return;
      }
      const res = GS.changeKmBuffType?.(type);
      if (!res || !res.ok) {
        if (res && res.code === 'no_vs') this._setMsg(MSG.noVs, true);
        else this._setMsg('\uBC84\uD504 \uBCC0\uACBD\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.', true);
        return;
      }
      this._setMsg(MSG.changed);
      this._render();
    }

    _renderBuffPanel() {
      if (!this._upgradeOpen) return;
      const GS = getGS();
      if (!GS) return;

      const buff = GS.getKmBuff?.() || { type: null, level: 0 };
      const types = Km.BUFF_TYPES || ['speed', 'armor', 'reload', 'evasion'];
      const defs = Km.BUFF_DEFS || {};

      if (!this._selectedType && buff.type) this._selectedType = buff.type;

      if (this._buffStatus) {
        const desc = (Km.describeBuff && Km.describeBuff(buff)) || '\uC120\uD0DD \uC804';
        this._buffStatus.textContent = '\uD604\uC7AC: ' + desc + ' \u00B7 \uBCF4\uC720 KM ' + (GS.km || 0);
      }

      if (this._buffCards) {
        this._buffCards.innerHTML = '';
        types.forEach((type) => {
          const def = defs[type] || { label: type, desc: '' };
          const isActive = buff.type === type && buff.level > 0;
          const isSelected = this._selectedType === type;
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'km-buff-card' + (isSelected ? ' selected' : '') + (isActive ? ' active' : '');
          card.setAttribute('role', 'radio');
          card.setAttribute('aria-checked', isSelected ? 'true' : 'false');
          card.innerHTML =
            '<span class="km-buff-card-label">' + (def.label || type) + '</span>' +
            '<span class="km-buff-card-desc">' + (def.desc || '') + '</span>' +
            (isActive ? '<span class="km-buff-card-lv">Lv.' + buff.level + '</span>' : '');
          card.addEventListener('click', () => { this._selectedType = type; this._renderBuffPanel(); });
          this._buffCards.appendChild(card);
        });
      }

      const showChange = buff.type && buff.level > 0 && this._selectedType && this._selectedType !== buff.type;
      this._buffSpendBtn?.classList.toggle('hidden', !!showChange);
      this._buffChangeBtn?.classList.toggle('hidden', !showChange);

      if (this._buffSpendBtn) {
        const canSpend = (GS.km || 0) >= 1 && (!buff.type || buff.type === this._selectedType);
        this._buffSpendBtn.disabled = !canSpend || !this._selectedType;
      }
      if (this._buffChangeBtn) {
        const cost = Km.CHANGE_BUFF_VS_COST || 5000;
        this._buffChangeBtn.textContent = '\uBC84\uD504 \uBCC0\uACBD \u00B7 ' + cost.toLocaleString() + ' VS';
        this._buffChangeBtn.disabled = !showChange || (GS.money || 0) < cost;
      }
    }

    _render() {
      const fn = paint();
      if (typeof fn === 'function') fn(this._root);
      this._renderBuffPanel();
    }
  }

  Sky.AchievementManager = AchievementManager;
})(window.Sky = window.Sky || {});
