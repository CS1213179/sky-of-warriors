/* <!--
  BattleManager
  - Three.js 기반의 3D 전투 씬을 구성합니다.
  - 책임 범위:
    * 씬/카메라/렌더러 생애주기 (enter/exit)
    * 플레이어 비행 물리 (피치/롤/요/부스트)
    * 3인칭 추적 카메라(스프링 댐핑)
    * 기관총 발사 (탄착군 스프레드)
    * 미사일 락온 & 호밍 유도
    * 적 AI(스폰/추격/사격)
    * 오브젝트 풀링 (탄환/미사일/폭발)
    * HUD 업데이트 & 결과 처리

  파일 구조: file:// 환경 호환을 위해 IIFE + Sky 네임스페이스 패턴 사용.
            THREE 는 글로벌(UMD) 로 로드되어 있다고 가정합니다.
--> */
(function (Sky, THREE) {
  'use strict';

const InputManager = Sky.InputManager;
const ObjectPool = Sky.ObjectPool;
const GameState = Sky.GameState;
const { findFighter, computeFinalStats, computeTurnRates, findFighterByMeshType } = Sky.fighters;
const {
  buildAircraftMesh: _buildAircraftMeshExport,
  buildEmergencyAircraftMesh,
  ENEMY_MESH_TYPES,
  applySwingWingFold,
} = Sky.Aircraft ?? {};
const buildAircraftMesh = (fighter) => {
  const fn = _buildAircraftMeshExport ?? Sky.Aircraft?.buildAircraftMesh;
  if (typeof fn !== 'function') {
    throw new Error('buildAircraftMesh is not available — Aircraft.js load failed');
  }
  return fn(fighter);
};
const SWING_WING_MESH_TYPES = Sky.Aircraft?.SWING_WING_MESH_TYPES ?? new Set(['f14', 'tornado']);
const STEALTH_MESH_TYPES = Sky.fighters?.STEALTH_MESH_TYPES ?? new Set(['f22', 'su57', 'j20']);
const STEALTH_RADAR_GHOST_CHANCE = 0.8;
const STEALTH_RADAR_OUTER_NORM = 0.72;
const WING_FOLD_AGILITY_MUL = 0.85;
const WING_FOLD_SPEED_MUL = 1.25;
const WING_FOLD_ANIM_SPEED = 0.4;

const BATTLE_DURATION = 300; // 초 단위. 한 세션 5분.
const ENEMY_MAX = 14;
const WORLD_MAP_SCALE = 4;
const WORLD_RADIUS = 2600 * WORLD_MAP_SCALE;
const WORLD_FEATURE_MARGIN = 360 * WORLD_MAP_SCALE;
const WORLD_PLAY_RADIUS = WORLD_RADIUS - WORLD_FEATURE_MARGIN;
const GROUND_SIZE = WORLD_RADIUS * 2 + 800 * WORLD_MAP_SCALE;
const ENEMY_SPAWN_RADIUS = 420 * WORLD_MAP_SCALE;
/* <!-- 전투 고도(월드 Y). GROUND_Y(-120) 기준 AGL 약 300m — 산봉우리 위에서 교전합니다. --> */
const BATTLE_SPAWN_Y = 180;
const ENEMY_SPAWN_MIN_Y = 150;
const ENEMY_SPAWN_Y_SPREAD = 40;
const BOUNDARY_HEIGHT = 720;
const BOUNDARY_THICKNESS = 8;
const BOUNDARY_KILL_MARGIN = 14;

/* <!-- 전투 보상: data/fighters.js 와 분리해 BattleManager 에서만 정의합니다. --> */
const REWARD_PER_KILL = 1500;
const REWARD_PER_SURVIVAL_SECOND = 10;

/* <!-- 고도: 지면 y=-120 기준 AGL(지상고도). 1인칭 콕핏 고도 경고에 사용합니다. --> */
const GROUND_Y = -120;
const GROUND_SCRAPE_AGL = 8;
const GROUND_FATAL_AGL = 2;
/* <!-- 평지 메쉬: 넓은 평원 + 불규칙한 구릉·능선·함몰. 도시·기지 주변만 평탄 패드. --> */
const GROUND_PLAIN_SEG = 256;
const GROUND_PLAIN_SEG_QUICK = 48;
const GROUND_TEXTURE_RES = 512;
const MAP_LOADING_MIN_MS = 5000;
const MAP_LOADING_MAX_MS = 18000;
const WORLD_ASSET_CACHE_MAX = 4;
const GROUND_PLAIN_MAX_FLAT = 52;
const GROUND_PLAIN_MAX_ROLL = 340;
const GROUND_PLAIN_MICRO_AMP = 46;
const SETTLEMENT_CITY_FLAT_RADIUS = 396;
const SETTLEMENT_BASE_FLAT_RADIUS = 210;
const CITY_SPEED_FACTOR = 0.68;
const CITY_SIZE_SCALE = Math.SQRT2;
const BASE_RELOAD_RADIUS_MUL = 5;
const BASE_RELOAD_DWELL_SEC = 4;
const BASE_RELOAD_HP_STEP = 10;
const BASE_RELOAD_MG_STEP = 10;
const WORLD_MOUNTAIN_COUNT = 10;
const WORLD_HILL_COUNT = 38;

/* <!-- 지형 팔레트: 위성 영상 기반 초록 식생 톤 --> */
const TERRAIN_COLORS = {
  fill: 0x7a9458,
  minor: 0x5a7848,
  major: 0x3d5230,
  mega: 0x2a3824,
  snow: 0xd0dcc4,
  asphalt: 0x6d7560,
  concrete: 0x8a9680,
  building: 0x7a8572,
  buildingDark: 0x5c6654,
  runway: 0x525a48,
  hangar: 0x636b58,
  fence: 0x58604a,
  roof: 0x6a7562,
};

const ALT_WARN_AGL = 100;
const ALT_DANGER_AGL = 70;
const ALT_CRITICAL_AGL = 45;

/* <!-- 수호이 Flanker 계열만 코브라 기동 가능. agility 는 일반 선회율에만 반영합니다. --> */
const COBRA_FIGHTER_IDS = new Set(['su27', 'su30', 'su32', 'su35']);
const COBRA_COOLDOWN_SEC = 8.5;
/* <!-- 코브라: 수평 궤도 유지 + 기수만 급격히 상승. 진입 약 M0.32(360km/h). --> */
const COBRA_MIN_SPEED = 110;
const COBRA_PITCH_UP_RAD = 1.35;
const COBRA_MAX_START_DIVE = 0.28;
const COBRA_PITCH_RATE = 3.4;
const COBRA_RECOVER_RATE = 1.25;
const COBRA_HOLD_SEC = 0.42;
const COBRA_SPEED_BLEED = 72;
const COBRA_STALL_SPEED = 95;
/* <!-- 코브라 중 적 미사일: 관성 오vershoot 회피 20%, 명중 80%. 반경 내 1회 판정. --> */
const COBRA_MISSILE_EVADE_CHANCE = 0.2;
const COBRA_MISSILE_CHECK_RADIUS = 58;

const ANG_VEL_DAMP = 5.0;
const FBW_AUTO_BANK_DEG = 45;
const FBW_BANK_TRACK = 3.8;
const FBW_LEVEL_TRACK = 2.4;
const FBW_RUDDER_YAW = 1.0;
const CONTACT_EPSILON = 0.25;
const RADAR_RANGE = 500;
const MISSILE_WARN_PROXIMITY = 50;
const MISSILE_SPEED = 580;
const MISSILE_TURN_RATE = 3.8;
/* <!-- 발사 시 락온된 기체를 이 시간(초) 동안 강제 추적합니다. 플레어 유도도 무시합니다. --> */
const MISSILE_HARD_LOCK_DURATION = 20;
const MISSILE_MAX_LIFE = 24;
const MISSILE_HARD_TURN_RATE = 7.8;
const PLAYER_MISSILE_MAX_HITS = 2;
const PLAYER_MG_MAX_HITS = 5;
const ENEMY_MG_MAX_HITS = 5;
const MG_AMMO_RU = 150;
const MG_AMMO_DEFAULT = 300;
const MG_DAMAGE_MUL_RU = 1.5;
/* <!-- 이 거리 미만: 적은 미사일 대신 기관총 도그파이트(근접전). --> */
const DOGFIGHT_RANGE = 220;
const DOGFIGHT_MISSILE_MIN_RANGE = 200;
const DOGFIGHT_STEER_MUL = 1.5;
const DOGFIGHT_ENEMY_STEER_MUL = 1.08;
/* <!-- 도그파이트 시 적 속도 상한: 플레이어 대비 과속 추격 방지 --> */
const DOGFIGHT_ENEMY_SPEED_CAP = 0.86;
const DOGFIGHT_ENEMY_SPEED_FLOOR = 0.62;
const DOGFIGHT_ALIGN_THRESHOLD = 0.86;
/* <!-- 기관총: 화면 조준 원 안에 적이 있으면 피격(물리 탄환 충돌 대신). --> */
const MG_AIM_RADIUS_PX = 34;
const MG_AIM_RADIUS_PURSUIT_PX = 38;
const MG_RETICLE_MAX_RANGE = DOGFIGHT_RANGE * 2.2;
const MG_AIM_DEPTH_NDC_MAX = 1.08;
const ENEMY_FLARE_THREAT_RANGE = 150;
const ENEMY_FLARE_LURE_CHANCE = 0.42;
/* <!-- 추격(F): 적에게 락온(LOCK) 2초 유지 시 활성화. 완전 고정 추적이 아닌 기체 능력 기반 추적. --> */
const PURSUIT_LOCK_HOLD_SEC = 2;
const PURSUIT_RANGE = DOGFIGHT_RANGE;
const PURSUIT_FOLLOW_DIST = 48;
const PURSUIT_TRACK_MUL = 1.05;
const PURSUIT_TRACK_CORRECT_MUL = 0.42;
const PURSUIT_MAX_RANGE = PURSUIT_RANGE * 1.45;
const PURSUIT_CAM_BACK = 36;
const PURSUIT_CAM_UP = 9;
const PURSUIT_CAM_LOOK_AHEAD = 24;
const PURSUIT_CAM_LERP = 7.5;
/* <!-- 3인칭: 기체 뒤·위 오프셋(조준점은 메시 중심) --> */
const THIRD_CAM_OFFSET = Object.freeze({ x: 0, y: 2.8, z: -11.5 });
const PURSUIT_MIN_DURATION_SEC = 5;
const PURSUIT_AIM_SPEED = 420;
const PURSUIT_AIM_MAX = 168;
const COMBAT_FLOOR_Y = BATTLE_SPAWN_Y - 52;
const MAP_GROUND_PHOTO_BLEND = 0.78;
/* <!-- W/S 스로틀: 0~1 사이를 조절해 순항 속도를 minSpeed~maxSpeed 사이에서 선택합니다. --> */
const THROTTLE_ADJUST_RATE = 0.5;
const MIN_SPEED_RATIO = 0.35;
/* <!-- 플레어 1개당 미사일 유도 성공 확률(0~1). 반경 내 최초 접근 시 1회만 판정합니다. --> */
const FLARE_LURE_CHANCE = 0.4;
const FLARE_LURE_RADIUS = 40;
const NET_SEND_INTERVAL = 0.05;
const ONLINE_ENEMY_MAX = 10;
const ALLY_MAX = 3;
/* <!--
  게임 속도 = m/s (월드 1단위 ≈ 1m). 해수면 음속 340m/s ≈ 1224km/h 기준으로 마하를 표시합니다.
  기체 stats.speed → 순항 M0.72~0.95, 애프터버너 M1.55~2.35 선형 매핑.
--> */
const SEA_LEVEL_SOUND_MS = 340;
const SEA_LEVEL_SOUND_KMH = 1224;
const SPEED_STAT_MIN = 100;
const SPEED_STAT_MAX = 220;
const CRUISE_MACH_MIN = 0.58;
const CRUISE_MACH_MAX = 0.78;
const BOOST_MACH_MIN = 1.22;
const BOOST_MACH_MAX = 1.72;

/* <!-- 4개 전투 맵: 중동·동남아·평원·산맥. 출격 시 랜덤, mapIndex 0~3 으로 지정 가능. --> */
const WORLD_MAP_PRESETS = [
  {
    id: 'middle_east',
    name: '중동',
    loadingImage: 'assets/maps/middle_east.svg',
    loadingPhoto: 'assets/maps/middle_east.jpg',
    layoutSeed: 2100,
    mountainCount: 8,
    hillCount: 9,
    cityCount: 2,
    baseCount: 7,
    cloudCount: 42,
    plainRoughMul: 0.48,
    peakHeightMul: 1.05,
    peakRadiusMul: 0.95,
    settleMaxRough: 0.46,
    fogColor: 0xc8b890,
    hemiGround: 0x907858,
    skyBottom: 0xe8dcc0,
    terrainColors: {
      fill: 0xc4a878, minor: 0xa08858, major: 0x786840, mega: 0x504028, snow: 0xe8dcc8,
    },
    canyons: [
      { seed: 501, corridorWidth: 215, samples: 32, startAng: -2.2, endAng: -0.4, pathDist: 0.55 },
      { seed: 907, corridorWidth: 205, samples: 30, startAng: 1.2, endAng: 2.5, pathDist: 0.5 },
    ],
    /* <!-- 메사·암주·오아시스·유적: 사막/반사막 지형지물 --> */
    mapFeatures: [
      { type: 'mesa', count: 7 },
      { type: 'rockSpire', count: 12 },
      { type: 'oasis', count: 6 },
      { type: 'ruin', count: 5 },
    ],
  },
  {
    id: 'southeast_asia',
    name: '동남아',
    loadingImage: 'assets/maps/southeast_asia.svg',
    loadingPhoto: 'assets/maps/southeast_asia.jpg',
    layoutSeed: 3200,
    mountainCount: 11,
    hillCount: 62,
    cityCount: 4,
    baseCount: 3,
    cloudCount: 72,
    plainRoughMul: 0.88,
    peakHeightMul: 0.95,
    peakRadiusMul: 1.05,
    settleMaxRough: 0.38,
    fogColor: 0x78a868,
    hemiGround: 0x286030,
    skyBottom: 0xc8e8c0,
    terrainColors: {
      fill: 0x4a8840, minor: 0x306830, major: 0x204818, mega: 0x142810, snow: 0xd0e0c8,
    },
    canyons: [
      { seed: 612, corridorWidth: 218, samples: 28, startAng: -0.5, endAng: 1.7, pathDist: 0.52 },
    ],
    mapFeatures: [
      { type: 'jungleCluster', count: 32 },
      { type: 'palmGrove', count: 20 },
      { type: 'riverShallow', count: 5 },
      { type: 'villageHut', count: 8 },
    ],
  },
  {
    id: 'plains',
    name: '평원',
    loadingImage: 'assets/maps/plains.svg',
    loadingPhoto: 'assets/maps/plains.jpg',
    layoutSeed: 1001,
    mountainCount: 3,
    hillCount: 24,
    cityCount: 5,
    baseCount: 4,
    cloudCount: 48,
    plainRoughMul: 0.72,
    peakHeightMul: 0.85,
    peakRadiusMul: 0.9,
    settleMaxRough: 0.34,
    fogColor: 0x90a878,
    hemiGround: 0x4a7040,
    skyBottom: 0xd6ecfa,
    terrainColors: {
      fill: 0x7a9458, minor: 0x5a7848, major: 0x3d5230, mega: 0x2a3824, snow: 0xd0dcc4,
    },
    canyons: [
      { seed: 415, corridorWidth: 225, samples: 26, startAng: -1.6, endAng: 0.8, pathDist: 0.48 },
    ],
    mapFeatures: [
      { type: 'farmCluster', count: 16 },
      { type: 'windmill', count: 10 },
      { type: 'barnSilo', count: 8 },
      { type: 'cropField', count: 12 },
    ],
  },
  {
    id: 'mountains',
    name: '산맥',
    loadingImage: 'assets/maps/mountains.svg',
    loadingPhoto: 'assets/maps/mountains.jpg',
    layoutSeed: 4300,
    mountainCount: 22,
    hillCount: 12,
    cityCount: 2,
    baseCount: 9,
    cloudCount: 38,
    plainRoughMul: 1.12,
    peakHeightMul: 1.4,
    peakRadiusMul: 1.15,
    settleMaxRough: 0.3,
    fogColor: 0x889898,
    hemiGround: 0x3a4840,
    skyBottom: 0xc8d4e0,
    terrainColors: {
      fill: 0x687858, minor: 0x506048, major: 0x384830, mega: 0x283020, snow: 0xe8eef0,
    },
    canyons: [
      { seed: 703, corridorWidth: 198, samples: 36, startAng: -2.6, endAng: -0.1, pathDist: 0.6 },
      { seed: 904, corridorWidth: 192, samples: 34, startAng: 0.5, endAng: 2.8, pathDist: 0.52 },
      { seed: 1105, corridorWidth: 185, samples: 28, startAng: -1.2, endAng: 1.0, pathDist: 0.56 },
    ],
    mapFeatures: [
      { type: 'cliffSpire', count: 18 },
      { type: 'snowPatch', count: 11 },
      { type: 'watchTower', count: 6 },
      { type: 'ridgeLine', count: 4 },
    ],
  },
];

class BattleManager {
  constructor({ canvas, hudRoot, onExit }) {
    this._canvas = canvas;
    this._hud = hudRoot;
    this._onExit = onExit;
    this._input = new InputManager();
    this._worldUp = new THREE.Vector3(0, 1, 0);
    this._bankEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._running = false;
    this._raf = 0;
    this._mgHitDealtTimer = 0;
    this._mgHitTakenTimer = 0;

    this._unsubModelReady = Sky.AircraftModelLoader?.whenReady?.(() => {
      this._upgradePlayerMeshIfNeeded();
    });

    this._hudEls = {
      hp: hudRoot.querySelector('#hud-hp'),
      hpP2: hudRoot.querySelector('#hud-hp-p2'),
      p2Block: hudRoot.querySelector('#hud-p2-block'),
      boost: hudRoot.querySelector('#hud-boost'),
      score: hudRoot.querySelector('#hud-score'),
      kills: hudRoot.querySelector('#hud-kills'),
      time: hudRoot.querySelector('#hud-time'),
      mg: hudRoot.querySelector('#hud-mg'),
      missiles: hudRoot.querySelector('#hud-missiles'),
      baseReloadWrap: hudRoot.querySelector('#base-reload-wrap'),
      baseReloadFill: hudRoot.querySelector('#base-reload-fill'),
      flares: hudRoot.querySelector('#hud-flares'),
      speed: hudRoot.querySelector('#hud-speed'),
      mapName: hudRoot.querySelector('#hud-map-name'),
      gameMode: hudRoot.querySelector('#hud-game-mode'),
      lock: hudRoot.querySelector('#lockon-indicator'),
      lockFp: hudRoot.querySelector('#lockon-indicator-fp'),
      cockpitOverlay: hudRoot.querySelector('#cockpit-overlay'),
      altitudeWarning: hudRoot.querySelector('#altitude-warning'),
      cockpitAlt: hudRoot.querySelector('#cockpit-alt'),
      cockpitSpd: hudRoot.querySelector('#cockpit-spd'),
      cockpitMach: hudRoot.querySelector('#cockpit-mach'),
      cockpitHdg: hudRoot.querySelector('#cockpit-hdg'),
      cockpitHull: hudRoot.querySelector('#cockpit-hull-pct'),
      cockpitBoost: hudRoot.querySelector('#cockpit-boost-pct'),
      cockpitMsl: hudRoot.querySelector('#cockpit-msl'),
      cockpitFlr: hudRoot.querySelector('#cockpit-flr'),
      pitchLadder: hudRoot.querySelector('#hud-pitch-ladder'),
      rollIndicator: hudRoot.querySelector('#hud-roll-indicator'),
      missileWarning: hudRoot.querySelector('#missile-warning'),
      missileWarningCount: hudRoot.querySelector('#missile-warning-count'),
      missileVignette: hudRoot.querySelector('#missile-vignette'),
      incomingLockWarning: hudRoot.querySelector('#incoming-lock-warning'),
      cobra: hudRoot.querySelector('#hud-cobra'),
      cobraHint: hudRoot.querySelector('#hud-cobra-hint'),
      pursuitPrompt: hudRoot.querySelector('#pursuit-prompt'),
      pursuitHud: hudRoot.querySelector('#hud-pursuit'),
      pursuitHint: hudRoot.querySelector('#hud-pursuit-hint'),
      pursuitScope: hudRoot.querySelector('#pursuit-scope'),
      wingFold: hudRoot.querySelector('#hud-wing-fold'),
      wingFoldHint: hudRoot.querySelector('#hud-wing-fold-hint'),
      mgHitMarkerWrap: hudRoot.querySelector('#mg-hit-marker-wrap'),
      mgHitMarker: hudRoot.querySelector('#mg-hit-marker'),
      mgHitReceived: hudRoot.querySelector('#mg-hit-received'),
      modal: hudRoot.querySelector('#battle-result'),
      modalTitle: hudRoot.querySelector('#result-title'),
      modalKills: hudRoot.querySelector('#result-kills'),
      modalScore: hudRoot.querySelector('#result-score'),
      modalReward: hudRoot.querySelector('#result-reward'),
      modalBestKills: hudRoot.querySelector('#result-best-kills'),
      modalKmRow: hudRoot.querySelector('#result-km-row'),
      modalKmEarned: hudRoot.querySelector('#result-km-earned'),
      modalAchWrap: hudRoot.querySelector('#result-ach-wrap'),
      modalAchList: hudRoot.querySelector('#result-ach-list'),
    };

    this._mapLoadingEls = {
      root: document.getElementById('map-loading-overlay'),
      img: document.getElementById('map-loading-img'),
      title: document.getElementById('map-loading-title'),
      desc: document.getElementById('map-loading-desc'),
      fill: document.getElementById('map-loading-fill'),
      bar: document.querySelector('#map-loading-overlay .map-loading-bar'),
    };

    hudRoot.querySelector('[data-action="replay"]').addEventListener('click', () => {
      this._hudEls.modal.classList.add('hidden');
      this._restart();
    });
    hudRoot.querySelector('[data-action="to-menu"]').addEventListener('click', () => {
      this._hudEls.modal.classList.add('hidden');
      onExit?.();
    });
    this._hudEls.pursuitPrompt?.addEventListener('click', () => this._tryTogglePursuit());
    this._hudEls.wingFold?.addEventListener('click', () => this._tryToggleWingFold());

    this._handleResize = () => this._onResize();
    window.addEventListener('resize', this._handleResize);

    /* 레이더: 3인칭=좌상단, 1인칭=하부 MFD 중앙 슬롯으로 DOM 이동 */
    this._radarWrap = hudRoot.querySelector('.radar-wrap');
    this._fpRadarSlot = hudRoot.querySelector('#fp-radar-slot');
    this._fpPanelLabels = hudRoot.querySelector('.fp-panel-labels');
    this._worldLayout = null;
    this._settlementSites = null;
    this._mapPreset = null;
    this._mapPhotoImage = null;
    this._viewBeforePursuit = 'third';
    this._wingFoldT = 0;
    this._wingFoldTarget = 0;
    this._gWasDown = false;
    this._loadGen = 0;
    this._loadWatchdogTimer = null;
    this._loadStepTimer = null;
    this._loadEnterTimer = null;
  }

  /* ====================== 라이프사이클 ====================== */
  enter(payload = {}) {
    try {
      if (!window.THREE) {
        throw new Error('Three.js가 로드되지 않았습니다. 인터넷 연결 후 Ctrl+F5로 새로고침하세요.');
      }
      this._cancelBattleLoadTimers();
      this._loadGen += 1;
      const loadGen = this._loadGen;
      this._running = false;
      cancelAnimationFrame(this._raf);
      /* <!-- 이전 출격 씬이 남아 있으면 풀·메시가 꼬여 플레이어 소환이 실패할 수 있습니다. --> */
      if (this._scene) {
        this._teardown();
        this._canvas.style.display = 'block';
        this._canvas.style.visibility = 'visible';
      }
      this._player = null;
      this._players = null;
      this._session = null;
      this._enemies = null;
      this._allies = null;

      this._battleMode = payload.mode === 'online' ? 'online' : 'solo';
      this._gameRules = payload.gameRules === 'team' ? 'team' : 'ffa';
      this._net = payload.net || null;
      this._onlineInfo = this._isOnlinePvP() ? payload : null;
      this._netSendAcc = 0;
      this._selectMapPreset(payload);
      this._canvas.style.display = 'block';
      this._canvas.style.visibility = 'visible';
      this._hud?.classList.remove('battle-ended');
      this._ensureRenderer();
      this._showMapLoading(0);
      this._preloadMapPhoto();
      const loadStart = performance.now();
      this._input.setEnabled(false);

      this._loadWatchdogTimer = setTimeout(() => {
        if (loadGen !== this._loadGen) return;
        console.warn('[BattleManager] map load watchdog — forcing battle enter');
        this._setMapLoadingProgress(100, false);
        this._finishBattleEnter(loadGen);
      }, MAP_LOADING_MAX_MS);

      /* <!-- 로딩 UI를 먼저 그린 뒤 무거운 지형 생성을 시작합니다. --> */
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (loadGen !== this._loadGen) return;
          this._runBattleLoadSteps(loadStart, loadGen);
        });
      });
    } catch (err) {
      console.error('[BattleManager] enter failed:', err);
      this._hideMapLoading();
      alert(err?.message || '전투 진입에 실패했습니다.');
    }
  }

  _cancelBattleLoadTimers() {
    if (this._loadWatchdogTimer) {
      clearTimeout(this._loadWatchdogTimer);
      this._loadWatchdogTimer = null;
    }
    if (this._loadStepTimer) {
      clearTimeout(this._loadStepTimer);
      this._loadStepTimer = null;
    }
    if (this._loadEnterTimer) {
      clearTimeout(this._loadEnterTimer);
      this._loadEnterTimer = null;
    }
  }

  _preloadMapPhoto() {
    const preset = this._mapPreset;
    const src = preset?.loadingImage || preset?.loadingPhoto;
    this._mapPhotoImage = null;
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0) this._mapPhotoImage = img;
    };
    img.onerror = () => { this._mapPhotoImage = null; };
    img.src = src;
  }

  _runBattleLoadSteps(loadStart, loadGen) {
    /* <!-- 로딩 화면 표시 중에 지형·도시·고해상도 지면까지 모두 bake합니다. --> */
    const setLoadDesc = (text) => {
      const desc = this._mapLoadingEls?.desc;
      if (desc && text) desc.textContent = text;
    };

    const loadSteps = [
      () => {
        this._setupSceneCore();
        this._setMapLoadingProgress(12);
        setLoadDesc('하늘·조명 구성…');
      },
      () => {
        this._setupSceneGround();
        this._setMapLoadingProgress(32);
        setLoadDesc('지형 메시 생성…');
      },
      () => {
        if (!this._terrain) {
          this._terrain = this._createTerrain();
          this._scene.add(this._terrain);
        }
        this._setMapLoadingProgress(62);
        setLoadDesc('산악·협곡 배치…');
      },
      () => {
        if (!this._settlements) this._setupSceneWorldProps();
        this._setMapLoadingProgress(88);
        setLoadDesc('도시·구름·경계 설정…');
      },
    ];

    this._worldBuiltDuringLoad = false;

    let stepIdx = 0;
    const scheduleFinishAfterMinDisplay = () => {
      this._worldBuiltDuringLoad = true;
      const tick = () => {
        if (loadGen !== this._loadGen) return;
        const elapsed = performance.now() - loadStart;
        const pct = Math.min(100, 88 + (elapsed / MAP_LOADING_MIN_MS) * 12);
        this._setMapLoadingProgress(pct);
        if (elapsed < MAP_LOADING_MIN_MS) {
          setLoadDesc('작전 구역 최종 점검…');
          this._loadEnterTimer = setTimeout(tick, 50);
          return;
        }
        this._loadEnterTimer = null;
        this._setMapLoadingProgress(100, false);
        this._finishBattleEnter(loadGen);
      };
      this._loadEnterTimer = setTimeout(tick, 50);
    };

    const runLoadStep = () => {
      this._loadStepTimer = null;
      if (loadGen !== this._loadGen) return;
      try {
        if (stepIdx >= loadSteps.length) {
          scheduleFinishAfterMinDisplay();
          return;
        }
        try {
          loadSteps[stepIdx]();
        } catch (stepErr) {
          console.warn('[BattleManager] map load step failed (continuing):', stepErr);
        }
        stepIdx += 1;
        const delay = stepIdx === 3 ? 16 : 0;
        this._loadStepTimer = setTimeout(runLoadStep, delay);
      } catch (err) {
        console.error('[BattleManager] map load scheduler failed:', err);
        this._setMapLoadingProgress(100, false);
        this._loadEnterTimer = setTimeout(() => this._finishBattleEnter(loadGen), 120);
      }
    };
    this._loadStepTimer = setTimeout(runLoadStep, 0);
  }

  _finishBattleEnter(loadGen = this._loadGen) {
    if (loadGen !== this._loadGen) return;
    this._cancelBattleLoadTimers();
    if (!this._scene) {
      console.warn('[BattleManager] scene missing — emergency setup');
      try {
        this._setupSceneCore();
        this._setupSceneGroundQuick();
      } catch (err) {
        console.error('[BattleManager] battle enter aborted — scene setup failed:', err);
        this._hideMapLoading();
        return;
      }
    }

    try {
      this._bootstrapBattlePlay();
    } catch (err) {
      console.error('[BattleManager] battle bootstrap failed:', err);
    }
    if (!this._ensureLocalPlayer()) {
      console.error('[BattleManager] player spawn failed — minimal fallback');
      try { this._spawnMinimalPlayerSlot(); } catch (fallbackErr) {
        console.error('[BattleManager] minimal player spawn failed:', fallbackErr);
      }
    }
    this._repairBattleState();
    /* <!-- 플레이어·풀 준비가 끝난 뒤 타이머를 시작해 로딩 중 시간이 줄지 않게 합니다. --> */
    this._resetSession();
    this._initSwingWingState();

    if (!this._renderer || !this._camera || !this._scene) {
      console.error('[BattleManager] battle enter aborted — renderer/scene/camera missing');
      this._hideMapLoading();
      return;
    }

    if (this._renderer && this._camera && this._scene) {
      try { this._renderer.render(this._scene, this._camera); } catch (err) {
        console.warn('[BattleManager] initial render failed:', err);
      }
    }
    this._updateHUD();
    this._hideMapLoading();
    this._input.setEnabled(true);
    this._canvas?.focus?.({ preventScroll: true });
    this._running = true;
    this._lastTime = performance.now();
    this._loop();
    this._schedulePostEnterWorldBuild(loadGen);
  }

  /* <!-- 전투 루프 시작 후 무거운 지형·도시·고해상도 지면을 비동기로 채웁니다. --> */
  _schedulePostEnterWorldBuild(loadGen = this._loadGen) {
    if (this._worldBuiltDuringLoad) return;
    const jobs = [
      () => {
        if (loadGen !== this._loadGen || !this._scene || this._terrain) return;
        this._terrain = this._createTerrain();
        this._scene.add(this._terrain);
      },
      () => {
        if (loadGen !== this._loadGen || !this._scene || this._settlements) return;
        this._setupSceneWorldProps();
      },
      () => {
        if (loadGen !== this._loadGen || !this._scene) return;
        this._scheduleGroundDetailUpgrade(loadGen);
      },
    ];
    let jobIdx = 0;
    const runJob = () => {
      if (loadGen !== this._loadGen || !this._scene) return;
      if (jobIdx >= jobs.length) return;
      try { jobs[jobIdx](); } catch (err) {
        console.warn('[BattleManager] post-enter world build failed:', err);
      }
      jobIdx += 1;
      /* <!-- _createTerrain 은 무거우므로 프레임 사이에 양보합니다. --> */
      const delay = jobIdx === 1 ? 80 : 0;
      setTimeout(runJob, delay);
    };
    setTimeout(runJob, 0);
  }

  _initBattleCamera() {
    const p = this._player;
    if (!p?.mesh || !this._camera) return;
    if (!this._thirdCamCenter) this._thirdCamCenter = new THREE.Vector3();
    this._cameraState = {
      offset: new THREE.Vector3(THIRD_CAM_OFFSET.x, THIRD_CAM_OFFSET.y, THIRD_CAM_OFFSET.z),
      target: new THREE.Vector3(),
      lookTarget: new THREE.Vector3(),
    };
    const center = this._getAircraftVisualCenter(p.mesh, this._thirdCamCenter);
    const initialOffset = this._cameraState.offset.clone().applyQuaternion(p.mesh.quaternion);
    this._camera.position.copy(center).add(initialOffset);
    this._camera.lookAt(center);
  }

  _bootstrapBattlePlay() {
    this._viewMode = this._isOnlinePvP() ? 'third' : (this._viewMode ?? 'third');
    this._vWasDown = false;
    this._cWasDown = false;
    this._fWasDown = false;
    this._gWasDown = false;

    const steps = [
      () => { if (!this._bulletPool) this._setupPools(); },
      () => { this._setupPlayers(); },
      () => { this._setupEnemies(); },
      () => { if (this._gameRules === 'team') this._setupAllies(); },
      () => { this._setupRadar(); },
      () => { this._setupCockpitHUD(); },
      () => { this._buildFirstPersonCockpitMesh(); },
      () => { this._syncViewModeUI(); },
      () => {
        if (this._isOnlinePvP()) {
          this._netUnsubs?.forEach((fn) => fn());
          this._bindNetworkHandlers();
        }
      },
    ];
    for (const step of steps) {
      try { step(); } catch (err) {
        console.warn('[BattleManager] bootstrap step failed:', err);
      }
    }
    this._ensureLocalPlayer();
    this._updateHUD();
  }

  /* <!-- 기체 메시 생성 실패 시에도 전투가 시작되도록 로컬 플레이어를 보장합니다. --> */
  _ensureLocalPlayer() {
    const existing = this._getLocalPlayer();
    if (existing?.mesh && this._scene) {
      this._player = existing;
      if (!this._cameraState) this._initBattleCamera();
      return true;
    }
    if (!this._scene) return false;

    if (this._isOnlinePvP()) {
      try {
        this._setupPlayers();
        this._player = this._getLocalPlayer();
        if (this._player?.mesh) {
          if (!this._cameraState) this._initBattleCamera();
          return true;
        }
      } catch (err) {
        console.error('[BattleManager] online player setup retry failed:', err);
      }
      return false;
    }

    const spawns = {
      p1: { pos: [0, BATTLE_SPAWN_Y, 0], rotY: Math.PI },
    };
    const fighterId = GameState.equippedFighterId || 'fighter_001';
    try {
      const slot = this._buildPlayerSlot(fighterId, {
        id: 'p1',
        controls: 'p1',
        label: 'P1',
        spawn: spawns.p1.pos,
        rotY: spawns.p1.rotY,
      });
      this._players = [slot];
      slot.mesh.visible = true;
      this._scene.add(slot.mesh);
      this._player = slot;
      this._initBattleCamera();
      console.warn('[BattleManager] local player recovered via emergency spawn');
      return true;
    } catch (err) {
      console.warn('[BattleManager] emergency player spawn failed:', err);
    }
    try {
      this._spawnMinimalPlayerSlot();
      return !!this._player?.mesh;
    } catch (err) {
      console.error('[BattleManager] minimal player spawn failed:', err);
      return false;
    }
  }

  /* <!-- Box·Cone 만 쓰는 최소 기체. buildAircraftMesh 전부 실패해도 전투를 시작합니다. --> */
  _spawnMinimalPlayerSlot() {
    if (!this._scene) throw new Error('scene missing');
    const fighter = findFighter('fighter_001');
    const final = computeFinalStats(fighter, GameState.getUpgrade(fighter.id));
    const turnRates = computeTurnRates(fighter, final);
    const speedLimits = this._computePlayerSpeedLimits(final.speed);
    const mesh = typeof buildEmergencyAircraftMesh === 'function'
      ? buildEmergencyAircraftMesh()
      : (() => {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(
          new THREE.BoxGeometry(0.8, 0.5, 4),
          new THREE.MeshLambertMaterial({ color: 0x8899aa }),
        ));
        return g;
      })();
    mesh.position.set(0, BATTLE_SPAWN_Y, 0);
    mesh.rotation.set(0, Math.PI, 0);
    mesh.visible = true;
    const slot = {
      id: 'p1',
      controls: 'p1',
      label: 'P1',
      isRemote: false,
      fighter,
      mesh,
      velocity: new THREE.Vector3(),
      speed: speedLimits.maxSpeed * 0.68,
      minSpeed: 0,
      maxSpeed: speedLimits.maxSpeed,
      boostSpeed: speedLimits.boostSpeed,
      cruiseMach: speedLimits.cruiseMach,
      boostMach: speedLimits.boostMach,
      throttle: 0.62,
      pitchRate: turnRates.pitchRate,
      rollRate: turnRates.rollRate,
      yawRate: turnRates.yawRate,
      angVel: { pitch: 0, roll: 0, yaw: 0 },
      cobra: null,
      cobraCooldown: 0,
      hp: 80 + final.armor * 1.0,
      maxHp: 80 + final.armor * 1.0,
      boost: 1,
      missiles: fighter.weapons.secondary,
      maxMissiles: fighter.weapons.secondary,
      flares: 12,
      maxFlares: 12,
      firepower: final.firepower,
      mgDamageMul: 1,
      mgAmmo: MG_AMMO_DEFAULT,
      maxMgAmmo: MG_AMMO_DEFAULT,
      mgCooldown: 0,
      missileCooldown: 0,
      flareCooldown: 0,
      lockTarget: null,
      lockProgress: 0,
      pursuitLockEnemy: null,
      pursuitLockTimer: 0,
      pursuitReady: false,
      pursuitActive: false,
      pursuitTarget: null,
      pursuitSpeedBreakTimer: 0,
      pursuitActiveTimer: 0,
      pursuitAimX: 0,
      pursuitAimY: 0,
      mgTick: 0,
      hullSamples: [new THREE.Vector3(0, -0.4, 0)],
      baseReloadState: new Map(),
      baseReloadGauge: 0,
    };
    this._applyKmBuffToSlot(slot, final, speedLimits);
    this._players = [slot];
    this._scene.add(mesh);
    this._player = slot;
    this._initBattleCamera();
  }

  /* <!--
    bootstrap 직후 플레이어·세션·씬 그래프가 어긋나면 조종·타이머·HUD 가 동시에 멈춘 것처럼 보입니다.
  --> */
  _repairBattleState() {
    if (!this._session) {
      this._session = { kills: 0, score: 0, time: BATTLE_DURATION, ended: false };
    }

    if (!this._player && this._players?.length) {
      this._player = this._getLocalPlayer();
    }
    if (this._player && (!this._players?.length || !this._players.includes(this._player))) {
      this._players = [this._player];
    }
    if (this._player?.mesh && this._scene && !this._player.mesh.parent) {
      this._scene.add(this._player.mesh);
    }
    if (this._player?.mesh) {
      this._player.mesh.visible = this._viewMode !== 'first' || !!this._player.pursuitActive;
    }
    if (!this._enemies) {
      try { this._setupEnemies(); } catch (err) {
        console.warn('[BattleManager] enemy setup repair failed:', err);
        this._enemies = new Set();
      }
    }
    this._upgradePlayerMeshIfNeeded();
    if (this._player?.mesh && !this._cameraState) this._initBattleCamera();
  }

  /* <!-- 긴급 T자 메시를 실제 기체 메시로 교체합니다. --> */
  _upgradePlayerMeshIfNeeded() {
    const p = this._player;
    if (!p?.fighter || !p.mesh || !this._scene) return;
    const emergency = p.mesh.name === 'Emergency Fighter'
      || (p.mesh.children?.length <= 4 && p.mesh.name !== p.fighter.modelName);
    const modelKey = p.fighter.assets?.modelKey;
    const awaitingGltf = modelKey
      && p.mesh.userData?.procedural === true
      && Sky.AircraftModelLoader?.isReady?.(modelKey);
    if (!emergency && !awaitingGltf) return;

    try {
      const pos = p.mesh.position.clone();
      const quat = p.mesh.quaternion.clone();
      const visible = p.mesh.visible;
      this._scene.remove(p.mesh);
      const upgraded = buildAircraftMesh(p.fighter);
      upgraded.position.copy(pos);
      upgraded.quaternion.copy(quat);
      upgraded.visible = visible;
      p.mesh = upgraded;
      try {
        p.hullSamples = this._buildAircraftHullSamples(upgraded);
      } catch (err) {
        p.hullSamples = [new THREE.Vector3(0, -0.4, 0)];
      }
      this._scene.add(upgraded);
      console.info('[BattleManager] player mesh upgraded:', p.fighter.modelName);
    } catch (err) {
      console.warn('[BattleManager] player mesh upgrade failed:', err);
    }
  }

  _getBattleTimeRemaining() {
    if (!this._session || this._session.ended) return 0;
    return Math.max(0, Number(this._session.time) || 0);
  }

  /* <!-- HUD·조종이 서로 다른 player 객체를 보면 탄약·체력만 멈춘 것처럼 보입니다. --> */
  _syncActivePlayerRef() {
    const local = this._getLocalPlayer();
    if (local) {
      this._player = local;
      return;
    }
    if (this._player?.mesh && (!this._players?.length || this._players.includes(this._player))) return;
    const fallback = this._players?.find((pl) => !pl.isRemote) ?? this._players?.[0];
    if (fallback) this._player = fallback;
  }

  _getControllablePlayers() {
    if (this._players?.length) return this._players;
    return this._player ? [this._player] : [];
  }

  _scheduleGroundDetailUpgrade(loadGen = this._loadGen) {
    /* <!-- 고해상도 지면 bake는 무겁고 실패 시 검은 지면이 되므로, 새 메시 확인 후 교체합니다. --> */
    setTimeout(() => {
      if (loadGen !== this._loadGen || !this._scene) return;
      requestAnimationFrame(() => {
        if (loadGen !== this._loadGen || !this._scene) return;
        const old = this._scene.getObjectByName('ground');
        try {
          const detailed = this._createGroundMesh();
          if (!detailed) return;
          this._scene.add(detailed);
          if (old && old !== detailed) {
            this._scene.remove(old);
            old.geometry?.dispose?.();
            if (old.material) {
              const mats = Array.isArray(old.material) ? old.material : [old.material];
              mats.forEach((m) => {
                if (m.map && !m.userData?.sharedMap) m.map.dispose?.();
                m.dispose?.();
              });
            }
          }
        } catch (err) {
          console.warn('[BattleManager] ground detail upgrade skipped:', err);
        }
      });
    }, 4000);
  }

  exit() {
    this._loadGen += 1;
    this._cancelBattleLoadTimers();
    this._running = false;
    cancelAnimationFrame(this._raf);
    this._input.setEnabled(false);
    this._netUnsubs?.forEach((fn) => fn());
    this._netUnsubs = null;
    if (this._isOnlinePvP()) this._net?.leaveBattle();
    this._teardown();
  }

  /* ====================== 렌더러/씬 ====================== */
  _ensureRenderer() {
    /* 렌더러는 BattleManager 인스턴스 수명 동안 단 한 번만 생성합니다.
       매번 dispose/forceContextLoss 하면 일부 브라우저에서 새 컨텍스트 획득에 실패할 수 있어
       enter/exit 사이에는 씬 그래프만 새로 구성합니다. */
    if (!window.THREE) {
      throw new Error('Three.js가 로드되지 않았습니다. 인터넷 연결 후 Ctrl+F5로 새로고침하세요.');
    }
    if (this._renderer) return;
    this._renderer = new THREE.WebGLRenderer({ canvas: this._canvas, antialias: true, powerPreference: 'high-performance' });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setSize(window.innerWidth, window.innerHeight, false);
    this._renderer.setClearColor(0xbcdcef, 1);
  }

  _setupScene() {
    this._setupSceneCore();
    this._setupSceneGround();
    this._setupSceneTerrain();
    this._setupSceneWorldProps();
  }

  _setupSceneCore() {
    this._terrainMaterials = null;
    this._terrainMaterialsKey = null;
    this._scene = new THREE.Scene();
    const preset = this._mapPreset || WORLD_MAP_PRESETS[2];
    const fogHex = preset.fogColor ?? 0x90a878;
    this._scene.fog = new THREE.Fog(fogHex, 900 * WORLD_MAP_SCALE, 4200 * WORLD_MAP_SCALE);

    this._camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.5, 8000 * WORLD_MAP_SCALE);

    const hemiGround = preset.hemiGround ?? 0x4a7040;
    const hemi = new THREE.HemisphereLight(0xc8e2f6, hemiGround, 0.72);
    this._scene.add(hemi);
    this._scene.add(new THREE.AmbientLight(0xffffff, 0.38));
    const sun = new THREE.DirectionalLight(0xfff4d8, 1.25);
    sun.position.set(220, 380, 120);
    this._scene.add(sun);

    const skyBottom = preset.skyBottom ?? 0xd6ecfa;
    const skyGeo = new THREE.SphereGeometry(4800 * WORLD_MAP_SCALE, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        topColor:    { value: new THREE.Color(0x4d96d8) },
        bottomColor: { value: new THREE.Color(skyBottom) },
        offset:      { value: 80 },
        exponent:    { value: 0.55 },
      },
      vertexShader: `varying vec3 vWorldPos; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vWorldPos = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `uniform vec3 topColor; uniform vec3 bottomColor; uniform float offset; uniform float exponent; varying vec3 vWorldPos; void main(){ float h = normalize(vWorldPos + vec3(0.0, offset, 0.0)).y; gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h,0.0), exponent), 0.0)), 1.0); }`,
    });
    this._scene.add(new THREE.Mesh(skyGeo, skyMat));
    this._initWorldLayout();
  }

  _setupSceneGround() {
    const ground = this._createGroundMesh();
    this._scene.add(ground);
  }

  _removeGroundMesh() {
    const old = this._scene?.getObjectByName('ground');
    if (!old) return;
    this._scene.remove(old);
    old.geometry?.dispose?.();
    if (old.material) {
      const mats = Array.isArray(old.material) ? old.material : [old.material];
      mats.forEach((m) => {
        if (m.map && !m.userData?.sharedMap) m.map.dispose?.();
        m.dispose?.();
      });
    }
  }

  /* <!-- 로딩 중: bake 없이 바로 보이는 경량 지면. 전투 시작 후 고해상도로 교체합니다. --> */
  _setupSceneGroundQuick() {
    this._removeGroundMesh();
    const tc = this._getActiveTerrainColors();
    const seg = GROUND_PLAIN_SEG_QUICK;
    const geo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, seg, seg);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i);
      const wz = -pos.getY(i);
      pos.setZ(i, this._plainHeightAt(wx, wz) * 0.55);
    }
    geo.computeVertexNormals();
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: tc.fill });
    const ground = new THREE.Mesh(geo, mat);
    ground.name = 'ground';
    ground.position.y = GROUND_Y;
    ground.receiveShadow = true;
    this._scene.add(ground);
  }

  _setupSceneTerrain() {
    this._terrain = this._createTerrain();
    this._scene.add(this._terrain);
  }

  _setupSceneWorldProps() {
    this._settlements = this._createSettlements();
    this._scene.add(this._settlements);

    this._mapFeatures = this._createMapFeatures();
    this._scene.add(this._mapFeatures);

    this._boundaries = this._createBoundaryWalls();
    this._scene.add(this._boundaries);

    this._clouds = new THREE.Group();
    const preset = this._mapPreset || WORLD_MAP_PRESETS[2];
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false });
    const cloudTotal = preset.cloudCount ?? 60;
    for (let i = 0; i < cloudTotal; i++) {
      const c = new THREE.Mesh(new THREE.SphereGeometry(20 + Math.random() * 40, 6, 4), cloudMat);
      c.position.set(
        (Math.random() - 0.5) * WORLD_PLAY_RADIUS * 1.65,
        120 + Math.random() * 200,
        (Math.random() - 0.5) * WORLD_PLAY_RADIUS * 1.65,
      );
      c.scale.set(1 + Math.random() * 1.8, 0.3 + Math.random() * 0.4, 1 + Math.random() * 1.8);
      this._clouds.add(c);
    }
    this._scene.add(this._clouds);
  }

  _getWorldAssetCacheKey() {
    const preset = this._mapPreset || WORLD_MAP_PRESETS[0];
    return `${preset.id}:${preset.layoutSeed ?? 0}`;
  }

  _rememberWorldAssetCache(key, entry) {
    if (!BattleManager._worldAssetCache) BattleManager._worldAssetCache = new Map();
    if (!BattleManager._worldAssetCacheOrder) BattleManager._worldAssetCacheOrder = [];
    if (BattleManager._worldAssetCache.has(key)) return;
    BattleManager._worldAssetCache.set(key, entry);
    BattleManager._worldAssetCacheOrder.push(key);
    while (BattleManager._worldAssetCacheOrder.length > WORLD_ASSET_CACHE_MAX) {
      const evictKey = BattleManager._worldAssetCacheOrder.shift();
      if (evictKey === key) continue;
      const evict = BattleManager._worldAssetCache.get(evictKey);
      evict?.groundGeometry?.dispose?.();
      evict?.groundTexture?.dispose?.();
      BattleManager._worldAssetCache.delete(evictKey);
    }
  }

  _getOrBuildWorldGroundAssets() {
    const key = this._getWorldAssetCacheKey();
    if (BattleManager._worldAssetCache?.has(key)) {
      return BattleManager._worldAssetCache.get(key);
    }
    const entry = {
      groundGeometry: this._buildPlainGroundGeometry(),
      groundTexture: this._bakeGroundSatelliteTexture(),
    };
    this._rememberWorldAssetCache(key, entry);
    return entry;
  }

  _getTerrainMaterials() {
    const key = this._mapPreset?.id ?? 'default';
    if (this._terrainMaterials && this._terrainMaterialsKey === key) return this._terrainMaterials;
    this._terrainMaterialsKey = key;
    this._terrainMaterials = this._createTerrainMaterials();
    return this._terrainMaterials;
  }

  /* <!--
    지면 메쉬: 세분화된 평원 + 극단적으로 울퉁불퉁한 구릉·능선·함몰.
    산·협곡·언덉·정착지 좌표는 _initWorldLayout() 에서 격자 안에 배치합니다.
  --> */
  _valueNoise2D(x, z, scale) {
    const fx = x * scale;
    const fz = z * scale;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const u = tx * tx * (3 - 2 * tx);
    const v = tz * tz * (3 - 2 * tz);
    const hash = (i, j) => this._terrainRand(i * 17.31 + j * 31.71);
    const a = hash(ix, iz);
    const b = hash(ix + 1, iz);
    const c = hash(ix, iz + 1);
    const d = hash(ix + 1, iz + 1);
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(a, b, u),
      THREE.MathUtils.lerp(c, d, u),
      v,
    );
  }

  _octaveNoise2D(x, z, scale, octaves = 4) {
    let sum = 0;
    let amp = 1;
    let freq = scale;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this._valueNoise2D(x, z, freq) * amp;
      norm += amp;
      amp *= 0.52;
      freq *= 2.05;
    }
    return sum / norm;
  }

  /* <!--
    평지 고도: 저주파 바이옴 + 고주파 리플·능선·요철·소규모 함몰.
    도시·군사기지 주변은 _getSettlementFlatFalloff 로 평탄 패드로 블렌딩합니다.
  --> */
  _clampWorldXZ(x, z, maxR = WORLD_PLAY_RADIUS) {
    const d = Math.hypot(x, z);
    if (d <= maxR || d < 1e-6) return [x, z];
    const s = maxR / d;
    return [x * s, z * s];
  }

  _isInsidePlayArea(x, z, padding = 0) {
    return Math.hypot(x, z) + padding <= WORLD_PLAY_RADIUS;
  }

  _plainRoughnessAt(x, z) {
    const biome = this._octaveNoise2D(x + 400, z - 280, 0.00032, 5);
    return THREE.MathUtils.smoothstep(0.22, 0.62, biome);
  }

  _getSettlementFlatFalloff(x, z) {
    const sites = this._settlementSites;
    if (!sites?.length) return 0;
    let maxFalloff = 0;
    for (const s of sites) {
      const d = Math.hypot(x - s.x, z - s.z);
      const inner = s.flatRadius * 0.58;
      const outer = s.flatRadius * 1.12;
      if (d >= outer) continue;
      const t = d <= inner ? 1 : 1 - (d - inner) / (outer - inner);
      const eased = t * t * (3 - 2 * t);
      maxFalloff = Math.max(maxFalloff, eased);
    }
    return maxFalloff;
  }

  /* <!-- 도시 평탄 구역: 속도를 CITY_SPEED_FACTOR 까지 완만히 제한합니다. --> */
  _getCitySpeedFactor(p) {
    const sites = this._settlementSites;
    if (!sites?.length || !p?.mesh) return 1;
    const pos = p.mesh.position;
    let factor = 1;
    for (const s of sites) {
      if (s.type !== 'city') continue;
      const d = Math.hypot(pos.x - s.x, pos.z - s.z);
      const outer = s.flatRadius * 1.08;
      if (d >= outer) continue;
      const inner = s.flatRadius * 0.55;
      const t = d <= inner ? 1 : 1 - (d - inner) / (outer - inner);
      const eased = t * t * (3 - 2 * t);
      factor = Math.min(factor, THREE.MathUtils.lerp(1, CITY_SPEED_FACTOR, eased));
    }
    return factor;
  }

  _selectMapPreset(payload = {}) {
    const idx = payload.mapIndex;
    if (Number.isInteger(idx) && idx >= 0 && idx < WORLD_MAP_PRESETS.length) {
      this._mapPreset = WORLD_MAP_PRESETS[idx];
      return;
    }
    this._mapPreset = WORLD_MAP_PRESETS[Math.floor(Math.random() * WORLD_MAP_PRESETS.length)];
  }

  _speedToKmh(speed) {
    return Math.round(speed * 3.6);
  }

  _speedToMach(speed) {
    return speed / SEA_LEVEL_SOUND_MS;
  }

  /* <!--
    최종 speed 스탯(업그레이드 반영)을 해수면 기준 순항·애프터버너 마하 한계로 변환합니다.
    F-16A(135) ≈ M0.79 / M1.78, Su-35급(168) ≈ M0.87 / M2.00, 최대 개량 ≈ M0.95 / M2.35.
  --> */
  _computePlayerSpeedLimits(speedStat) {
    const stat = THREE.MathUtils.clamp(speedStat, SPEED_STAT_MIN, SPEED_STAT_MAX);
    const t = (stat - SPEED_STAT_MIN) / (SPEED_STAT_MAX - SPEED_STAT_MIN);
    const cruiseMach = THREE.MathUtils.lerp(CRUISE_MACH_MIN, CRUISE_MACH_MAX, t);
    const boostMach = THREE.MathUtils.lerp(BOOST_MACH_MIN, BOOST_MACH_MAX, t);
    return {
      maxSpeed: cruiseMach * SEA_LEVEL_SOUND_MS,
      boostSpeed: boostMach * SEA_LEVEL_SOUND_MS,
      cruiseMach,
      boostMach,
    };
  }

  _formatSpeedDisplay(speed) {
    const kmh = this._speedToKmh(speed);
    const mach = this._speedToMach(speed);
    return `M${mach.toFixed(2)} · ${kmh.toLocaleString()} km/h`;
  }

  _getKmBuffModifiers() {
    const fn = Sky.KmBuffs?.getModifiers;
    if (typeof fn !== 'function') return { speedMul: 1, hpMul: 1, reloadTimeMul: 1, flareLureBonus: 0, missileEvadeChance: 0 };
    return fn(GameState.getKmBuff?.() ?? null);
  }

  /* <!-- KM 버프를 플레이어 슬롯 스탯에 반영(전투 출격 시 1회) --> */
  _applyKmBuffToSlot(slot, final, speedLimits) {
    const mod = this._getKmBuffModifiers();
    if (mod.speedMul !== 1) {
      slot.maxSpeed *= mod.speedMul;
      slot.boostSpeed *= mod.speedMul;
      slot.speed = Math.min(slot.speed, slot.maxSpeed);
    }
    const baseHp = 80 + final.armor * 1.0;
    slot.maxHp = baseHp * mod.hpMul;
    slot.hp = slot.maxHp;
    slot.kmReloadMul = mod.reloadTimeMul;
    slot.kmFlareLureBonus = mod.flareLureBonus;
    slot.kmMissileEvadeChance = mod.missileEvadeChance;
  }

  _showMapLoading(initialPct = 0) {
    const els = this._mapLoadingEls;
    const preset = this._mapPreset;
    if (!els?.root || !preset) return;
    if (els.img) {
      const src = preset.loadingImage || preset.loadingPhoto || 'assets/maps/plains.svg';
      els.img.onerror = () => {
        if (els.img.src.includes('plains.svg')) return;
        els.img.src = 'assets/maps/plains.svg';
      };
      els.img.src = src;
      els.img.alt = `${preset.name} 작전 구역`;
    }
    if (els.title) els.title.textContent = preset.name;
    if (els.desc) els.desc.textContent = '작전 구역 로딩 중… (5초)';
    els.root.classList.remove('hidden');
    els.root.setAttribute('aria-hidden', 'false');
    this._setMapLoadingProgress(initialPct, false);
  }

  _setMapLoadingProgress(pct, animate = true) {
    const els = this._mapLoadingEls;
    if (!els?.fill) return;
    const clamped = Math.min(100, Math.max(0, pct));
    els.fill.style.transition = animate ? 'width 0.2s ease-out' : 'none';
    els.fill.style.width = `${clamped}%`;
    if (els.bar) els.bar.setAttribute('aria-valuenow', String(Math.round(clamped)));
  }

  _hideMapLoading() {
    const els = this._mapLoadingEls;
    if (!els?.root) return;
    els.root.classList.add('hidden');
    els.root.setAttribute('aria-hidden', 'true');
    if (els.fill) {
      els.fill.style.transition = 'none';
      els.fill.style.width = '0%';
    }
    if (els.bar) els.bar.setAttribute('aria-valuenow', '0');
  }

  _getActiveTerrainColors() {
    const base = TERRAIN_COLORS;
    const over = this._mapPreset?.terrainColors;
    return over ? { ...base, ...over } : base;
  }

  _getGroundBiomeIndex() {
    const map = { middle_east: 0, southeast_asia: 1, plains: 2, mountains: 3 };
    return map[this._mapPreset?.id] ?? 2;
  }

  _getSettlementUrbanBlend(x, z) {
    let blend = 0;
    for (const s of this._settlementSites || []) {
      if (s.type !== 'city') continue;
      const outer = s.flatRadius * 1.15;
      const d = Math.hypot(x - s.x, z - s.z);
      if (d >= outer) continue;
      const t = 1 - d / outer;
      blend = Math.max(blend, t * t);
    }
    return blend;
  }

  /* <!-- 맵별 위성 톤: 구글어스식 고해상도 팔레트 + 필지·하천·도시 블렌딩 --> */
  _colorGroundVertexAt(wx, wz, h, tmp) {
    const biome = this._mapPreset?.id ?? 'plains';
    const vegMask = this._octaveNoise2D(wx + 180, wz - 240, 0.00042, 5);
    const fieldPatch = this._valueNoise2D(wx * 0.6, wz * 0.55, 0.00022);
    const mesoPatch = this._valueNoise2D(wx * 0.35, wz * 0.28, 0.00085);
    const microPatch = this._valueNoise2D(wx * 1.8, wz * 1.4, 0.0036);
    const finePatch = this._valueNoise2D(wx * 4.2, wz * 3.8, 0.012);
    const wadi = this._valueNoise2D(wx - 700, wz + 520, 0.0018);
    const wadiFine = this._octaveNoise2D(wx + 320, wz - 180, 0.0042, 3);
    const dryLake = this._valueNoise2D(wx + 2100, wz - 1600, 0.00038);
    const slopeHint = THREE.MathUtils.clamp(h / GROUND_PLAIN_MAX_ROLL, 0, 1);
    const fieldCell = Math.abs(Math.sin(wx * 0.00011) * Math.cos(wz * 0.00013));
    const parcel = Math.abs(Math.sin(wx * 0.00019 + wz * 0.00007) * Math.cos(wz * 0.00023 - wx * 0.00005));
    const urban = this._getSettlementUrbanBlend(wx, wz);

    if (biome === 'middle_east') {
      const sand = new THREE.Color(0xd8bc88);
      const sandDark = new THREE.Color(0xb89858);
      const rock = new THREE.Color(0x9a8068);
      const wadiTone = new THREE.Color(0x887050);
      const sabkha = new THREE.Color(0xe8d8a8);
      tmp.copy(sand);
      tmp.lerp(sandDark, (1 - vegMask) * 0.42);
      tmp.lerp(wadiTone, THREE.MathUtils.smoothstep(0.48, 0.78, wadi) * 0.38);
      tmp.lerp(wadiTone, THREE.MathUtils.smoothstep(0.55, 0.72, wadiFine) * 0.22);
      tmp.lerp(rock, slopeHint * 0.52);
      tmp.lerp(sabkha, THREE.MathUtils.smoothstep(0.68, 0.88, dryLake) * 0.32);
      tmp.lerp(sandDark, (microPatch - 0.5) * 0.18);
      tmp.lerp(sand, (finePatch - 0.5) * 0.1);
      tmp.lerp(new THREE.Color(0x8a8078), urban * 0.55);
      return;
    }

    if (biome === 'southeast_asia') {
      const canopy = new THREE.Color(0x245820);
      const jungle = new THREE.Color(0x3a7838);
      const rice = new THREE.Color(0x62a848);
      const water = new THREE.Color(0x2a5838);
      const clearing = new THREE.Color(0x4a9040);
      tmp.copy(jungle);
      tmp.lerp(canopy, THREE.MathUtils.smoothstep(0.4, 0.88, vegMask) * 0.62);
      tmp.lerp(rice, THREE.MathUtils.smoothstep(0.32, 0.62, fieldPatch) * 0.48);
      tmp.lerp(rice, parcel * fieldPatch * 0.35);
      tmp.lerp(water, THREE.MathUtils.smoothstep(0.52, 0.76, wadi) * 0.32);
      tmp.lerp(water, THREE.MathUtils.smoothstep(0.58, 0.72, wadiFine) * 0.18);
      tmp.lerp(clearing, mesoPatch * 0.22);
      tmp.lerp(new THREE.Color(0x486838), slopeHint * 0.32);
      tmp.lerp(jungle, (microPatch - 0.5) * 0.1);
      tmp.lerp(new THREE.Color(0x6a7068), urban * 0.5);
      return;
    }

    if (biome === 'mountains') {
      const alpine = new THREE.Color(0x788868);
      const rock = new THREE.Color(0x605848);
      const moss = new THREE.Color(0x4a6848);
      const forest = new THREE.Color(0x3a5238);
      const snowHint = new THREE.Color(0xd8e0d8);
      tmp.copy(alpine);
      tmp.lerp(forest, THREE.MathUtils.smoothstep(0.25, 0.55, vegMask) * 0.42);
      tmp.lerp(moss, THREE.MathUtils.smoothstep(0.35, 0.65, mesoPatch) * 0.38);
      tmp.lerp(rock, slopeHint * 0.62);
      tmp.lerp(snowHint, THREE.MathUtils.smoothstep(0.5, 0.82, h / GROUND_PLAIN_MAX_ROLL) * 0.28);
      tmp.lerp(rock, (microPatch - 0.5) * 0.16);
      tmp.lerp(rock, (finePatch - 0.5) * 0.08);
      tmp.lerp(new THREE.Color(0x707068), urban * 0.4);
      return;
    }

    /* 평원: 농경 필지 + 숲 + 하천 */
    const soilDry = new THREE.Color(0x8ca858);
    const vegLight = new THREE.Color(0x52a040);
    const vegDark = new THREE.Color(0x2a5828);
    const cropGold = new THREE.Color(0x9ab848);
    const rockBare = new THREE.Color(0x6a7858);
    const wadiTone = new THREE.Color(0x4a6840);
    const lakeDry = new THREE.Color(0xa8c078);
    tmp.copy(vegLight);
    tmp.lerp(vegDark, (1 - vegMask) * 0.28);
    tmp.lerp(vegLight, THREE.MathUtils.smoothstep(0.28, 0.72, vegMask) * 0.85);
    tmp.lerp(cropGold, parcel * THREE.MathUtils.smoothstep(0.38, 0.72, fieldPatch) * 0.45);
    tmp.lerp(wadiTone, THREE.MathUtils.smoothstep(0.58, 0.8, wadi) * 0.22);
    tmp.lerp(rockBare, slopeHint * 0.42);
    tmp.lerp(lakeDry, THREE.MathUtils.smoothstep(0.7, 0.9, dryLake) * 0.24);
    if (fieldPatch > 0.42 && fieldCell > 0.28) {
      tmp.lerp(cropGold, 0.22 + (fieldPatch - 0.42) * 0.5);
    }
    tmp.lerp(soilDry, (microPatch - 0.5) * 0.14);
    tmp.lerp(new THREE.Color(0x787870), urban * 0.52);
  }

  _getMapFallbackSettlements() {
    return [
      { type: 'city', x: -3920, z: -2880, seed: 11, flatRadius: SETTLEMENT_CITY_FLAT_RADIUS },
      { type: 'city', x: 4720, z: -2160, seed: 22, flatRadius: SETTLEMENT_CITY_FLAT_RADIUS },
      { type: 'city', x: -1680, z: 5280, seed: 33, flatRadius: SETTLEMENT_CITY_FLAT_RADIUS },
      { type: 'base', x: 3680, z: 3920, seed: 101, flatRadius: SETTLEMENT_BASE_FLAT_RADIUS, baseMaxLen: this._computeBaseMaxLength(101) },
      { type: 'base', x: -5520, z: 1040, seed: 202, flatRadius: SETTLEMENT_BASE_FLAT_RADIUS, baseMaxLen: this._computeBaseMaxLength(202) },
      { type: 'base', x: 1040, z: -4720, seed: 303, flatRadius: SETTLEMENT_BASE_FLAT_RADIUS, baseMaxLen: this._computeBaseMaxLength(303) },
      { type: 'base', x: -2200, z: -4800, seed: 404, flatRadius: SETTLEMENT_BASE_FLAT_RADIUS, baseMaxLen: this._computeBaseMaxLength(404) },
      { type: 'base', x: 5800, z: -1200, seed: 505, flatRadius: SETTLEMENT_BASE_FLAT_RADIUS, baseMaxLen: this._computeBaseMaxLength(505) },
      { type: 'base', x: -800, z: 6200, seed: 606, flatRadius: SETTLEMENT_BASE_FLAT_RADIUS, baseMaxLen: this._computeBaseMaxLength(606) },
    ];
  }

  _isBlockedForRoughTerrain(x, z, margin = 0) {
    for (const s of this._settlementSites || []) {
      if (Math.hypot(x - s.x, z - s.z) < s.flatRadius + margin) return true;
    }
    return false;
  }

  _tooCloseToPeaks(x, z, peaks, minD) {
    return peaks.some(([px, pz]) => Math.hypot(x - px, z - pz) < minD);
  }

  _buildCanyonControlPoints(seed, startAng, endAng, avgDist, steps = 6) {
    const points = [];
    for (let i = 0; i < steps; i++) {
      const t = steps <= 1 ? 0 : i / (steps - 1);
      const ang = THREE.MathUtils.lerp(startAng, endAng, t)
        + (this._terrainRand(seed + i * 7.3) - 0.5) * 0.42;
      const dist = avgDist + (this._terrainRand(seed + i * 11.7) - 0.5) * WORLD_PLAY_RADIUS * 0.22;
      const [x, z] = this._clampWorldXZ(Math.cos(ang) * dist, Math.sin(ang) * dist, WORLD_PLAY_RADIUS - WORLD_PLAY_RADIUS * 0.06);
      points.push([x, z]);
    }
    return points;
  }

  /* <!--
    산·협곡·언덉·도시·기지 좌표를 격자(WORLD_RADIUS) 안에서 한 번에 배치합니다.
    정착지는 평탄 바이옴·산맥과 충분히 떨어진 위치만 사용합니다.
  --> */
  _initWorldLayout() {
    const preset = this._mapPreset || WORLD_MAP_PRESETS[0];
    const playR = WORLD_PLAY_RADIUS;
    const peakInset = playR * 0.08;
    const settleMinRad = playR * 0.28;
    const settleEdgePad = playR * 0.07;
    const peakSep = playR * 0.23;
    const cityMinSep = playR * 0.39;
    const baseMinSep = playR * 0.28;
    const hillMinDist = playR * 0.25;
    const centerClear = playR * 0.22;
    const hillPeakSep = playR * 0.11;
    const settleBlockPad = playR * 0.038;
    const mountainCount = preset.mountainCount ?? WORLD_MOUNTAIN_COUNT;
    const hillCount = preset.hillCount ?? WORLD_HILL_COUNT;
    const cityCount = preset.cityCount ?? 3;
    const baseCount = preset.baseCount ?? 5;
    const peakHMul = preset.peakHeightMul ?? 1;
    const peakRMul = preset.peakRadiusMul ?? 1;
    const settleMaxRough = preset.settleMaxRough ?? 0.34;
    const peaks = [];

    for (let i = 0; i < mountainCount; i++) {
      const ang = (i / mountainCount) * Math.PI * 2
        + this._terrainRand(i * 19.7 + 300) * 0.55;
      const dist = playR * (0.48 + this._terrainRand(i * 23.1 + 301) * 0.42);
      const [x, z] = this._clampWorldXZ(Math.cos(ang) * dist, Math.sin(ang) * dist, playR - peakInset);
      const h = (240 + this._terrainRand(i * 31.3 + 302) * 210) * peakHMul;
      const r = (112 + this._terrainRand(i * 37.9 + 303) * 98) * peakRMul;
      peaks.push([x, z, h, r]);
    }

    const canyons = (preset.canyons || []).map((c) => ({
      seed: c.seed,
      corridorWidth: c.corridorWidth,
      samples: c.samples,
      controlPoints: this._buildCanyonControlPoints(
        c.seed, c.startAng, c.endAng, playR * c.pathDist, 7,
      ),
    }));

    const settlements = [];
    const placeType = (type, count, flatRadius, seedBase, minSep) => {
      const candidates = [];
      for (let i = 0; i < 900; i++) {
        const ang = this._terrainRand(seedBase + i * 1.17) * Math.PI * 2;
        const maxRad = playR - flatRadius - settleEdgePad;
        const minRad = settleMinRad;
        if (maxRad <= minRad) continue;
        const rad = minRad + this._terrainRand(seedBase + i * 2.31) * (maxRad - minRad);
        const [x, z] = this._clampWorldXZ(Math.cos(ang) * rad, Math.sin(ang) * rad, maxRad);
        if (!this._isInsidePlayArea(x, z, flatRadius + settleEdgePad * 0.5)) continue;
        if (this._tooCloseToPeaks(x, z, peaks, peakSep)) continue;
        const rough = this._plainRoughnessAt(x, z);
        if (rough > settleMaxRough) continue;
        candidates.push({ x, z, rough, tie: this._terrainRand(seedBase + i * 4.07) });
      }
      candidates.sort((a, b) => (a.rough - b.rough) || (a.tie - b.tie));

      let found = 0;
      for (const c of candidates) {
        if (found >= count) break;
        if (settlements.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < minSep)) continue;
        settlements.push({
          type,
          x: c.x,
          z: c.z,
          seed: seedBase + found * 97,
          flatRadius,
          ...(type === 'base' ? { baseMaxLen: this._computeBaseMaxLength(seedBase + found * 97) } : {}),
        });
        found += 1;
      }
    };

    placeType('city', cityCount, SETTLEMENT_CITY_FLAT_RADIUS, 11, cityMinSep);
    placeType('base', baseCount, SETTLEMENT_BASE_FLAT_RADIUS, 101, baseMinSep);

    const needSites = cityCount + baseCount;
    if (settlements.length < needSites) {
      const fallback = this._getMapFallbackSettlements().slice(0, needSites);
      settlements.length = 0;
      fallback.forEach((site) => settlements.push(site));
    }

    this._settlementSites = settlements;

    const hills = [];
    for (let i = 0; i < hillCount; i++) {
      for (let attempt = 0; attempt < 14; attempt++) {
        const seed = i * 17 + attempt * 503;
        const ang = this._terrainRand(seed * 2.9) * Math.PI * 2;
        const dist = hillMinDist + this._terrainRand(seed * 4.1) * (playR - hillMinDist - settleEdgePad);
        const [x, z] = this._clampWorldXZ(Math.cos(ang) * dist, Math.sin(ang) * dist, playR - settleEdgePad * 0.25);
        if (Math.hypot(x, z) < centerClear) continue;
        if (this._isBlockedForRoughTerrain(x, z, settleBlockPad)) continue;
        if (this._tooCloseToPeaks(x, z, peaks, hillPeakSep)) continue;
        hills.push({ x, z, seed });
        break;
      }
    }

    const mapFeatures = this._buildMapFeatureLayout(preset, playR, peaks);

    this._worldLayout = { peaks, canyons, hills, mapFeatures, presetId: preset.id };
  }

  /* <!-- 맵 프리셋별 지형지물(오아시스·농장·정글 등) 좌표를 산·정착지와 겹치지 않게 배치합니다. --> */
  _scatterMapFeatureSites(count, seedBase, playR, peaks, minPeakSep, minSettleSep) {
    const sites = [];
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 18; attempt++) {
        const seed = seedBase + i * 173 + attempt * 29;
        const ang = this._terrainRand(seed * 1.9) * Math.PI * 2;
        const dist = playR * (0.22 + this._terrainRand(seed * 2.7) * 0.62);
        const [x, z] = this._clampWorldXZ(
          Math.cos(ang) * dist,
          Math.sin(ang) * dist,
          playR - playR * 0.06,
        );
        if (this._tooCloseToPeaks(x, z, peaks, minPeakSep)) continue;
        if (this._isBlockedForRoughTerrain(x, z, minSettleSep)) continue;
        if (sites.some((s) => Math.hypot(s.x - x, s.z - z) < playR * 0.06)) continue;
        sites.push({ x, z, seed });
        break;
      }
    }
    return sites;
  }

  _buildMapFeatureLayout(preset, playR, peaks) {
    const list = [];
    const defs = preset.mapFeatures || [];
    let seedCursor = (preset.layoutSeed ?? 0) + 9000;
    for (const def of defs) {
      const sites = this._scatterMapFeatureSites(
        def.count ?? 0,
        seedCursor,
        playR,
        peaks,
        playR * 0.14,
        playR * 0.045,
      );
      seedCursor += 500;
      sites.forEach((site) => list.push({ type: def.type, ...site }));
    }
    return list;
  }

  _plainHeightAt(x, z) {
    const rough = this._plainRoughnessAt(x, z);

    const micro = (this._octaveNoise2D(x, z, 0.018, 4) - 0.5) * GROUND_PLAIN_MICRO_AMP;
    const grain = (this._valueNoise2D(x * 1.35, z * 0.92, 0.044) - 0.5) * 34 * rough;
    const flatSwell = Math.sin(x * 0.00075 + 0.4) * Math.cos(z * 0.00082 - 0.2) * 18 * (1 - rough);

    const rollA = Math.sin(x * 0.0024 + z * 0.0017 + 0.9) * 88;
    const rollB = Math.sin(x * 0.0046 - z * 0.0031 + 1.7) * 64;
    const rollC = (this._valueNoise2D(x - 900, z + 600, 0.00135) - 0.5) * 165;
    const rollD = Math.sin(x * 0.0074 + z * 0.0059 + 2.3) * 36 * rough;
    const ridged = (1 - Math.abs(this._octaveNoise2D(x + 1200, z - 800, 0.0028, 3) * 2 - 1)) * 78 * rough;
    const rolling = (rollA + rollB + rollC * 0.62 + rollD + ridged) * rough;

    const pitN = this._valueNoise2D(x - 400, z + 200, 0.0038);
    const pit = -Math.pow(Math.max(0, pitN - 0.56), 2) * 88 * rough;
    const bumpN = this._valueNoise2D(x + 650, z - 520, 0.0062);
    const bump = Math.pow(Math.max(0, bumpN - 0.52), 1.55) * 58 * rough;
    const chaos = (this._valueNoise2D(x * 0.7 + 200, z * 0.8 - 150, 0.0095) - 0.5) * 42 * rough;

    let h = micro + grain + flatSwell + rolling + pit + bump + chaos;
    const maxH = GROUND_PLAIN_MAX_FLAT + rough * (GROUND_PLAIN_MAX_ROLL - GROUND_PLAIN_MAX_FLAT);
    h = THREE.MathUtils.clamp(h, -34, maxH);
    h *= this._mapPreset?.plainRoughMul ?? 1;

    const flatFalloff = this._getSettlementFlatFalloff(x, z);
    return THREE.MathUtils.lerp(h, 0, flatFalloff);
  }

  _buildPlainGroundGeometry() {
    const seg = GROUND_PLAIN_SEG;
    const geo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, seg, seg);
    const pos = geo.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i);
      const wz = -pos.getY(i);
      pos.setZ(i, this._plainHeightAt(wx, wz));
    }

    geo.computeVertexNormals();
    geo.rotateX(-Math.PI / 2);
    return geo;
  }

  /* <!--
    맵별 위성 텍스처를 CPU에서 구워 PlaneGeometry UV에 입힙니다.
    셰이더 컴파일 실패 시 단색으로 보이는 문제를 피하고 4개 맵 모두 선명한 위성 톤을 보장합니다.
  --> */
  _bakeGroundSatelliteTexture() {
    const res = GROUND_TEXTURE_RES;
    const canvas = document.createElement('canvas');
    canvas.width = res;
    canvas.height = res;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      const fallback = new THREE.CanvasTexture(document.createElement('canvas'));
      fallback.needsUpdate = true;
      return fallback;
    }
    const tmp = new THREE.Color();
    const half = GROUND_SIZE * 0.5;
    const photo = this._mapPhotoImage;
    const hasPhoto = !!(photo?.complete && photo.naturalWidth > 0);
    let photoData = null;

    if (hasPhoto) {
      try {
        ctx.drawImage(photo, 0, 0, res, res);
        photoData = ctx.getImageData(0, 0, res, res);
      } catch (err) {
        console.warn('[BattleManager] map photo bake skipped:', err);
      }
    }

    const proc = ctx.createImageData(res, res);
    for (let py = 0; py < res; py++) {
      for (let px = 0; px < res; px++) {
        const wx = (px / (res - 1)) * GROUND_SIZE - half;
        const wz = -((py / (res - 1)) * GROUND_SIZE - half);
        const h = this._plainHeightAt(wx, wz);
        this._colorGroundVertexAt(wx, wz, h, tmp);
        const meso = this._valueNoise2D(wx * 0.4, wz * 0.35, 0.0018);
        const micro = this._valueNoise2D(wx * 1.6, wz * 1.4, 0.009);
        const ridge = this._valueNoise2D(wx * 0.12, wz * 0.11, 0.00055);
        const heightShade = 0.9 + THREE.MathUtils.clamp(h / GROUND_PLAIN_MAX_ROLL, 0, 1) * 0.22;
        tmp.multiplyScalar(heightShade * (0.78 + meso * 0.26 + ridge * 0.12 + Math.abs(micro - 0.5) * 0.28));
        const i = (py * res + px) * 4;
        if (hasPhoto && photoData) {
          const pb = MAP_GROUND_PHOTO_BLEND;
          proc.data[i] = Math.min(255, Math.round(tmp.r * 255 * (1 - pb) + photoData.data[i] * pb));
          proc.data[i + 1] = Math.min(255, Math.round(tmp.g * 255 * (1 - pb) + photoData.data[i + 1] * pb));
          proc.data[i + 2] = Math.min(255, Math.round(tmp.b * 255 * (1 - pb) + photoData.data[i + 2] * pb));
        } else {
          proc.data[i] = Math.min(255, Math.round(tmp.r * 255));
          proc.data[i + 1] = Math.min(255, Math.round(tmp.g * 255));
          proc.data[i + 2] = Math.min(255, Math.round(tmp.b * 255));
        }
        proc.data[i + 3] = 255;
      }
    }

    ctx.putImageData(proc, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    else if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
    if (this._renderer?.capabilities?.getMaxAnisotropy) {
      tex.anisotropy = Math.min(16, this._renderer.capabilities.getMaxAnisotropy());
    }
    tex.needsUpdate = true;
    return tex;
  }

  _createGroundMesh() {
    const tc = this._getActiveTerrainColors();
    let assets;
    try {
      assets = this._getOrBuildWorldGroundAssets();
    } catch (err) {
      console.warn('[BattleManager] ground asset build failed, using quick color:', err);
      const geo = this._buildPlainGroundGeometry();
      const mat = new THREE.MeshLambertMaterial({ color: tc.fill });
      const ground = new THREE.Mesh(geo, mat);
      ground.position.y = GROUND_Y;
      ground.name = 'ground';
      ground.receiveShadow = true;
      return ground;
    }

    const tex = assets.groundTexture;
    const texReady = tex?.image && tex.image.width > 8 && tex.image.height > 8;
    this._sharedGroundTexture = texReady ? tex : null;
    const mat = texReady
      ? (() => {
        const m = new THREE.MeshLambertMaterial({ map: tex, color: 0xffffff });
        m.userData.sharedMap = true;
        return m;
      })()
      : new THREE.MeshLambertMaterial({ color: tc.fill });

    const ground = new THREE.Mesh(assets.groundGeometry.clone(), mat);
    ground.position.y = GROUND_Y;
    ground.name = 'ground';
    ground.receiveShadow = true;
    return ground;
  }

  _terrainRand(seed) {
    const s = seed + (this._mapPreset?.layoutSeed ?? 0);
    const n = Math.sin(s * 127.1 + 311.7) * 43758.5453123;
    return n - Math.floor(n);
  }

  /* <!-- 지면 격자색과 같은 올리브 계열로 산·구릉·협곡·건물 재질을 통일합니다. --> */
  _createTerrainMaterials() {
    const tc = this._getActiveTerrainColors();
    const mk = (hex, roughness = 0.94, metalness = 0.03) =>
      new THREE.MeshStandardMaterial({ color: hex, roughness, metalness });
    const rockVariants = [
      mk(tc.fill, 0.95),
      mk(tc.minor, 0.96),
      mk(0x8a8058, 0.96),
      mk(tc.major, 0.97, 0.02),
      mk(0x9a8c78, 0.96),
      mk(tc.mega, 0.98, 0.02),
    ];
    return {
      rockVariants,
      snow: mk(tc.snow, 0.9, 0.01),
      canyonFloor: mk(tc.fill, 0.98),
      asphalt: mk(TERRAIN_COLORS.asphalt, 0.88, 0.05),
      concrete: mk(TERRAIN_COLORS.concrete, 0.85, 0.04),
      building: mk(TERRAIN_COLORS.building, 0.82, 0.06),
      buildingDark: mk(TERRAIN_COLORS.buildingDark, 0.86, 0.05),
      roof: mk(TERRAIN_COLORS.roof, 0.84, 0.05),
      runway: mk(TERRAIN_COLORS.runway, 0.75, 0.08),
      hangar: mk(TERRAIN_COLORS.hangar, 0.8, 0.06),
      fence: mk(TERRAIN_COLORS.fence, 0.9, 0.04),
      tower: mk(TERRAIN_COLORS.buildingDark, 0.78, 0.07),
    };
  }

  _pickRockMaterial(materials, seed) {
    const idx = Math.floor(this._terrainRand(seed + 6) * materials.rockVariants.length);
    return materials.rockVariants[idx];
  }

  /* <!--
    15가지 실루엣. preferGentle=true 일 때만 완만한 형태(gentle·rolling·broad·dome).
    협곡·일반 산맥은 항상 뾰족/능선형(sharp)만 사용합니다.
  --> */
  _getMountainShape(seed, preferGentle = false) {
    const gridSeg = 14 + Math.floor(this._terrainRand(seed + 209) * 8);
    const profiles = [
      { mode: 'ridge', power: 0.52, rf1: 3, rf2: 5, ra1: 0.22, ra2: 0.14, subs: 1, crag: 0.04, plateau: 0, asym: 0, stretchX: 1, stretchZ: 1, gentle: false },
      { mode: 'needle', power: 0.28, rf1: 4, rf2: 7, ra1: 0.18, ra2: 0.10, subs: 0, crag: 0.05, plateau: 0, asym: 0, stretchX: 0.75, stretchZ: 0.75, gentle: false },
      { mode: 'mesa', power: 0.74, rf1: 2, rf2: 4, ra1: 0.12, ra2: 0.08, subs: 0, crag: 0.03, plateau: 0.42, asym: 0, stretchX: 1.15, stretchZ: 1.05, gentle: false },
      { mode: 'twin', power: 0.48, rf1: 3, rf2: 5, ra1: 0.16, ra2: 0.12, subs: 2, crag: 0.04, plateau: 0, asym: 0.14, stretchX: 1, stretchZ: 1, gentle: false },
      { mode: 'asymmetric', power: 0.42, rf1: 3, rf2: 6, ra1: 0.20, ra2: 0.12, subs: 1, crag: 0.04, plateau: 0, asym: 0.38, stretchX: 1.1, stretchZ: 0.9, gentle: false },
      { mode: 'craggy', power: 0.56, rf1: 6, rf2: 9, ra1: 0.24, ra2: 0.16, subs: 3, crag: 0.11, plateau: 0, asym: 0.12, stretchX: 1, stretchZ: 1, gentle: false },
      { mode: 'dome', power: 0.88, rf1: 2, rf2: 3, ra1: 0.06, ra2: 0.04, subs: 0, crag: 0.01, plateau: 0, asym: 0, stretchX: 1.35, stretchZ: 1.2, gentle: true },
      { mode: 'saddle', power: 0.58, rf1: 2, rf2: 4, ra1: 0.14, ra2: 0.10, subs: 2, crag: 0.03, plateau: 0, asym: 0, stretchX: 1.35, stretchZ: 0.7, saddle: 0.55, gentle: false },
      { mode: 'crater', power: 0.50, rf1: 3, rf2: 5, ra1: 0.15, ra2: 0.10, subs: 0, crag: 0.05, plateau: 0, asym: 0, stretchX: 1, stretchZ: 1, crater: 0.28, craterDepth: 0.22, gentle: false },
      { mode: 'cliff', power: 0.55, rf1: 3, rf2: 5, ra1: 0.18, ra2: 0.11, subs: 1, crag: 0.06, plateau: 0, asym: 0.2, stretchX: 1, stretchZ: 1, cliffBias: 0.62, gentle: false },
      { mode: 'knife', power: 0.38, rf1: 5, rf2: 8, ra1: 0.20, ra2: 0.12, subs: 1, crag: 0.05, plateau: 0, asym: 0, stretchX: 0.38, stretchZ: 1.55, gentle: false },
      { mode: 'terrace', power: 0.62, rf1: 4, rf2: 6, ra1: 0.16, ra2: 0.10, subs: 1, crag: 0.04, plateau: 0, asym: 0.08, stretchX: 1, stretchZ: 1, terraces: 5, gentle: false },
      { mode: 'gentle', power: 1.35, rf1: 2, rf2: 3, ra1: 0.05, ra2: 0.03, subs: 0, crag: 0.012, plateau: 0, asym: 0, stretchX: 1.45, stretchZ: 1.35, gentle: true },
      { mode: 'rolling', power: 1.12, rf1: 2, rf2: 3, ra1: 0.07, ra2: 0.04, subs: 0, crag: 0.018, plateau: 0, asym: 0.08, stretchX: 1.55, stretchZ: 1.45, gentle: true },
      { mode: 'broad', power: 1.6, rf1: 2, rf2: 2, ra1: 0.04, ra2: 0.02, subs: 0, crag: 0.008, plateau: 0, asym: 0, stretchX: 1.75, stretchZ: 1.65, gentle: true },
    ];
    const gentleIndices = [6, 12, 13, 14];
    const sharpIndices = [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11];
    let type;
    if (preferGentle) {
      type = gentleIndices[Math.floor(this._terrainRand(seed + 201) * gentleIndices.length)];
    } else {
      type = sharpIndices[Math.floor(this._terrainRand(seed + 202) * sharpIndices.length)];
    }
    const p = profiles[type];
    const tierScale = p.gentle ? 1.18 : 1;
    return {
      ...p,
      type,
      gridSeg,
      stretchX: p.stretchX * (0.92 + this._terrainRand(seed + 210) * 0.16),
      stretchZ: p.stretchZ * (0.92 + this._terrainRand(seed + 211) * 0.16),
      cliffDir: this._terrainRand(seed + 212) * Math.PI * 2,
      rf1: p.rf1 + Math.floor(this._terrainRand(seed + 213) * (p.gentle ? 1 : 2)),
      rf2: p.rf2 + Math.floor(this._terrainRand(seed + 214) * (p.gentle ? 1 : 2)),
      lowerEnd: (0.30 + this._terrainRand(seed + 215) * 0.14) * tierScale,
      midEnd: (0.56 + this._terrainRand(seed + 216) * 0.16) * Math.min(tierScale, 1.08),
      powerLow: p.gentle ? 1.35 + this._terrainRand(seed + 217) * 0.35 : 1.02 + this._terrainRand(seed + 217) * 0.32,
      powerMid: p.gentle ? 0.95 + this._terrainRand(seed + 218) * 0.35 : 0.38 + this._terrainRand(seed + 218) * 0.24,
      footSpread: (p.gentle ? 0.26 : 0.14) + this._terrainRand(seed + 219) * (p.gentle ? 0.22 : 0.18),
      footRidge: p.gentle ? 0.08 + this._terrainRand(seed + 220) * 0.08 : 0.28 + this._terrainRand(seed + 220) * 0.22,
    };
  }

  /* <!-- cos² 계열 완만 곡선: 정상·산록 모두 기울기가 부드럽게 변합니다. --> */
  _mountainGentleHeight(nr, height, shape) {
    const r = Math.min(nr, 1);
    const cosT = Math.cos(r * Math.PI * 0.5);
    let h;
    if (shape.mode === 'broad') {
      h = height * Math.pow(cosT, 1.15);
    } else if (shape.mode === 'rolling') {
      h = height * cosT * cosT;
      h *= 1 + 0.045 * Math.cos(r * Math.PI * 3.2);
    } else if (shape.mode === 'dome') {
      h = height * (1 - Math.pow(r, 2.05));
    } else {
      h = height * cosT * cosT;
    }
    return Math.max(0, h);
  }

  /* <!--
    산 높이를 하단(완만)·중턱(급경사)·상단(봉우리) 3구간으로 나눠 실제 산처럼 프로파일을 만듭니다.
  --> */
  _mountainTierHeight(t, height, shape) {
    const lowerEnd = shape.lowerEnd;
    const midEnd = Math.max(lowerEnd + 0.08, shape.midEnd);
    const hFoot = height * 0.28;
    const hMid = height * 0.62;

    if (t <= lowerEnd) {
      const lt = t / lowerEnd;
      return hFoot * Math.pow(lt, shape.powerLow);
    }
    if (t <= midEnd) {
      const mt = (t - lowerEnd) / (midEnd - lowerEnd);
      return hFoot + (hMid - hFoot) * Math.pow(mt, shape.powerMid);
    }
    const ut = (t - midEnd) / (1 - midEnd);
    return hMid + (height - hMid) * Math.pow(ut, shape.power);
  }

  /* <!--
    산·협곡·구릉 지형. 충돌은 평면 지면(GROUND_Y)만 적용하고 지형물은 시각 참조용입니다.
    산은 ridged 메쉬로 표현하고, 협곡은 곡선 경로를 따라 산맥이 모여 형성됩니다.
  --> */
  _createTerrain() {
    const group = new THREE.Group();
    group.name = 'terrain';
    const materials = this._getTerrainMaterials();
    this._terrainColliders = [];
    const layout = this._worldLayout || { peaks: [], canyons: [], hills: [] };

    layout.peaks.forEach(([x, z, h, r], idx) => {
      this._addRealisticMountain(group, x, z, h, r, idx * 17 + 3, materials, {
        preferGentle: idx % 3 === 0 || h < 280,
      });
    });

    for (const hill of layout.hills) {
      this._addNaturalHillCluster(group, hill.x, hill.z, hill.seed, materials);
    }

    for (const canyon of layout.canyons) {
      this._addCurvedMountainCanyon(group, materials, canyon);
    }

    return group;
  }

  _catmullRomPoint(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    const x = 0.5 * (
      (2 * p1.x)
      + (-p0.x + p2.x) * t
      + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2
      + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
    );
    const y = 0.5 * (
      (2 * p1.y)
      + (-p0.y + p2.y) * t
      + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2
      + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
    );
    return new THREE.Vector2(x, y);
  }

  _sampleCatmullRom(points, t) {
    const n = points.length;
    if (n < 2) return points[0].clone();
    if (n === 2) {
      return new THREE.Vector2(
        points[0].x + (points[1].x - points[0].x) * t,
        points[0].y + (points[1].y - points[0].y) * t,
      );
    }
    const scaled = t * (n - 1);
    const seg = Math.min(Math.floor(scaled), n - 2);
    const localT = scaled - seg;
    const p0 = points[Math.max(seg - 1, 0)];
    const p1 = points[seg];
    const p2 = points[seg + 1];
    const p3 = points[Math.min(seg + 2, n - 1)];
    return this._catmullRomPoint(p0, p1, p2, p3, localT);
  }

  _sampleCatmullRomTangent(points, t, eps = 0.01) {
    const a = this._sampleCatmullRom(points, Math.max(0, t - eps));
    const b = this._sampleCatmullRom(points, Math.min(1, t + eps));
    return new THREE.Vector2(b.x - a.x, b.y - a.y);
  }

  _evalMountainHeightLocal(lx, ly, height, baseRadius, seed, preferGentle) {
    const shape = this._getMountainShape(seed, preferGentle);
    const asymX = shape.asym * baseRadius;
    const asymZ = shape.asym * baseRadius * 0.65;
    lx = (lx - asymX) / shape.stretchX;
    ly = (ly - asymZ) / shape.stretchZ;

    const ang = Math.atan2(ly, lx);
    const dist = Math.hypot(lx, ly);
    const ridgeW = shape.footRidge + (1 - shape.footRidge) * 0.4;
    const ridgeA = Math.max(
      0.74,
      1 - shape.ra1 * ridgeW + shape.ra1 * ridgeW * Math.sin(ang * shape.rf1 + this._terrainRand(seed) * Math.PI * 2),
    );
    const ridgeB = Math.max(
      0.74,
      1 - shape.ra2 * ridgeW + shape.ra2 * ridgeW * Math.sin(ang * shape.rf2 + this._terrainRand(seed + 1) * Math.PI * 2),
    );
    const footMul = 1 + shape.footSpread * Math.pow(Math.max(0, 1 - dist / (baseRadius * 1.12)), 1.6);
    const effectiveR = baseRadius * ridgeA * ridgeB * footMul;
    const nr = dist / effectiveR;
    const t = Math.max(0, 1 - nr);

    let hDetail;
    if (shape.mode === 'terrace' && shape.terraces) {
      hDetail = height * Math.pow(Math.floor(t * shape.terraces) / shape.terraces, shape.power);
    } else if (shape.plateau > 0 && t > 1 - shape.plateau) {
      hDetail = height * (0.86 + ((t - (1 - shape.plateau)) / shape.plateau) * 0.14);
    } else if (shape.mode === 'cliff') {
      hDetail = this._mountainTierHeight(t, height, shape);
      hDetail *= 1 + shape.cliffBias * 0.35 * Math.max(0, Math.cos(ang - shape.cliffDir)) * t;
    } else if (shape.gentle) {
      hDetail = this._mountainGentleHeight(nr, height, shape);
    } else {
      hDetail = this._mountainTierHeight(t, height, shape);
    }

    if (shape.mode === 'saddle' && shape.saddle && t > 0.22) {
      const sb = (t - 0.22) / 0.78;
      hDetail *= (1 - sb) + sb * (0.55 + 0.45 * Math.abs(Math.sin(ang * 2 + this._terrainRand(seed + 5) * Math.PI)));
    }

    if (!shape.gentle) {
      for (let s = 0; s < shape.subs; s++) {
        const subOx = (this._terrainRand(seed + 20 + s * 4) - 0.5) * baseRadius * 0.48;
        const subOz = (this._terrainRand(seed + 21 + s * 4) - 0.5) * baseRadius * 0.48;
        const subScale = 0.34 + this._terrainRand(seed + 22 + s * 4) * 0.18;
        const subR = Math.hypot(lx - subOx, ly - subOz) / (baseRadius * subScale);
        if (subR < 1) {
          const st = Math.cos(subR * Math.PI * 0.5);
          hDetail += height * (0.12 + this._terrainRand(seed + 23 + s * 4) * 0.14) * st * st;
        }
      }
    }

    if (shape.mode === 'crater' && shape.crater && dist < baseRadius * shape.crater) {
      const ct = dist / (baseRadius * shape.crater);
      hDetail -= height * shape.craterDepth * (1 - ct * ct);
    }

    /* 등방성 외곽(envelope) + 내부 디테일: 산록 방향별 nr 차이로 생기는 구멍 방지 */
    const skirtR = baseRadius * (1.14 + shape.footSpread * 0.48);
    const isoNr = dist / skirtR;
    const envelope = height * Math.pow(Math.max(0, 1 - Math.min(isoNr, 1)), 1.75);
    const detailMask = Math.pow(Math.max(0, 1 - isoNr / 0.82), 2.4);
    let h = envelope + Math.max(0, hDetail - envelope) * detailMask;
    if (isoNr > 1.02) h *= Math.max(0, 1 - (isoNr - 1.02) / 0.12) ** 2;
    return Math.max(0, h);
  }

  _evalHillHeightLocal(lx, ly, footprint, bumps) {
    const half = footprint * 1.15 * 0.5;
    let h = 0;
    for (const b of bumps) {
      const r2 = ((lx - b.ox) / b.rx) ** 2 + ((ly - b.oz) / b.rz) ** 2;
      if (r2 >= 1) continue;
      const t = Math.cos(r2 * Math.PI * 0.5);
      h += b.h * t * t;
    }
    const edge = Math.max(Math.abs(lx) / half, Math.abs(ly) / half);
    if (edge > 0.78) h *= Math.max(0, 1 - (edge - 0.78) / 0.22) ** 2;
    return Math.max(0, h);
  }

  _sampleTerrainColliderY(px, pz, col) {
    const dx = px - col.x;
    const dz = pz - col.z;
    const cos = Math.cos(-col.rotY);
    const sin = Math.sin(-col.rotY);
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;

    if (col.kind === 'mountain') {
      if (Math.hypot(lx, lz) > col.baseRadius * 1.48) return GROUND_Y;
      return GROUND_Y + this._evalMountainHeightLocal(lx, lz, col.height, col.baseRadius, col.seed, col.preferGentle);
    }
    if (col.kind === 'hill') {
      const half = col.footprint * 1.15 * 0.5;
      if (Math.abs(lx) > half || Math.abs(lz) > half) return GROUND_Y;
      return GROUND_Y + this._evalHillHeightLocal(lx, lz, col.footprint, col.bumps);
    }
    return GROUND_Y;
  }

  _getMaxTerrainSurfaceY(px, pz) {
    if (!this._terrainColliders?.length) return GROUND_Y;
    let maxSurface = GROUND_Y;
    for (const col of this._terrainColliders) {
      const sy = this._sampleTerrainColliderY(px, pz, col);
      if (sy > maxSurface) maxSurface = sy;
    }
    return maxSurface;
  }

  /* <!--
    (x,z) 지점 지표면 높이: 평지 메쉬 undulation + 산·언덉 콜라이더 중 최대값.
    무게중심 수직 수선(AGL) 계산에 사용합니다.
  --> */
  _getGroundSurfaceY(px, pz) {
    const plainY = GROUND_Y + this._plainHeightAt(px, pz);
    const terrainY = this._getMaxTerrainSurfaceY(px, pz);
    return Math.max(plainY, terrainY);
  }

  /* <!-- 무게중심(기체 원점)에서 지표면까지의 수직 거리(AGL). --> */
  _getCgClearanceAGL(p) {
    if (!p) return 0;
    const pos = p.mesh.position;
    return Math.max(0, pos.y - this._getGroundSurfaceY(pos.x, pos.z));
  }

  _registerTerrainCollider(entry) {
    this._terrainColliders.push(entry);
  }

  /* <!-- 기체 메쉬 바닥·날개 끝 등 접촉 판정용 로컬 샘플 포인트. --> */
  _getAircraftVisualCenter(mesh, out) {
    if (!mesh) return out.set(0, 0, 0);
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3();
    let hasMesh = false;
    mesh.traverse((obj) => {
      if (!obj.isMesh || !obj.visible) return;
      if (obj.name === 'thrust') return;
      const part = new THREE.Box3().setFromObject(obj);
      if (part.isEmpty()) return;
      if (!hasMesh) {
        box.copy(part);
        hasMesh = true;
      } else {
        box.union(part);
      }
    });
    if (!hasMesh) return out.copy(mesh.position);
    box.getCenter(out);
    return out;
  }

  _buildAircraftHullSamples(mesh) {
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    const { min, max } = box;
    const y = min.y;
    const cx = (min.x + max.x) * 0.5;
    const cz = (min.z + max.z) * 0.5;
    const belly = min.y + (max.y - min.y) * 0.06;
    return [
      new THREE.Vector3(min.x, y, min.z),
      new THREE.Vector3(max.x, y, min.z),
      new THREE.Vector3(min.x, y, max.z),
      new THREE.Vector3(max.x, y, max.z),
      new THREE.Vector3(cx, y, cz),
      new THREE.Vector3(cx, belly, min.z),
      new THREE.Vector3(cx, belly, max.z),
      new THREE.Vector3(min.x, y, cz),
      new THREE.Vector3(max.x, y, cz),
      new THREE.Vector3(cx, y, min.z),
      new THREE.Vector3(cx, y, max.z),
    ];
  }

  _getAircraftHullWorldSamples(p) {
    if (!this._hullWorldBuf) this._hullWorldBuf = [];
    const buf = this._hullWorldBuf;
    buf.length = 0;
    p.mesh.updateMatrixWorld(true);
    const tmp = this._hullTmpVec ?? (this._hullTmpVec = new THREE.Vector3());
    for (const local of p.hullSamples) {
      tmp.copy(local).applyMatrix4(p.mesh.matrixWorld);
      buf.push(tmp.clone());
    }
    return buf;
  }

  _getAircraftLowestWorldY(p) {
    p.mesh.updateMatrixWorld(true);
    const tmp = this._hullTmpVec ?? (this._hullTmpVec = new THREE.Vector3());
    let lowest = Infinity;
    for (const local of p.hullSamples) {
      tmp.copy(local).applyMatrix4(p.mesh.matrixWorld);
      if (tmp.y < lowest) lowest = tmp.y;
    }
    return lowest;
  }

  _checkTerrainCollision(p) {
    if (!this._terrainColliders?.length) return;
    const lowestY = this._getAircraftLowestWorldY(p);
    const maxSurface = this._getMaxTerrainSurfaceY(p.mesh.position.x, p.mesh.position.z);
    if (maxSurface > GROUND_Y + 1.5 && lowestY <= maxSurface + CONTACT_EPSILON) {
      this._killPlayer(p, '지형 충돌');
    }
  }

  _missileHitsTerrain(missile) {
    const py = missile.position.y;
    const maxSurface = this._getMaxTerrainSurfaceY(missile.position.x, missile.position.z);
    return maxSurface > GROUND_Y + 1 && py <= maxSurface + 2.5;
  }

  /* <!--
    ridged 프로파일 산 메쉬. 눈은 정점 색 snow line(고도 그라데이션)으로 표현합니다.
  --> */
  _buildMountainGeometry(height, baseRadius, seed, preferGentle, rockColor, snowColor, groundColor) {
    const shape = this._getMountainShape(seed, preferGentle);
    const size = baseRadius * 2.5;
    const seg = Math.max(shape.gridSeg, 18);
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const rock = new THREE.Color(rockColor);
    const snow = new THREE.Color(snowColor);
    const ground = new THREE.Color(groundColor);
    const snowStart = height * 0.52;
    const snowEnd = height * 0.68;
    const groundBlendH = Math.max(height * 0.18, 10);
    const useSnow = height > 200;

    for (let i = 0; i < pos.count; i++) {
      const h = this._evalMountainHeightLocal(pos.getX(i), pos.getY(i), height, baseRadius, seed, preferGentle);
      pos.setZ(i, h);

      const col = new THREE.Color();
      if (h < groundBlendH) {
        const t = h / groundBlendH;
        col.lerpColors(ground, rock, t * t * (3 - 2 * t));
      } else if (useSnow && h > snowStart) {
        col.lerpColors(rock, snow, Math.min(1, ((h - snowStart) / Math.max(snowEnd - snowStart, 1)) ** 1.4));
      } else {
        col.copy(rock);
      }
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    geo.rotateX(-Math.PI / 2);
    return geo;
  }

  _addRealisticMountain(group, x, z, height, baseRadius, seed, materials, opts = {}) {
    const { preferGentle = false } = opts;
    const baseMat = this._pickRockMaterial(materials, seed);
    const mat = baseMat.clone();
    mat.vertexColors = true;
    mat.color.setHex(0xffffff);
    /* 지면과의 z-fighting(반짝임) 방지: 깊이 버퍼 미세 오프셋 */
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = 2;
    mat.polygonOffsetUnits = 2;
    const groundHex = this._getActiveTerrainColors().fill;
    const rotY = this._terrainRand(seed + 50) * Math.PI * 2;
    const body = new THREE.Mesh(
      this._buildMountainGeometry(
        height, baseRadius, seed, preferGentle,
        baseMat.color.getHex(), materials.snow.color.getHex(), groundHex,
      ),
      mat,
    );
    body.position.set(x, GROUND_Y, z);
    body.rotation.y = rotY;
    body.renderOrder = 1;
    group.add(body);

    const shape = this._getMountainShape(seed, preferGentle);

    if (!shape.gentle && this._terrainRand(seed + 80) > 0.55) {
      const outcropR = baseRadius * (0.22 + this._terrainRand(seed + 81) * 0.18);
      const outcropH = height * (0.18 + this._terrainRand(seed + 82) * 0.15);
      const ox = (this._terrainRand(seed + 83) - 0.5) * baseRadius * 1.1;
      const oz = (this._terrainRand(seed + 84) - 0.5) * baseRadius * 1.1;
      const oBaseMat = this._pickRockMaterial(materials, seed + 85);
      const oRockHex = oBaseMat.color.getHex();
      const oMat = oBaseMat.clone();
      oMat.vertexColors = true;
      oMat.color.setHex(0xffffff);
      oMat.polygonOffset = true;
      oMat.polygonOffsetFactor = 2;
      oMat.polygonOffsetUnits = 2;
      const outcrop = new THREE.Mesh(
        this._buildMountainGeometry(
          outcropH, outcropR, seed + 300, false,
          oRockHex, materials.snow.color.getHex(), groundHex,
        ),
        oMat,
      );
      outcrop.position.set(x + ox, GROUND_Y, z + oz);
      outcrop.rotation.y = this._terrainRand(seed + 86) * Math.PI * 2;
      group.add(outcrop);
      this._registerTerrainCollider({
        kind: 'mountain', x: x + ox, z: z + oz, height: outcropH, baseRadius: outcropR,
        seed: seed + 300, rotY: outcrop.rotation.y, preferGentle: false,
      });
    }

    this._registerTerrainCollider({
      kind: 'mountain', x, z, height, baseRadius, seed, rotY, preferGentle,
    });
  }

  /* <!--
    Catmull-Rom 곡선을 따라 양쪽에 산맥을 배치해 자연스러운 곡선 협곡을 만듭니다.
    corridorWidth 는 비행 통로(양벽 간격)를, sampleCount 는 경로 방향 산 배치 밀도를 조절합니다.
  --> */
  _addCurvedMountainCanyon(group, materials, { seed, controlPoints, corridorWidth, samples }) {
    const path = controlPoints.map(([px, pz]) => new THREE.Vector2(px, pz));
    const canyon = new THREE.Group();
    canyon.name = 'curved-canyon';
    /* 경로 방향(앞뒤) 산 간격: 기존 대비 촘촘히 배치 */
    const sampleCount = Math.max(6, Math.round(samples * 3));

    for (let i = 0; i < sampleCount; i++) {
      const t = sampleCount <= 1 ? 0 : i / (sampleCount - 1);
      const center = this._sampleCatmullRom(path, t);
      const tangent = this._sampleCatmullRomTangent(path, t);
      const tLen = Math.hypot(tangent.x, tangent.y) || 1;
      const px = -tangent.y / tLen;
      const pz = tangent.x / tLen;

      const wallBoost = 0.85 + 0.3 * Math.sin(t * Math.PI);

      for (const side of [-1, 1]) {
        /* 양벽 간격 확대: 산 중심을 통로 중심에서 더 멀리 배치 */
        const outerOff = corridorWidth * 0.48 + 16 + this._terrainRand(seed + i + side * 11) * 10;
        const mx = center.x + px * side * outerOff;
        const mz = center.y + pz * side * outerOff;
        const mHeight = (195 + this._terrainRand(seed + i * 3 + side * 5) * 175) * wallBoost;
        const mRadius = 108 + this._terrainRand(seed + i * 7 + side * 3) * 72;

        this._addRealisticMountain(
          canyon, mx, mz, mHeight, mRadius, seed + i * 19 + side * 1000, materials,
          { preferGentle: false },
        );
      }
    }

    group.add(canyon);
  }

  /* <!--
    부드러운 곡선 프로파일로 단일 언덉 메쉬를 생성합니다.
    여러 봉우리를 cos² 곡선으로 합산해 납작한 구가 아닌 롤링 힐 형태를 만듭니다.
  --> */
  _buildSmoothHillGeometry(footprint, segments, bumps) {
    const size = footprint * 1.15;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    const pos = geo.attributes.position;
    const half = size * 0.5;

    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const ly = pos.getY(i);
      let h = 0;

      for (const b of bumps) {
        const dx = (lx - b.ox) / b.rx;
        const dz = (ly - b.oz) / b.rz;
        const r2 = dx * dx + dz * dz;
        if (r2 >= 1) continue;
        /* cos² 곡선: 경계에서 기울기 0 → 지면과 부드럽게 접합 */
        const t = Math.cos(r2 * Math.PI * 0.5);
        h += b.h * t * t;
      }

      /* 가장자리 페이드 — 클러스터 외곽이 지면과 매끈하게 이어지도록 */
      const edge = Math.max(Math.abs(lx) / half, Math.abs(ly) / half);
      if (edge > 0.78) {
        const fade = 1 - (edge - 0.78) / 0.22;
        h *= Math.max(0, fade * fade);
      }

      pos.setZ(i, h);
    }

    geo.computeVertexNormals();
    geo.rotateX(-Math.PI / 2);
    return geo;
  }

  _addNaturalHillCluster(group, x, z, seed, materials) {
    const r0 = this._terrainRand(seed + 1);
    const footprint = 190 + r0 * 320;
    const peakH = 85 + this._terrainRand(seed + 2) * 240;
    const bumpCount = 3 + Math.floor(this._terrainRand(seed + 3) * 4);
    const bumps = [];

    for (let b = 0; b < bumpCount; b++) {
      bumps.push({
        ox: (this._terrainRand(seed + b * 7.1) - 0.5) * footprint * 0.32,
        oz: (this._terrainRand(seed + b * 11.3) - 0.5) * footprint * 0.32,
        rx: footprint * (0.38 + this._terrainRand(seed + b * 5.2) * 0.22),
        rz: footprint * (0.38 + this._terrainRand(seed + b * 9.4) * 0.22),
        h: peakH * (0.5 + this._terrainRand(seed + b * 13.7) * 0.5),
      });
    }

    const hill = new THREE.Mesh(
      this._buildSmoothHillGeometry(footprint, 32, bumps),
      this._pickRockMaterial(materials, seed + 40),
    );
    const rotY = this._terrainRand(seed + 99) * Math.PI * 2;
    hill.position.set(x, GROUND_Y, z);
    hill.rotation.y = rotY;
    group.add(hill);

    this._registerTerrainCollider({
      kind: 'hill', x, z, footprint, bumps, rotY,
    });
  }

  /* <!-- 맵별 고유 지형지물: 프리셋 mapFeatures 목록을 3D 오브젝트로 생성합니다. --> */
  _createMapFeatures() {
    const group = new THREE.Group();
    group.name = 'map-features';
    const mats = this._getTerrainMaterials();
    const features = this._worldLayout?.mapFeatures || [];

    for (const feat of features) {
      switch (feat.type) {
        case 'mesa':
          this._addFeatureMesa(group, feat.x, feat.z, feat.seed, mats);
          break;
        case 'rockSpire':
        case 'cliffSpire':
          this._addFeatureRockSpire(group, feat.x, feat.z, feat.seed, mats, feat.type === 'cliffSpire');
          break;
        case 'oasis':
          this._addFeatureOasis(group, feat.x, feat.z, feat.seed, mats);
          break;
        case 'ruin':
          this._addFeatureRuin(group, feat.x, feat.z, feat.seed, mats);
          break;
        case 'jungleCluster':
          this._addFeatureJungleCluster(group, feat.x, feat.z, feat.seed, mats);
          break;
        case 'palmGrove':
          this._addFeaturePalmGrove(group, feat.x, feat.z, feat.seed, mats);
          break;
        case 'riverShallow':
          this._addFeatureRiverShallow(group, feat.x, feat.z, feat.seed, mats);
          break;
        case 'villageHut':
          this._addFeatureVillageHut(group, feat.x, feat.z, feat.seed, mats);
          break;
        case 'farmCluster':
          this._addFeatureFarmCluster(group, feat.x, feat.z, feat.seed, mats);
          break;
        case 'windmill':
          this._addFeatureWindmill(group, feat.x, feat.z, feat.seed, mats);
          break;
        case 'barnSilo':
          this._addFeatureBarnSilo(group, feat.x, feat.z, feat.seed, mats);
          break;
        case 'cropField':
          this._addFeatureCropField(group, feat.x, feat.z, feat.seed, mats);
          break;
        case 'snowPatch':
          this._addFeatureSnowPatch(group, feat.x, feat.z, feat.seed, mats);
          break;
        case 'watchTower':
          this._addFeatureWatchTower(group, feat.x, feat.z, feat.seed, mats);
          break;
        case 'ridgeLine':
          this._addFeatureRidgeLine(group, feat.x, feat.z, feat.seed, mats);
          break;
        default:
          break;
      }
    }

    return group;
  }

  _addFeatureMesa(group, x, z, seed, materials) {
    const h = (110 + this._terrainRand(seed) * 90) * (this._mapPreset?.peakHeightMul ?? 1);
    const r = (130 + this._terrainRand(seed + 1) * 70) * (this._mapPreset?.peakRadiusMul ?? 1);
    this._addRealisticMountain(group, x, z, h, r, seed + 800, materials, { preferGentle: true });
  }

  _addFeatureRockSpire(group, x, z, seed, materials, tall = false) {
    const h = (tall ? 260 : 200) + this._terrainRand(seed) * (tall ? 220 : 140);
    const r = 38 + this._terrainRand(seed + 1) * (tall ? 42 : 28);
    this._addRealisticMountain(group, x, z, h, r, seed + 5100, materials, { preferGentle: false });
  }

  _addFeatureOasis(group, x, z, seed, materials) {
    const radius = 28 + this._terrainRand(seed) * 22;
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 20),
      new THREE.MeshLambertMaterial({ color: 0x3a98b0, transparent: true, opacity: 0.88 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(x, GROUND_Y + 0.35, z);
    group.add(water);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.92, radius * 1.35, 24),
      new THREE.MeshLambertMaterial({ color: 0x6a9850 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, GROUND_Y + 0.2, z);
    group.add(ring);
    const palmCount = 3 + Math.floor(this._terrainRand(seed + 2) * 4);
    for (let p = 0; p < palmCount; p++) {
      const ang = (p / palmCount) * Math.PI * 2 + this._terrainRand(seed + p) * 0.8;
      const pr = radius * (0.55 + this._terrainRand(seed + p * 3) * 0.35);
      this._addSimplePalm(group, x + Math.cos(ang) * pr, z + Math.sin(ang) * pr, seed + p * 11);
    }
  }

  _addSimplePalm(group, x, z, seed) {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 1.2, 14 + this._terrainRand(seed) * 6, 6),
      new THREE.MeshLambertMaterial({ color: 0x6a5030 }),
    );
    trunk.position.set(x, GROUND_Y + 7, z);
    group.add(trunk);
    const leaves = new THREE.Mesh(
      new THREE.ConeGeometry(5 + this._terrainRand(seed + 1) * 3, 10, 6),
      new THREE.MeshLambertMaterial({ color: 0x3a7838 }),
    );
    leaves.position.set(x, GROUND_Y + 16, z);
    group.add(leaves);
  }

  _addFeatureRuin(group, x, z, seed, materials) {
    const ruin = new THREE.Group();
    const blockMat = this._pickRockMaterial(materials, seed + 60);
    const count = 2 + Math.floor(this._terrainRand(seed) * 3);
    for (let i = 0; i < count; i++) {
      const w = 8 + this._terrainRand(seed + i * 5) * 14;
      const h = 6 + this._terrainRand(seed + i * 7) * 18;
      const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.7), blockMat);
      block.position.set(
        (this._terrainRand(seed + i * 3) - 0.5) * 24,
        GROUND_Y + h * 0.5,
        (this._terrainRand(seed + i * 4) - 0.5) * 24,
      );
      block.rotation.y = this._terrainRand(seed + i * 9) * Math.PI;
      ruin.add(block);
    }
    ruin.position.set(x, 0, z);
    group.add(ruin);
  }

  _addFeatureJungleCluster(group, x, z, seed, materials) {
    const trees = 5 + Math.floor(this._terrainRand(seed) * 6);
    const vegMat = new THREE.MeshLambertMaterial({ color: 0x2a5828 });
    for (let t = 0; t < trees; t++) {
      const ox = (this._terrainRand(seed + t * 2.1) - 0.5) * 55;
      const oz = (this._terrainRand(seed + t * 3.3) - 0.5) * 55;
      const h = 12 + this._terrainRand(seed + t * 5) * 22;
      const tree = new THREE.Mesh(new THREE.ConeGeometry(4 + this._terrainRand(seed + t) * 3, h, 7), vegMat);
      tree.position.set(x + ox, GROUND_Y + h * 0.5, z + oz);
      group.add(tree);
    }
    this._addNaturalHillCluster(group, x, z, seed + 400, materials);
  }

  _addFeaturePalmGrove(group, x, z, seed, materials) {
    const n = 4 + Math.floor(this._terrainRand(seed) * 5);
    for (let i = 0; i < n; i++) {
      const ang = this._terrainRand(seed + i * 1.7) * Math.PI * 2;
      const r = 8 + this._terrainRand(seed + i * 2.3) * 28;
      this._addSimplePalm(group, x + Math.cos(ang) * r, z + Math.sin(ang) * r, seed + i * 13);
    }
  }

  _addFeatureRiverShallow(group, x, z, seed, materials) {
    const len = 80 + this._terrainRand(seed) * 120;
    const wid = 18 + this._terrainRand(seed + 1) * 14;
    const river = new THREE.Mesh(
      new THREE.PlaneGeometry(len, wid),
      new THREE.MeshLambertMaterial({ color: 0x4a8878, transparent: true, opacity: 0.75 }),
    );
    river.rotation.x = -Math.PI / 2;
    river.rotation.z = this._terrainRand(seed + 2) * Math.PI;
    river.position.set(x, GROUND_Y + 0.25, z);
    group.add(river);
  }

  _addFeatureVillageHut(group, x, z, seed, materials) {
    const hut = new THREE.Group();
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x8a6848 });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x5a4030 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(14, 8, 12), wallMat);
    body.position.y = GROUND_Y + 4;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(10, 6, 4), roofMat);
    roof.position.y = GROUND_Y + 11;
    roof.rotation.y = Math.PI * 0.25;
    hut.add(body, roof);
    hut.position.set(x, 0, z);
    hut.rotation.y = this._terrainRand(seed) * Math.PI * 2;
    group.add(hut);
  }

  _addFeatureFarmCluster(group, x, z, seed, materials) {
    this._addFeatureBarnSilo(group, x, z, seed, materials);
    this._addFeatureCropField(group, x + 28, z + 18, seed + 77, materials);
  }

  _addFeatureWindmill(group, x, z, seed, materials) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.8, 38, 8),
      new THREE.MeshLambertMaterial({ color: 0xd8d0c0 }),
    );
    pole.position.set(x, GROUND_Y + 19, z);
    group.add(pole);
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(28, 1.2, 3),
      new THREE.MeshLambertMaterial({ color: 0xf0ece0 }),
    );
    blade.position.set(x, GROUND_Y + 36, z);
    blade.rotation.y = this._terrainRand(seed) * Math.PI;
    group.add(blade);
    const blade2 = blade.clone();
    blade2.rotation.y += Math.PI * 0.5;
    group.add(blade2);
  }

  _addFeatureBarnSilo(group, x, z, seed, materials) {
    const barn = new THREE.Mesh(
      new THREE.BoxGeometry(22, 14, 16),
      new THREE.MeshLambertMaterial({ color: 0x8a3030 }),
    );
    barn.position.set(x - 8, GROUND_Y + 7, z);
    group.add(barn);
    const silo = new THREE.Mesh(
      new THREE.CylinderGeometry(5, 5, 22, 10),
      new THREE.MeshLambertMaterial({ color: 0xc8c0b0 }),
    );
    silo.position.set(x + 12, GROUND_Y + 11, z + 4);
    group.add(silo);
  }

  _addFeatureCropField(group, x, z, seed, materials) {
    const rows = 3 + Math.floor(this._terrainRand(seed) * 3);
    const cols = 4 + Math.floor(this._terrainRand(seed + 1) * 3);
    const patch = new THREE.Mesh(
      new THREE.PlaneGeometry(cols * 8, rows * 6),
      new THREE.MeshLambertMaterial({ color: 0x7a9848 }),
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(x, GROUND_Y + 0.15, z);
    patch.rotation.z = this._terrainRand(seed + 2) * 0.4;
    group.add(patch);
  }

  _addFeatureSnowPatch(group, x, z, seed, materials) {
    const snow = new THREE.Mesh(
      new THREE.CircleGeometry(35 + this._terrainRand(seed) * 40, 16),
      new THREE.MeshLambertMaterial({ color: 0xe8eef0 }),
    );
    snow.rotation.x = -Math.PI / 2;
    snow.position.set(x, GROUND_Y + 0.5, z);
    group.add(snow);
    this._addFeatureRockSpire(group, x, z, seed + 900, materials, true);
  }

  _addFeatureWatchTower(group, x, z, seed, materials) {
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(10, 28, 10),
      this._pickRockMaterial(materials, seed + 30),
    );
    base.position.set(x, GROUND_Y + 14, z);
    group.add(base);
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(14, 4, 14),
      new THREE.MeshLambertMaterial({ color: 0x505850 }),
    );
    top.position.set(x, GROUND_Y + 30, z);
    group.add(top);
  }

  _addFeatureRidgeLine(group, x, z, seed, materials) {
    const span = 120 + this._terrainRand(seed) * 100;
    const ang = this._terrainRand(seed + 1) * Math.PI;
    for (let i = -2; i <= 2; i++) {
      const ox = Math.cos(ang) * i * span * 0.35;
      const oz = Math.sin(ang) * i * span * 0.35;
      this._addNaturalHillCluster(group, x + ox, z + oz, seed + i * 41, materials);
    }
  }

  /* <!-- 도시·군사 기지: 지형과 같은 톤의 저폴리 건물군. 도시 건물은 충돌 시 사망. --> */
  _computeBaseMaxLength(seed) {
    const span = 180 + this._terrainRand(seed + 2) * 60;
    return span * 1.05;
  }

  _createSettlements() {
    const group = new THREE.Group();
    group.name = 'settlements';
    const mats = this._getTerrainMaterials();
    this._buildingColliders = [];

    for (const site of this._settlementSites || []) {
      if (site.type === 'city') this._addCity(group, site.x, site.z, site.seed, mats);
      else if (site.type === 'base') this._addMilitaryBase(group, site.x, site.z, site.seed, mats);
    }

    return group;
  }

  _registerBuildingCollider(city, lx, ly, lz, halfW, halfH, halfD) {
    this._buildingColliders.push({
      city, lx, ly, lz, halfW, halfH, halfD,
    });
  }

  /* <!-- 도시 건물 OBB: 기체 하부 샘플이 건물 부피와 겹칠 때만 즉사. --> */
  _checkBuildingCollision(p) {
    if (!this._buildingColliders?.length || !p.hullSamples?.length) return;

    const samples = this._getAircraftHullWorldSamples(p);

    for (const b of this._buildingColliders) {
      const rot = b.city.rotation.y;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const wx = b.city.position.x + b.lx * cos - b.lz * sin;
      const wz = b.city.position.z + b.lx * sin + b.lz * cos;
      const wy = b.ly;

      for (const pt of samples) {
        const dx = pt.x - wx;
        const dz = pt.z - wz;
        const localX = dx * cos + dz * sin;
        const localZ = -dx * sin + dz * cos;
        const localY = pt.y - wy;

        if (
          Math.abs(localX) <= b.halfW + CONTACT_EPSILON
          && Math.abs(localZ) <= b.halfD + CONTACT_EPSILON
          && localY <= b.halfH + CONTACT_EPSILON
          && localY >= -b.halfH - CONTACT_EPSILON
        ) {
          this._killPlayer(p, '건물 충돌');
          return;
        }
      }
    }
  }

  _addCity(group, x, z, seed, mats) {
    const city = new THREE.Group();
    city.name = 'city';
    const size = (300 + this._terrainRand(seed) * 140) * CITY_SIZE_SCALE;
    const rot = this._terrainRand(seed + 1) * Math.PI * 2;
    const half = size * 0.5;

    const pad = new THREE.Mesh(new THREE.PlaneGeometry(size * 1.35, size * 1.35), mats.asphalt);
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = GROUND_Y + 0.4;
    city.add(pad);

    const suburbPad = new THREE.Mesh(new THREE.PlaneGeometry(size * 1.65, size * 1.65), mats.concrete);
    suburbPad.rotation.x = -Math.PI / 2;
    suburbPad.position.y = GROUND_Y + 0.2;
    city.add(suburbPad);

    const roadW = size * 0.06;
    const gridN = 4 + Math.floor(this._terrainRand(seed + 2) * 2);
    for (let g = 0; g <= gridN; g++) {
      const offset = -half + (g / gridN) * size;
      for (const [rw, rd, rx, rz] of [
        [roadW, size * 1.08, offset, 0],
        [size * 1.08, roadW, 0, offset],
      ]) {
        const road = new THREE.Mesh(new THREE.PlaneGeometry(rw, rd), mats.concrete);
        road.rotation.x = -Math.PI / 2;
        road.position.set(rx, GROUND_Y + 0.65, rz);
        city.add(road);
      }
    }

    const cellSize = size / gridN;
    let towerCount = 0;
    const maxTowers = 4 + Math.floor(this._terrainRand(seed + 3) * 3);

    for (let gx = 0; gx < gridN; gx++) {
      for (let gz = 0; gz < gridN; gz++) {
        const cellSeed = seed + gx * 41 + gz * 67;
        const buildingsInCell = 2 + Math.floor(this._terrainRand(cellSeed) * 3);

        for (let b = 0; b < buildingsInCell; b++) {
          const bx = -half + (gx + 0.15 + this._terrainRand(cellSeed + b * 5) * 0.7) * cellSize;
          const bz = -half + (gz + 0.15 + this._terrainRand(cellSeed + b * 9) * 0.7) * cellSize;

          const bw = 16 + this._terrainRand(cellSeed + b * 7) * 24;
          const bd = 16 + this._terrainRand(cellSeed + b * 11) * 24;
          let bh = 18 + this._terrainRand(cellSeed + b * 13) * 55;
          const isTower = towerCount < maxTowers && this._terrainRand(cellSeed + b * 17) > 0.72;
          if (isTower) {
            bh = 55 + this._terrainRand(cellSeed + b * 19) * 75;
            towerCount += 1;
          }
          const bMat = isTower ? mats.buildingDark : mats.building;

          const body = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), bMat);
          body.position.set(bx, GROUND_Y + bh * 0.5 + 0.5, bz);
          city.add(body);
          this._registerBuildingCollider(
            city, bx, GROUND_Y + bh * 0.5 + 0.5, bz,
            bw * 0.5, (bh + 2.2) * 0.5, bd * 0.5,
          );

          const roof = new THREE.Mesh(
            new THREE.BoxGeometry(bw * 1.04, 2.2, bd * 1.04),
            mats.roof,
          );
          roof.position.set(bx, GROUND_Y + bh + 1.4, bz);
          city.add(roof);
        }
      }
    }

    const suburbBlocks = 28 + Math.floor(this._terrainRand(seed + 4) * 20);
    for (let i = 0; i < suburbBlocks; i++) {
      const angle = this._terrainRand(seed + i * 2.3) * Math.PI * 2;
      const dist = half * (1.05 + this._terrainRand(seed + i * 3.7) * 0.45);
      const bx = Math.cos(angle) * dist;
      const bz = Math.sin(angle) * dist;
      const bw = 10 + this._terrainRand(seed + i * 5) * 14;
      const bd = 10 + this._terrainRand(seed + i * 7) * 14;
      const bh = 8 + this._terrainRand(seed + i * 11) * 22;

      const body = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mats.building);
      body.position.set(bx, GROUND_Y + bh * 0.5 + 0.5, bz);
      city.add(body);
      this._registerBuildingCollider(
        city, bx, GROUND_Y + bh * 0.5 + 0.5, bz,
        bw * 0.5, (bh + 1.5) * 0.5, bd * 0.5,
      );
    }

    const plaza = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.18, size * 0.18), mats.concrete);
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(0, GROUND_Y + 0.75, 0);
    city.add(plaza);

    city.position.set(x, 0, z);
    city.rotation.y = rot;
    group.add(city);
  }

  _addMilitaryBase(group, x, z, seed, mats) {
    const base = new THREE.Group();
    base.name = 'military-base';
    const rot = this._terrainRand(seed + 1) * Math.PI * 2;
    const span = 180 + this._terrainRand(seed + 2) * 60;
    const baseMaxLen = span * 1.05;
    const reloadRadius = baseMaxLen * BASE_RELOAD_RADIUS_MUL;

    const apron = new THREE.Mesh(new THREE.PlaneGeometry(span * 1.15, span * 1.15), mats.asphalt);
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = GROUND_Y + 0.4;
    base.add(apron);

    const rwLen = span * 1.05;
    const rwW = span * 0.14;
    const runway = new THREE.Mesh(new THREE.PlaneGeometry(rwLen, rwW), mats.runway);
    runway.rotation.x = -Math.PI / 2;
    runway.position.set(0, GROUND_Y + 0.7, 0);
    base.add(runway);

    const hangarW = span * 0.38;
    const hangarH = 16 + this._terrainRand(seed + 3) * 8;
    const hangar = new THREE.Mesh(new THREE.BoxGeometry(hangarW, hangarH, span * 0.22), mats.hangar);
    hangar.position.set(-span * 0.28, GROUND_Y + hangarH * 0.5 + 0.5, -span * 0.22);
    base.add(hangar);

    const hangarRoof = new THREE.Mesh(
      new THREE.CylinderGeometry(hangarW * 0.52, hangarW * 0.52, span * 0.24, 10, 1, false, 0, Math.PI),
      mats.roof,
    );
    hangarRoof.rotation.z = Math.PI / 2;
    hangarRoof.rotation.y = Math.PI / 2;
    hangarRoof.position.set(-span * 0.28, GROUND_Y + hangarH + 0.5, -span * 0.22);
    base.add(hangarRoof);

    const barracks = 3 + Math.floor(this._terrainRand(seed + 4) * 3);
    for (let i = 0; i < barracks; i++) {
      const bx = span * 0.22 + this._terrainRand(seed + i * 9) * span * 0.28;
      const bz = (this._terrainRand(seed + i * 13) - 0.5) * span * 0.55;
      const bw = 18 + this._terrainRand(seed + i * 7) * 10;
      const bh = 8 + this._terrainRand(seed + i * 11) * 6;
      const block = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 14), mats.buildingDark);
      block.position.set(bx, GROUND_Y + bh * 0.5 + 0.5, bz);
      base.add(block);
    }

    const towerH = 28 + this._terrainRand(seed + 5) * 14;
    const tower = new THREE.Mesh(new THREE.BoxGeometry(8, towerH, 8), mats.tower);
    tower.position.set(span * 0.32, GROUND_Y + towerH * 0.5 + 0.5, span * 0.28);
    base.add(tower);

    const radar = new THREE.Mesh(new THREE.ConeGeometry(5, 3, 8), mats.concrete);
    radar.rotation.x = Math.PI / 2;
    radar.position.set(span * 0.32, GROUND_Y + towerH + 2, span * 0.28);
    base.add(radar);

    const fenceH = 3.5;
    const fenceSegs = 4;
    for (let f = 0; f < fenceSegs; f++) {
      const t = f / fenceSegs;
      const angle = t * Math.PI * 2;
      const fx = Math.cos(angle) * span * 0.58;
      const fz = Math.sin(angle) * span * 0.58;
      const fence = new THREE.Mesh(new THREE.BoxGeometry(span * 0.5, fenceH, 0.5), mats.fence);
      fence.position.set(fx, GROUND_Y + fenceH * 0.5, fz);
      fence.rotation.y = -angle + Math.PI / 2;
      base.add(fence);
    }

    /* <!-- 재장전 구역(반지름 5r) 표시: 기지 중심 원형 링 --> */
    const reloadRing = new THREE.Mesh(
      new THREE.RingGeometry(reloadRadius - 10, reloadRadius, 72),
      new THREE.MeshBasicMaterial({
        color: 0x7a9a62,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    reloadRing.rotation.x = -Math.PI / 2;
    reloadRing.position.y = GROUND_Y + 1.4;
    base.add(reloadRing);

    base.position.set(x, 0, z);
    base.rotation.y = rot;
    group.add(base);
  }

  /* <!-- 월드 경계: 파란 격자 방벽. 시각·충돌 판정은 WORLD_RADIUS 기준. --> */
  _createBoundaryWalls() {
    const group = new THREE.Group();
    group.name = 'boundaries';

    const barrierMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uGrid: { value: 40.0 },
        uFill: { value: new THREE.Color(0x1a4a8a) },
        uLine: { value: new THREE.Color(0x66ccff) },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        varying vec3 vWorldPos;
        uniform float uGrid;
        uniform vec3 uFill;
        uniform vec3 uLine;
        float gridLine(vec2 xz, float cell) {
          vec2 uv = xz / cell;
          vec2 g = abs(fract(uv - 0.5) - 0.5) / fwidth(uv);
          return 1.0 - min(min(g.x, g.y), 1.0);
        }
        void main() {
          vec2 xz = vWorldPos.xz;
          float g = max(gridLine(xz, uGrid), gridLine(xz, uGrid * 5.0) * 0.55);
          vec3 col = mix(uFill, uLine, smoothstep(0.55, 1.0, g));
          float alpha = 0.42 + g * 0.48;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    const half = WORLD_RADIUS;
    const h = BOUNDARY_HEIGHT;
    const yMid = GROUND_Y + h * 0.5;
    const span = half * 2;
    const specs = [
      { x: half, z: 0, ry: Math.PI / 2 },
      { x: -half, z: 0, ry: Math.PI / 2 },
      { x: 0, z: half, ry: 0 },
      { x: 0, z: -half, ry: 0 },
    ];
    specs.forEach(({ x, z, ry }) => {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(span, h, 1, 1), barrierMat);
      wall.position.set(x, yMid, z);
      wall.rotation.y = ry;
      group.add(wall);
    });

    return group;
  }

  /* ====================== 플레이어 ====================== */
  _isOnlinePvP() {
    return this._battleMode === 'online';
  }

  _getEnemyMax() {
    return this._isOnlinePvP() ? ONLINE_ENEMY_MAX : ENEMY_MAX;
  }

  _getLocalPlayer() {
    return this._players?.find((pl) => !pl.isRemote) ?? this._player;
  }

  _getRemotePlayer() {
    return this._players?.find((pl) => pl.isRemote) ?? null;
  }

  _bindNetworkHandlers() {
    if (!this._net) return;
    this._netUnsubs = [
      this._net.on('relay', (msg) => this._onNetRelay(msg)),
      this._net.on('opponent_left', () => {
        if (!this._session?.ended) this._endSession('상대 퇴장 · 승리!', 'multi_win');
      }),
    ];
  }

  _onNetRelay({ payload }) {
    const remote = this._getRemotePlayer();
    if (!remote || !payload) return;
    if (payload.kind === 'state') {
      this._applyRemoteState(remote, payload);
    } else if (payload.kind === 'hit') {
      const local = this._getLocalPlayer();
      if (local) {
        this._showMgHitFeedback('taken');
        this._damagePlayer(local, payload.damage || 0, { fromNetwork: true });
      }
    }
  }

  _applyRemoteState(p, data) {
    if (!p._netTarget) {
      p._netTarget = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    }
    p._netTarget.pos.set(data.x, data.y, data.z);
    p._netTarget.quat.set(data.qx, data.qy, data.qz, data.qw);
    p.hp = data.hp;
    if (data.speed != null) p.speed = data.speed;
    if (p.hp <= 0) p.mesh.visible = false;
    if (data.hp <= 0) this._checkOnlineVictory();
  }

  _interpolateRemotePlayer(dt) {
    const p = this._getRemotePlayer();
    if (!p?._netTarget) return;
    p.mesh.position.lerp(p._netTarget.pos, Math.min(1, 12 * dt));
    p.mesh.quaternion.slerp(p._netTarget.quat, Math.min(1, 10 * dt));
  }

  _sendNetworkState() {
    const p = this._getLocalPlayer();
    if (!this._net || !p || p.hp <= 0) return;
    const q = p.mesh.quaternion;
    this._net.sendRelay({
      kind: 'state',
      x: p.mesh.position.x,
      y: p.mesh.position.y,
      z: p.mesh.position.z,
      qx: q.x,
      qy: q.y,
      qz: q.z,
      qw: q.w,
      hp: p.hp,
      speed: p.speed,
    });
  }

  _relayHit(damage) {
    if (this._isOnlinePvP() && this._net) {
      this._net.sendRelay({ kind: 'hit', damage });
    }
  }

  _getPlayerById(id) {
    return this._players?.find((pl) => pl.id === id) ?? null;
  }

  _getAlivePlayers() {
    return (this._players ?? []).filter((pl) => pl.hp > 0);
  }

  _isHumanPlayer(target) {
    return !!target?.id && (!!target.controls || target.isRemote);
  }

  /* <!-- 팀전: 플레이어·아군 AI 모두 적군의 교전 대상입니다. --> */
  _isFriendlyCombatant(target) {
    if (!target) return false;
    if (this._isHumanPlayer(target)) return true;
    return this._allies?.has(target) ?? false;
  }

  _isPlayerOwner(owner) {
    return owner === 'p1' || owner === 'p2';
  }

  _isLocalPlayerOwner(owner) {
    const local = this._getLocalPlayer();
    return !!local && local.id === owner;
  }

  _usesReticleMgHit(p) {
    return !!p && !p.isRemote;
  }

  _getMgAimRadiusPx(p) {
    return (p.pursuitActive && !this._isOnlinePvP())
      ? MG_AIM_RADIUS_PURSUIT_PX
      : MG_AIM_RADIUS_PX;
  }

  _getMgAimScreenCenter(p, out = { x: 0, y: 0, w: 0, h: 0 }) {
    const w = this._canvas?.clientWidth || window.innerWidth;
    const h = this._canvas?.clientHeight || window.innerHeight;
    const usePursuit = p.pursuitActive && !this._isOnlinePvP();
    out.w = w;
    out.h = h;
    out.x = w * 0.5 + (usePursuit ? (p.pursuitAimX ?? 0) : 0);
    out.y = h * 0.5 + (usePursuit ? (p.pursuitAimY ?? 0) : 0);
    return out;
  }

  _ensureMgAimScratch() {
    if (this._mgAimScratch) return this._mgAimScratch;
    this._mgAimScratch = {
      ndc: new THREE.Vector2(),
      center: { x: 0, y: 0, w: 0, h: 0 },
      screen: { x: 0, y: 0 },
      toTarget: new THREE.Vector3(),
      camFwd: new THREE.Vector3(),
      dir: new THREE.Vector3(),
    };
    return this._mgAimScratch;
  }

  _getMgAimDirection(p, out = new THREE.Vector3()) {
    const s = this._ensureMgAimScratch();
    const center = this._getMgAimScreenCenter(p, s.center);
    s.ndc.set((center.x / center.w) * 2 - 1, -(center.y / center.h) * 2 + 1);
    if (!this._pursuitRaycaster) this._pursuitRaycaster = new THREE.Raycaster();
    this._pursuitRaycaster.setFromCamera(s.ndc, this._camera);
    return out.copy(this._pursuitRaycaster.ray.direction).normalize();
  }

  _projectWorldToScreenPx(worldPos, out) {
    const s = this._ensureMgAimScratch();
    s.toTarget.copy(worldPos);
    s.toTarget.project(this._camera);
    const w = this._canvas?.clientWidth || window.innerWidth;
    const h = this._canvas?.clientHeight || window.innerHeight;
    out.x = (s.toTarget.x * 0.5 + 0.5) * w;
    out.y = (-s.toTarget.y * 0.5 + 0.5) * h;
    return s.toTarget.z;
  }

  _isWorldPointInMgReticle(p, worldPos, radiusPx) {
    if (p.mesh.position.distanceTo(worldPos) > MG_RETICLE_MAX_RANGE) return false;
    const s = this._ensureMgAimScratch();
    this._camera.getWorldDirection(s.camFwd);
    s.toTarget.copy(worldPos).sub(this._camera.position);
    if (s.toTarget.dot(s.camFwd) <= 0) return false;
    if (this._projectWorldToScreenPx(worldPos, s.screen) > MG_AIM_DEPTH_NDC_MAX) return false;
    const center = this._getMgAimScreenCenter(p, s.center);
    const dx = s.screen.x - center.x;
    const dy = s.screen.y - center.y;
    return (dx * dx + dy * dy) <= radiusPx * radiusPx;
  }

  /* <!-- 기관총 조준: 기체 중심·동체·날개 등 복수 샘플로 판정을 넓힙니다. --> */
  _forEachMgAimSamplePoints(combatant, cb) {
    const mesh = combatant?.mesh;
    if (!mesh || typeof cb !== 'function') return;
    const s = this._ensureMgAimScratch();
    cb(mesh.position);
    const hull = combatant.hullSamples;
    if (Array.isArray(hull) && hull.length) {
      for (const local of hull) {
        s.toTarget.copy(local).applyMatrix4(mesh.matrixWorld);
        cb(s.toTarget);
      }
      return;
    }
    const offsets = [
      [0, 0, 2.2], [0, 0, 0.8], [0, 0, -0.6],
      [-2.4, 0, 0.4], [2.4, 0, 0.4], [0, 0.55, 0.6], [0, -0.25, 0.35],
    ];
    for (const off of offsets) {
      s.toTarget.set(off[0], off[1], off[2]).applyMatrix4(mesh.matrixWorld);
      cb(s.toTarget);
    }
  }

  _findMgReticleTarget(p) {
    const radius = this._getMgAimRadiusPx(p);
    const s = this._ensureMgAimScratch();
    const center = this._getMgAimScreenCenter(p, s.center);
    let best = null;
    let bestDistSq = Infinity;
    let bestPos = null;
    let bestKind = null;

    const consider = (target, kind, worldPos) => {
      if (!this._isWorldPointInMgReticle(p, worldPos, radius)) return;
      this._projectWorldToScreenPx(worldPos, s.screen);
      const dx = s.screen.x - center.x;
      const dy = s.screen.y - center.y;
      const distSq = dx * dx + dy * dy;
      if (distSq >= bestDistSq) return;
      bestDistSq = distSq;
      best = target;
      bestPos = worldPos;
      bestKind = kind;
    };

    for (const enemy of this._enemies ?? []) {
      if (enemy.hp <= 0) continue;
      this._forEachMgAimSamplePoints(enemy, (pos) => consider(enemy, 'enemy', pos));
    }
    for (const victim of this._players ?? []) {
      if (victim.id === p.id || victim.hp <= 0) continue;
      this._forEachMgAimSamplePoints(victim, (pos) => consider(victim, 'player', pos));
    }

    if (!best) return null;
    return { target: best, kind: bestKind, position: bestPos };
  }

  /* <!-- 기관총: 조준 원 안 적중 판정 --> */
  _applyReticleMgHit(p, damage) {
    const hit = this._findMgReticleTarget(p);
    if (!hit) return false;

    if (hit.kind === 'enemy') {
      const mgHit = hit.target.maxHp / ENEMY_MG_MAX_HITS;
      hit.target.hp -= mgHit;
      this._showMgHitFeedback('dealt', hit.position);
      this._session.score += 5;
      if (hit.target.hp <= 0) this._killEnemy(hit.target);
      return true;
    }

    this._showMgHitFeedback('dealt', hit.position);
    if (hit.target.isRemote) {
      this._relayHit(hit.target.maxHp / PLAYER_MG_MAX_HITS);
      this._session.score += 25;
    } else {
      this._damagePlayerFromMG(hit.target);
      this._session.score += 25;
    }
    return true;
  }

  /* <!-- 기관총 적중/피격 HUD·스파크 피드백 --> */
  _showMgHitFeedback(kind, worldPos = null) {
    if (kind === 'dealt') {
      this._mgHitDealtTimer = 0.24;
      const wrap = this._hudEls.mgHitMarkerWrap;
      wrap?.classList.remove('hidden');
      wrap?.classList.remove('active');
      void wrap?.offsetWidth;
      wrap?.classList.add('active');
      this._syncMgHitMarkerPosition();
      if (worldPos) this._spawnMgImpactSpark(worldPos);
    } else if (kind === 'taken') {
      this._mgHitTakenTimer = 0.5;
      const el = this._hudEls.mgHitReceived;
      el?.classList.remove('hidden');
      el?.classList.remove('active');
      void el?.offsetWidth;
      el?.classList.add('active');
      this._hud?.classList.add('mg-hit-flash');
    }
  }

  _syncMgHitMarkerPosition() {
    const wrap = this._hudEls.mgHitMarkerWrap;
    const p = this._player;
    if (!wrap) return;
    if (p?.pursuitActive) {
      wrap.style.transform = `translate(calc(-50% + ${p.pursuitAimX ?? 0}px), calc(-50% + ${p.pursuitAimY ?? 0}px))`;
      return;
    }
    wrap.style.transform = 'translate(-50%, -50%)';
  }

  _spawnMgImpactSpark(position) {
    const spark = this._explosionPool.acquire();
    spark.position.copy(position);
    spark.scale.setScalar(0.15);
    spark.material.color.setHex(0xffd866);
    spark.material.opacity = 0.92;
    spark.userData.life = 0;
    spark.userData.maxLife = 0.16;
    spark.userData.targetScale = 2.4;
    spark.visible = true;
  }

  _updateMgHitFeedback(dt) {
    if (this._mgHitDealtTimer > 0) {
      this._mgHitDealtTimer = Math.max(0, this._mgHitDealtTimer - dt);
      if (this._mgHitDealtTimer <= 0) {
        this._hudEls.mgHitMarkerWrap?.classList.remove('active');
        this._hudEls.mgHitMarkerWrap?.classList.add('hidden');
      }
    }
    if (this._mgHitTakenTimer > 0) {
      this._mgHitTakenTimer = Math.max(0, this._mgHitTakenTimer - dt);
      if (this._mgHitTakenTimer <= 0) {
        this._hudEls.mgHitReceived?.classList.remove('active');
        this._hudEls.mgHitReceived?.classList.add('hidden');
        this._hud?.classList.remove('mg-hit-flash');
      }
    }
  }

  /* <!-- 구버전/캐시 JS가 _updateMultiHitFeedback 이름으로 호출하는 경우 호환 --> */
  _updateMultiHitFeedback(dt) {
    this._updateMgHitFeedback(dt);
  }

  _resolveP2FighterId() {
    const owned = GameState.ownedFighters;
    const p1 = GameState.equippedFighterId;
    const alt = owned.find((id) => id !== p1);
    return alt ?? p1;
  }

  _buildPlayerSlot(fighterId, { id, controls, label, spawn, rotY = Math.PI, isRemote = false, useUpgrades = true }) {
    let fighter = findFighter(fighterId);
    let upgrades = useUpgrades ? GameState.getUpgrade(fighter.id) : {};
    let final = computeFinalStats(fighter, upgrades);
    let turnRates = computeTurnRates(fighter, final);
    let speedLimits = this._computePlayerSpeedLimits(final.speed);
    let isRu = fighter.country === 'RU';
    let maxMgAmmo = isRu ? MG_AMMO_RU : MG_AMMO_DEFAULT;
    let mesh;
    try {
      mesh = buildAircraftMesh(fighter);
    } catch (err) {
      console.warn('[BattleManager] aircraft mesh build failed, using fallback:', err);
      const fallbackFighter = findFighter('fighter_001');
      try {
        fighter = fallbackFighter;
        upgrades = useUpgrades ? GameState.getUpgrade(fighter.id) : {};
        final = computeFinalStats(fighter, upgrades);
        turnRates = computeTurnRates(fighter, final);
        speedLimits = this._computePlayerSpeedLimits(final.speed);
        isRu = fighter.country === 'RU';
        maxMgAmmo = isRu ? MG_AMMO_RU : MG_AMMO_DEFAULT;
        mesh = buildAircraftMesh(fighter);
      } catch (fallbackErr) {
        if (typeof buildEmergencyAircraftMesh === 'function') {
          mesh = buildEmergencyAircraftMesh();
        } else {
          mesh = new THREE.Group();
          mesh.add(new THREE.Mesh(
            new THREE.BoxGeometry(0.8, 0.5, 4),
            new THREE.MeshLambertMaterial({ color: 0x8899aa }),
          ));
        }
      }
    }
    mesh.position.set(spawn[0], spawn[1], spawn[2]);
    mesh.rotation.set(0, rotY, 0);
    mesh.visible = true;

    let hullSamples = [new THREE.Vector3(0, -0.4, 0)];
    try {
      hullSamples = this._buildAircraftHullSamples(mesh);
    } catch (err) {
      console.warn('[BattleManager] hull sample bake failed, using fallback:', err);
    }

    const slot = {
      id,
      controls,
      label,
      isRemote,
      fighter,
      mesh,
      velocity: new THREE.Vector3(),
      speed: speedLimits.maxSpeed * 0.68,
      minSpeed: 0,
      maxSpeed: speedLimits.maxSpeed,
      boostSpeed: speedLimits.boostSpeed,
      cruiseMach: speedLimits.cruiseMach,
      boostMach: speedLimits.boostMach,
      throttle: 0.62,
      pitchRate: turnRates.pitchRate,
      rollRate: turnRates.rollRate,
      yawRate: turnRates.yawRate,
      angVel: { pitch: 0, roll: 0, yaw: 0 },
      cobra: null,
      cobraCooldown: 0,
      hp: 80 + final.armor * 1.0,
      maxHp: 80 + final.armor * 1.0,
      boost: 1,
      missiles: fighter.weapons.secondary,
      maxMissiles: fighter.weapons.secondary,
      flares: 12,
      maxFlares: 12,
      firepower: final.firepower,
      mgDamageMul: isRu ? MG_DAMAGE_MUL_RU : 1,
      mgAmmo: maxMgAmmo,
      maxMgAmmo,
      mgCooldown: 0,
      missileCooldown: 0,
      flareCooldown: 0,
      lockTarget: null,
      lockProgress: 0,
      pursuitLockEnemy: null,
      pursuitLockTimer: 0,
      pursuitReady: false,
      pursuitActive: false,
      pursuitTarget: null,
      pursuitSpeedBreakTimer: 0,
      pursuitActiveTimer: 0,
      pursuitAimX: 0,
      pursuitAimY: 0,
      mgTick: 0,
      hullSamples,
      baseReloadState: new Map(),
      baseReloadGauge: 0,
    };
    if (useUpgrades && !isRemote) {
      this._applyKmBuffToSlot(slot, final, speedLimits);
    }
    return slot;
  }

  /* <!--
    군사기지 5r 원 안 4초 체류마다 1회 보급. 우선순위: 미사일(+1) → 체력(+10) → 기관총(+10).
  --> */
  _playerNeedsBaseReload(p) {
    return p.missiles < p.maxMissiles || p.hp < p.maxHp || p.mgAmmo < p.maxMgAmmo;
  }

  _applyBaseReloadTick(p) {
    if (p.missiles < p.maxMissiles) {
      p.missiles += 1;
    } else if (p.hp < p.maxHp) {
      p.hp = Math.min(p.maxHp, p.hp + BASE_RELOAD_HP_STEP);
    } else if (p.mgAmmo < p.maxMgAmmo) {
      p.mgAmmo = Math.min(p.maxMgAmmo, p.mgAmmo + BASE_RELOAD_MG_STEP);
    }
  }

  _updateBaseReload(p, dt) {
    if (!p || p.isRemote || p.hp <= 0) return;

    const bases = this._settlementSites?.filter((s) => s.type === 'base' && s.baseMaxLen > 0) || [];
    const pos = p.mesh.position;
    let gauge = 0;
    let inZone = false;

    for (const base of bases) {
      const key = `${Math.round(base.x)}:${Math.round(base.z)}`;
      const reloadRadius = base.baseMaxLen * BASE_RELOAD_RADIUS_MUL;
      const dist = Math.hypot(pos.x - base.x, pos.z - base.z);
      const inside = dist <= reloadRadius;

      if (!inside) {
        p.baseReloadState.delete(key);
        continue;
      }

      inZone = true;

      if (!this._playerNeedsBaseReload(p)) {
        p.baseReloadState.set(key, { timer: 0 });
        continue;
      }

      const state = p.baseReloadState.get(key) || { timer: 0 };
      const dwellSec = BASE_RELOAD_DWELL_SEC * (p.kmReloadMul ?? 1);
      state.timer += dt;
      if (state.timer >= dwellSec) {
        this._applyBaseReloadTick(p);
        state.timer = 0;
      }
      p.baseReloadState.set(key, state);
      gauge = Math.max(gauge, state.timer / dwellSec);
    }

    p.baseReloadGauge = inZone && this._playerNeedsBaseReload(p) ? gauge : 0;
  }

  _getPlayerMinSpeed(p) {
    return p.minSpeed || p.maxSpeed * MIN_SPEED_RATIO;
  }

  _getPlayerCruiseSpeed(p) {
    const min = this._getPlayerMinSpeed(p);
    return THREE.MathUtils.lerp(min, p.maxSpeed, THREE.MathUtils.clamp(p.throttle ?? 1, 0, 1));
  }

  _applyMissileHardLock(missile, target) {
    if (!target) return;
    missile.userData.hardLockTarget = target;
    missile.userData.hardLockTimer = MISSILE_HARD_LOCK_DURATION;
    missile.userData.hardLockLastPos = new THREE.Vector3();
    missile.userData.life = Math.max(missile.userData.life ?? 0, MISSILE_MAX_LIFE);
  }

  _resolveMissileTargetPos(missile) {
    const ht = missile.userData.hardLockTarget;
    if (!ht) return null;
    const pos = ht.mesh?.position ?? ht.position ?? null;
    if (pos) {
      missile.userData.hardLockLastPos.copy(pos);
      return missile.userData.hardLockLastPos;
    }
    return missile.userData.hardLockLastPos ?? null;
  }

  /* <!--
    적 미사일이 플레어 반경에 들어올 때 플레어당 1회 40% 확률로 유도를 시도합니다.
    여러 플레어가 동시에 성공하면 가장 가까운 플레어를 선택합니다.
  --> */
  _tryFlareLureMissile(missile) {
    if (missile.userData.lured) return;
    if ((missile.userData.hardLockTimer ?? 0) > 0) return;

    const owner = missile.userData.owner;
    const isEnemyMissile = owner === 'enemy';
    const isPlayerMissile = this._isPlayerOwner(owner);
    if (!isEnemyMissile && !isPlayerMissile) return;

    const target = missile.userData.hardLockTarget ?? missile.userData.target;
    if (isPlayerMissile && (!target || !this._enemies.has(target))) return;

    if (!missile.userData.flareChecked) missile.userData.flareChecked = new WeakSet();
    const checked = missile.userData.flareChecked;
    const radiusSq = FLARE_LURE_RADIUS * FLARE_LURE_RADIUS;
    const local = this._getLocalPlayer();
    const lureChance = isEnemyMissile
      ? (FLARE_LURE_CHANCE + (local?.kmFlareLureBonus ?? 0))
      : ENEMY_FLARE_LURE_CHANCE;
    let best = null;
    let bestSq = radiusSq;

    this._flarePool.forEachActive((flare) => {
      const d2 = missile.position.distanceToSquared(flare.position);
      if (d2 > radiusSq || checked.has(flare)) return;
      checked.add(flare);
      if (Math.random() >= lureChance) return;
      if (d2 < bestSq) {
        best = flare;
        bestSq = d2;
      }
    });

    if (best) {
      missile.userData.target = best;
      missile.userData.lured = true;
    }
  }

  /* <!--
    코브라 기동 중 추적 미사일이 접근하면 1회 판정.
    20%: 관성으로 기체를 앞질러 비껴 지나감(유도 해제), 80%: 정상 명중.
  --> */
  _tryCobraMissileEvade(missile) {
    if (missile.userData.overshot || missile.userData.cobraEvadeChecked) return;
    if (missile.userData.lured) return;

    const radiusSq = COBRA_MISSILE_CHECK_RADIUS * COBRA_MISSILE_CHECK_RADIUS;

    for (const victim of this._players ?? []) {
      if (victim.hp <= 0 || !victim.cobra) continue;
      if (!this._isMissileTrackingPlayer(missile, victim)) continue;
      if (!this._isHostileMissile(missile, victim)) continue;
      if (missile.position.distanceToSquared(victim.mesh.position) > radiusSq) continue;

      missile.userData.cobraEvadeChecked = true;
      if (Math.random() < COBRA_MISSILE_EVADE_CHANCE) {
        missile.userData.overshot = true;
        missile.userData.hardLockTarget = null;
        missile.userData.hardLockTimer = 0;
        missile.userData.target = null;
        const vel = missile.userData.velocity;
        if (vel.lengthSq() > 1) {
          vel.normalize().multiplyScalar(MISSILE_SPEED * 1.04);
        }
      }
      return;
    }
  }

  /* <!-- KM 미사일 회피: 적 미사일이 로컬 플레이어를 추적할 때 1회 회피 판정 --> */
  _tryKmBuffMissileEvade(missile) {
    if (missile.userData.overshot || missile.userData.kmEvadeChecked) return;
    if (missile.userData.lured) return;
    if (missile.userData.owner === 'player') return;

    const local = this._getLocalPlayer();
    if (!local || local.hp <= 0 || local.isRemote) return;
    const chance = local.kmMissileEvadeChance ?? 0;
    if (chance <= 0) return;
    if (!this._isHostileMissile(missile, local)) return;
    if (!this._missileThreatensPlayer(missile, local)) return;

    missile.userData.kmEvadeChecked = true;
    if (Math.random() >= chance) return;

    missile.userData.overshot = true;
    missile.userData.hardLockTarget = null;
    missile.userData.hardLockTimer = 0;
    missile.userData.target = null;
    const vel = missile.userData.velocity;
    if (vel?.lengthSq?.() > 1) {
      vel.normalize().multiplyScalar(MISSILE_SPEED * 1.06);
    }
  }

  _setupPlayers() {
    const spawns = {
      p1: { pos: [0, BATTLE_SPAWN_Y, 0], rotY: Math.PI },
      p2: { pos: [560, BATTLE_SPAWN_Y, 400], rotY: Math.PI * 0.72 },
    };

    if (this._isOnlinePvP()) {
      const slot = this._onlineInfo?.slot || 'p1';
      const remoteSlot = slot === 'p1' ? 'p2' : 'p1';
      const localSpawn = spawns[slot];
      const remoteSpawn = spawns[remoteSlot];
      this._players = [
        this._buildPlayerSlot(GameState.equippedFighterId, {
          id: slot,
          controls: 'p1',
          label: 'YOU',
          spawn: localSpawn.pos,
          rotY: localSpawn.rotY,
        }),
        this._buildPlayerSlot(this._onlineInfo?.opponentFighterId || 'fighter_001', {
          id: remoteSlot,
          controls: null,
          label: 'OPP',
          spawn: remoteSpawn.pos,
          rotY: remoteSpawn.rotY,
          isRemote: true,
          useUpgrades: false,
        }),
      ];
    } else {
      this._players = [
        this._buildPlayerSlot(GameState.equippedFighterId, {
          id: 'p1',
          controls: 'p1',
          label: 'P1',
          spawn: spawns.p1.pos,
          rotY: spawns.p1.rotY,
        }),
      ];
    }

    this._players.forEach((pl) => {
      pl.mesh.visible = true;
      this._scene.add(pl.mesh);
    });
    this._player = this._getLocalPlayer();
    if (!this._player) {
      console.error('[BattleManager] no local player after _setupPlayers');
      return;
    }
    this._initBattleCamera();
  }

  _setupPlayer() {
    this._setupPlayers();
  }

  _getCameraAnchor(out) {
    const local = this._getLocalPlayer();
    if (!local?.mesh) {
      out.set(0, BATTLE_SPAWN_Y, 0);
      return null;
    }
    if (!this._isOnlinePvP()) {
      out.copy(local.mesh.position);
      return local;
    }
    const alive = this._getAlivePlayers();
    if (!alive.length) {
      out.copy(local.mesh.position);
      return local;
    }
    out.set(0, 0, 0);
    alive.forEach((pl) => out.add(pl.mesh.position));
    out.divideScalar(alive.length);
    return alive[0];
  }

  /* ====================== 풀 (탄환/미사일/폭발) ====================== */
  _setupPools() {
    if (this._bulletPool) return;
    const bulletGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.6, 8);
    bulletGeo.rotateX(Math.PI / 2);
    const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffe27a });

    this._bulletPool = new ObjectPool(
      () => {
        const m = new THREE.Mesh(bulletGeo, bulletMat);
        m.visible = false;
        m.userData = { dir: new THREE.Vector3(), life: 0, damage: 0, owner: 'player', shooter: null };
        this._scene.add(m);
        return m;
      },
      (m) => { m.visible = false; m.userData.life = 0; m.userData.shooter = null; },
      40,
    );

    const missileGeo = new THREE.CapsuleGeometry(0.16, 1.4, 4, 8);
    missileGeo.rotateX(Math.PI / 2);
    this._missilePool = new ObjectPool(
      () => {
        const group = new THREE.Group();
        const body = new THREE.Mesh(missileGeo, new THREE.MeshStandardMaterial({ color: 0xdcdcdc, metalness: 0.5, roughness: 0.3 }));
        const flame = new THREE.Mesh(
          new THREE.ConeGeometry(0.18, 0.9, 8, 1, true),
          new THREE.MeshBasicMaterial({ color: 0xffa550, transparent: true, opacity: 0.85, depthWrite: false }),
        );
        flame.rotation.x = -Math.PI / 2;
        flame.position.z = -1.2;
        group.add(body);
        group.add(flame);
        group.visible = false;
        group.userData = { velocity: new THREE.Vector3(), target: null, life: 0, damage: 0, owner: 'player', flame, lured: false, shooter: null };
        this._scene.add(group);
        return group;
      },
      (m) => {
        m.visible = false;
        m.userData.target = null;
        m.userData.life = 0;
        m.userData.lured = false;
        m.userData.shooter = null;
        m.userData.hardLockTarget = null;
        m.userData.hardLockTimer = 0;
        m.userData.hardLockLastPos = null;
        m.userData.flareChecked = null;
        m.userData.lockedShot = false;
      },
      12,
    );

    this._explosionPool = new ObjectPool(
      () => {
        const mat = new THREE.MeshBasicMaterial({ color: 0xff9a45, transparent: true, opacity: 0.95, depthWrite: false });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 12), mat);
        mesh.visible = false;
        mesh.userData = { life: 0, maxLife: 0 };
        this._scene.add(mesh);
        return mesh;
      },
      (m) => { m.visible = false; m.userData.life = 0; m.scale.setScalar(1); m.material.opacity = 0.95; },
      8,
    );

    /* 플레어 풀: IR 디코이용 작은 발광체. 마테리얼은 개체별로 복제해
       페이드 아웃 시 다른 플레어와 opacity 가 공유되지 않도록 합니다. */
    const flareGeo = new THREE.SphereGeometry(0.45, 8, 6);
    this._flarePool = new ObjectPool(
      () => {
        const mat = new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 1.0, depthWrite: false });
        const mesh = new THREE.Mesh(flareGeo, mat);
        mesh.visible = false;
        mesh.userData = { velocity: new THREE.Vector3(), life: 0, maxLife: 2.6 };
        this._scene.add(mesh);
        return mesh;
      },
      (m) => { m.visible = false; m.userData.life = 0; m.scale.setScalar(1); m.material.opacity = 1.0; },
      24,
    );
  }

  /* ====================== 적 ====================== */
  _setupEnemies() {
    if (this._enemies?.size) return;
    this._enemies = new Set();
    /* 적기 색상 팔레트 풀: 모두 붉은 계열로 적군임을 식별 가능하게. */
    this._enemyPalettes = [
      { body: 0x8a2b2b, accent: 0xff6677, cockpit: 0x1a0606 },
      { body: 0x6b1f2c, accent: 0xff8a8a, cockpit: 0x140509 },
      { body: 0x4a2b2b, accent: 0xffa050, cockpit: 0x1a0a06 },
    ];
    this._enemyMesh = (palette, meshType) => {
      const fakeFighter = { modelName: 'Enemy', palette, meshType };
      const mesh = buildAircraftMesh(fakeFighter);
      mesh.scale.setScalar(0.95);
      return mesh;
    };
    for (let i = 0; i < this._getEnemyMax(); i++) this._spawnEnemy();
  }

  _spawnEnemy() {
    /* 적은 플레이어 주변 구체 표면에서 무작위 방향으로 등장합니다.
       메시 타입과 색상은 풀에서 무작위로 골라 시각적 다양성을 확보합니다. */
    const palette = this._enemyPalettes[Math.floor(Math.random() * this._enemyPalettes.length)];
    const meshType = ENEMY_MESH_TYPES[Math.floor(Math.random() * ENEMY_MESH_TYPES.length)];
    const fighterDef = findFighterByMeshType(meshType);
    const enemyTurn = computeTurnRates(fighterDef);
    const enemySpeedLimits = this._computePlayerSpeedLimits(fighterDef.stats.speed);
    const mesh = this._enemyMesh(palette, meshType);
    const dir = new THREE.Vector3(
      Math.random() - 0.5,
      (Math.random() - 0.5) * 0.4,
      Math.random() - 0.5,
    ).normalize();
    const origin = new THREE.Vector3();
    this._getCameraAnchor(origin);
    const battleY = Math.max(BATTLE_SPAWN_Y, origin.y);
    mesh.position.copy(origin).addScaledVector(dir, ENEMY_SPAWN_RADIUS + Math.random() * 200);
    mesh.position.y = battleY + (Math.random() - 0.5) * ENEMY_SPAWN_Y_SPREAD * 2;
    mesh.position.y = Math.max(ENEMY_SPAWN_MIN_Y, mesh.position.y);
    /* 기체 메시는 +Z가 노즈이므로 lookAt 대신 setFromUnitVectors로
       로컬 +Z 축을 플레이어 방향에 정확히 맞춥니다. */
    const initialDir = origin.clone().sub(mesh.position).normalize();
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), initialDir);

    const enemy = {
      mesh,
      fighterDef,
      hp: 30,
      maxHp: 30,
      speed: enemySpeedLimits.maxSpeed * (0.52 + Math.random() * 0.12),
      steerRate: enemyTurn.steerRate,
      fireCooldown: 1 + Math.random() * 2,
      missileCooldown: 6 + Math.random() * 6,
      missiles: fighterDef.weapons.secondary,
      maxMissiles: fighterDef.weapons.secondary,
      attackRange: 220,
      missileRange: 360,
      /* FFA(개인전): 적은 매 _updateEnemies 마다 타겟이 살아있는지 확인하고,
         retargetTimer 가 만료되면 가까운 후보(다른 적기/플레이어) 중 하나로 재선택. */
      target: null,
      retargetTimer: 0,
      lockTarget: null,
      lockProgress: 0,
      agility: fighterDef.stats.agility,
      statSpeed: fighterDef.stats.speed,
      maxSpeed: enemySpeedLimits.maxSpeed,
      prevBankRad: 0,
      evasiveTimer: 0,
      evasiveBoostTimer: 0,
      flares: 6 + Math.floor(Math.random() * 5),
      maxFlares: 10,
      flareCooldown: 0,
      radarTrack: null,
    };
    this._enemies.add(enemy);
    this._scene.add(mesh);
  }

  _killEnemy(enemy, { awardKill = true, respawn = true } = {}) {
    this._spawnExplosion(enemy.mesh.position, 8);
    this._scene.remove(enemy.mesh);
    enemy.mesh.traverse((o) => { o.geometry?.dispose?.(); });
    this._enemies.delete(enemy);
    this._players?.forEach((pl) => {
      if (pl.lockTarget === enemy) {
        pl.lockTarget = null;
        pl.lockProgress = 0;
      }
      if (pl.pursuitTarget === enemy || pl.pursuitLockEnemy === enemy) {
        this._endPursuit(pl, { force: true });
      }
    });
    if (awardKill) {
      this._session.kills += 1;
      this._session.score += 100;
    }
    /* 전투 중에는 즉시 보충해 밀도를 유지. 재시작/종료 시는 호출 측이 respawn=false 로 끕니다. */
    if (this._running && respawn && !this._session?.ended) this._spawnEnemy();
  }

  /* ====================== 아군 AI (팀전) ====================== */
  _setupAllies() {
    this._allies = new Set();
    this._allyPalettes = [
      { body: 0x3a5878, accent: 0x6ab0ff, cockpit: 0x0a1420 },
      { body: 0x2a4868, accent: 0x88c8ff, cockpit: 0x081018 },
      { body: 0x4a6890, accent: 0x5a98d8, cockpit: 0x0c1828 },
    ];
    this._allyMesh = (palette, meshType) => {
      const fakeFighter = { modelName: 'Ally', palette, meshType };
      const mesh = buildAircraftMesh(fakeFighter);
      mesh.scale.setScalar(0.95);
      return mesh;
    };
    for (let i = 0; i < ALLY_MAX; i++) this._spawnAlly(i);
  }

  _spawnAlly(slotIndex = 0) {
    const p = this._player;
    if (!p || !this._allies) return;
    const palette = this._allyPalettes[slotIndex % this._allyPalettes.length];
    const meshType = ENEMY_MESH_TYPES[slotIndex % ENEMY_MESH_TYPES.length];
    const fighterDef = findFighterByMeshType(meshType);
    const allyTurn = computeTurnRates(fighterDef);
    const speedLimits = this._computePlayerSpeedLimits(fighterDef.stats.speed);
    const mesh = this._allyMesh(palette, meshType);
    const ang = (slotIndex / ALLY_MAX) * Math.PI * 2 + 0.6;
    const spread = 90 + slotIndex * 35;
    mesh.position.set(
      p.mesh.position.x + Math.sin(ang) * spread,
      p.mesh.position.y + slotIndex * 8,
      p.mesh.position.z + Math.cos(ang) * spread,
    );
    const face = p.mesh.position.clone().sub(mesh.position).normalize();
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), face);

    const ally = {
      mesh,
      fighterDef,
      hp: 24,
      maxHp: 24,
      speed: speedLimits.maxSpeed * (0.62 + Math.random() * 0.1),
      steerRate: allyTurn.steerRate * 1.05,
      fireCooldown: 0.5 + Math.random(),
      attackRange: 220,
      target: null,
      retargetTimer: 0,
    };
    this._allies.add(ally);
    this._scene.add(mesh);
  }

  _killAlly(ally, { respawn = false } = {}) {
    if (!ally) return;
    this._spawnExplosion(ally.mesh.position, 8);
    this._scene.remove(ally.mesh);
    ally.mesh.traverse((o) => { o.geometry?.dispose?.(); });
    this._allies?.delete(ally);
    if (respawn && this._gameRules === 'team' && this._allies.size < ALLY_MAX) {
      this._spawnAlly(this._allies.size);
    }
  }

  _pickAllyTarget(ally) {
    const myPos = ally.mesh.position;
    let best = null;
    let bestScore = Infinity;
    const maxRange = 900;
    this._enemies.forEach((enemy) => {
      if (enemy.hp <= 0) return;
      const d = myPos.distanceTo(enemy.mesh.position);
      if (d >= maxRange) return;
      const score = d * (0.75 + Math.random() * 0.5);
      if (score < bestScore) { bestScore = score; best = enemy; }
    });
    return best;
  }

  _pickTeamHostileTarget(enemy) {
    const myPos = enemy.mesh.position;
    let best = null;
    let bestScore = Infinity;
    const maxRange = 900;
    const playerBias = 1.35;

    for (const pl of this._players ?? []) {
      if (pl.hp <= 0) continue;
      const d = myPos.distanceTo(pl.mesh.position);
      if (d < maxRange) {
        const score = d * (0.75 + Math.random() * 0.5) * playerBias;
        if (score < bestScore) { bestScore = score; best = pl; }
      }
    }
    this._allies?.forEach((ally) => {
      if (ally.hp <= 0) return;
      const d = myPos.distanceTo(ally.mesh.position);
      if (d >= maxRange) return;
      const score = d * (0.75 + Math.random() * 0.5) * 1.15;
      if (score < bestScore) { bestScore = score; best = ally; }
    });
    return best;
  }

  _updateAllies(dt) {
    if (this._gameRules !== 'team' || !this._allies?.size) return;
    this._allies.forEach((ally) => {
      ally.retargetTimer -= dt;
      if (ally.retargetTimer <= 0 || !ally.target || ally.target.hp <= 0) {
        ally.target = this._pickAllyTarget(ally);
        ally.retargetTimer = 2 + Math.random() * 3;
      }
      const target = ally.target;
      if (!target || target.hp <= 0) return;

      const toTarget = target.mesh.position.clone().sub(ally.mesh.position);
      const dist = toTarget.length();
      const desiredDir = toTarget.normalize();
      if (ally.mesh.position.y < BATTLE_SPAWN_Y - 35) {
        desiredDir.y = Math.max(desiredDir.y, 0.2);
        desiredDir.normalize();
      }

      this._steerEnemyToward(ally, desiredDir, dt, dist < DOGFIGHT_RANGE ? DOGFIGHT_STEER_MUL : 1);
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(ally.mesh.quaternion);
      ally.mesh.position.addScaledVector(forward, ally.speed * dt);

      ally.fireCooldown -= dt;
      const inDogfight = dist < DOGFIGHT_RANGE;
      const aligned = forward.dot(desiredDir) > (inDogfight ? DOGFIGHT_ALIGN_THRESHOLD : 0.93);
      if (aligned && dist < ally.attackRange && ally.fireCooldown <= 0) {
        this._allyFire(ally);
        ally.fireCooldown = (inDogfight ? 0.5 : 1.0) + Math.random() * (inDogfight ? 0.35 : 0.8);
      }
    });
  }

  _allyFire(ally) {
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(ally.mesh.quaternion);
    const bullet = this._bulletPool.acquire();
    bullet.position.copy(ally.mesh.position).addScaledVector(forward, 3);
    bullet.quaternion.copy(ally.mesh.quaternion);
    bullet.visible = true;
    bullet.userData.dir.copy(forward);
    bullet.userData.life = 2.2;
    bullet.userData.damage = 7;
    bullet.userData.owner = 'ally';
    bullet.userData.shooter = ally;
  }

  /* ====================== 세션 ====================== */
  _resetSession() {
    this._session = {
      kills: 0,
      score: 0,
      time: BATTLE_DURATION,
      ended: false,
    };
  }

  _restart() {
    /* 적/풀에 남아있는 활성 객체 제거 후 새 세션 시작 */
    Array.from(this._enemies ?? []).forEach((e) => this._killEnemy(e, { awardKill: false, respawn: false }));
    Array.from(this._allies ?? []).forEach((a) => this._killAlly(a, { respawn: false }));
    this._bulletPool.forEachActive((b) => this._bulletPool.release(b));
    this._missilePool.forEachActive((m) => this._missilePool.release(m));
    this._flarePool.forEachActive((f) => this._flarePool.release(f));
    this._explosionPool.forEachActive((m) => this._explosionPool.release(m));
    /* 플레이어 상태 갱신 (재출격 시 업그레이드 반영) */
    this._players?.forEach((pl) => this._scene.remove(pl.mesh));
    this._setupPlayers();
    this._resetSession();
    this._repairBattleState();
    this._initSwingWingState();
    for (let i = 0; i < this._getEnemyMax(); i++) this._spawnEnemy();
    if (this._gameRules === 'team') this._setupAllies();
    this._hudEls.modal.classList.add('hidden');
    this._hudEls.modal.classList.remove('battle-result-fullscreen');
    this._hud?.classList.remove('battle-ended');
    this._canvas.style.visibility = 'visible';
    this._lastTime = performance.now();
  }

  /* ====================== 메인 루프 ====================== */
  _loop = () => {
    if (!this._running) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this._lastTime) / 1000);
    this._lastTime = now;
    try {
      this._update(dt);
    } catch (err) {
      console.error('[BattleManager] update failed:', err);
    }
    try {
      if (this._scene && this._camera && this._renderer) {
        this._renderer.render(this._scene, this._camera);
      }
    } catch (err) {
      console.error('[BattleManager] render failed:', err);
    }
    this._raf = requestAnimationFrame(this._loop);
  };

  _update(dt) {
    /* 키 에지 감지: V 키가 새로 눌린 프레임에만 시점 전환. */
    const vDown = this._input.isDown('KeyV');
    if (vDown && !this._vWasDown && !this._isOnlinePvP()) {
      this._viewMode = (this._viewMode === 'first') ? 'third' : 'first';
      this._syncViewModeUI();
    }
    this._vWasDown = vDown;

    const cDown = this._input.isDown('KeyC');
    if (cDown && !this._cWasDown) this._tryStartCobra();
    this._cWasDown = cDown;

    const fDown = this._input.isDown('KeyF');
    if (fDown && !this._fWasDown) this._tryTogglePursuit();
    this._fWasDown = fDown;

    const gDown = this._input.isDown('KeyG');
    if (gDown && !this._gWasDown) this._tryToggleWingFold();
    this._gWasDown = gDown;

    if (this._session && !this._session.ended) {
      this._session.time = Math.max(0, this._session.time - dt);
      if (this._session.time <= 0) {
        if (this._isOnlinePvP()) this._endMultiplayerTimeout();
        else this._endSession('전투 종료', 'timeout');
      }
      this._syncActivePlayerRef();
      try {
        this._updatePlayers(dt);
        this._interpolateRemotePlayer(dt);
        this._updateLockOn(dt);
        if (!this._isOnlinePvP()) this._updatePursuitPrompt(dt);
        if (this._isOnlinePvP()) {
          this._netSendAcc += dt;
          if (this._netSendAcc >= NET_SEND_INTERVAL) {
            this._netSendAcc = 0;
            this._sendNetworkState();
          }
          this._checkOnlineVictory();
        }
        this._updateHostileLockOn(dt);
        this._updateBullets(dt);
        this._updateFlares(dt);
        this._updateMissiles(dt);
        this._updateEnemies(dt);
        if (this._gameRules === 'team') this._updateAllies(dt);
        this._updateExplosions(dt);
        this._updateSwingWings(dt);
      } catch (err) {
        console.warn('[BattleManager] combat update failed:', err);
      }
    }
    try {
      this._updateCamera(dt);
    } catch (err) {
      console.warn('[BattleManager] camera update failed:', err);
    }
    try {
      this._updateRadar();
    } catch (err) {
      console.warn('[BattleManager] radar update failed:', err);
    }
    try {
      this._updateMgHitFeedback(dt);
    } catch (err) {
      console.warn('[BattleManager] hit feedback update failed:', err);
    }
    try {
      this._updateHUD();
    } catch (err) {
      console.warn('[BattleManager] HUD update failed:', err);
    }
  }

  _getPlayerBankRad(p) {
    this._bankEuler.setFromQuaternion(p.mesh.quaternion, 'YXZ');
    return this._bankEuler.z;
  }

  _computeFlightAngularTargets(p, axes, turnMul = 1) {
    const rudder = axes.yaw;
    const aileron = axes.roll;
    const manualRoll = Math.abs(aileron) > 0;
    const bankRad = this._getPlayerBankRad(p);
    const maxAutoBank = THREE.MathUtils.degToRad(FBW_AUTO_BANK_DEG);

    let rollTarget = 0;
    if (manualRoll) {
      rollTarget = -aileron * p.rollRate * turnMul;
    } else if (rudder !== 0) {
      /* <!-- 러더 선회 시 자동 뱅크만 진행 방향과 반대로 기울입니다(에일러론 Q/E 는 그대로). --> */
      const targetBank = rudder * maxAutoBank;
      rollTarget = THREE.MathUtils.clamp(
        (targetBank - bankRad) * FBW_BANK_TRACK,
        -p.rollRate * 0.85 * turnMul,
        p.rollRate * 0.85 * turnMul,
      );
    } else if (Math.abs(bankRad) > 0.02) {
      rollTarget = THREE.MathUtils.clamp(
        -bankRad * FBW_LEVEL_TRACK,
        -p.rollRate * 0.45 * turnMul,
        p.rollRate * 0.45 * turnMul,
      );
    }

    const yawTarget = rudder !== 0
      ? -rudder * p.yawRate * FBW_RUDDER_YAW * turnMul
      : 0;

    return {
      pitchTarget: axes.pitch * p.pitchRate * turnMul,
      rollTarget,
      yawTarget,
    };
  }

  /* ====================== 플레이어 ====================== */
  _checkOnlineVictory() {
    if (!this._isOnlinePvP() || this._session?.ended) return;
    const local = this._getLocalPlayer();
    const remote = this._getRemotePlayer();
    if (remote?.hp <= 0 && local?.hp > 0) {
      this._endSession('승리!', 'multi_win');
    }
  }

  _updatePlayers(dt) {
    for (const p of this._getControllablePlayers()) {
      if (p.hp <= 0 || p.isRemote) continue;
      this._updateSinglePlayer(p, dt);
    }
  }

  _updateSinglePlayer(p, dt) {
    const axes = this._input.getFlightAxes(p.controls || 'p1');
    const wingMul = this._getWingFoldFlightMul(p);

    if (p.id === 'p1') {
      p.cobraCooldown = Math.max(0, p.cobraCooldown - dt);
    }

    if (p.pursuitActive && p.pursuitTarget && !p.cobra) {
      const pursuitEnded = this._updatePursuitFlight(p, dt, axes);
      if (pursuitEnded) {
        const target = p.pursuitTarget;
        const forceEnd = !target || target.hp <= 0 || !this._enemies.has(target);
        if (forceEnd || this._canEndPursuit(p)) {
          this._endPursuit(p, { force: forceEnd });
        }
      }
    } else if (p.id === 'p1' && p.cobra) {
      this._updateCobraManeuver(dt);
    } else {
      const { pitchTarget, rollTarget, yawTarget } = this._computeFlightAngularTargets(p, axes, wingMul.turnMul);
      const av = p.angVel;
      av.pitch = THREE.MathUtils.damp(av.pitch, pitchTarget, ANG_VEL_DAMP, dt);
      av.roll = THREE.MathUtils.damp(av.roll, rollTarget, ANG_VEL_DAMP, dt);
      av.yaw = THREE.MathUtils.damp(av.yaw, yawTarget, ANG_VEL_DAMP, dt);
      p.mesh.rotateX(av.pitch * dt);
      p.mesh.rotateZ(av.roll * dt);
      p.mesh.rotateOnWorldAxis(this._worldUp, av.yaw * dt);
    }

    if (p.pursuitActive && p.pursuitTarget && !p.cobra) {
      /* <!-- 추격 중: 속도·위치는 _updatePursuitFlight 에서 처리. --> */
    } else {
      const wantBoost = !(p.id === 'p1' && p.cobra) && axes.boost && p.boost > 0;
      if (axes.throttle) {
        p.throttle = THREE.MathUtils.clamp(
          (p.throttle ?? 0.62) + axes.throttle * THROTTLE_ADJUST_RATE * dt,
          0,
          1,
        );
      }
      const cruiseSpeed = this._getPlayerCruiseSpeed(p) * wingMul.speedMul;
      const cityFactor = this._getCitySpeedFactor(p);
      if (!p.cobra) {
        const targetSpeed = (wantBoost ? p.boostSpeed * wingMul.speedMul : cruiseSpeed) * cityFactor;
        p.speed = THREE.MathUtils.damp(p.speed, targetSpeed, 1.8, dt);
      }
      p.boost = THREE.MathUtils.clamp(p.boost + (wantBoost ? -0.18 : 0.08) * dt, 0, 1);

      if (p.cobra) {
        p.mesh.position.addScaledVector(p.cobra.pathForward, p.speed * dt);
        p.mesh.position.y = p.cobra.startY;
      } else {
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(p.mesh.quaternion);
        p.mesh.position.addScaledVector(forward, p.speed * dt);
      }
    }

    this._checkWorldBoundary(p);
    this._checkGroundCollision(p, dt);
    this._checkBuildingCollision(p);
    this._checkTerrainCollision(p);
    if (!p.isRemote) this._updateBaseReload(p, dt);

    p.mgCooldown -= dt;
    p.missileCooldown -= dt;
    p.flareCooldown -= dt;
    if (axes.fireMG && p.mgCooldown <= 0 && p.mgAmmo > 0) {
      this._fireMachineGun(p);
      p.mgCooldown = 0.08;
    }
    if (axes.fireMissile && p.missileCooldown <= 0 && p.missiles > 0) {
      this._fireMissile(p);
      p.missileCooldown = 0.5;
    }
    if (axes.fireFlare && p.flareCooldown <= 0 && p.flares > 0) {
      this._fireFlare(p);
      p.flareCooldown = 0.55;
    }

    if (!p.isRemote) {
      const k = (p.speed - p.maxSpeed * 0.6) / (p.boostSpeed - p.maxSpeed * 0.6);
      const pulse = 0.8 + Math.max(0, k) * 0.7 + Math.sin(performance.now() * 0.02) * 0.05;
      p.mesh.traverse((obj) => {
        if (obj.name === 'thrust') obj.scale.setScalar(pulse);
      });
    }
  }

  _updatePlayer(dt) {
    this._updatePlayers(dt);
  }

  _isSukhoiFighter() {
    return COBRA_FIGHTER_IDS.has(this._player?.fighter?.id);
  }

  _tryStartCobra() {
    const p = this._player;
    if (!p || !this._isSukhoiFighter()) return;
    if (p.cobra || p.cobraCooldown > 0 || p.hp <= 0) return;
    if (p.speed < COBRA_MIN_SPEED) return;
    const euler = new THREE.Euler().setFromQuaternion(p.mesh.quaternion, 'YXZ');
    if (euler.x > COBRA_MAX_START_DIVE) return;

    const pathForward = new THREE.Vector3(0, 0, 1).applyQuaternion(p.mesh.quaternion);
    pathForward.y = 0;
    if (pathForward.lengthSq() < 1e-4) {
      pathForward.set(Math.sin(euler.y), 0, Math.cos(euler.y)).normalize();
    } else {
      pathForward.normalize();
    }

    p.cobra = {
      phase: 'pitch_up',
      holdTimer: 0,
      pathForward,
      startY: p.mesh.position.y,
      entrySpeed: p.speed,
      stallSpeed: Math.max(COBRA_STALL_SPEED, p.speed * 0.32),
    };
    p.cobraCooldown = COBRA_COOLDOWN_SEC;
    p.angVel.pitch = 0;
    p.angVel.roll = 0;
    p.angVel.yaw = 0;
  }

  /* <!--
    푸가체프 코브라: 수평 관성 궤도는 유지하고 기수만 급격히 들어 올려 속도를 떨군 뒤,
    실속 직전에 기수를 내리고 원래 고도·진행 방향으로 복귀합니다.
  --> */
  _updateCobraManeuver(dt) {
    const p = this._player;
    const c = p.cobra;
    if (!c) return;

    const targetPitch = -COBRA_PITCH_UP_RAD;
    const pitch = new THREE.Euler().setFromQuaternion(p.mesh.quaternion, 'YXZ').x;
    const minSpeed = c.stallSpeed;

    if (c.phase === 'pitch_up') {
      if (pitch > targetPitch + 0.02) {
        const step = Math.min(COBRA_PITCH_RATE * dt, pitch - targetPitch);
        p.mesh.rotateX(-step);
      } else {
        c.phase = 'hold';
        c.holdTimer = COBRA_HOLD_SEC;
      }
      p.speed = Math.max(minSpeed, p.speed - COBRA_SPEED_BLEED * dt);
    } else if (c.phase === 'hold') {
      c.holdTimer -= dt;
      p.speed = Math.max(minSpeed, p.speed - COBRA_SPEED_BLEED * 0.35 * dt);
      if (c.holdTimer <= 0) c.phase = 'recover';
    } else {
      if (pitch < -0.05) {
        p.mesh.rotateX(Math.min(COBRA_RECOVER_RATE * dt, -pitch));
      } else {
        p.cobra = null;
      }
      p.speed = Math.max(minSpeed, p.speed - COBRA_SPEED_BLEED * 0.12 * dt);
    }
  }

  _fireMachineGun(p) {
    if (p.mgAmmo <= 0) return;
    p.mgAmmo -= 1;
    const damage = 8 * p.firepower * (p.mgDamageMul ?? 1);
    /* 좌/우 윙 팁에서 번갈아 발사. 로컬 플레이어는 조준 원 기준 적중. */
    const offsets = [new THREE.Vector3(-2.7, -0.05, 0.6), new THREE.Vector3(2.7, -0.05, 0.6)];
    p.mgTick = (p.mgTick + 1) % 2;
    const offset = offsets[p.mgTick];
    const origin = offset.clone().applyMatrix4(p.mesh.matrixWorld);

    let dir;
    if (this._usesReticleMgHit(p)) {
      dir = this._getMgAimDirection(p, this._ensureMgAimScratch().dir);
    } else {
      const spread = 0.012;
      dir = new THREE.Vector3(0, 0, 1)
        .applyQuaternion(p.mesh.quaternion)
        .addScaledVector(new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 0).applyQuaternion(p.mesh.quaternion), spread)
        .normalize();
    }

    const bullet = this._bulletPool.acquire();
    bullet.position.copy(origin);
    bullet.quaternion.copy(p.mesh.quaternion);
    bullet.visible = true;
    bullet.userData.dir.copy(dir);
    bullet.userData.life = 1.4;
    bullet.userData.damage = damage;
    bullet.userData.owner = p.id;
    bullet.userData.reticleOnly = this._usesReticleMgHit(p);

    if (this._usesReticleMgHit(p)) {
      this._applyReticleMgHit(p, damage);
    }
  }

  _getCombatantAgility(combatant) {
    if (combatant.fighter?.stats) {
      const up = GameState.getUpgrade(combatant.fighter.id);
      return computeFinalStats(combatant.fighter, up).agility;
    }
    return combatant.agility ?? combatant.fighterDef?.stats?.agility ?? 110;
  }

  _getCombatantStatSpeed(combatant) {
    if (combatant.fighter?.stats) {
      const up = GameState.getUpgrade(combatant.fighter.id);
      return computeFinalStats(combatant.fighter, up).speed;
    }
    return combatant.statSpeed ?? combatant.fighterDef?.stats?.speed ?? 140;
  }

  _updatePursuitPrompt(dt) {
    const p = this._player;
    if (!p || p.hp <= 0) {
      if (p?.hp <= 0) this._endPursuit(p, { force: true });
      return;
    }
    if (p.pursuitActive || p.cobra) return;

    const target = p.lockTarget;
    const locked = target
      && (p.lockProgress ?? 0) >= 1
      && target.hp > 0
      && this._enemies.has(target);

    if (locked) {
      if (p.pursuitLockEnemy === target) {
        p.pursuitLockTimer += dt;
      } else {
        p.pursuitLockEnemy = target;
        p.pursuitLockTimer = dt;
      }
      p.pursuitReady = p.pursuitLockTimer >= PURSUIT_LOCK_HOLD_SEC;
    } else {
      p.pursuitLockEnemy = null;
      p.pursuitLockTimer = 0;
      p.pursuitReady = false;
    }
  }

  _tryTogglePursuit() {
    const p = this._player;
    if (!p || p.hp <= 0 || p.cobra || this._isOnlinePvP()) return;

    if (p.pursuitActive) {
      if (!this._canEndPursuit(p)) return;
      this._endPursuit(p);
      return;
    }
    if (!p.pursuitReady || !p.pursuitLockEnemy || p.pursuitLockEnemy.hp <= 0) return;

    p.pursuitActive = true;
    p.pursuitTarget = p.pursuitLockEnemy;
    p.pursuitReady = false;
    p.pursuitSpeedBreakTimer = 0;
    p.pursuitLockTimer = 0;
    p.pursuitActiveTimer = 0;
    p.pursuitAimX = 0;
    p.pursuitAimY = 0;
    p.angVel.pitch = 0;
    p.angVel.roll = 0;
    p.angVel.yaw = 0;
    this._hudEls.pursuitScope?.classList.remove('hidden');
    this._syncPursuitScopePosition(p);
    this._viewBeforePursuit = this._viewMode ?? 'third';
    this._viewMode = 'first';
    this._syncViewModeUI();
  }

  _canEndPursuit(p, { force = false } = {}) {
    if (!p?.pursuitActive) return true;
    if (force) return true;
    return (p.pursuitActiveTimer ?? 0) >= PURSUIT_MIN_DURATION_SEC;
  }

  _endPursuit(p, { force = false } = {}) {
    if (!p) return;
    if (p.pursuitActive && !this._canEndPursuit(p, { force })) return;
    const wasActive = p.pursuitActive;
    p.pursuitActive = false;
    p.pursuitTarget = null;
    p.pursuitReady = false;
    p.pursuitLockEnemy = null;
    p.pursuitLockTimer = 0;
    p.pursuitSpeedBreakTimer = 0;
    p.pursuitActiveTimer = 0;
    p.pursuitAimX = 0;
    p.pursuitAimY = 0;
    this._hudEls.pursuitScope?.classList.add('hidden');
    if (wasActive && !this._isOnlinePvP()) {
      this._viewMode = this._viewBeforePursuit ?? 'third';
      this._players?.forEach((pl) => { if (pl.hp > 0) pl.mesh.visible = true; });
      this._syncViewModeUI();
    }
  }

  /* <!-- 전투기 최저 고도: 지면으로 떨구는 회피·추격 버그 방지. --> */
  _enforceCombatFloor(mesh, { pullUp = false } = {}) {
    if (!mesh || mesh.position.y >= COMBAT_FLOOR_Y) return;
    mesh.position.y = THREE.MathUtils.lerp(mesh.position.y, COMBAT_FLOOR_Y, 0.42);
    if (!pullUp) return;
    const pitch = new THREE.Euler().setFromQuaternion(mesh.quaternion, 'YXZ').x;
    if (pitch > -0.06) {
      mesh.rotateX(-Math.min(0.06, pitch + 0.1));
    }
  }

  _steerPlayerToward(p, desiredDir, dt, steerMul = 1) {
    if (!this._steerScratch) {
      this._steerScratch = {
        desiredQuat: new THREE.Quaternion(),
        nose: new THREE.Vector3(0, 0, 1),
      };
    }
    const s = this._steerScratch;
    s.desiredQuat.setFromUnitVectors(s.nose, desiredDir);
    const q = p.mesh.quaternion;
    const angle = q.angleTo(s.desiredQuat);
    const steerRate = (p.pitchRate + p.rollRate + p.yawRate) / 3;
    const step = steerRate * dt * steerMul;
    const alpha = angle > 1e-5 ? Math.min(1, step / angle) : 1;
    q.slerp(s.desiredQuat, alpha);
  }

  /* <!--
    추격 비행: 적 후방 슬롯을 추적하고, 화살표 키로 화면 조준경을 이동해 기관총을 조준합니다.
    최소 PURSUIT_MIN_DURATION_SEC 동안은 F·거리 이탈로 해제되지 않습니다.
  --> */
  _updatePursuitFlight(p, dt, axes = {}) {
    const enemy = p.pursuitTarget;
    if (!enemy || enemy.hp <= 0 || !this._enemies.has(enemy)) return true;

    p.pursuitActiveTimer = (p.pursuitActiveTimer ?? 0) + dt;
    this._updatePursuitAimScope(p, dt, axes);

    const distToEnemy = p.mesh.position.distanceTo(enemy.mesh.position);
    if (distToEnemy > PURSUIT_MAX_RANGE && this._canEndPursuit(p)) return true;

    if (!this._pursuitFlightScratch) {
      this._pursuitFlightScratch = {
        enemyFwd: new THREE.Vector3(),
        enemyVel: new THREE.Vector3(),
        slotPos: new THREE.Vector3(),
        toSlot: new THREE.Vector3(),
        forward: new THREE.Vector3(),
        blendDir: new THREE.Vector3(),
      };
    }
    const s = this._pursuitFlightScratch;
    s.enemyFwd.set(0, 0, 1).applyQuaternion(enemy.mesh.quaternion).normalize();
    s.enemyVel.copy(s.enemyFwd).multiplyScalar(enemy.speed ?? 0);
    s.slotPos.copy(enemy.mesh.position)
      .addScaledVector(s.enemyFwd, -PURSUIT_FOLLOW_DIST)
      .addScaledVector(s.enemyVel, 0.1);
    s.slotPos.y = Math.max(s.slotPos.y, COMBAT_FLOOR_Y + 10);
    s.toSlot.copy(s.slotPos).sub(p.mesh.position);
    const distToSlot = s.toSlot.length();
    const slotDir = distToSlot > 0.5 ? s.toSlot.normalize() : s.enemyFwd.clone();

    s.blendDir.copy(slotDir).lerp(s.enemyFwd, 0.22).normalize();

    const pAgi = this._getCombatantAgility(p);
    const eAgi = this._getCombatantAgility(enemy);
    const agiRatio = THREE.MathUtils.clamp(pAgi / Math.max(eAgi, 80), 0.72, 1.35);
    const trackMul = PURSUIT_TRACK_MUL * agiRatio;

    this._steerPlayerToward(p, s.blendDir, dt, trackMul);

    this._steerPlayerToward(p, s.blendDir, dt, PURSUIT_TRACK_CORRECT_MUL * agiRatio);

    const distErr = distToSlot - 5;
    let targetSpeed = (enemy.speed ?? p.speed) * THREE.MathUtils.clamp(1 + distErr * 0.011, 0.88, 1.08);
    const closingGap = distToEnemy - PURSUIT_FOLLOW_DIST;
    if (closingGap > 22 || distToSlot > PURSUIT_FOLLOW_DIST * 1.18) {
      targetSpeed = Math.max(targetSpeed, p.maxSpeed * 0.94);
      if (p.boost > 0.12) {
        targetSpeed = Math.max(targetSpeed, p.boostSpeed * 0.9);
        p.boost = Math.max(0, p.boost - 0.16 * dt);
      }
    } else {
      p.boost = THREE.MathUtils.clamp(p.boost + 0.05 * dt, 0, 1);
    }
    targetSpeed = Math.min(targetSpeed, p.boostSpeed * 0.98);
    p.speed = THREE.MathUtils.damp(p.speed, targetSpeed, 2.6, dt);

    s.forward.set(0, 0, 1).applyQuaternion(p.mesh.quaternion);
    p.mesh.position.addScaledVector(s.forward, p.speed * dt);
    this._enforceCombatFloor(p.mesh, { pullUp: true });

    return false;
  }

  _syncPursuitScopePosition(p) {
    const scope = this._hudEls.pursuitScope;
    if (!scope || !p) return;
    scope.style.transform = `translate(calc(-50% + ${p.pursuitAimX}px), calc(-50% + ${p.pursuitAimY}px))`;
  }

  /* <!-- 추격 조준: 화살표 키로 화면 중앙 원형 조준경을 이동합니다. --> */
  _updatePursuitAimScope(p, dt, axes = {}) {
    const move = PURSUIT_AIM_SPEED * dt;
    p.pursuitAimX = THREE.MathUtils.clamp(
      (p.pursuitAimX ?? 0) + axes.yaw * move,
      -PURSUIT_AIM_MAX,
      PURSUIT_AIM_MAX,
    );
    p.pursuitAimY = THREE.MathUtils.clamp(
      (p.pursuitAimY ?? 0) + axes.pitch * move,
      -PURSUIT_AIM_MAX,
      PURSUIT_AIM_MAX,
    );
    this._syncPursuitScopePosition(p);
  }

  _getPursuitAimDirection(out = new THREE.Vector3()) {
    const p = this._player;
    return this._getMgAimDirection(p, out);
  }

  _updatePursuitHUD() {
    const p = this._player;
    const prompt = this._hudEls.pursuitPrompt;
    const hud = this._hudEls.pursuitHud;
    const hint = this._hudEls.pursuitHint;
    if (!p || this._isOnlinePvP()) {
      prompt?.classList.add('hidden');
      hud?.classList.add('hidden');
      this._hudEls.pursuitScope?.classList.add('hidden');
      this._hud?.classList.remove('pursuit-active');
      return;
    }

    const active = !!p.pursuitActive;
    const ready = !active && !!p.pursuitReady;
    const charging = !active && !ready && p.pursuitLockTimer > 0 && p.pursuitLockEnemy;

    prompt?.classList.toggle('hidden', !ready);
    hud?.classList.toggle('hidden', !active && !charging);
    hud?.classList.toggle('active', active);
    hud?.classList.toggle('ready', ready);
    this._hud?.classList.toggle('pursuit-active', active);
    this._hudEls.pursuitScope?.classList.toggle('hidden', !active);

    if (hint) {
      if (active) {
        const left = Math.max(0, PURSUIT_MIN_DURATION_SEC - (p.pursuitActiveTimer ?? 0));
        hint.textContent = left > 0.05 ? `${left.toFixed(1)}s` : '[F] 해제';
      } else if (charging) {
        const left = Math.max(0, PURSUIT_LOCK_HOLD_SEC - p.pursuitLockTimer);
        hint.textContent = `${left.toFixed(1)}s`;
      } else hint.textContent = '[F]';
    }
  }

  _fireMissile(p) {
    p.missiles -= 1;
    const offset = (p.missiles % 2 === 0 ? new THREE.Vector3(-1.5, -0.2, 0.2) : new THREE.Vector3(1.5, -0.2, 0.2));
    const origin = offset.applyMatrix4(p.mesh.matrixWorld);

    const missile = this._missilePool.acquire();
    missile.position.copy(origin);
    missile.quaternion.copy(p.mesh.quaternion);
    missile.visible = true;
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(p.mesh.quaternion);
    missile.userData.velocity.copy(forward).multiplyScalar(MISSILE_SPEED);
    missile.userData.target = p.lockTarget;
    missile.userData.life = 5.5;
    missile.userData.damage = 35 * p.firepower;
    missile.userData.owner = p.id;
    missile.userData.hardLockTarget = null;
    missile.userData.hardLockTimer = 0;
    missile.userData.lockedShot = !!(p.lockTarget && p.lockProgress >= 1);
    if (p.lockTarget && p.lockProgress >= 1) {
      this._applyMissileHardLock(missile, p.lockTarget);
    }
  }

  /* <!--
    플레어(IR 디코이): 1회 입력 시 3발을 좌·우·아래 방향으로 산포합니다.
    적 호밍 미사일이 반경(≈40m) 안에 들어올 때 플레어당 40% 확률로 재유도됩니다.
  --> */
  _fireFlare(p) {
    if ((p.flares ?? 0) <= 0) return;
    p.flares -= 1;

    const back = new THREE.Vector3(0, 0, -1).applyQuaternion(p.mesh.quaternion);
    const up   = new THREE.Vector3(0, 1, 0 ).applyQuaternion(p.mesh.quaternion);
    const right= new THREE.Vector3(1, 0, 0 ).applyQuaternion(p.mesh.quaternion);
    const baseSpeed = Math.max(20, p.speed * 0.35);

    /* 좌·우·하 3방향으로 산포해 시각적으로도 클러스터처럼 보이게 함. */
    const spread = [
      right.clone().multiplyScalar(-1).add(up.clone().multiplyScalar(-0.2)),
      right.clone().multiplyScalar( 1).add(up.clone().multiplyScalar(-0.2)),
      up.clone().multiplyScalar(-1),
    ];

    for (const dir of spread) {
      const flare = this._flarePool.acquire();
      flare.position.copy(p.mesh.position).addScaledVector(back, 1.4);
      flare.visible = true;
      flare.material.opacity = 1.0;
      flare.scale.setScalar(1);
      flare.userData.life = 0;
      flare.userData.maxLife = 2.6;
      /* 후방 + 산포 방향으로 던짐. 절대 속도 = 기체속도의 일부 + 산포 속도. */
      flare.userData.velocity
        .copy(back).multiplyScalar(-baseSpeed * 0.4)
        .addScaledVector(dir.normalize(), 16);
    }
  }

  /* <!-- 추적 미사일이 접근 중인지 판정 (적·플레이어 플레어 대응용) --> */
  _hasIncomingMissileThreat(combatant) {
    if (!combatant?.mesh || !this._missilePool) return false;
    const threatRangeSq = ENEMY_FLARE_THREAT_RANGE * ENEMY_FLARE_THREAT_RANGE;
    let threatened = false;
    this._missilePool.forEachActive((missile) => {
      if (threatened) return;
      if (missile.userData.overshot || missile.userData.lured) return;
      const target = missile.userData.hardLockTarget ?? missile.userData.target;
      if (target !== combatant) return;
      if (missile.position.distanceToSquared(combatant.mesh.position) > threatRangeSq) return;
      threatened = true;
    });
    return threatened;
  }

  _tryEnemyDeployFlare(enemy, dt) {
    if (!enemy || enemy.hp <= 0) return;
    enemy.flareCooldown = Math.max(0, (enemy.flareCooldown ?? 0) - dt);
    if ((enemy.flares ?? 0) <= 0 || enemy.flareCooldown > 0) return;
    if (!this._hasIncomingMissileThreat(enemy)) return;
    if (Math.random() > 0.72) return;
    this._fireFlare(enemy);
    enemy.flareCooldown = 0.65 + Math.random() * 0.85;
  }

  _updateFlares(dt) {
    if (!this._flarePool) return;
    const gravity = -28;
    this._flarePool.forEachActive((flare) => {
      flare.userData.life += dt;
      const t = flare.userData.life / flare.userData.maxLife;
      if (t >= 1) { this._flarePool.release(flare); return; }
      /* 중력 + 항력 적용 */
      flare.userData.velocity.y += gravity * dt;
      flare.userData.velocity.multiplyScalar(1 - 0.6 * dt);
      flare.position.addScaledVector(flare.userData.velocity, dt);
      /* 시간이 갈수록 어두워지고 살짝 커짐 (소진되는 발광체 표현) */
      flare.material.opacity = Math.max(0, 1.0 - t);
      flare.scale.setScalar(1 + t * 0.8);
    });
  }

  /* ====================== 락온 ====================== */
  _updateLockOn(dt) {
    for (const p of this._players ?? []) {
      if (p.hp <= 0 || p.isRemote) {
        if (p.isRemote) continue;
        p.lockTarget = null;
        p.lockProgress = 0;
        continue;
      }
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(p.mesh.quaternion);
      const eye = p.mesh.position;
      let best = null;
      let bestScore = Infinity;
      const cone = Math.cos(THREE.MathUtils.degToRad(12));

      const consider = (target, pos) => {
        const to = pos.clone().sub(eye);
        const dist = to.length();
        if (dist > 600) return;
        const dot = to.normalize().dot(forward);
        if (dot < cone) return;
        const score = dist * (2 - dot);
        if (score < bestScore) { best = target; bestScore = score; }
      };

      this._enemies.forEach((enemy) => consider(enemy, enemy.mesh.position));
      if (this._isOnlinePvP()) {
        for (const foe of this._players) {
          if (foe === p || foe.hp <= 0) continue;
          consider(foe, foe.mesh.position);
        }
      }

      if (best) {
        if (p.lockTarget !== best) { p.lockTarget = best; p.lockProgress = 0; }
        p.lockProgress = Math.min(1, p.lockProgress + dt * 1.6);
      } else {
        p.lockTarget = null;
        p.lockProgress = 0;
      }
    }

    const local = this._getLocalPlayer();
    const locked = !!(local?.lockTarget && local.lockProgress >= 1 && local.hp > 0);
    this._hudEls.lock?.classList.toggle('hidden', !locked);
    this._hudEls.lockFp?.classList.toggle('hidden', !locked);
  }

  /* <!--
    적·온라인 상대가 플레이어를 조준할 때 락온 진행도를 갱신합니다.
    완료 시 HUD 에 락온 경보를 표시합니다.
  --> */
  _advanceHostileLock(locker, victim, maxDist, dt) {
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(locker.mesh.quaternion);
    const to = victim.mesh.position.clone().sub(locker.mesh.position);
    const dist = to.length();
    const cone = Math.cos(THREE.MathUtils.degToRad(12));
    if (dist > maxDist || dist < 1 || to.normalize().dot(forward) < cone) {
      locker.lockTarget = null;
      locker.lockProgress = 0;
      return;
    }
    if (locker.lockTarget !== victim) {
      locker.lockTarget = victim;
      locker.lockProgress = 0;
    }
    locker.lockProgress = Math.min(1, (locker.lockProgress ?? 0) + dt * 1.6);
  }

  _updateHostileLockOn(dt) {
    const local = this._getLocalPlayer();
    if (!local || local.hp <= 0) return;

    this._enemies.forEach((enemy) => {
      const target = enemy.target;
      if (!this._isFriendlyCombatant(target)) {
        enemy.lockTarget = null;
        enemy.lockProgress = 0;
        return;
      }
      this._advanceHostileLock(enemy, target, enemy.missileRange, dt);
    });

    if (this._isOnlinePvP()) {
      const remote = this._getRemotePlayer();
      if (remote && remote.hp > 0) {
        this._advanceHostileLock(remote, local, 600, dt);
      } else if (remote) {
        remote.lockTarget = null;
        remote.lockProgress = 0;
      }
    }
  }

  _isLocalPlayerLockedByHostile() {
    const local = this._getLocalPlayer();
    if (!local || local.hp <= 0) return false;
    for (const enemy of this._enemies ?? []) {
      if (enemy.lockTarget === local && (enemy.lockProgress ?? 0) >= 1) return true;
    }
    const remote = this._getRemotePlayer();
    if (this._isOnlinePvP() && remote?.lockTarget === local && (remote.lockProgress ?? 0) >= 1) {
      return true;
    }
    return false;
  }

  _isHostileMissile(missile, local) {
    const owner = missile.userData.owner;
    if (owner === 'enemy') return true;
    return this._isOnlinePvP() && this._isPlayerOwner(owner) && owner !== local?.id;
  }

  _isMissileTrackingPlayer(missile, player) {
    if (missile.userData.lured) return false;
    const ht = missile.userData.hardLockTarget;
    if (ht === player) return true;
    return missile.userData.target === player;
  }

  _missileThreatensPlayer(missile, player) {
    if (!player || player.hp <= 0) return false;
    if (missile.userData.overshot) return false;
    if (!this._isHostileMissile(missile, player)) return false;
    if (missile.userData.lured) return false;

    const proxSq = MISSILE_WARN_PROXIMITY * MISSILE_WARN_PROXIMITY;
    if (missile.position.distanceToSquared(player.mesh.position) <= proxSq) return true;

    if (!this._isMissileTrackingPlayer(missile, player)) return false;
    if (missile.userData.lockedShot || this._isLocalPlayerLockedByHostile()) return true;
    return false;
  }

  _updateIncomingLockWarning() {
    const local = this._getLocalPlayer();
    const active = !!(local && local.hp > 0 && !this._session?.ended && this._isLocalPlayerLockedByHostile());
    this._hudEls.incomingLockWarning?.classList.toggle('hidden', !active);
  }

  _hitHumanPlayers(bulletPos, radiusSq, callback) {
    for (const victim of this._players ?? []) {
      if (victim.hp <= 0) continue;
      if (bulletPos.distanceToSquared(victim.mesh.position) < radiusSq) {
        callback(victim);
        return true;
      }
    }
    return false;
  }

  /* ====================== 탄환 ====================== */
  _updateBullets(dt) {
    if (!this._bulletPool) return;
    const speed = 320;
    this._bulletPool.forEachActive((bullet) => {
      bullet.userData.life -= dt;
      bullet.position.addScaledVector(bullet.userData.dir, speed * dt);
      if (bullet.userData.life <= 0) {
        this._bulletPool.release(bullet);
        return;
      }
      const owner = bullet.userData.owner;
      if (this._isPlayerOwner(owner)) {
        const shooter = this._getPlayerById(owner);
        if (shooter && bullet.userData.reticleOnly) return;
        for (const enemy of this._enemies ?? []) {
          if (bullet.position.distanceToSquared(enemy.mesh.position) < 9) {
            enemy.hp -= bullet.userData.damage;
            if (this._isLocalPlayerOwner(owner)) {
              this._showMgHitFeedback('dealt', bullet.position);
            }
            this._session.score += 5;
            this._bulletPool.release(bullet);
            if (enemy.hp <= 0) this._killEnemy(enemy);
            return;
          }
        }
        for (const victim of this._players ?? []) {
          if (victim.id === owner || victim.hp <= 0) continue;
          if (bullet.position.distanceToSquared(victim.mesh.position) < 9) {
            if (this._isLocalPlayerOwner(owner)) {
              this._showMgHitFeedback('dealt', bullet.position);
            }
            if (victim.isRemote) {
              this._relayHit(victim.maxHp / PLAYER_MG_MAX_HITS);
              this._session.score += 25;
            } else {
              this._damagePlayerFromMG(victim);
              this._session.score += 25;
            }
            this._bulletPool.release(bullet);
            return;
          }
        }
      } else if (owner === 'ally') {
        for (const enemy of this._enemies ?? []) {
          if (bullet.position.distanceToSquared(enemy.mesh.position) < 9) {
            enemy.hp -= bullet.userData.damage;
            this._session.score += 4;
            this._bulletPool.release(bullet);
            if (enemy.hp <= 0) this._killEnemy(enemy);
            return;
          }
        }
      } else {
        /* 적 탄: 플레이어 + 다른 적기에도 적중 (자기 자신 제외) */
        if (this._hitHumanPlayers(bullet.position, 9, (victim) => {
          this._damagePlayerFromMG(victim);
          this._bulletPool.release(bullet);
        })) return;
        if (this._allies) {
          for (const ally of this._allies) {
            if (ally.hp <= 0) continue;
            if (bullet.position.distanceToSquared(ally.mesh.position) < 9) {
              ally.hp -= bullet.userData.damage;
              this._bulletPool.release(bullet);
              if (ally.hp <= 0) this._killAlly(ally, { respawn: true });
              return;
            }
          }
        }
        const shooter = bullet.userData.shooter;
        for (const enemy of this._enemies ?? []) {
          if (enemy === shooter) continue;
          if (bullet.position.distanceToSquared(enemy.mesh.position) < 9) {
            enemy.hp -= bullet.userData.damage;
            this._bulletPool.release(bullet);
            /* 적 간 격추는 플레이어 점수에 포함되지 않음 (awardKill: false) */
            if (enemy.hp <= 0) this._killEnemy(enemy, { awardKill: false });
            return;
          }
        }
      }
    });
  }

  /* ====================== 미사일 ======================
     플레이어/적 미사일 모두 같은 풀을 공유합니다. owner 필드로 분기.
     적 미사일은 플레어 반경 내 접근 시 플레어당 40% 확률로 재유도됩니다.
  */
  _updateMissiles(dt) {
    if (!this._missilePool) return;
    const turnRate = MISSILE_TURN_RATE;

    this._missilePool.forEachActive((missile) => {
      missile.userData.life -= dt;
      if (missile.userData.life <= 0) { this._missilePool.release(missile); return; }

      const hardLockActive = (missile.userData.hardLockTimer ?? 0) > 0;
      if (hardLockActive) missile.userData.hardLockTimer -= dt;

      this._tryFlareLureMissile(missile);
      this._tryCobraMissileEvade(missile);
      this._tryKmBuffMissileEvade(missile);

      let target = missile.userData.target;
      let targetPos = null;
      let targetAlive = false;
      let steerRate = turnRate;

      if (missile.userData.overshot) {
        target = null;
        targetPos = null;
        targetAlive = false;
      } else if (hardLockActive && missile.userData.hardLockTarget) {
        target = missile.userData.hardLockTarget;
        targetPos = this._resolveMissileTargetPos(missile);
        targetAlive = !!targetPos;
        steerRate = MISSILE_HARD_TURN_RATE;
      } else {
        targetPos = target?.mesh?.position ?? target?.position ?? null;
        targetAlive =
          (target?.mesh && target.hp > 0 && this._enemies.has(target)) ||
          (target?.visible === true && (target?.userData?.life ?? 0) < (target?.userData?.maxLife ?? Infinity)) ||
          (this._isHumanPlayer(target) && target.hp > 0) ||
          (this._allies?.has(target) && target.hp > 0);
      }

      if (targetPos && targetAlive) {
        const desired = targetPos.clone().sub(missile.position).normalize().multiplyScalar(missile.userData.velocity.length());
        missile.userData.velocity.lerp(desired, Math.min(1, steerRate * dt));
      }

      /* 미사일 노즈(+Z)가 현재 속도 방향을 향하도록 회전 */
      const vel = missile.userData.velocity;
      const velDir = vel.clone().normalize();
      missile.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), velDir);
      missile.position.addScaledVector(vel, dt);

      if (this._missileHitsTerrain(missile)) {
        this._spawnExplosion(missile.position, 10);
        this._missilePool.release(missile);
        return;
      }

      if (this._isPlayerOwner(missile.userData.owner)) {
        for (const enemy of this._enemies ?? []) {
          if (missile.position.distanceToSquared(enemy.mesh.position) < 49) {
            enemy.hp -= missile.userData.damage;
            this._spawnExplosion(missile.position, 12);
            this._missilePool.release(missile);
            if (enemy.hp <= 0) this._killEnemy(enemy);
            return;
          }
        }
        for (const victim of this._players ?? []) {
          if (victim.id === missile.userData.owner || victim.hp <= 0) continue;
          if (missile.userData.overshot) continue;
          if (missile.position.distanceToSquared(victim.mesh.position) < 36) {
            if (victim.isRemote) {
              this._relayHit(victim.maxHp / PLAYER_MISSILE_MAX_HITS);
              this._session.score += 120;
            } else {
              this._damagePlayerFromMissile(victim);
              this._session.score += 120;
            }
            this._spawnExplosion(missile.position, 12);
            this._missilePool.release(missile);
            return;
          }
        }
      } else {
        /* 적 미사일: 플레이어 / 다른 적기 / 플레어 모두에 충돌 가능 (자기 자신은 제외) */
        if (!missile.userData.overshot) {
          if (this._hitHumanPlayers(missile.position, 36, (victim) => {
            this._damagePlayerFromMissile(victim);
            this._spawnExplosion(missile.position, 10);
            this._missilePool.release(missile);
          })) return;
          if (this._allies) {
            for (const ally of this._allies) {
              if (ally.hp <= 0) continue;
              if (missile.position.distanceToSquared(ally.mesh.position) < 36) {
                ally.hp -= missile.userData.damage;
                this._spawnExplosion(missile.position, 10);
                this._missilePool.release(missile);
                if (ally.hp <= 0) this._killAlly(ally, { respawn: true });
                return;
              }
            }
          }
        }
        const shooter = missile.userData.shooter;
        let killed = false;
        for (const other of this._enemies ?? []) {
          if (other === shooter) continue;
          if (missile.position.distanceToSquared(other.mesh.position) < 36) {
            other.hp -= missile.userData.damage;
            this._spawnExplosion(missile.position, 10);
            this._missilePool.release(missile);
            if (other.hp <= 0) this._killEnemy(other, { awardKill: false });
            killed = true;
            break;
          }
        }
        if (killed) return;
        /* 디코이된 플레어와 충돌하면 그 자리에서 소진 (플레어는 계속 유지) */
        let exploded = false;
        this._flarePool.forEachActive((flare) => {
          if (exploded) return;
          if (missile.position.distanceToSquared(flare.position) < 16) {
            this._spawnExplosion(missile.position, 8);
            this._missilePool.release(missile);
            exploded = true;
          }
        });
        if (exploded) return;
      }
    });
  }

  /* <!-- 추격 중인 적: 추격 모드일 때는 회피 강도를 낮춰 플레이어 자동 추적이 우선합니다. --> */
  _applyPursuitEvasion(enemy, dt) {
    const pursued = this._player?.pursuitActive && this._player.pursuitTarget === enemy;
    const evadeMul = pursued ? 0.34 : 1;

    enemy.evasiveTimer = (enemy.evasiveTimer ?? 0) - dt;
    enemy.evasiveBoostTimer = Math.max(0, (enemy.evasiveBoostTimer ?? 0) - dt);

    const agi = enemy.agility ?? 110;
    const p = this._player;
    const pAgi = p ? this._getCombatantAgility(p) : 110;
    const pSpd = p ? this._getCombatantStatSpeed(p) : 140;
    const eSpd = enemy.statSpeed ?? 140;

    if (enemy.evasiveTimer <= 0) {
      const interval = THREE.MathUtils.lerp(1.4, 0.55, THREE.MathUtils.clamp(agi / 140, 0, 1));
      enemy.evasiveTimer = (interval + Math.random() * 0.5) / evadeMul;
      const rollSign = Math.random() > 0.5 ? 1 : -1;
      const rollBurst = rollSign * (1.6 + (agi / 120) * (1.2 + Math.random()));
      enemy.mesh.rotateZ(rollBurst * dt * 14 * evadeMul);
      if (eSpd > pSpd * 1.03 && enemy.evasiveBoostTimer <= 0) {
        enemy.speed = Math.min(
          (enemy.maxSpeed ?? enemy.speed) * 1.02,
          enemy.speed * (1 + (0.06 + (eSpd - pSpd) * 0.0015) * evadeMul),
        );
        enemy.evasiveBoostTimer = (0.35 + Math.random() * 0.35) / evadeMul;
      }
    }
  }

  _steerEnemyToward(enemy, desiredDir, dt, steerMul = 1) {
    if (!this._steerScratch) {
      this._steerScratch = {
        desiredQuat: new THREE.Quaternion(),
        nose: new THREE.Vector3(0, 0, 1),
      };
    }
    const s = this._steerScratch;
    s.desiredQuat.setFromUnitVectors(s.nose, desiredDir);
    const q = enemy.mesh.quaternion;
    const angle = q.angleTo(s.desiredQuat);
    const step = (enemy.steerRate ?? 0.45) * dt * steerMul;
    const alpha = angle > 1e-5 ? Math.min(1, step / angle) : 1;
    q.slerp(s.desiredQuat, alpha);
  }

  /* <!--
    도그파이트 속도: 가까울수록 감속하고, 플레이어 추격 시 현재 플레이어 속도를 넘지 않도록 상한을 둡니다.
    기존 가속(1.08~1.14배)은 추격 불가 원인이었습니다.
  --> */
  _computeEnemyMoveSpeed(enemy, target, dist, forward, desiredDir) {
    let speed = enemy.speed;
    if (dist >= DOGFIGHT_RANGE) return speed;

    const closeness = 1 - dist / DOGFIGHT_RANGE;
    speed *= THREE.MathUtils.lerp(0.82, DOGFIGHT_ENEMY_SPEED_FLOOR, closeness);

    const aligned = forward.dot(desiredDir);
    if (aligned > 0.88) {
      speed *= THREE.MathUtils.lerp(1, 0.78, closeness);
    }

    if (this._isHumanPlayer(target)) {
      const ref = Math.max(
        target.speed ?? 0,
        (target.maxSpeed ?? speed) * 0.58,
      );
      speed = Math.min(speed, ref * DOGFIGHT_ENEMY_SPEED_CAP);
    }

    return Math.max(speed, enemy.speed * 0.45);
  }

  /* ====================== 적 AI (FFA / 개인전) ======================
     모든 적기는 매 프레임 자기 타겟을 검증하고, 만료/사망 시 가장 가까운 후보로 재선택.
     후보 = 플레이어 + (자기 자신을 제외한) 다른 모든 적기.
     플레이어에게 너무 몰리는 것을 피하기 위해 약한 거리 가중(playerBias)을 둠.
  */
  _updateEnemies(dt) {
    if (!this._enemies?.size) return;
    this._enemies.forEach((enemy) => {
      /* 타겟 검증 / 재선택 */
      enemy.retargetTimer -= dt;
      const isStillValid = this._isTargetAlive(enemy.target);
      if (enemy.retargetTimer <= 0 || !isStillValid) {
        enemy.target = this._pickEnemyTarget(enemy);
        enemy.retargetTimer = 2.5 + Math.random() * 3.5;
      }
      const target = enemy.target;
      if (!target || !this._isTargetAlive(target)) return;

      const targetPos = target.mesh.position;
      const toTarget = targetPos.clone().sub(enemy.mesh.position);
      const dist = toTarget.length();
      const desiredDir = toTarget.normalize();
      /* <!-- 저고도 추격 방지: 전투 고도 이하로 내려가면 상승 성분을 섞습니다. --> */
      if (enemy.mesh.position.y < COMBAT_FLOOR_Y + 18) {
        desiredDir.y = Math.max(desiredDir.y, 0.35);
        desiredDir.normalize();
      }

      const inDogfight = dist < DOGFIGHT_RANGE;
      const steerMul = inDogfight ? DOGFIGHT_ENEMY_STEER_MUL : 1;
      const pursued = this._player?.pursuitActive && this._player.pursuitTarget === enemy;
      if (pursued) this._applyPursuitEvasion(enemy, dt);
      this._steerEnemyToward(enemy, desiredDir, dt, pursued ? steerMul * 1.05 : steerMul);

      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(enemy.mesh.quaternion);
      const moveSpeed = this._computeEnemyMoveSpeed(enemy, target, dist, forward, desiredDir);
      enemy.mesh.position.addScaledVector(forward, moveSpeed * dt);
      this._enforceCombatFloor(enemy.mesh, { pullUp: pursued || enemy.mesh.position.y < COMBAT_FLOOR_Y + 24 });

      enemy.fireCooldown -= dt;
      enemy.missileCooldown -= dt;
      this._tryEnemyDeployFlare(enemy, dt);
      const aligned = forward.dot(desiredDir) > (inDogfight ? DOGFIGHT_ALIGN_THRESHOLD : 0.93);

      if (
        !inDogfight
        && aligned
        && dist >= DOGFIGHT_MISSILE_MIN_RANGE
        && dist < enemy.missileRange
        && enemy.missileCooldown <= 0
        && enemy.missiles > 0
        && this._isFriendlyCombatant(target)
        && enemy.lockTarget === target
        && (enemy.lockProgress ?? 0) >= 1
      ) {
        this._enemyFireMissile(enemy);
        enemy.missileCooldown = 9 + Math.random() * 6;
      } else if (aligned && dist < enemy.attackRange && enemy.fireCooldown <= 0) {
        this._enemyFire(enemy);
        enemy.fireCooldown = (inDogfight ? 0.45 : 1.0) + Math.random() * (inDogfight ? 0.35 : 0.8);
      }
    });
  }

  /* <!-- 타겟이 살아있는지 통일 검사. 플레이어/다른 적기 모두 지원. --> */
  _isTargetAlive(target) {
    if (!target) return false;
    if (this._isHumanPlayer(target)) return target.hp > 0;
    if (this._allies?.has(target)) return target.hp > 0;
    return target.hp > 0 && this._enemies.has(target);
  }

  /* <!--
    가까운 대상 우선 + 약한 무작위 노이즈로 후보 채택.
    playerBias > 1.0 → 플레이어를 일부러 약간 멀게 평가해서 모든 적이 몰리는 현상 완화.
    같은 거리라면 다른 적기를 우선 공격하게 되어 FFA 분위기가 살아남.
  --> */
  _pickEnemyTarget(enemy) {
    if (this._gameRules === 'team') return this._pickTeamHostileTarget(enemy);

    const myPos = enemy.mesh.position;
    let best = null;
    let bestScore = Infinity;
    const playerBias = 1.6;
    const maxRange = 900;

    for (const pl of this._players ?? []) {
      if (pl.hp <= 0) continue;
      const d = myPos.distanceTo(pl.mesh.position);
      if (d < maxRange) {
        const score = d * (0.75 + Math.random() * 0.5) * playerBias;
        if (score < bestScore) { bestScore = score; best = pl; }
      }
    }
    this._enemies.forEach((other) => {
      if (other === enemy || other.hp <= 0) return;
      const d = myPos.distanceTo(other.mesh.position);
      if (d > maxRange) return;
      const score = d * (0.75 + Math.random() * 0.5);
      if (score < bestScore) { bestScore = score; best = other; }
    });
    return best;
  }

  _enemyFire(enemy) {
    const muzzle = enemy.mesh.position.clone();
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(enemy.mesh.quaternion);
    const bullet = this._bulletPool.acquire();
    bullet.position.copy(muzzle).addScaledVector(forward, 3);
    bullet.quaternion.copy(enemy.mesh.quaternion);
    bullet.visible = true;
    bullet.userData.dir.copy(forward);
    bullet.userData.life = 2.2;
    bullet.userData.damage = 6;
    bullet.userData.owner = 'enemy';
    bullet.userData.shooter = enemy;
  }

  /* <!-- 적 호밍 미사일 발사. 타겟은 enemy.target (다른 적기 또는 플레이어).
       _updateMissiles 가 비행 중 플레어 디코이로의 재유도와 다중 충돌을 처리합니다. --> */
  _enemyFireMissile(enemy) {
    if (enemy.missiles <= 0) return;
    enemy.missiles -= 1;
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(enemy.mesh.quaternion);
    const missile = this._missilePool.acquire();
    missile.position.copy(enemy.mesh.position).addScaledVector(forward, 3.5);
    missile.quaternion.copy(enemy.mesh.quaternion);
    missile.visible = true;
    missile.userData.velocity.copy(forward).multiplyScalar(MISSILE_SPEED);
    missile.userData.target = enemy.target;
    missile.userData.life = 5.0;
    missile.userData.damage = 22;
    missile.userData.owner = 'enemy';
    missile.userData.lured = false;
    missile.userData.shooter = enemy;
    missile.userData.hardLockTarget = null;
    missile.userData.hardLockTimer = 0;
    missile.userData.lockedShot = this._isFriendlyCombatant(enemy.target) && (enemy.lockProgress ?? 0) >= 1;
    if (enemy.target) this._applyMissileHardLock(missile, enemy.target);
  }

  /* ====================== 폭발 ====================== */
  _spawnExplosion(position, size) {
    const ex = this._explosionPool.acquire();
    ex.position.copy(position);
    ex.scale.setScalar(0.4);
    ex.material.opacity = 0.95;
    ex.userData.life = 0;
    ex.userData.maxLife = 0.6;
    ex.userData.targetScale = size;
    ex.visible = true;
  }

  _updateExplosions(dt) {
    this._explosionPool.forEachActive((ex) => {
      ex.userData.life += dt;
      const t = ex.userData.life / ex.userData.maxLife;
      if (t >= 1) { this._explosionPool.release(ex); return; }
      const s = THREE.MathUtils.lerp(0.4, ex.userData.targetScale, t);
      ex.scale.setScalar(s);
      ex.material.opacity = 0.95 * (1 - t);
    });
  }

  /* <!-- AGL 기준 지면 충돌. 기체 하부가 지면에 닿을 때만 피격·사망 처리. --> */
  _checkGroundCollision(p, dt) {
    const lowestY = this._getAircraftLowestWorldY(p);
    const agl = lowestY - GROUND_Y;
    if (agl >= GROUND_SCRAPE_AGL) return;

    const floorY = GROUND_Y + GROUND_FATAL_AGL;
    if (lowestY < floorY) {
      p.mesh.position.y += floorY - lowestY;
    }

    if (agl <= GROUND_FATAL_AGL) {
      this._killPlayer(p, '지면 충돌');
      return;
    }
    const t = 1 - (agl - GROUND_FATAL_AGL) / (GROUND_SCRAPE_AGL - GROUND_FATAL_AGL);
    this._damagePlayer(p, t * 28 * dt * 60);
  }

  _checkWorldBoundary(p) {
    const pos = p.mesh.position;
    const limit = WORLD_RADIUS - BOUNDARY_KILL_MARGIN;
    if (Math.abs(pos.x) >= limit || Math.abs(pos.z) >= limit) {
      this._killPlayer(p, '격자 방벽 충돌');
    }
  }

  _killPlayer(p, title) {
    if (!p || p.hp <= 0) return;
    if (p.pursuitActive) this._endPursuit(p, { force: true });
    p.hp = 0;
    p.mesh.visible = false;
    this._spawnExplosion(p.mesh.position, 18);

    if (this._isOnlinePvP()) {
      if (p.isRemote) return;
      this._endSession(title || '격추당했습니다', 'multi_loss');
      return;
    }

    this._endSession(title, 'death');
  }

  /* ====================== 데미지 / 종료 ====================== */
  _damagePlayerFromMissile(p, opts = {}) {
    if (!p || p.hp <= 0) return;
    this._damagePlayer(p, p.maxHp / PLAYER_MISSILE_MAX_HITS, opts);
  }

  _damagePlayerFromMG(p, opts = {}) {
    if (!p || p.hp <= 0) return;
    const local = this._getLocalPlayer();
    if (local && p.id === local.id && !opts.fromNetwork && !opts.skipHitFeedback) {
      this._showMgHitFeedback('taken');
    }
    this._damagePlayer(p, p.maxHp / PLAYER_MG_MAX_HITS, opts);
  }

  _damagePlayer(p, amount, opts = {}) {
    if (!p || p.hp <= 0) return;
    if (p.isRemote && !opts.fromNetwork) return;
    p.hp = Math.max(0, p.hp - amount);
    if (p.hp <= 0) {
      this._spawnExplosion(p.mesh.position, 18);
      p.mesh.visible = false;
      if (this._isOnlinePvP()) {
        if (p.isRemote || opts.fromNetwork) return;
        this._endSession('격추당했습니다', 'multi_loss');
      } else {
        this._endSession('격추당했습니다', 'death');
      }
    }
  }

  _endMultiplayerTimeout() {
    if (!this._isOnlinePvP()) return;
    const local = this._getLocalPlayer();
    const remote = this._getRemotePlayer();
    if (local && remote) {
      if (local.hp === remote.hp) {
        this._endSession('시간 종료 · 무승부', 'multi_draw');
      } else if (local.hp > remote.hp) {
        this._endSession('시간 종료 · 승리!', 'multi_win');
      } else {
        this._endSession('시간 종료 · 패배', 'multi_loss');
      }
      return;
    }
    const ranked = [...(this._players ?? [])].sort((a, b) => b.hp - a.hp);
    if (ranked.length >= 2 && ranked[0].hp === ranked[1].hp) {
      this._endSession('시간 종료 · 무승부', 'multi_draw');
    } else {
      this._endSession(`${ranked[0].label} 승리!`, 'multi_win', { winner: ranked[0] });
    }
  }

  /* <!--
    전투 보상 계산.
    - survivedSec: 실제로 버틴 시간(초). 잔여 타이머가 아닌 경과 시간을 씁니다.
      (이전 버그: 잔여 시간 * 8 을 써서 일찍 죽을수록 보상이 커졌음)
    - death   : 생존 시간(초) × 10 만 지급 (격추·점수 보상 없음)
    - timeout : 격추 1기 이상 → 격추당 1500 + 생존 시간(초) × 10
                격추 0기     → 생존 시간(초) × 10 만
  --> */
  _computeReward(kills, survivedSec, outcome) {
    const survivalCash = Math.floor(survivedSec * REWARD_PER_SURVIVAL_SECOND);
    if (outcome === 'multi_win') {
      return Math.max(400, survivalCash + 900 + kills * 80);
    }
    if (outcome === 'multi_draw') {
      return Math.max(200, Math.floor(survivalCash * 0.6));
    }
    if (outcome === 'multi_loss') {
      return Math.max(100, Math.floor(survivalCash * 0.5));
    }
    if (outcome === 'death') {
      return survivalCash;
    }
    if (kills > 0) {
      return kills * REWARD_PER_KILL + survivalCash;
    }
    return survivalCash;
  }

  _endSession(title, outcome, extra = {}) {
    if (this._session.ended) return;
    this._session.ended = true;
    const { kills, score } = this._session;
    const survivedSec = Math.max(0, BATTLE_DURATION - Math.max(0, this._session.time));
    const reward = this._computeReward(kills, survivedSec, outcome);
    GameState.recordBattle({ kills, score, reward });
    const ach = GameState.lastBattleAchievements;

    this._hudEls.modalTitle.textContent = title;
    this._hudEls.modalKills.textContent = kills;
    this._hudEls.modalScore.textContent = score.toLocaleString();
    this._hudEls.modalReward.textContent = Sky.currency?.formatVS?.(reward)
      ?? `${Math.max(0, reward | 0).toLocaleString()} VS`;
    if (this._hudEls.modalBestKills) {
      this._hudEls.modalBestKills.textContent = String(ach?.newBest ?? kills);
    }
    const kmEarned = ach?.kmEarned ?? 0;
    this._hudEls.modalKmRow?.classList.toggle('hidden', kmEarned <= 0);
    if (this._hudEls.modalKmEarned && kmEarned > 0) {
      this._hudEls.modalKmEarned.textContent = Sky.currency?.formatKM?.(kmEarned)
        ?? `${kmEarned} KM`;
    }
    const unlocks = ach?.newUnlocks ?? [];
    this._hudEls.modalAchWrap?.classList.toggle('hidden', unlocks.length === 0);
    if (this._hudEls.modalAchList) {
      this._hudEls.modalAchList.innerHTML = '';
      unlocks.forEach((u) => {
        const li = document.createElement('li');
        li.textContent = u.name;
        this._hudEls.modalAchList.appendChild(li);
      });
    }
    this._hud?.classList.add('battle-ended');
    this._canvas.style.visibility = 'hidden';
    this._hudEls.modal.classList.remove('hidden');
    this._hudEls.modal.classList.add('battle-result-fullscreen');
  }

  /* ====================== 카메라 ======================
     - 3인칭: 기체 뒤 약간 위에서 스프링 댐핑된 추적.
     - 1인칭: 콕핏 위치에 즉시 스냅, 기체의 롤/뱅크까지 그대로 따라감.
       기체 메시는 1인칭일 때만 보이지 않게 처리해 시야 차폐 방지.
  */
  _updateCamera(dt) {
    if (!this._cameraAnchor) this._cameraAnchor = new THREE.Vector3();
    const focusPlayer = this._getCameraAnchor(this._cameraAnchor);
    const p = focusPlayer;
    if (!p?.mesh) return;

    if (this._isOnlinePvP()) {
      this._players?.forEach((pl) => { if (pl.hp > 0) pl.mesh.visible = true; });
    }

    if (this._fpCockpitMesh) this._fpCockpitMesh.visible = this._viewMode === 'first' && !p.pursuitActive;

    if (p.pursuitActive && p.pursuitTarget && !this._isOnlinePvP()) {
      const enemy = p.pursuitTarget;
      p.mesh.visible = true;
      if (this._players) {
        for (const pl of this._players) {
          if (pl !== p && pl.hp > 0) pl.mesh.visible = false;
        }
      }
      const ef = new THREE.Vector3(0, 0, 1).applyQuaternion(enemy.mesh.quaternion).normalize();
      const camPos = enemy.mesh.position.clone()
        .addScaledVector(ef, -PURSUIT_CAM_BACK)
        .add(new THREE.Vector3(0, PURSUIT_CAM_UP, 0));
      const lookAt = enemy.mesh.position.clone().addScaledVector(ef, PURSUIT_CAM_LOOK_AHEAD);
      const k = Math.min(1, PURSUIT_CAM_LERP * dt);
      this._camera.position.lerp(camPos, k);
      this._camera.lookAt(lookAt);
      return;
    }

    if (this._viewMode === 'first' && !this._isOnlinePvP()) {
      /* 콕핏 시점: 캐노피 위치 살짝 위/앞에 카메라 고정. */
      p.mesh.visible = false;
      const cockpitLocal = new THREE.Vector3(0, 0.52, 0.85);
      const cockpitWorld = cockpitLocal.applyMatrix4(p.mesh.matrixWorld);
      this._camera.position.copy(cockpitWorld);

      /* 기체 +Z 방향을 바라보고, 업벡터는 기체의 +Y(롤에 따라 기울어짐)로 설정해
         실제 콕핏처럼 화면이 자연스럽게 뱅크되도록 합니다. */
      const forwardWorld = new THREE.Vector3(0, 0, 1).applyQuaternion(p.mesh.quaternion);
      const upWorld      = new THREE.Vector3(0, 1, 0).applyQuaternion(p.mesh.quaternion);
      const lookAhead    = cockpitWorld.clone().addScaledVector(forwardWorld, 40);
      const m = new THREE.Matrix4().lookAt(this._camera.position, lookAhead, upWorld);
      this._camera.quaternion.setFromRotationMatrix(m);
      return;
    }

    /* 3인칭: 메시 바운딩 중심을 화면 정중앙에 두고, 카메라는 뒤·위에서 추적합니다. */
    p.mesh.visible = true;
    if (!this._thirdCamCenter) this._thirdCamCenter = new THREE.Vector3();
    if (!this._cameraState) {
      this._cameraState = {
        offset: new THREE.Vector3(THIRD_CAM_OFFSET.x, THIRD_CAM_OFFSET.y, THIRD_CAM_OFFSET.z),
        target: new THREE.Vector3(),
        lookTarget: new THREE.Vector3(),
      };
    }
    const center = this._getAircraftVisualCenter(p.mesh, this._thirdCamCenter);
    const worldOffset = this._cameraState.offset.clone().applyQuaternion(p.mesh.quaternion);
    this._cameraState.target.copy(center).add(worldOffset);
    this._cameraState.lookTarget.copy(center);

    const k = Math.min(1, 4.5 * dt);
    this._camera.position.lerp(this._cameraState.target, k);
    this._camera.quaternion.slerp(
      new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().lookAt(this._camera.position, this._cameraState.lookTarget, new THREE.Vector3(0, 1, 0).applyQuaternion(p.mesh.quaternion)),
      ),
      k,
    );
  }

  /* ====================== 레이더 ======================
     좌상단 미니맵. 2D 캔버스에 매 프레임 다시 그리며,
     화면 위쪽이 '플레이어 전방'이 되도록 모든 좌표를 yaw 만큼 역회전합니다.
     수직 정보는 무시한 단순 평면 레이더.
  */
  _setupRadar() {
    if (!this._hud) return;
    this._radar = this._hud.querySelector('#hud-radar');
    this._radarCtx = this._radar?.getContext('2d') ?? null;
    this._radarSweep = 0;
  }

  _updateRadar() {
    const ctx = this._radarCtx;
    const p = this._player;
    if (!ctx || !p) return;

    const w = this._radar.width;
    const h = this._radar.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(cx, cy) - 4;
    const range = 500; /* 미터. 이 이상은 가장자리에 outline 으로만 표시 */

    ctx.clearRect(0, 0, w, h);

    /* 베이스 원 + 거리 링 */
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = 'rgba(10, 22, 34, 0.55)';
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = 'rgba(110, 200, 255, 0.35)';
    ctx.lineWidth = 1;
    for (const f of [0.33, 0.66, 1.0]) {
      ctx.beginPath(); ctx.arc(0, 0, radius * f, 0, Math.PI * 2); ctx.stroke();
    }
    /* 십자선 */
    ctx.beginPath();
    ctx.moveTo(0, -radius); ctx.lineTo(0, radius);
    ctx.moveTo(-radius, 0); ctx.lineTo(radius, 0);
    ctx.stroke();

    /* 회전 스위프 라인 (장식용 회전 광선) */
    this._radarSweep = (this._radarSweep + 0.04) % (Math.PI * 2);
    const sweepGrad = ctx.createLinearGradient(0, 0, Math.sin(this._radarSweep) * radius, -Math.cos(this._radarSweep) * radius);
    sweepGrad.addColorStop(0, 'rgba(110, 230, 255, 0)');
    sweepGrad.addColorStop(1, 'rgba(110, 230, 255, 0.55)');
    ctx.strokeStyle = sweepGrad;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.sin(this._radarSweep) * radius, -Math.cos(this._radarSweep) * radius);
    ctx.stroke();

    /* 플레이어 헤딩(yaw): XZ 평면에서 +Z 방향의 각도 */
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(p.mesh.quaternion);
    const headingAngle = Math.atan2(forward.x, forward.z); /* 0 = 정북(+Z) */

    /* 적 표시 — 플레이어 기준 상대 좌표를 yaw 만큼 역회전 → 항상 화면 위쪽 = 기수 방향 */
    this._enemies?.forEach((enemy) => {
      const dx = enemy.mesh.position.x - p.mesh.position.x;
      const dz = enemy.mesh.position.z - p.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      const worldAngle = Math.atan2(dx, dz);
      const localAngle = worldAngle - headingAngle;
      const r = dist <= range ? (dist / range) * radius : radius - 2;
      const ex =  Math.sin(localAngle) * r;
      const ey = -Math.cos(localAngle) * r;
      const isLocked = p.lockTarget === enemy;
      const blip = this._resolveRadarBlip(enemy, dist, range);
      if (!blip.visible) return;

      ctx.fillStyle = dist <= range ? (isLocked ? '#ffe26a' : '#ff5566') : 'rgba(255, 85, 102, 0.7)';
      ctx.beginPath();
      ctx.arc(ex, ey, blip.radius, 0, Math.PI * 2);
      ctx.fill();
      if (isLocked) {
        ctx.strokeStyle = '#ffe26a';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(ex, ey, blip.radius + 3, 0, Math.PI * 2); ctx.stroke();
      }
    });

    if (this._gameRules === 'team') {
      this._allies?.forEach((ally) => {
        if (ally.hp <= 0) return;
        const plot = this._radarWorldToLocal(
          ally.mesh.position.x, ally.mesh.position.z, p.mesh.position, headingAngle, range, radius,
        );
        if (!plot) return;
        ctx.fillStyle = plot.onScope ? '#66aaff' : 'rgba(102, 170, 255, 0.75)';
        ctx.beginPath();
        ctx.arc(plot.ex, plot.ey, plot.onScope ? 3.5 : 2.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    if (this._isOnlinePvP()) {
      const p2 = this._getPlayerById('p2');
      if (p2?.hp > 0) {
        const plot = this._radarWorldToLocal(
          p2.mesh.position.x, p2.mesh.position.z, p.mesh.position, headingAngle, range, radius,
        );
        if (plot) {
          ctx.fillStyle = plot.onScope ? '#ffb347' : 'rgba(255, 179, 71, 0.75)';
          ctx.beginPath();
          ctx.arc(plot.ex, plot.ey, plot.onScope ? 4 : 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    /* 중앙의 플레이어 (위로 향하는 삼각형) — 미사일은 그 위에 그려 가려지지 않게 함 */
    ctx.fillStyle = '#88e0ff';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(-5, 5);
    ctx.lineTo(5, 5);
    ctx.closePath();
    ctx.fill();

    /* 미사일: 아군(발사) / 적군(위협) 모두 표시. 적 미사일은 크고 깜빡여 식별합니다. */
    const pulse = 0.65 + Math.sin(performance.now() * 0.012) * 0.35;
    this._missilePool?.forEachActive((m) => {
      const plot = this._radarWorldToLocal(
        m.position.x, m.position.z, p.mesh.position, headingAngle, range, radius,
      );
      if (!plot) return;
      const { ex, ey, dist, onScope } = plot;
      const isEnemy = m.userData.owner === 'enemy';
      if (isEnemy) {
        const sz = onScope ? 5.5 * pulse : 4;
        ctx.fillStyle = m.userData.lured ? 'rgba(255, 180, 80, 0.85)' : '#ff3344';
        ctx.strokeStyle = '#ff8899';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(ex, ey - sz);
        ctx.lineTo(ex + sz * 0.75, ey + sz * 0.5);
        ctx.lineTo(ex - sz * 0.75, ey + sz * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ex, ey, sz + 3, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = onScope ? '#66ffcc' : 'rgba(102, 255, 204, 0.65)';
        ctx.beginPath();
        ctx.arc(ex, ey, onScope ? 3.5 : 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (dist > range * 0.15 && m.userData.velocity) {
        const vx = m.userData.velocity.x;
        const vz = m.userData.velocity.z;
        const vmag = Math.hypot(vx, vz) || 1;
        const trailLen = isEnemy ? 10 : 6;
        const tx = ex - (Math.sin(Math.atan2(vx, vz) - headingAngle) * trailLen);
        const ty = ey + (Math.cos(Math.atan2(vx, vz) - headingAngle) * trailLen);
        ctx.strokeStyle = isEnemy ? 'rgba(255, 80, 90, 0.55)' : 'rgba(102, 255, 204, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }
    });

    ctx.restore();
  }

  /* <!-- 레이더: 월드 XZ → 플레이어 기준 로컬 좌표. 범위 밖은 가장자리에 클램프. --> */
  _radarWorldToLocal(wx, wz, playerPos, headingAngle, range, radius) {
    const dx = wx - playerPos.x;
    const dz = wz - playerPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.5) return null;
    const worldAngle = Math.atan2(dx, dz);
    const localAngle = worldAngle - headingAngle;
    const onScope = dist <= range;
    const r = onScope ? (dist / range) * radius : radius - 3;
    return {
      ex: Math.sin(localAngle) * r,
      ey: -Math.cos(localAngle) * r,
      dist,
      onScope,
    };
  }

  /* ====================== HUD ====================== */
  _updateHUD() {
    const p = this._player;
    const s = this._session;

    if (s && this._hudEls.time) {
      const total = Math.max(0, Math.floor(this._getBattleTimeRemaining()));
      const mm = String(Math.floor(total / 60)).padStart(2, '0');
      const ss = String(total % 60).padStart(2, '0');
      this._hudEls.time.textContent = `${mm}:${ss}`;
    }
    if (this._hudEls.mapName && this._mapPreset) {
      this._hudEls.mapName.textContent = this._mapPreset.name;
    }
    if (!p || !s) return;
    if (this._hudEls.hp) this._hudEls.hp.style.width = `${(p.hp / p.maxHp) * 100}%`;
    this._hudEls.p2Block?.classList.toggle('hidden', !this._isOnlinePvP());
    const p2 = this._getPlayerById('p2');
    if (p2 && this._hudEls.hpP2) {
      this._hudEls.hpP2.style.width = `${(p2.hp / p2.maxHp) * 100}%`;
    }
    if (this._hudEls.boost) this._hudEls.boost.style.width = `${p.boost * 100}%`;
    if (this._hudEls.score) this._hudEls.score.textContent = s.score.toLocaleString();
    if (this._hudEls.kills) this._hudEls.kills.textContent = s.kills;
    if (this._hudEls.gameMode) {
      if (this._isOnlinePvP()) {
        this._hudEls.gameMode.textContent = this._gameRules === 'team' ? '온라인 팀전' : '온라인 개인전';
      } else if (this._gameRules === 'team') {
        this._hudEls.gameMode.textContent = '팀전';
      } else {
        this._hudEls.gameMode.textContent = '개인전';
      }
    }
    this._hudEls.mg && (this._hudEls.mg.textContent = `${p.mgAmmo}/${p.maxMgAmmo}`);
    this._hudEls.missiles && (this._hudEls.missiles.textContent = p.missiles);
    if (this._hudEls.baseReloadWrap && this._hudEls.baseReloadFill) {
      const show = p.baseReloadGauge > 0;
      this._hudEls.baseReloadWrap.classList.toggle('hidden', !show);
      this._hudEls.baseReloadFill.style.width = `${Math.min(100, p.baseReloadGauge * 100)}%`;
    }
    this._hudEls.flares && (this._hudEls.flares.textContent = p.flares);
    this._hudEls.speed && (this._hudEls.speed.textContent = this._formatSpeedDisplay(p.speed));

    this._updateMissileWarning();
    this._updateIncomingLockWarning();
    this._updateCobraHUD();
    this._updatePursuitHUD();
    this._updateSwingWingHUD();
    this._updateAltitudeWarning(this._getAltitudeAGL());
    this._syncViewModeUI();
    if (this._viewMode === 'first' || this._player?.pursuitActive) this._updateCockpitHUD();
  }

  _isSwingWingFighter(fighter = this._player?.fighter) {
    return SWING_WING_MESH_TYPES.has(fighter?.meshType);
  }

  _isStealthMeshType(meshType) {
    return STEALTH_MESH_TYPES.has(meshType);
  }

  /* <!--
    스텔스: 레이더 외곽(원거리)에서 최초 포착 시 80% 확률로 잠깐 소실.
    접근할수록 블립 반경을 키웁니다.
  --> */
  _resolveRadarBlip(enemy, dist, range) {
    const proximity = 1 - Math.min(1, Math.max(0, dist / range));
    const baseR = 2.2 + proximity * 4.5;
    const meshType = enemy.fighterDef?.meshType;
    if (!this._isStealthMeshType(meshType)) {
      return { visible: true, radius: baseR };
    }

    if (!enemy.radarTrack) enemy.radarTrack = { captured: false, ghost: false };
    const tr = enemy.radarTrack;
    const distNorm = dist / range;
    const atOuterEdge = distNorm >= STEALTH_RADAR_OUTER_NORM || dist > range;

    if (dist <= range * 1.15 && !tr.captured) {
      tr.captured = true;
      if (atOuterEdge && Math.random() < STEALTH_RADAR_GHOST_CHANCE) {
        tr.ghost = true;
      }
    }

    if (tr.ghost && distNorm < STEALTH_RADAR_OUTER_NORM * 0.82) {
      tr.ghost = false;
    }

    if (tr.ghost && atOuterEdge) {
      return { visible: false, radius: 0 };
    }

    return { visible: true, radius: 2 + proximity * 7.5 };
  }

  _getWingFoldFlightMul(p) {
    if (!this._isSwingWingFighter(p?.fighter)) {
      return { turnMul: 1, speedMul: 1 };
    }
    const t = THREE.MathUtils.clamp(this._wingFoldT ?? 0, 0, 1);
    return {
      turnMul: THREE.MathUtils.lerp(1, WING_FOLD_AGILITY_MUL, t),
      speedMul: THREE.MathUtils.lerp(1, WING_FOLD_SPEED_MUL, t),
    };
  }

  _initSwingWingState() {
    const p = this._player ?? this._getLocalPlayer();
    if (!this._isSwingWingFighter(p?.fighter)) {
      this._wingFoldT = 0;
      this._wingFoldTarget = 0;
      return;
    }
    this._wingFoldT = 0;
    this._wingFoldTarget = 0;
    if (p?.mesh) applySwingWingFold(p.mesh, 0);
  }

  _tryToggleWingFold() {
    const p = this._player;
    if (!p || p.hp <= 0 || p.cobra || p.pursuitActive) return;
    if (!this._isSwingWingFighter(p.fighter)) return;
    this._wingFoldTarget = this._wingFoldTarget < 0.5 ? 1 : 0;
  }

  _updateSwingWings(dt) {
    const p = this._player;
    if (!p || !this._isSwingWingFighter(p.fighter)) return;
    const speed = WING_FOLD_ANIM_SPEED;
    if (this._wingFoldT < this._wingFoldTarget) {
      this._wingFoldT = Math.min(this._wingFoldTarget, this._wingFoldT + dt * speed);
    } else if (this._wingFoldT > this._wingFoldTarget) {
      this._wingFoldT = Math.max(this._wingFoldTarget, this._wingFoldT - dt * speed);
    }
    applySwingWingFold(p.mesh, this._wingFoldT);
  }

  _updateSwingWingHUD() {
    const el = this._hudEls.wingFold;
    const hint = this._hudEls.wingFoldHint;
    if (!el) return;
    const show = this._isSwingWingFighter() && !this._isOnlinePvP();
    el.classList.toggle('hidden', !show);
    if (!show || !hint) return;
    const folded = this._wingFoldTarget > 0.5;
    el.classList.toggle('active', folded);
    hint.textContent = folded ? '펼치기 [G]' : '접기 [G]';
  }

  _updateCobraHUD() {
    const el = this._hudEls.cobra;
    const hint = this._hudEls.cobraHint;
    if (!el || !this._player) return;
    const p = this._player;
    const su = this._isSukhoiFighter();
    el.classList.toggle('hidden', !su);
    if (!su) {
      this._hud?.classList.remove('cobra-active');
      return;
    }
    const active = !!p.cobra;
    const ready = !active && p.cobraCooldown <= 0 && p.speed >= COBRA_MIN_SPEED;
    el.classList.toggle('active', active);
    el.classList.toggle('ready', ready);
    this._hud?.classList.toggle('cobra-active', active);
    if (!hint) return;
    if (active) hint.textContent = '실행';
    else if (p.cobraCooldown > 0) hint.textContent = `${Math.ceil(p.cobraCooldown)}s`;
    else if (p.speed < COBRA_MIN_SPEED) hint.textContent = '저속';
    else {
      const pitch = new THREE.Euler().setFromQuaternion(p.mesh.quaternion, 'YXZ').x;
      hint.textContent = pitch > COBRA_MAX_START_DIVE ? '평준' : '[C]';
    }
  }

  _getAltitudeAGL() {
    return this._getCgClearanceAGL(this._player);
  }

  /* <!-- 피치 래더 눈금을 1회만 생성합니다. --> */
  _setupCockpitHUD() {
    const ladder = this._hudEls.pitchLadder;
    if (!ladder || ladder.dataset.ready) return;
    ladder.dataset.ready = '1';
    ladder.innerHTML = '';
    for (let deg = -40; deg <= 40; deg += 5) {
      const line = document.createElement('div');
      line.className = 'ladder-line' + (deg % 10 === 0 ? ' major' : '');
      line.dataset.deg = String(deg);
      line.style.top = `calc(50% + ${deg * 5.2}px)`;
      if (deg % 10 === 0) {
        const lbl = document.createElement('span');
        lbl.className = 'ladder-lbl';
        lbl.textContent = Math.abs(deg);
        line.appendChild(lbl);
      }
      ladder.appendChild(line);
    }
    if (this._hudEls.rollIndicator) {
      this._hudEls.rollIndicator.innerHTML = '<i class="roll-wing"></i><i class="roll-center"></i>';
    }
  }

  /* <!-- 하단 대시만 유지. 좌우 프레임은 시야를 가려 제거했습니다. --> */
  _buildFirstPersonCockpitMesh() {
    if (this._fpCockpitMesh) return;
    const g = new THREE.Group();
    const panelMat = new THREE.MeshBasicMaterial({ color: 0x1a2430 });

    const dash = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.32, 0.75), panelMat);
    dash.position.set(0, -0.68, -0.2);
    dash.rotation.x = -0.42;
    g.add(dash);

    g.visible = false;
    g.renderOrder = 999;
    this._camera.add(g);
    this._fpCockpitMesh = g;
  }

  _syncViewModeUI() {
    const pursuit = !!this._player?.pursuitActive && !this._isOnlinePvP();
    const first = this._viewMode === 'first' || pursuit;
    this._hud?.classList.toggle('view-first', first);
    this._hud?.classList.toggle('view-third', !first && !pursuit);
    this._hud?.classList.toggle('view-pursuit', pursuit);
    this._hudEls.cockpitOverlay?.classList.toggle('hidden', !first);
    if (this._hudEls.cockpitOverlay) {
      this._hudEls.cockpitOverlay.setAttribute('aria-hidden', first ? 'false' : 'true');
    }
    this._hud?.querySelector('.crosshair')?.classList.toggle('hidden', first && !pursuit);
    if (!first) this._hudEls.cockpitOverlay?.classList.remove('ground-proximity');
    this._dockRadar(first);
  }

  /* <!-- 1인칭: 하부 MFD 중앙 슬롯 / 3인칭: battle-hud 좌상단 --> */
  _dockRadar(first) {
    const wrap = this._radarWrap;
    const slot = this._fpRadarSlot;
    if (!wrap || !this._hud) return;

    if (first && slot) {
      slot.appendChild(wrap);
      slot.setAttribute('aria-hidden', 'false');
      wrap.classList.add('radar-fp');
      this._fpPanelLabels?.classList.add('hidden');
    } else {
      if (wrap.parentElement !== this._hud) {
        this._hud.insertBefore(wrap, this._hud.firstChild);
      }
      slot?.setAttribute('aria-hidden', 'true');
      wrap.classList.remove('radar-fp');
      this._fpPanelLabels?.classList.remove('hidden');
    }
  }

  _updateCockpitHUD() {
    const p = this._player;
    if (!p || p.hp <= 0) return;

    const agl = this._getAltitudeAGL();
    const euler = new THREE.Euler().setFromQuaternion(p.mesh.quaternion, 'YXZ');
    const pitchDeg = THREE.MathUtils.radToDeg(euler.x);
    const rollDeg = THREE.MathUtils.radToDeg(euler.z);
    let hdg = THREE.MathUtils.radToDeg(euler.y);
    if (hdg < 0) hdg += 360;

    if (this._hudEls.cockpitAlt) {
      this._hudEls.cockpitAlt.textContent = String(Math.round(agl)).padStart(4, '0');
      this._hudEls.cockpitAlt.classList.toggle('low', agl < ALT_WARN_AGL);
    }
    if (this._hudEls.cockpitSpd) {
      this._hudEls.cockpitSpd.textContent = String(this._speedToKmh(p.speed)).padStart(4, '0');
    }
    if (this._hudEls.cockpitMach) {
      this._hudEls.cockpitMach.textContent = `M${this._speedToMach(p.speed).toFixed(2)}`;
    }
    if (this._hudEls.cockpitHdg) {
      this._hudEls.cockpitHdg.textContent = String(Math.round(hdg)).padStart(3, '0');
    }
    if (this._hudEls.cockpitHull) {
      this._hudEls.cockpitHull.textContent = `${Math.round((p.hp / p.maxHp) * 100)}%`;
    }
    if (this._hudEls.cockpitBoost) {
      this._hudEls.cockpitBoost.textContent = `${Math.round(p.boost * 100)}%`;
    }
    if (this._hudEls.cockpitMsl) this._hudEls.cockpitMsl.textContent = String(p.missiles);
    if (this._hudEls.cockpitFlr) this._hudEls.cockpitFlr.textContent = String(p.flares);

    if (this._hudEls.pitchLadder) {
      const pxPerDeg = 5.2;
      this._hudEls.pitchLadder.style.transform = `translate(-50%, calc(-50% + ${pitchDeg * pxPerDeg}px))`;
    }
    if (this._hudEls.rollIndicator) {
      this._hudEls.rollIndicator.style.transform = `translate(-50%, -50%) rotate(${-rollDeg}deg)`;
    }

  }

  _updateAltitudeWarning(agl) {
    const el = this._hudEls.altitudeWarning;
    if (!el) return;
    const p = this._player;
    if (!p || p.hp <= 0 || this._session.ended) {
      el.classList.add('hidden');
      this._hud?.classList.remove('ground-proximity');
      this._hudEls.cockpitOverlay?.classList.remove('ground-proximity');
      return;
    }

    const show = agl < ALT_WARN_AGL;
    const prox = agl < ALT_DANGER_AGL;
    el.classList.toggle('hidden', !show);
    el.classList.toggle('caution', show && agl >= ALT_DANGER_AGL);
    el.classList.toggle('danger', agl < ALT_DANGER_AGL && agl >= ALT_CRITICAL_AGL);
    el.classList.toggle('critical', agl < ALT_CRITICAL_AGL);
    this._hud?.classList.toggle('ground-proximity', prox);
    if (this._viewMode === 'first') {
      this._hudEls.cockpitOverlay?.classList.toggle('ground-proximity', prox);
    } else {
      this._hudEls.cockpitOverlay?.classList.remove('ground-proximity');
    }
  }

  /* <!--
    미사일 경보: (1) 적 락온 상태에서 본인을 추적하는 미사일, (2) 50m 이내 접근 시에만 표시.
    플레어 유도(lured) 미사일은 제외합니다.
  --> */
  _updateMissileWarning() {
    const local = this._getLocalPlayer();
    if (!local || local.hp <= 0 || this._session?.ended) {
      this._hudEls.missileWarning?.classList.add('hidden');
      this._hudEls.missileVignette?.classList.add('hidden');
      return;
    }

    let count = 0;
    this._missilePool?.forEachActive((m) => {
      if (this._missileThreatensPlayer(m, local)) count += 1;
    });

    const active = count > 0;
    this._hudEls.missileWarning?.classList.toggle('hidden', !active);
    this._hudEls.missileVignette?.classList.toggle('hidden', !active);
    if (active && this._hudEls.missileWarningCount) {
      this._hudEls.missileWarningCount.textContent = count > 1 ? `×${count}` : '';
    }
  }

  /* ====================== 리사이즈 / 정리 ====================== */
  _onResize() {
    if (!this._renderer) return;
    this._renderer.setSize(window.innerWidth, window.innerHeight, false);
    this._camera.aspect = window.innerWidth / window.innerHeight;
    this._camera.updateProjectionMatrix();
  }

  _teardown() {
    /* 렌더러는 유지하되 씬 그래프와 풀/적은 모두 해제합니다.
       다음 enter 시 _setupScene 등으로 깨끗한 상태에서 시작합니다. */
    this._allies?.forEach((a) => { this._scene?.remove(a.mesh); });
    this._allies?.clear();
    this._allies = null;
    this._enemies?.forEach((e) => { this._scene.remove(e.mesh); });
    this._enemies?.clear();
    this._groundTexture = null;
    this._sharedGroundTexture = null;
    [this._bulletPool, this._missilePool, this._flarePool, this._explosionPool].forEach((pool) => {
      pool?.forEachActive((obj) => this._scene.remove(obj));
    });
    this._scene?.traverse((obj) => {
      obj.geometry?.dispose?.();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => {
          if (m.map && m.userData?.sharedMap) {
            m.map = null;
          }
          m.dispose?.();
        });
      }
    });
    if (this._terrainMaterials) {
      Object.values(this._terrainMaterials).forEach((mat) => {
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.());
        else mat?.dispose?.();
      });
      this._terrainMaterials = null;
      this._terrainMaterialsKey = null;
    }
    this._scene = null;
    this._terrain = null;
    this._settlements = null;
    this._mapFeatures = null;
    this._boundaries = null;
    this._clouds = null;
    this._terrainColliders = null;
    this._buildingColliders = null;
    this._worldLayout = null;
    this._settlementSites = null;
    this._bulletPool = null;
    this._missilePool = null;
    this._flarePool = null;
    this._explosionPool = null;
    this._player = null;
    this._players = null;
    this._session = null;
    if (this._fpCockpitMesh) {
      this._camera?.remove(this._fpCockpitMesh);
      this._fpCockpitMesh.traverse((obj) => {
        obj.geometry?.dispose?.();
        if (obj.material) obj.material.dispose?.();
      });
      this._fpCockpitMesh = null;
    }
    /* 레이더 캔버스는 DOM 으로 살아 있으나, 다음 enter 시 _setupRadar 가 컨텍스트를 다시 잡습니다.
       남은 잔상은 한 번 비워줍니다. */
    if (this._radarCtx) this._radarCtx.clearRect(0, 0, this._radar.width, this._radar.height);
    this._radarCtx = null;
    this._canvas.style.display = 'none';
    this._canvas.style.visibility = 'visible';
    this._hud?.classList.remove('battle-ended');
    this._hudEls.modal.classList.add('hidden');
    this._hudEls.modal.classList.remove('battle-result-fullscreen');
    this._hideMapLoading();
  }
}

BattleManager._worldAssetCache = new Map();
BattleManager._worldAssetCacheOrder = [];

  Sky.BattleManager = BattleManager;
})(window.Sky = window.Sky || {}, window.THREE);
