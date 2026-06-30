/* <!--
  Sky of Warriors - 전투기 카탈로그 데이터.
  스키마(.cursor/rules/aircraft-schema.mdc)에 정의된 표준 필드를 그대로 따릅니다.
  - stats         : 기본 성능치이며 업그레이드 레벨에 따라 곱연산됩니다.
  - weapons.secondary : 미사일 적재량(정수).
  - assets        : 자산 경로는 프로젝트 상대경로로 지정.
                    현재는 3D 모델을 코드로 생성하므로 prefabPath는 식별 키 역할만 합니다.
  - country       : 상점 필터링에 사용되는 제조 국가 코드.
  - meshType      : Aircraft.js 의 형상 빌더 디스패치 키. 각 기체의 실루엣을 결정합니다.

  파일 구조: file:// 환경(index.html 더블클릭)에서도 동작하도록 ES 모듈 대신
            IIFE + 전역 네임스페이스(window.Sky.fighters) 패턴을 사용합니다.
--> */
(function (Sky) {
  'use strict';

const COUNTRIES = [
  { code: 'ALL', label: '전체',   flag: '🌐' },
  { code: 'US',  label: '미국',   flag: '🇺🇸' },
  { code: 'RU',  label: '러시아', flag: '🇷🇺' },
  { code: 'EU',  label: '유럽',   flag: '🇪🇺' },
  { code: 'KR',  label: '한국',   flag: '🇰🇷' },
  { code: 'CN',  label: '중국',   flag: '🇨🇳' },
];

const FIGHTERS = [
  /* ===================== 🇺🇸 미국 ===================== */
  {
    id: 'fighter_001', // 기존 세이브 호환을 위해 ID 유지 (기본 지급기)
    country: 'US',
    meshType: 'f16',
    modelName: 'F-16A Fighting Falcon',
    stats: { speed: 135, agility: 120, armor: 65, fuel: 100 },
    weapons: { primary: 'machine_gun', secondary: 4 },
    assets: {
      prefabPath: 'assets/models/f16.glb',
      thumbnailPath: 'UI/Thumbnails/f16a.png',
      modelKey: 'f16',
    },
    price: 0,
    palette: {
      body: 0x8a929c,
      belly: 0x9aa4ae,
      camo: 0x788088,
      radome: 0x505860,
      accent: 0x3a444f,
      cockpit: 0x3a4654,
      decal: 0xb8c0c8,
    },
    description: '단발 다목적 전투기. 고스트 회색 도장·AIM-120/9·3연 연료탱크 외부탑재가 특징입니다.',
    /* <!-- 개량 체인: F-16A → F-16C → F-16E → F-16V --> */
    upgradePath: { to: 'f16c', cost: 12000 },
  },
  {
    id: 'f16c',
    country: 'US',
    meshType: 'f16',
    modelName: 'F-16C Fighting Falcon',
    stats: { speed: 140, agility: 122, armor: 72, fuel: 105 },
    weapons: { primary: 'machine_gun', secondary: 5 },
    assets: { prefabPath: 'assets/models/f16.glb', thumbnailPath: 'UI/Thumbnails/f16c.png', modelKey: 'f16' },
    price: 0,
    purchasable: false,
    palette: { body: 0x687280, belly: 0x94a0ac, camo: 0x586270, radome: 0x181c22, accent: 0x2a3340, cockpit: 0x14202c, decal: 0xd0d8e2 },
    description: '블록 40/50급 다목적형. 개선된 항전·레이더와 AIM-120 운용 능력이 강화되었습니다.',
    upgradePath: { to: 'f16e', cost: 18000 },
  },
  {
    id: 'f16e',
    country: 'US',
    meshType: 'f16',
    modelName: 'F-16E Block 60',
    stats: { speed: 145, agility: 125, armor: 78, fuel: 115 },
    weapons: { primary: 'machine_gun', secondary: 6 },
    assets: { prefabPath: 'assets/models/f16.glb', thumbnailPath: 'UI/Thumbnails/f16e.png', modelKey: 'f16' },
    price: 0,
    purchasable: false,
    palette: { body: 0x626c78, belly: 0x909aa6, camo: 0x525c68, radome: 0x161a20, accent: 0x3a4a58, cockpit: 0x121a28, decal: 0xccd4dc },
    description: '블록 60 UAE형 파생. 콘포멀 연료탱크와 강화된 내구 구조, 장거리 작전에 최적화되었습니다.',
    upgradePath: { to: 'f16v', cost: 26000 },
  },
  {
    id: 'f16v',
    country: 'US',
    meshType: 'f16',
    modelName: 'F-16V Viper',
    stats: { speed: 150, agility: 128, armor: 82, fuel: 110 },
    weapons: { primary: 'machine_gun', secondary: 6 },
    assets: { prefabPath: 'assets/models/f16.glb', thumbnailPath: 'UI/Thumbnails/f16v.png', modelKey: 'f16' },
    price: 0,
    purchasable: false,
    palette: { body: 0x646e7a, belly: 0x929caa, camo: 0x545e6a, radome: 0x161a20, accent: 0x1e2838, cockpit: 0x0f1824, decal: 0xd0d8e2 },
    description: '최신 Viper Block 70/72. CFT·AESA·타게팅 포드·고스트 회색 도장으로 장거리 전투에 최적화되었습니다.',
  },
  {
    id: 'f15a',
    country: 'US',
    meshType: 'f15',
    modelName: 'F-15A Eagle',
    stats: { speed: 145, agility: 95, armor: 105, fuel: 130 },
    weapons: { primary: 'machine_gun', secondary: 6 },
    assets: {
      prefabPath: 'assets/models/f15.glb',
      thumbnailPath: 'UI/Thumbnails/f15a.png',
      modelKey: 'f15',
    },
    price: 22000,
    palette: {
      body: 0x88929c,
      belly: 0x959fa8,
      radome: 0x505860,
      accent: 0x3a444f,
      cockpit: 0x3a4654,
      decal: 0xb0b8c0,
    },
    description: '쌍발 엔진의 전천후 공중우세 전투기. 어깨 위로 올린 주익과 두 장의 수직미익이 위풍당당합니다.',
    /* <!-- 개량 체인: F-15A → F-15C → F-15E → F-15EX --> */
    upgradePath: { to: 'f15c', cost: 14000 },
  },
  {
    id: 'f15c',
    country: 'US',
    meshType: 'f15',
    modelName: 'F-15C Eagle',
    stats: { speed: 150, agility: 98, armor: 112, fuel: 135 },
    weapons: { primary: 'machine_gun', secondary: 6 },
    assets: {
      prefabPath: 'assets/models/f15.glb',
      thumbnailPath: 'UI/Thumbnails/f15c.png',
      modelKey: 'f15',
    },
    price: 0,
    purchasable: false,
    palette: {
      body: 0x828c98,
      belly: 0x929ca8,
      radome: 0x484e58,
      accent: 0x343e4a,
      cockpit: 0x3a4654,
      decal: 0xa8b0b8,
    },
    description: 'MSIP 개량형 공중우세기. 강화된 항전·레이더와 개선된 생존성을 갖춘 C/D 계열 발전형입니다.',
    upgradePath: { to: 'f15e', cost: 21000 },
  },
  {
    id: 'f15e',
    country: 'US',
    meshType: 'f15',
    modelName: 'F-15E Strike Eagle',
    stats: { speed: 154, agility: 100, armor: 120, fuel: 145 },
    weapons: { primary: 'machine_gun', secondary: 7 },
    assets: {
      prefabPath: 'assets/models/f15.glb',
      thumbnailPath: 'UI/Thumbnails/f15e.png',
      modelKey: 'f15',
    },
    price: 0,
    purchasable: false,
    palette: {
      body: 0x7a848e,
      belly: 0x8a949e,
      radome: 0x444a54,
      accent: 0x2e3844,
      cockpit: 0x36404c,
      decal: 0x9ea6ae,
    },
    description: '2인 승무 다목적 타격기. 대공·대지 임무를 겸하는 Strike Eagle. 연료·장갑·무장이 대폭 강화되었습니다.',
    upgradePath: { to: 'f15ex', cost: 30000 },
  },
  {
    id: 'f15ex',
    country: 'US',
    meshType: 'f15',
    modelName: 'F-15EX Eagle II',
    stats: { speed: 158, agility: 102, armor: 128, fuel: 150 },
    weapons: { primary: 'machine_gun', secondary: 8 },
    assets: {
      prefabPath: 'assets/models/f15.glb',
      thumbnailPath: 'UI/Thumbnails/f15ex.png',
      modelKey: 'f15',
    },
    price: 0,
    purchasable: false,
    palette: {
      body: 0x727c88,
      belly: 0x828c98,
      radome: 0x404650,
      accent: 0x252d38,
      cockpit: 0x323c48,
      decal: 0x98a0a8,
    },
    description: '최신 Eagle II. 디지털 백본·AESA·확장 무장 운용으로 F-15 계열의 최종 진화형입니다.',
  },
  {
    id: 'f14',
    country: 'US',
    meshType: 'f14',
    modelName: 'F-14 Tomcat',
    stats: { speed: 150, agility: 90, armor: 100, fuel: 140 },
    weapons: { primary: 'machine_gun', secondary: 6 },
    assets: {
      prefabPath: 'assets/models/f14.glb',
      thumbnailPath: 'UI/Thumbnails/f14.png',
      modelKey: 'f14',
    },
    price: 28000,
    palette: {
      body: 0x8a929c,
      belly: 0x969fa8,
      radome: 0x505860,
      accent: 0x2b323b,
      cockpit: 0x3a4654,
      decal: 0xb0b8c0,
    },
    description: '함재용 가변익 요격기. 좌우로 벌어진 쌍발 엔진과 펼쳐진 주익이 트레이드마크입니다.',
  },
  {
    id: 'fa18',
    country: 'US',
    meshType: 'fa18',
    modelName: 'F/A-18E Super Hornet',
    stats: { speed: 148, agility: 115, armor: 88, fuel: 125 },
    weapons: { primary: 'machine_gun', secondary: 5 },
    assets: { prefabPath: 'Prefabs/Fighters/FA18E', thumbnailPath: 'UI/Thumbnails/fa18e.png' },
    price: 32000,
    palette: { body: 0x7a8794, accent: 0x2a3540, cockpit: 0x141c28 },
    description: '함재 다목적 전투기. LERX와 캔트 수직미익, 견고한 함상 운용성이 특징입니다.',
    /* <!-- F-14 관리에서 스탯 2개 이상 MAX 시 상점 구매 잠금 해제 --> */
    unlock: { requiresOwned: 'f14', minMaxedStats: 2 },
  },
  {
    id: 'f22',
    country: 'US',
    meshType: 'f22',
    modelName: 'F-22 Raptor',
    stats: { speed: 165, agility: 130, armor: 100, fuel: 130 },
    weapons: { primary: 'machine_gun', secondary: 6 },
    assets: { prefabPath: 'Prefabs/Fighters/F22', thumbnailPath: 'UI/Thumbnails/f22.png' },
    price: 50000,
    palette: { body: 0x3a3f48, accent: 0x1e2228, cockpit: 0x0d1018 },
    description: '5세대 스텔스 제공기. 다이아몬드 평면형과 바깥쪽으로 기울어진 두 장의 수직미익이 특징입니다.',
  },

  /* ===================== 🇷🇺 러시아 ===================== */
  {
    id: 'mig29a',
    country: 'RU',
    meshType: 'mig29',
    modelName: 'MiG-29A Fulcrum',
    stats: { speed: 145, agility: 125, armor: 60, fuel: 85 },
    weapons: { primary: 'machine_gun', secondary: 4 },
    assets: { prefabPath: 'Prefabs/Fighters/MiG29A', thumbnailPath: 'UI/Thumbnails/mig29a.png' },
    price: 9000,
    palette: { body: 0x5e6a55, accent: 0xb84442, cockpit: 0x131a14 },
    description: '단거리 공중우세 전투기. 분리된 쌍발 엔진과 LERX, 두 장의 수직미익이 단단해 보입니다.',
    /* <!-- 개량 체인: MiG-29A → MiG-29C → MiG-29M(MiG-33) → MiG-35 --> */
    upgradePath: { to: 'mig29c', cost: 10000 },
  },
  {
    id: 'mig29c',
    country: 'RU',
    meshType: 'mig29',
    modelName: 'MiG-29C Fulcrum',
    stats: { speed: 148, agility: 127, armor: 68, fuel: 90 },
    weapons: { primary: 'machine_gun', secondary: 5 },
    assets: { prefabPath: 'Prefabs/Fighters/MiG29C', thumbnailPath: 'UI/Thumbnails/mig29c.png' },
    price: 0,
    purchasable: false,
    palette: { body: 0x566452, accent: 0xae3e3c, cockpit: 0x121814 },
    description: '항전·레이더가 개선된 C형. 연료량과 생존성이 보강된 초기 개량형입니다.',
    upgradePath: { to: 'mig29m', cost: 16000 },
  },
  {
    id: 'mig29m',
    country: 'RU',
    meshType: 'mig29',
    modelName: 'MiG-29M Fulcrum (MiG-33)',
    stats: { speed: 152, agility: 128, armor: 75, fuel: 100 },
    weapons: { primary: 'machine_gun', secondary: 6 },
    assets: { prefabPath: 'Prefabs/Fighters/MiG29M', thumbnailPath: 'UI/Thumbnails/mig29m.png' },
    price: 0,
    purchasable: false,
    palette: { body: 0x4e5c4e, accent: 0xa03838, cockpit: 0x101612 },
    description: 'MiG-33 계열 다목적 발전형. 연료·장갑·미사일 운용 능력이 크게 향상되었습니다.',
    upgradePath: { to: 'mig35', cost: 24000 },
  },
  {
    id: 'mig35',
    country: 'RU',
    meshType: 'mig29',
    modelName: 'MiG-35 Fulcrum-F',
    stats: { speed: 156, agility: 130, armor: 82, fuel: 105 },
    weapons: { primary: 'machine_gun', secondary: 6 },
    assets: { prefabPath: 'Prefabs/Fighters/MiG35', thumbnailPath: 'UI/Thumbnails/mig35.png' },
    price: 0,
    purchasable: false,
    palette: { body: 0x465448, accent: 0x943434, cockpit: 0x0e1410 },
    description: '4++세대 최종형. AESA·현대 항전 suite·강화된 기동성으로 Fulcrum 계열의 정점입니다.',
  },
  {
    id: 'su27',
    country: 'RU',
    meshType: 'su27',
    modelName: 'Su-27 Flanker',
    stats: { speed: 150, agility: 120, armor: 110, fuel: 140 },
    weapons: { primary: 'machine_gun', secondary: 6 },
    assets: { prefabPath: 'Prefabs/Fighters/Su27', thumbnailPath: 'UI/Thumbnails/su27.png' },
    price: 24000,
    palette: { body: 0x4d5a48, accent: 0x9aa994, cockpit: 0x111811 },
    description: '대형 블렌디드 윙바디 제공기. 길고 부드러운 동체에 멀리 떨어진 쌍발 엔진이 자리합니다.',
    /* <!-- 개량 체인: Su-27 → Su-30 → Su-32 → Su-35. cost 는 GameState.improveFighter 에서 차감. --> */
    upgradePath: { to: 'su30', cost: 18000 },
  },
  /* <!--
    개량 전용 변형(purchasable: false). 상점에서 직접 구매할 수 없고,
    이전 모델을 보유한 상태에서 "개량" 버튼을 통해서만 획득합니다.
    스탯은 베이스(Su-27)보다 점진적으로 향상되도록 설계해 개량 비용 정당성을 부여합니다.
  --> */
  {
    id: 'su30',
    country: 'RU',
    meshType: 'su30',
    modelName: 'Su-30 Flanker-C',
    stats: { speed: 152, agility: 122, armor: 115, fuel: 150 },
    weapons: { primary: 'machine_gun', secondary: 7 },
    assets: { prefabPath: 'Prefabs/Fighters/Su30', thumbnailPath: 'UI/Thumbnails/su30.png' },
    price: 0,
    purchasable: false,
    palette: { body: 0x4a5a55, accent: 0x96a39c, cockpit: 0x111811 },
    description: '다목적 발전형. 카나드와 2인 탠덤 캐노피, 강화된 항전 장비가 특징입니다.',
    upgradePath: { to: 'su32', cost: 24000 },
  },
  {
    id: 'su32',
    country: 'RU',
    meshType: 'su32',
    modelName: 'Su-32 Strike Flanker',
    stats: { speed: 148, agility: 120, armor: 140, fuel: 175 },
    weapons: { primary: 'machine_gun', secondary: 8 },
    assets: { prefabPath: 'Prefabs/Fighters/Su32', thumbnailPath: 'UI/Thumbnails/su32.png' },
    price: 0,
    purchasable: false,
    palette: { body: 0x556e58, accent: 0xb1bca6, cockpit: 0x121e14 },
    description: '폭격형 파생. 넓적한 사이드-바이-사이드 콕핏과 두꺼운 장갑, 늘어난 항속거리를 자랑합니다.',
    upgradePath: { to: 'su35', cost: 32000 },
  },
  {
    id: 'su35',
    country: 'RU',
    meshType: 'su35',
    modelName: 'Su-35S Flanker-E',
    stats: { speed: 168, agility: 138, armor: 125, fuel: 160 },
    weapons: { primary: 'machine_gun', secondary: 8 },
    assets: { prefabPath: 'Prefabs/Fighters/Su35', thumbnailPath: 'UI/Thumbnails/su35.png' },
    price: 0,
    purchasable: false,
    palette: { body: 0x3f4a44, accent: 0x8a9690, cockpit: 0x0f1614 },
    description: '4.5세대 최종 발전형. 추력편향 노즐과 강화된 항전 시스템으로 극초기동을 발휘합니다.',
  },
  {
    id: 'su57',
    country: 'RU',
    meshType: 'su57',
    modelName: 'Su-57 Felon',
    stats: { speed: 162, agility: 130, armor: 100, fuel: 135 },
    weapons: { primary: 'machine_gun', secondary: 6 },
    assets: { prefabPath: 'Prefabs/Fighters/Su57', thumbnailPath: 'UI/Thumbnails/su57.png' },
    price: 46000,
    palette: { body: 0x39424c, accent: 0x1c2128, cockpit: 0x0f1620 },
    description: '러시아의 5세대 스텔스 전투기. 외측으로 기울어진 쌍수직미익과 LEVCON, 추력편향 노즐을 갖췄습니다.',
  },

  /* ===================== 🇪🇺 유럽 ===================== */
  {
    id: 'typhoon',
    country: 'EU',
    meshType: 'typhoon',
    modelName: 'Eurofighter Typhoon',
    stats: { speed: 152, agility: 130, armor: 80, fuel: 110 },
    weapons: { primary: 'machine_gun', secondary: 5 },
    assets: { prefabPath: 'Prefabs/Fighters/Typhoon', thumbnailPath: 'UI/Thumbnails/typhoon.png' },
    price: 26000,
    palette: { body: 0x7a8693, accent: 0x2a3038, cockpit: 0x111722 },
    description: '델타익 + 카나드 조합의 4.5세대 다목적기. 유럽 여러 나라가 공동 개발했습니다.',
  },
  {
    id: 'rafale',
    country: 'EU',
    meshType: 'rafale',
    modelName: 'Dassault Rafale',
    stats: { speed: 148, agility: 130, armor: 80, fuel: 110 },
    weapons: { primary: 'machine_gun', secondary: 5 },
    assets: { prefabPath: 'Prefabs/Fighters/Rafale', thumbnailPath: 'UI/Thumbnails/rafale.png' },
    price: 27000,
    palette: { body: 0x4a5562, accent: 0xbac4cf, cockpit: 0x111824 },
    description: '프랑스의 함재 가능한 다목적기. 카나드가 흡입구 위에 자리 잡은 컴팩트 델타기입니다.',
  },
  {
    id: 'tornado',
    country: 'EU',
    meshType: 'tornado',
    modelName: 'Panavia Tornado',
    stats: { speed: 138, agility: 90, armor: 105, fuel: 130 },
    weapons: { primary: 'machine_gun', secondary: 6 },
    assets: { prefabPath: 'Prefabs/Fighters/Tornado', thumbnailPath: 'UI/Thumbnails/tornado.png' },
    price: 19000,
    palette: { body: 0x4f5b66, accent: 0x9aa5b0, cockpit: 0x111722 },
    description: '영국·독일·이탈리아 공동 개발의 가변익 전폭기. 두꺼운 동체와 한 장의 큰 수직미익이 특징입니다.',
  },

  /* ===================== 🇰🇷 한국 ===================== */
  {
    id: 'kf21',
    country: 'KR',
    meshType: 'kf21',
    modelName: 'KF-21 Boramae Block 1',
    stats: { speed: 150, agility: 120, armor: 95, fuel: 120 },
    weapons: { primary: 'machine_gun', secondary: 5 },
    assets: { prefabPath: 'Prefabs/Fighters/KF21', thumbnailPath: 'UI/Thumbnails/kf21.png' },
    price: 32000,
    palette: { body: 0xe6e8ec, accent: 0xc8202a, cockpit: 0x101a26 },
    description: '한국이 독자 개발한 4.5세대 다목적기. 살짝 기울어진 쌍수직미익이 현대적입니다.',
  },
  {
    id: 'fa50',
    country: 'KR',
    meshType: 'fa50',
    modelName: 'FA-50 Fighting Eagle',
    stats: { speed: 130, agility: 120, armor: 78, fuel: 95 },
    weapons: { primary: 'machine_gun', secondary: 3 },
    assets: { prefabPath: 'Prefabs/Fighters/FA50', thumbnailPath: 'UI/Thumbnails/fa50.png' },
    price: 11000,
    palette: { body: 0x1a1f2b, accent: 0xf2c14e, cockpit: 0x0a0d14 },
    description: '훈련기 베이스의 경공격기. 작고 민첩하며 입문자가 다루기 편한 단발 전투기입니다.',
  },

  /* ===================== 🇨🇳 중국 ===================== */
  {
    id: 'j20',
    country: 'CN',
    meshType: 'j20',
    modelName: 'J-20 Mighty Dragon',
    stats: { speed: 160, agility: 120, armor: 95, fuel: 135 },
    weapons: { primary: 'machine_gun', secondary: 6 },
    assets: { prefabPath: 'Prefabs/Fighters/J20', thumbnailPath: 'UI/Thumbnails/j20.png' },
    price: 48000,
    palette: { body: 0x2a2e38, accent: 0xd9b04a, cockpit: 0x101421 },
    description: '카나드를 가진 중국제 스텔스기. 긴 노즈와 카나드-델타 조합이 인상적입니다.',
  },
  {
    id: 'j10',
    country: 'CN',
    meshType: 'j10',
    modelName: 'J-10A Vigorous Dragon',
    stats: { speed: 140, agility: 125, armor: 75, fuel: 105 },
    weapons: { primary: 'machine_gun', secondary: 4 },
    assets: { prefabPath: 'Prefabs/Fighters/J10', thumbnailPath: 'UI/Thumbnails/j10.png' },
    price: 16000,
    palette: { body: 0x7a8593, accent: 0xc2cad4, cockpit: 0x121823 },
    description: '카나드 + 델타익의 단발 다목적기. 배밑 흡입구가 특징인 경량 기체입니다.',
  },
];

/* <!--
  체급별 선회 배율: light(소형) > medium > heavy(대형).
  러시아(RU)·F-14 는 같은 체급 대비 "비교적" 빠르게만 보정(절대값 과다 상향 금지).
--> */
const STEALTH_MESH_TYPES = new Set(['f22', 'su57', 'j20']);

const MESH_SIZE_TIER = {
  fa50: 'light', j10: 'light', mig29: 'light', f16: 'light', rafale: 'light',
  typhoon: 'medium', kf21: 'medium', f15: 'medium', f22: 'medium', fa18: 'medium', su30: 'medium', su35: 'medium', su57: 'medium',
  f14: 'heavy', su27: 'heavy', su32: 'heavy', tornado: 'heavy', j20: 'heavy',
};
const SIZE_TURN_MUL = { light: 1.14, medium: 1.0, heavy: 0.86 };
const TURN_MUL_RU = 1.1;
const TURN_MUL_F14 = 1.1;
const TURN_MUL_FA50 = 1.12; /* 경공격기: 소형 체급 + 추가 기동 보너스 */

function getSizeTier(fighter) {
  return MESH_SIZE_TIER[fighter?.meshType] ?? 'medium';
}

/* <!--
  플레이어·적 AI 공통 선회율(rad/s). finalStats 가 있으면 업그레이드 반영 agility 사용.
--> */
function computeTurnRates(fighter, finalStats = null) {
  const agi = finalStats?.agility ?? fighter.stats.agility;
  let mul = SIZE_TURN_MUL[getSizeTier(fighter)] ?? 1;
  if (fighter.country === 'RU') mul *= TURN_MUL_RU;
  if (fighter.id === 'f14') mul *= TURN_MUL_F14;
  if (fighter.id === 'fa50') mul *= TURN_MUL_FA50;

  const pitchRate = (0.22 + agi * 0.0048) * mul;
  const rollRate = (0.3 + agi * 0.0058) * mul;
  const yawRate = (0.18 + agi * 0.0036) * mul;
  const steerRate = (pitchRate + rollRate + yawRate) / 3;

  return { pitchRate, rollRate, yawRate, steerRate, sizeTier: getSizeTier(fighter) };
}

function findFighterByMeshType(meshType) {
  return FIGHTERS.find((f) => f.meshType === meshType) ?? FIGHTERS[0];
}

/* <!--
  업그레이드 설정.
  각 스탯은 레벨마다 multiplier 만큼 증가하며 maxLevel까지 강화 가능합니다.
  baseCost * (level + 1)^costExp 로 비용을 계산해 후반부로 갈수록 비싸지도록 설계했습니다.
--> */
const UPGRADE_CONFIG = {
  speed:    { label: '속도',     multiplier: 0.10, baseCost: 800,  costExp: 1.6, maxLevel: 8, desc: '최고 속도와 부스트 가속을 향상시킵니다.' },
  agility:  { label: '기동성',   multiplier: 0.10, baseCost: 900,  costExp: 1.6, maxLevel: 8, desc: '롤·피치·요 회전 속도를 개선합니다.' },
  armor:    { label: '내구도',   multiplier: 0.15, baseCost: 1000, costExp: 1.65, maxLevel: 8, desc: '최대 체력을 늘려 더 오래 생존합니다.' },
  firepower:{ label: '공격력',   multiplier: 0.18, baseCost: 1200, costExp: 1.7, maxLevel: 8, desc: '기관총·미사일 데미지를 향상시킵니다.' },
};

/* <!--
  레벨이 반영된 최종 스탯을 계산하는 헬퍼.
  업그레이드 시스템과 BattleManager 양쪽에서 동일한 식을 사용하기 위해 공유합니다.
--> */
function computeFinalStats(fighter, upgrades = {}) {
  const lv = (k) => Math.max(0, upgrades[k] ?? 0);
  const mul = (k) => 1 + (UPGRADE_CONFIG[k]?.multiplier ?? 0) * lv(k);
  return {
    speed:     fighter.stats.speed     * mul('speed'),
    agility:   fighter.stats.agility   * mul('agility'),
    armor:     fighter.stats.armor     * mul('armor'),
    fuel:      fighter.stats.fuel,
    firepower: 1 * mul('firepower'),
  };
}

function upgradeCost(key, currentLevel) {
  const cfg = UPGRADE_CONFIG[key];
  if (!cfg) return Infinity;
  if (currentLevel >= cfg.maxLevel) return Infinity;
  return Math.floor(cfg.baseCost * Math.pow(currentLevel + 1, cfg.costExp));
}

function findFighter(id) {
  return FIGHTERS.find((f) => f.id === id) ?? FIGHTERS[0];
}

/* <!--
  상점 노출 기준:
  - purchasable !== false 인 기체는 항상 노출 (상점에서 직접 구매 가능)
  - purchasable === false 인 변형(개량 전용)은 보유한 경우에만 노출
  ownedIds 를 받아 호출 측이 GameState 의존성을 직접 알 필요가 없도록 분리했습니다.
--> */
function fightersByCountry(code, ownedIds = null) {
  const list = (!code || code === 'ALL') ? FIGHTERS.slice() : FIGHTERS.filter((f) => f.country === code);
  if (!ownedIds) return list;
  return list.filter((f) => f.purchasable !== false || ownedIds.includes(f.id));
}

function findCountry(code) {
  return COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0];
}

/* <!--
  현재 기체의 다음 개량 단계 정보를 반환합니다.
  반환값: { target, cost } 또는 null (개량 불가).
--> */
function getImprovementTarget(fighter, ownedIds = null) {
  if (!fighter?.upgradePath?.to) return null;
  const target = findFighter(fighter.upgradePath.to);
  if (!target || target.id === fighter.id) return null;
  if (ownedIds && ownedIds.includes(target.id)) return null;
  return { target, cost: fighter.upgradePath.cost ?? 0 };
}

/* <!-- 잠금 해제: 선행 기체의 MAX 스탯 개수를 집계합니다. --> */
function countMaxedUpgradeStats(upgradesForFighter = {}) {
  return Object.entries(UPGRADE_CONFIG).filter(
    ([key, cfg]) => (upgradesForFighter[key] ?? 0) >= cfg.maxLevel,
  ).length;
}

function getFighterUnlockStatus(fighter, { ownedIds = [], getUpgrade = () => ({}) } = {}) {
  if (!fighter?.unlock) return { unlocked: true, maxed: 0, required: 0 };
  const { requiresOwned, minMaxedStats } = fighter.unlock;
  const prereq = findFighter(requiresOwned);
  if (!ownedIds.includes(requiresOwned)) {
    return {
      unlocked: false,
      maxed: 0,
      required: minMaxedStats,
      requiresFighter: prereq,
      needsOwnership: true,
    };
  }
  const maxed = countMaxedUpgradeStats(getUpgrade(requiresOwned));
  return {
    unlocked: maxed >= minMaxedStats,
    maxed,
    required: minMaxedStats,
    requiresFighter: prereq,
    needsOwnership: false,
  };
}

function isFighterUnlocked(fighter, context) {
  return getFighterUnlockStatus(fighter, context).unlocked;
}

/* <!--
  상점 노출: 개량형 필터 + 선행 기체 보유 시 잠금 해제 대상 기체를 함께 노출합니다.
--> */
function getShopFighters(code, ownedIds, getUpgrade = () => ({})) {
  const list = fightersByCountry(code, ownedIds);
  const seen = new Set(list.map((f) => f.id));
  FIGHTERS.forEach((f) => {
    if (seen.has(f.id) || f.purchasable === false || !f.unlock) return;
    if (code !== 'ALL' && f.country !== code) return;
    if (!ownedIds.includes(f.unlock.requiresOwned)) return;
    list.push(f);
    seen.add(f.id);
  });
  return list;
}

  /* <!-- 전역 네임스페이스에 노출. 다른 스크립트는 Sky.fighters.* 로 참조합니다. --> */
  Sky.fighters = {
    COUNTRIES,
    FIGHTERS,
    UPGRADE_CONFIG,
    computeFinalStats,
    computeTurnRates,
    getSizeTier,
    findFighterByMeshType,
    MESH_SIZE_TIER,
    upgradeCost,
    findFighter,
    fightersByCountry,
    findCountry,
    getImprovementTarget,
    countMaxedUpgradeStats,
    getFighterUnlockStatus,
    isFighterUnlocked,
    getShopFighters,
    STEALTH_MESH_TYPES,
  };
})(window.Sky = window.Sky || {});
