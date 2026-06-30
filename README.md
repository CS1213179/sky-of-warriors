# Sky of Warriors

브라우저에서 동작하는 3D 3인칭 전투기 슈팅 게임입니다.
Three.js(CDN, ES Modules)를 사용하며 별도의 빌드 도구 없이 정적 서버만으로 실행됩니다.

## 실행 방법

### 1. 가장 간단한 방법 — `index.html` 더블클릭

`index.html` 을 더블클릭하면 브라우저가 곧바로 게임을 실행합니다.
별도의 로컬 서버나 빌드 도구가 전혀 필요 없습니다.

> 인터넷 연결은 필요합니다. Three.js 만 jsDelivr CDN(`three@0.149.0`)에서 로드합니다.

### 2. 로컬 서버 (개발용, 선택)

코드 수정 후 캐시 이슈가 없도록 새로고침하고 싶다면 가벼운 정적 서버를 띄울 수 있습니다.

```powershell
cd "Sky of Wariors"
node -e "const http=require('http'),fs=require('fs'),path=require('path');const MIME={'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};http.createServer((q,s)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';p=path.join('.',p);fs.readFile(p,(e,d)=>{if(e){s.writeHead(404);s.end();return}s.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});s.end(d)})}).listen(5173,()=>console.log('http://localhost:5173'))"
```

Python 3 도 가능합니다.

```powershell
python -m http.server 5173
```

VS Code 사용자는 "Live Server" 확장을 사용해도 됩니다.

## 조작

| 키 | 기능 |
| --- | --- |
| `↑` / `↓` | 엘리베이터 (기수 상승 · 하강) |
| `←` / `→` | 러더 (좌·우 선회) |
| `W` / `S` | 에일러론 (좌·우 롤, 롤에 따른 자연 선회 결합) |
| `Space` 또는 `좌클릭` | 기관총 (스프레드 산탄군) |
| `A` | 미사일 (락온 자동 유도) |
| `D` | 플레어 / 채프 (적 호밍 미사일을 디코이로 유인) |
| `V` | 시점 전환 (1인칭 콕핏 ↔ 3인칭 추적) |
| `Shift` | 부스트 (게이지 소모) |

화면 정면 콘 안의 가까운 적이 자동으로 락온됩니다. 락온이 완료되면 화면 중앙에 `LOCK` 표시가 나오며, 이 상태에서 미사일을 발사하면 추적합니다.

## 게임 루프

1. **전투** : 적 격추 수 + 점수 + 생존 시간에 비례한 보상을 획득합니다.
2. **상점** : 전투기를 게임머니로 구매하고 장착합니다.
3. **업그레이드 (상점 내 관리 모달)** : 보유 기체의 속도 / 기동성 / 내구도 / 공격력을 강화합니다.
4. **개량 (Modernization, 상점 내 관리 모달)** : 일부 기체는 상위 파생형으로 변환할 수 있습니다.
   - 러시아: `Su-27 → Su-30 → Su-32 → Su-35`
   - 개량 시 누적 업그레이드 레벨은 그대로 새 기체로 이관됩니다.
5. 더 강한 기체로 다시 전투에 나갑니다.

진행 상태는 `localStorage`(`sky_of_warriors:save:v1`)에 저장되며, PII는 일절 수집하지 않습니다.

## 폴더 구조

```
.
├─ index.html             # 진입점, UI 오버레이/캔버스 정의
├─ css/main.css           # 전체 스타일
├─ data/fighters.js       # 전투기 카탈로그 + 업그레이드 설정/헬퍼
├─ js/
│  ├─ main.js             # 부트스트랩
│  ├─ core/
│  │  ├─ GameState.js     # 진행 데이터 + 저장
│  │  ├─ InputManager.js  # 키보드/마우스 입력 정규화
│  │  └─ ObjectPool.js    # 탄환/미사일/폭발 풀
│  ├─ entities/
│  │  └─ Aircraft.js      # 절차적 전투기 메시 빌더 (썸네일/배틀 공유)
│  └─ managers/
│     ├─ SceneManager.js  # 화면 전환
│     ├─ MenuManager.js   # 메인 메뉴
│     ├─ ShopManager.js   # 상점 (구매 + 장착 + 업그레이드 + 개량 통합)
│     └─ BattleManager.js # 3D 전투 씬
└─ .cursor/rules/         # 프로젝트 룰
```

## 기술 메모

- 3D 모델은 외부 자산 없이 `BoxGeometry` / `CapsuleGeometry` / `ConeGeometry`를 조합한 절차 생성 형태입니다.
- 탄환, 미사일, 폭발 이펙트는 `ObjectPool`로 재사용해 GC 압력을 최소화합니다.
- 카메라는 플레이어 후방의 로컬 오프셋을 월드로 변환한 뒤 댐핑 보간으로 따라갑니다.
- 미사일 유도는 현재 속도 벡터를 `target - missile` 방향으로 매 프레임 `lerp` 합니다 (`turnRate * dt`).
- 업그레이드 수치는 `data/fighters.js`의 `UPGRADE_CONFIG`에서 단일 정의되며, 비용은 `baseCost * (level+1)^costExp` 공식을 사용합니다.
- 모듈 시스템: ES 모듈 대신 **IIFE + 전역 `window.Sky` 네임스페이스** 패턴을 사용합니다.
  `index.html` 을 `file://` 로 직접 열어도 동작하도록 한 의도적 선택입니다.
  각 스크립트는 `(function (Sky[, THREE]) { ... Sky.X = X; })(window.Sky = window.Sky || {}[, window.THREE])` 형태로 자체 캡슐화되며, `index.html` 의 `<script>` 태그 순서가 곧 의존성 그래프입니다.

## 크레딧 · 라이선스

외부 3D 모델(GLB) 출처와 라이선스는 **[CREDITS.md](CREDITS.md)** 를 참고하세요.  
게임 메인 메뉴의 **「크레딧 · 라이선스」** 버튼에서도 확인할 수 있습니다.

- F-15 / F-16 / F-22 GLB: Hugging Face [3D Air Combat Simulator](https://huggingface.co/spaces/cutechicken/3D-Airforce-Simulator) — **CC BY-NC 4.0** (비상업)
- F-14 / F/A-18 GLB (선택): Sketchfab — **CC BY 4.0** (표기 필수)
- GLB 없을 때: `Aircraft.js` 절차적 메시 사용
