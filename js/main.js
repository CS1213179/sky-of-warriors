/* <!--
  main.js - 부트스트랩.
  - 로그인 → 메인 메뉴 → 전투 모드 선택 → 전투 흐름을 SceneManager 로 조립합니다.
  - 로그인 UI 는 항상 먼저 초기화해 부트 중 오류가 나도 버튼이 동작합니다.
--> */
(function (Sky) {
  'use strict';

  let _scenes = null;
  let _loginManager = null;
  let _menuReady = false;

  function setCanvasInteractive(inBattle) {
    const canvas = document.getElementById('game-canvas');
    if (canvas) canvas.style.pointerEvents = inBattle ? 'auto' : 'none';
  }

  function showLoginScreen() {
    document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
    document.getElementById('screen-login')?.classList.add('active');
    setCanvasInteractive(false);
    _loginManager?.enter?.();
  }

  function ensureLoginManager(onAuthenticated) {
    if (_loginManager) return _loginManager;

    const screenLogin = document.getElementById('screen-login');
    if (!screenLogin || !Sky.LoginManager) {
      console.error('[Sky] LoginManager 또는 screen-login 을 사용할 수 없습니다.');
      return null;
    }

    _loginManager = new Sky.LoginManager({
      root: screenLogin,
      onAuthenticated,
    });

    _scenes?.register('login', { element: screenLogin, manager: _loginManager });
    return _loginManager;
  }

  function boot() {
    try {
      _bootCore();
    } catch (err) {
      console.error('[Sky] 게임 초기화 실패:', err);
      ensureLoginManager(() => {
        if (_menuReady && _scenes) {
          setCanvasInteractive(false);
          _scenes.show('menu');
        } else {
          alert('게임 데이터 로드에 실패했습니다. Ctrl+F5로 새로고침해 주세요.');
        }
      });
      showLoginScreen();
    }
  }

  function _bootCore() {
    if (!Sky.fighters?.FIGHTERS?.length) {
      throw new Error('전투기 데이터(fighters.js)를 불러오지 못했습니다.');
    }
    if (!Sky.GameState) {
      throw new Error('게임 저장소(GameState.js)를 불러오지 못했습니다.');
    }
    if (!Sky.AuthManager) {
      throw new Error('인증 모듈(AuthManager.js)을 불러오지 못했습니다.');
    }

    const GameState = Sky.GameState;
    const Auth = Sky.AuthManager;

    const canvas = document.getElementById('game-canvas');
    const screenLogin = document.getElementById('screen-login');
    const screenMenu = document.getElementById('screen-menu');
    const screenBattleMenu = document.getElementById('screen-battle-menu');
    const screenShop = document.getElementById('screen-shop');
    const screenAchievements = document.getElementById('screen-achievements');
    const screenBattle = document.getElementById('screen-battle');
    const matchModal = document.getElementById('online-match-modal');
    const matchStatus = document.getElementById('online-match-status');
    const net = Sky.NetManager.getInstance();

    _scenes = new Sky.SceneManager();
    const sceneShow = _scenes.show.bind(_scenes);
    _scenes.show = function (name, payload) {
      sceneShow(name, payload);
      if (name === 'achievements') {
        const paint = Sky.paintAchievementsScreen;
        if (typeof paint === 'function') {
          paint(screenAchievements);
          requestAnimationFrame(function () { paint(screenAchievements); });
        }
      }
    };

    const goMenu = () => {
      if (!screenMenu) {
        console.error('[Sky] screen-menu 요소가 없습니다.');
        return;
      }
      setCanvasInteractive(false);
      _scenes.show('menu');
    };

    ensureLoginManager(goMenu);

    const startOnlineMatch = async (queueMode) => {
      matchModal?.classList.remove('hidden');
      matchModal?.setAttribute('aria-hidden', 'false');
      if (matchStatus) matchStatus.textContent = '서버 연결 중…';
      try {
        const info = await net.startMatchmaking({
          fighterId: GameState.equippedFighterId,
          queueMode,
          callsign: Auth.getCallsign() || 'pilot',
          onStatus: ({ text }) => {
            if (matchStatus && text) matchStatus.textContent = text;
          },
        });
        matchModal?.classList.add('hidden');
        matchModal?.setAttribute('aria-hidden', 'true');
        setCanvasInteractive(true);
        _scenes.show('battle', {
          mode: 'online',
          gameRules: queueMode === 'team' ? 'team' : 'ffa',
          slot: info.slot,
          roomId: info.roomId,
          opponentFighterId: info.opponentFighterId,
          net,
        });
      } catch (err) {
        matchModal?.classList.add('hidden');
        matchModal?.setAttribute('aria-hidden', 'true');
        if (err?.message !== '매칭 취소') {
          const hint = location.protocol === 'file:'
            ? '\n\nstart-game.bat 을 실행한 뒤 http://127.0.0.1:8787/ 로 접속하거나, 서버 실행 상태에서 이 창에서 온라인을 시도하세요.'
            : '\n\nstart-game.bat 또는 npm start 로 서버를 실행했는지 확인하세요.';
          alert((err?.message || '온라인 매칭에 실패했습니다.') + hint);
        }
      }
    };

    const menu = new Sky.MenuManager({
      root: screenMenu,
      onBattleMenu: () => {
        setCanvasInteractive(false);
        _scenes.show('battle-menu');
      },
      onShop: () => {
        setCanvasInteractive(false);
        _scenes.show('shop');
      },
      onAchievements: () => {
        if (!screenAchievements) return;
        setCanvasInteractive(false);
        _scenes.show('achievements');
        const paint = Sky.paintAchievementsScreen;
        if (typeof paint === 'function') {
          paint(screenAchievements);
          setTimeout(function () { paint(screenAchievements); }, 0);
          setTimeout(function () { paint(screenAchievements); }, 120);
        }
      },
      onLogoutConfirmed: () => {
        net.disconnect();
        Auth.logout();
        GameState.bindAccount(null);
        setCanvasInteractive(false);
        _scenes.show('login');
      },
      onAccountDeleted: () => {
        net.disconnect();
        const accountId = Auth.deleteCurrentAccount();
        if (accountId) GameState.deleteAccountSave(accountId);
        else GameState.bindAccount(null);
        setCanvasInteractive(false);
        _scenes.show('login');
      },
    });

    const battleMenu = new Sky.BattleMenuManager({
      root: screenBattleMenu,
      onBack: goMenu,
      onSoloFfa: () => {
        setCanvasInteractive(true);
        _scenes.show('battle', { mode: 'solo', gameRules: 'ffa' });
      },
      onSoloTeam: () => {
        setCanvasInteractive(true);
        _scenes.show('battle', { mode: 'solo', gameRules: 'team' });
      },
      onOnlineFfa: () => startOnlineMatch('ffa'),
      onOnlineTeam: () => startOnlineMatch('team'),
    });

    matchModal?.querySelector('[data-action="cancel-match"]')?.addEventListener('click', () => {
      net.cancelMatchmaking();
      matchModal.classList.add('hidden');
      matchModal.setAttribute('aria-hidden', 'true');
    });

    const shop = new Sky.ShopManager({
      root: screenShop,
      onBack: goMenu,
    });

    let achievements = null;
    if (screenAchievements) {
      try {
        if (Sky.AchievementManager) {
          achievements = new Sky.AchievementManager({
            root: screenAchievements,
            onBack: goMenu,
          });
        }
      } catch (err) {
        console.error('[Sky] AchievementManager init failed:', err);
      }
      if (!achievements) {
        screenAchievements.querySelector('[data-action="ach-back"]')
          ?.addEventListener('click', goMenu);
        console.warn('[Sky] AchievementManager unavailable — achievements screen limited.');
      }
    }

    let battle = null;
    try {
      battle = new Sky.BattleManager({
        canvas,
        hudRoot: screenBattle,
        onExit: () => {
          net.leaveBattle();
          setCanvasInteractive(false);
          _scenes.show('battle-menu');
        },
      });
    } catch (err) {
      console.error('[Sky] BattleManager 초기화 실패(전투 제외하고 진행):', err);
    }

    _scenes.register('menu', { element: screenMenu, manager: menu });
    _menuReady = true;
    _scenes.register('battle-menu', { element: screenBattleMenu, manager: battleMenu });
    _scenes.register('shop', { element: screenShop, manager: shop });
    if (screenAchievements) {
      _scenes.register('achievements', { element: screenAchievements, manager: achievements });
    }
    if (screenBattle && battle) {
      _scenes.register('battle', { element: screenBattle, manager: battle });
    }

    if (Auth.isLoggedIn()) {
      GameState.bindAccount(Auth.getAccountId());
      goMenu();
    } else {
      setCanvasInteractive(false);
      _scenes.show('login');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(window.Sky = window.Sky || {});
