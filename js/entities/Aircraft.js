/* <!--
  Aircraft 메시 빌더 (v2 - 실제 형상 정밀화)
  - 외부 모델 파일 없이 three.js 기본 지오메트리 + ExtrudeGeometry 만으로
    각 전투기의 실루엣과 식별 포인트(LERX, LEVCON, 카나드, 캐럿/DSI 흡입구, IRST,
    복부 핀, 공중급유 프로브, 윙 펜스 등)를 재현합니다.
  - 모든 메시의 전방(forward)은 +Z 입니다.
  - 'thrust' 이름의 모든 메시는 BattleManager 에서 추력에 따라 스케일 펄스됩니다.
  - 각 빌더 주석에 실제 기체 도면 기준의 핵심 특징을 정리해 두었습니다.

  파일 구조: file:// 환경 호환을 위해 IIFE + Sky 네임스페이스 패턴 사용.
            THREE 는 글로벌(UMD) 로 로드되어 있다고 가정합니다.
--> */
(function (Sky, THREE) {
  'use strict';

/* <!--
  CapsuleGeometry 미지원 Three.js(r142 미만) 호환.
  IIFE 시점에 THREE.CapsuleGeometry 가 없으면 원통으로 대체합니다.
--> */
function createCapsuleGeometry(radius, cylinderLength, capSegments = 8, radialSegments = 14) {
  const T = window.THREE || THREE;
  const cyl = Math.max(0.01, cylinderLength);
  if (typeof T.CapsuleGeometry === 'function') {
    return new T.CapsuleGeometry(radius, cyl, capSegments, radialSegments);
  }
  return new T.CylinderGeometry(radius, radius, cyl + radius * 2, radialSegments);
}

/* ====================== 공용 헬퍼 ====================== */

function shadeColor(hex, amount) {
  const c = new THREE.Color(hex);
  c.r = Math.max(0, Math.min(1, c.r + amount));
  c.g = Math.max(0, Math.min(1, c.g + amount));
  c.b = Math.max(0, Math.min(1, c.b + amount));
  return c.getHex();
}

function makeMaterials(palette) {
  const p = {
    body:    palette?.body    ?? 0x8a96a4,
    belly:   palette?.belly   ?? null,
    accent:  palette?.accent  ?? 0x3a444f,
    cockpit: palette?.cockpit ?? 0x121826,
    decal:   palette?.decal   ?? 0xd0d6de,
    radome:  palette?.radome  ?? 0x1a1e24,
    camo:    palette?.camo    ?? null,
  };
  const bellyColor = p.belly ?? shadeColor(p.body, 0.11);
  const camoColor = p.camo ?? shadeColor(p.body, -0.09);
  return {
    body:     new THREE.MeshStandardMaterial({ color: p.body,    metalness: 0.48, roughness: 0.46 }),
    bodyAlt:  new THREE.MeshStandardMaterial({ color: shadeColor(p.body, -0.06), metalness: 0.52, roughness: 0.44 }),
    bodyLight:new THREE.MeshStandardMaterial({ color: bellyColor, metalness: 0.42, roughness: 0.48 }),
    bodyDark: new THREE.MeshStandardMaterial({ color: shadeColor(p.body, -0.16), metalness: 0.58, roughness: 0.46 }),
    camo:     new THREE.MeshStandardMaterial({ color: camoColor,  metalness: 0.44, roughness: 0.5 }),
    accent:   new THREE.MeshStandardMaterial({ color: p.accent,  metalness: 0.6,  roughness: 0.38 }),
    decal:    new THREE.MeshStandardMaterial({ color: p.decal,   metalness: 0.32, roughness: 0.42 }),
    radome:   new THREE.MeshStandardMaterial({ color: p.radome,  metalness: 0.55, roughness: 0.32 }),
    cockpit:  new THREE.MeshStandardMaterial({ color: p.cockpit, metalness: 0.95, roughness: 0.08, emissive: 0x1a2840, emissiveIntensity: 0.22 }),
    dark:     new THREE.MeshStandardMaterial({ color: 0x1c2028,  metalness: 0.62,  roughness: 0.48 }),
    sensor:   new THREE.MeshStandardMaterial({ color: 0x0a0d12,  metalness: 0.85, roughness: 0.18 }),
    intake:   new THREE.MeshBasicMaterial({ color: 0x040508 }),
    glow:     new THREE.MeshBasicMaterial({ color: p.accent, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
  };
}

function addThrust(parent, material, x, z, radius = 0.32, length = 1.0) {
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(radius, length, 12, 1, true),
    material,
  );
  cone.rotation.x = Math.PI / 2;
  cone.position.set(x, 0, z);
  cone.name = 'thrust';
  parent.add(cone);
  return cone;
}

/* <!-- 버블/탠덤 캐노피. sx/sy/sz 로 비율을 조절해 1인 버블 vs 2인 탠덤을 모두 표현. --> */
function addCanopy(parent, mat, x, y, z, sx, sy, sz) {
  const c = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    mat,
  );
  c.scale.set(sx, sy, sz);
  c.position.set(x, y, z);
  parent.add(c);
  return c;
}

function addPitot(parent, mat, z) {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.45, 6), mat);
  p.rotation.x = Math.PI / 2;
  p.position.z = z;
  parent.add(p);
}

/* <!-- 윙·미익 평면 메시. points 는 [X=스팬, Y=전후 chord] (Y 양수 = 전방). --> */
function planform(points, depth, mat) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, depth / 2, 0);
  return new THREE.Mesh(geo, mat);
}

/* <!--
  수직 꼬리날개: 직사각형 윗변을 잘라낸 사다리꼴 단면을 얇게 압출합니다.
  단일·쌍수직미익 모두 동일한 형상 규칙을 씁니다.
--> */
function addVerticalStab(parent, mat, opts = {}) {
  const height = opts.height ?? 1.0;
  const rootSpan = opts.rootSpan ?? 1.2;
  const tipSpan = opts.tipSpan ?? Math.max(0.2, rootSpan * 0.28);
  const thickness = opts.thickness ?? 0.09;
  const rootEmbed = opts.rootEmbed ?? rootSpan * 0.18;
  const zForward = opts.zForward ?? rootSpan * 0.42;
  const x = opts.x ?? 0;
  const yBase = opts.yBase ?? 0.55;
  const zCenter = opts.zCenter ?? -1.4;
  const sweep = opts.sweep ?? 0;

  const halfRoot = rootSpan * 0.5;
  const halfTip = tipSpan * 0.5;
  const shape = new THREE.Shape();
  /* <!-- 밑변(rootSpan) 직사각형 → 윗변(tipSpan)만 짧게 잘라 사다리꼴 --> */
  shape.moveTo(-halfRoot, -rootEmbed);
  shape.lineTo(halfRoot, -rootEmbed);
  shape.lineTo(halfTip - sweep, height);
  shape.lineTo(-halfTip - sweep, height);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.rotateY(Math.PI / 2);
  geo.translate(0, 0, -rootSpan * 0.5);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, yBase, zCenter + zForward);
  if (opts.roll) mesh.rotation.z = opts.roll;
  parent.add(mesh);
  return mesh;
}

/* <!-- 쌍수직미익: 좌·우 각각 사다리꼴 수직미익(기존 Box 파라미터 depth→rootSpan, width→thickness) --> */
function addTwinVerticalStabs(parent, mat, opts = {}) {
  const height = opts.height ?? 1.0;
  const rootSpan = opts.rootSpan ?? opts.depth ?? 1.2;
  const tipSpan = opts.tipSpan ?? Math.max(0.18, rootSpan * 0.26);
  const thickness = opts.thickness ?? opts.width ?? 0.1;
  const xSpan = opts.xSpan ?? 0.7;
  const yBase = opts.yBase ?? opts.y ?? 0.6;
  const zCenter = opts.zCenter ?? opts.z ?? -1.45;
  const roll = opts.roll ?? 0;
  const shared = {
    height,
    rootSpan,
    tipSpan,
    thickness,
    yBase,
    zCenter,
    sweep: opts.sweep ?? 0,
    rootEmbed: opts.rootEmbed,
  };

  const vL = addVerticalStab(parent, mat, { ...shared, x: -xSpan, roll });
  const vR = addVerticalStab(parent, mat, { ...shared, x: xSpan, roll: roll ? -roll : 0 });
  return [vL, vR];
}

const SWING_WING_MESH_TYPES = new Set(['f14', 'tornado']);
const F14_WING_FOLD_ANGLE = 1.12;

function addSwingWingHalf(parent, mat, side, points, depth, hinge, foldAngle, opts = {}) {
  const pivot = new THREE.Group();
  pivot.position.set(hinge.x * side, hinge.y, hinge.z);
  const wing = planform(points, depth, mat);
  pivot.add(wing);
  if (opts.gloveVane) {
    const vane = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.62), mat);
    vane.position.set((side < 0 ? -0.28 : 0.28), 0.03, 0.22);
    pivot.add(vane);
  }
  if (opts.pylonMissile) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.42), mat);
    rail.position.set((side < 0 ? -1.55 : 1.55), -0.02, -0.05);
    pivot.add(rail);
    const ms = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.95, 8), mat);
    ms.rotation.x = Math.PI / 2;
    ms.position.set((side < 0 ? -1.55 : 1.55), -0.02, -0.05);
    pivot.add(ms);
  }
  parent.add(pivot);
  parent.userData.swingWings = parent.userData.swingWings || [];
  parent.userData.swingWings.push({
    pivot,
    foldedRot: (side < 0 ? 1 : -1) * foldAngle,
    foldedYaw: (side < 0 ? -1 : 1) * (opts.foldYaw ?? 0),
  });
  return pivot;
}

function applySwingWingFold(meshRoot, t) {
  const wings = meshRoot?.userData?.swingWings;
  if (!wings?.length) return;
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  for (const w of wings) {
    w.pivot.rotation.set(
      w.foldedRot * clamped,
      (w.foldedYaw ?? 0) * clamped,
      0,
    );
  }
}

function addPylonMissile(parent, mat, x, z, hang = 0.28) {
  const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.08, hang, 0.5), mat);
  pylon.position.set(x, -0.08 - hang / 2, z);
  parent.add(pylon);
  const missile = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 8), mat);
  missile.rotation.x = Math.PI / 2;
  missile.position.set(x, -0.08 - hang, z);
  parent.add(missile);
}

/* <!-- IRST/EOTS 같은 광학 센서 볼. 캐노피 앞이나 노즈 옆에 작은 검은 구로 표현. --> */
function addIRST(parent, mat, x, y, z, radius = 0.13) {
  const ball = new THREE.Mesh(new THREE.SphereGeometry(radius, 14, 10), mat);
  ball.position.set(x, y, z);
  parent.add(ball);
  return ball;
}

/* <!-- 복부 핀(ventral fin). 동체 후방 아래에 외측으로 기울어진 작은 안정판. --> */
function addVentralFin(parent, mat, x, y, z, height = 0.32, length = 0.7, cant = 0.3) {
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, height, length), mat);
  fin.position.set(x, y, z);
  fin.rotation.z = cant;
  parent.add(fin);
  return fin;
}

/* <!-- 공중급유 프로브. 노즈 옆에서 살짝 전방으로 뻗는 가는 막대. --> */
function addRefuelProbe(parent, mat, x, y, z, length = 0.7) {
  const probe = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, length, 6), mat);
  probe.rotation.x = Math.PI / 2;
  probe.position.set(x, y, z + length / 2);
  parent.add(probe);
  /* 끝 디테일 (드로그 결합부) */
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mat);
  tip.position.set(x, y, z + length);
  parent.add(tip);
}

/* <!-- 윙 펜스(vortex generator). 윙 윗면 작은 세로 판으로 와류를 다스리는 구조. --> */
function addWingFence(parent, mat, x, y, z, length = 0.45, height = 0.18) {
  const fence = new THREE.Mesh(new THREE.BoxGeometry(0.04, height, length), mat);
  fence.position.set(x, y, z);
  parent.add(fence);
}

/* <!-- DSI(Diverterless Supersonic Inlet) 범프. 흡입구 앞 동체에 부드러운 융기. --> */
function addDSIBump(parent, mat, x, y, z) {
  const bump = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), mat);
  bump.scale.set(1.0, 0.45, 1.4);
  bump.position.set(x, y, z);
  parent.add(bump);
  return bump;
}

/* <!--
  평평하고 둥근 동체. 캡슐(원통 + 두 반구)을 Z축으로 눕히고 X 스케일로 단면을 타원화.
  - width: 좌우 폭 (X)
  - height: 상하 두께 (Y) ← 캡슐의 실제 반지름은 height/2
  - length: 전후 전체 길이 (Z), 양쪽 반구를 포함한 총 길이
  실제 전투기 동체는 박스가 아니라 단면이 타원/원형인 매끄러운 형상이므로
  모든 주력기에 이 헬퍼를 사용합니다.
--> */
function roundedBody(width, height, length, mat, segments = 18) {
  const r = height / 2;
  const cyl = Math.max(0.01, length - height); /* 원통 구간 길이 (반구 둘 빼고) */
  const geo = createCapsuleGeometry(r, cyl, 8, segments);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = Math.PI / 2; /* Y축 캡슐 → Z축으로 눕힘 (전후 길이) */
  mesh.scale.x = (width / 2) / r;
  return mesh;
}

/* <!-- AIM-120 AMRAAM: 윙팁 장착형 장거리 미사일 --> */
function addAmraamWingtip(parent, bodyMat, noseMat, finMat, x, z) {
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.48), finMat);
  rail.position.set(x, -0.05, z);
  parent.add(rail);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.078, 1.38, 12), bodyMat);
  body.rotation.x = Math.PI / 2;
  body.position.set(x, -0.05, z + 0.05);
  parent.add(body);
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.072, 0.28, 12), noseMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(x, -0.05, z + 0.82);
  parent.add(nose);
  for (const side of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.016, 0.14), finMat);
    fin.position.set(x + side * 0.08, -0.05, z + 0.18);
    fin.rotation.z = side * 0.22;
    parent.add(fin);
  }
}

/* <!-- F-16 AIM-9 사이드와인더: 밝은 회색 본체 + 어두운 시커 헤드 --> */
function addSidewinderPylon(parent, bodyMat, seekerMat, finMat, x, z) {
  const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.12), finMat);
  pylon.position.set(x, -0.32, z + 0.05);
  parent.add(pylon);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.92, 10), bodyMat);
  body.rotation.x = Math.PI / 2;
  body.position.set(x, -0.46, z);
  parent.add(body);
  const seeker = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.062, 0.16, 10), seekerMat);
  seeker.rotation.x = Math.PI / 2;
  seeker.position.set(x, -0.46, z + 0.48);
  parent.add(seeker);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.014, 0.08), finMat);
    fin.position.set(x, -0.46, z + 0.28);
    fin.rotation.z = (i * Math.PI) / 2;
    parent.add(fin);
  }
}

/* <!-- F-16 AIM-9 사이드와인더: 밝은 회색 본체 + 어두운 시커 헤드 (윙팁) --> */
function addSidewinderWingtip(parent, bodyMat, seekerMat, railMat, x, z) {
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.55), railMat);
  rail.position.set(x, -0.06, z);
  parent.add(rail);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 1.05, 10), bodyMat);
  body.rotation.x = Math.PI / 2;
  body.position.set(x, -0.06, z + 0.08);
  parent.add(body);
  const seeker = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.18, 10), seekerMat);
  seeker.rotation.x = Math.PI / 2;
  seeker.position.set(x, -0.06, z + 0.62);
  parent.add(seeker);
  const finGeo = new THREE.BoxGeometry(0.2, 0.018, 0.1);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(finGeo, railMat);
    fin.position.set(x, -0.06, z + 0.42);
    fin.rotation.z = (i * Math.PI) / 2;
    parent.add(fin);
  }
}

/* <!-- F-16 대형 외부 연료탱크: 탑뷰·RBAF 사진 기준 --> */
function addF16LargeFuelTank(parent, mat, finMat, x, z) {
  const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.32, 0.16), finMat);
  pylon.position.set(x, -0.26, z + 0.08);
  parent.add(pylon);
  const tank = new THREE.Mesh(createCapsuleGeometry(0.24, 1.72, 8, 14), mat);
  tank.rotation.x = Math.PI / 2;
  tank.scale.set(1, 0.78, 1);
  tank.position.set(x, -0.52, z);
  parent.add(tank);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 8), mat);
  cap.scale.set(1, 0.78, 0.7);
  cap.position.set(x, -0.52, z + 0.95);
  parent.add(cap);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.22, 10), finMat);
  tail.rotation.x = -Math.PI / 2;
  tail.position.set(x, -0.52, z - 0.92);
  parent.add(tail);
}

function addF16CenterlineTank(parent, mat, finMat) {
  const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.24, 0.18), finMat);
  pylon.position.set(0, -0.48, 0.05);
  parent.add(pylon);
  const tank = new THREE.Mesh(createCapsuleGeometry(0.21, 1.48, 8, 12), mat);
  tank.rotation.x = Math.PI / 2;
  tank.scale.set(1, 0.8, 1);
  tank.position.set(0, -0.68, 0.02);
  parent.add(tank);
}

function addF16ConformalTanks(parent, upperMat, sideMat) {
  for (const side of [-1, 1]) {
    const cft = new THREE.Mesh(createCapsuleGeometry(0.28, 2.28, 8, 16), upperMat);
    cft.rotation.x = Math.PI / 2;
    cft.rotation.z = side * 0.05;
    cft.scale.set(0.92, 0.58, 1.08);
    cft.position.set(side * 0.46, 0.46, -0.22);
    parent.add(cft);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 1.62), sideMat);
    ramp.position.set(side * 0.4, 0.38, -0.18);
    ramp.rotation.z = side * -0.1;
    parent.add(ramp);
    const fairing = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.55), upperMat);
    fairing.position.set(side * 0.34, 0.32, 0.72);
    fairing.rotation.z = side * -0.22;
    parent.add(fairing);
  }
}

function addF16TargetingPod(parent, mat, side) {
  const pod = new THREE.Mesh(createCapsuleGeometry(0.11, 0.88, 6, 10), mat);
  pod.rotation.x = Math.PI / 2;
  pod.rotation.z = side * 0.15;
  pod.position.set(side * 0.64, -0.38, 0.42);
  parent.add(pod);
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x0a1018, metalness: 0.9, roughness: 0.12 }),
  );
  glass.position.set(side * 0.64, -0.38, 0.82);
  parent.add(glass);
}

function addF16GhostCamo(parent, camoMat) {
  const wingPatch = planform([
    [ 0.42,  0.35], [ 2.68, -0.42], [ 2.7, -0.92], [ 0.42, -0.98],
    [-0.42, -0.98], [-2.7, -0.92], [-2.68, -0.42], [-0.42,  0.35],
  ], 0.018, camoMat);
  wingPatch.position.set(0, 0.06, 0);
  parent.add(wingPatch);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 1.65), camoMat);
  spine.position.set(0, 0.42, -0.35);
  parent.add(spine);
  for (const side of [-1, 1]) {
    const lerxPatch = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.04, 0.72), camoMat);
    lerxPatch.position.set(side * 0.55, 0.1, 0.55);
    lerxPatch.rotation.z = side * -0.18;
    parent.add(lerxPatch);
  }
}

function addLowVisRoundel(parent, side, y, z) {
  const rotY = side > 0 ? Math.PI / 2 : -Math.PI / 2;
  const x = side * 0.5;
  const grey = new THREE.MeshStandardMaterial({ color: 0x5a626c, metalness: 0.35, roughness: 0.55 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.14, 18), grey);
  ring.rotation.y = rotY;
  ring.position.set(x, y, z);
  parent.add(ring);
}

function addTailCheckerStripe(parent) {
  for (let i = 0; i < 6; i++) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.025, 0.06),
      new THREE.MeshStandardMaterial({ color: i % 2 === 0 ? 0x101418 : 0xd8dce4, metalness: 0.2, roughness: 0.5 }),
    );
    stripe.position.set((i - 2.5) * 0.055, 1.26, -1.02);
    parent.add(stripe);
  }
}

/* <!-- RBAF Block 70/72 꼬리: 바레인 국기 + 식별 코드(기하학적) --> */
function addBlock70TailMarkings(parent, accentMat) {
  const flagRed = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.14, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xc01828, metalness: 0.25, roughness: 0.55 }),
  );
  flagRed.position.set(0, 1.08, -1.0);
  parent.add(flagRed);
  const flagWhite = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.14, 0.045),
    new THREE.MeshStandardMaterial({ color: 0xe8ecf0, metalness: 0.2, roughness: 0.5 }),
  );
  flagWhite.position.set(-0.03, 1.08, -1.0);
  parent.add(flagWhite);
  for (let i = 0; i < 5; i++) {
    const digit = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.04), accentMat);
    digit.position.set((i - 2) * 0.058, 0.78, -1.0);
    parent.add(digit);
  }
}

function addWingTopRoundel(parent, side, x, z) {
  const grey = new THREE.MeshStandardMaterial({ color: 0x5a626c, metalness: 0.35, roughness: 0.55 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.11, 16), grey);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.1, z);
  parent.add(ring);
}

/* <!-- F-16 연료 탱크(370gal급): 타원 실루엣 외부 탱크 --> */
function addF16FuelTank(parent, mat, x, z) {
  const tank = new THREE.Mesh(createCapsuleGeometry(0.2, 1.45, 8, 12), mat);
  tank.rotation.x = Math.PI / 2;
  tank.scale.set(1, 0.82, 1);
  tank.position.set(x, -0.48, z);
  parent.add(tank);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), mat);
  nose.scale.set(1, 0.82, 0.75);
  nose.position.set(x, -0.48, z + 0.82);
  parent.add(nose);
  const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.28, 0.14), mat);
  pylon.position.set(x, -0.28, z + 0.05);
  parent.add(pylon);
}

/* <!-- GBU 계열 레이저 유도 폭탄(외부 탑재) --> */
function addF16GuidedBomb(parent, bodyMat, finMat, x, z) {
  const bomb = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.95, 10), bodyMat);
  bomb.rotation.x = Math.PI / 2;
  bomb.position.set(x, -0.46, z);
  parent.add(bomb);
  const kit = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.22), finMat);
  kit.position.set(x, -0.46, z - 0.38);
  parent.add(kit);
  const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.12), finMat);
  pylon.position.set(x, -0.3, z + 0.08);
  parent.add(pylon);
}

/* <!-- 미 공군 스타·바즈 라운델(단순화) --> */
function addUSAFRoundel(parent, side, y, z) {
  const rotY = side > 0 ? Math.PI / 2 : -Math.PI / 2;
  const x = side * 0.52;
  const blue = new THREE.Mesh(new THREE.CircleGeometry(0.16, 18), new THREE.MeshStandardMaterial({ color: 0x1a3478, metalness: 0.2, roughness: 0.6 }));
  blue.rotation.y = rotY;
  blue.position.set(x, y, z);
  parent.add(blue);
  const white = new THREE.Mesh(new THREE.CircleGeometry(0.11, 16), new THREE.MeshStandardMaterial({ color: 0xe8ecf0, metalness: 0.15, roughness: 0.55 }));
  white.rotation.y = rotY;
  white.position.set(x * 1.002, y, z);
  parent.add(white);
  const red = new THREE.Mesh(new THREE.CircleGeometry(0.055, 12), new THREE.MeshStandardMaterial({ color: 0xb81828, metalness: 0.25, roughness: 0.5 }));
  red.rotation.y = rotY;
  red.position.set(x * 1.004, y, z);
  parent.add(red);
}

/* <!-- F-16A 꼬리 HL / 12TH AF 마킹(기하학적 표현) --> */
function addF16TailMarkings(parent, accentMat, accentWarm) {
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.72, 0.95), accentMat);
  band.position.set(0, 0.72, -1.48);
  parent.add(band);
  const hlBarL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.38, 0.08), accentMat);
  hlBarL.position.set(-0.12, 0.78, -1.02);
  parent.add(hlBarL);
  const hlBarR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.38, 0.08), accentMat);
  hlBarR.position.set(0.12, 0.78, -1.02);
  parent.add(hlBarR);
  const hlMid = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.08), accentMat);
  hlMid.position.set(0, 0.78, -1.02);
  parent.add(hlMid);
  const squadron = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.04), accentWarm);
  squadron.position.set(0, 0.58, -1.0);
  parent.add(squadron);
}

/* <!-- 윙팁 미사일 발사기(레일). F-16/F-15 등 윙끝에 작은 사이드와인더 추가. --> */
function addWingtipRail(parent, mat, x, z) {
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.5), mat);
  rail.position.set(x, -0.05, z);
  parent.add(rail);
  const aim9 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.95, 8), mat);
  aim9.rotation.x = Math.PI / 2;
  aim9.position.set(x, -0.05, z + 0.05);
  parent.add(aim9);
  /* 사이드와인더 핀 4장 */
  const finGeo = new THREE.BoxGeometry(0.22, 0.02, 0.12);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(finGeo, mat);
    fin.position.set(x, -0.05, z + 0.4);
    fin.rotation.z = (i * Math.PI) / 2;
    parent.add(fin);
  }
}

/* ====================== F-16 Fighting Falcon ======================
   참고: F-16A 전술 회색·탑뷰 외부탑재·RBAF Block 70/72 CFT 사진 (~90% 실루엣).
   - 블렌디드 윙바디, 검은 레이돔, 고스트 2톤, 버블 캐노피, 턱밑 흡입구
   - 윙팁 AIM-120, 외측 AIM-9, 내부·센터라인 연료탱크
   - Block 60/V: CFT + 타게팅 포드
--> */
function buildF16(fighter, options) {
  const gltfMesh = Sky.AircraftModelLoader?.getClone?.('f16', fighter, options);
  if (gltfMesh) return gltfMesh;
  return buildF16Procedural(fighter);
}

function buildF16Procedural(fighter) {
  const m = makeMaterials(fighter.palette);
  const g = new THREE.Group();
  const id = fighter?.id ?? '';
  const isF16A = id === 'fighter_001';
  const isBlock70 = id === 'f16v';
  const hasCFT = id === 'f16e' || id === 'f16v';
  const hasPod = id === 'f16c' || id === 'f16e' || id === 'f16v';
  const intakeScale = hasCFT ? 1.12 : 1.0;

  const fuselage = roundedBody(1.02, 0.56, 5.15, m.body, 22);
  fuselage.position.z = 0.1;
  g.add(fuselage);
  const bellyShell = roundedBody(0.98, 0.5, 4.35, m.bodyLight, 18);
  bellyShell.position.set(0, -0.14, 0.35);
  bellyShell.scale.y = 0.62;
  g.add(bellyShell);

  /* 검은 레이돔 + 피토관 (탑뷰·RBAF 사진) */
  const radome = new THREE.Mesh(new THREE.ConeGeometry(0.36, 2.08, 24), m.radome);
  radome.rotation.x = Math.PI / 2;
  radome.position.z = 2.36;
  g.add(radome);
  addPitot(g, m.dark, 3.44);

  const intakeShell = new THREE.Mesh(createCapsuleGeometry(0.46 * intakeScale, 0.72, 8, 16), m.bodyAlt);
  intakeShell.rotation.x = Math.PI / 2;
  intakeShell.scale.set(1.05 * intakeScale, 0.58, 1.08);
  intakeShell.position.set(0, -0.58, 0.72);
  g.add(intakeShell);
  const intakeLip = new THREE.Mesh(new THREE.TorusGeometry(0.34 * intakeScale, 0.035, 8, 24), m.bodyDark);
  intakeLip.rotation.x = Math.PI / 2;
  intakeLip.scale.set(1.08 * intakeScale, 0.62, 1);
  intakeLip.position.set(0, -0.58, 1.28);
  g.add(intakeLip);
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.33 * intakeScale, 22), m.intake);
  mouth.scale.set(1.08 * intakeScale, 0.6, 1);
  mouth.position.set(0, -0.58, 1.29);
  g.add(mouth);
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.55), m.bodyDark);
  splitter.position.set(0, -0.38, 1.05);
  g.add(splitter);

  if (isBlock70) {
    addCanopy(g, m.cockpit, 0, 0.42, 0.78, 1.28, 0.68, 2.35);
  } else {
    addCanopy(g, m.cockpit, 0, 0.4, 0.92, 1.12, 0.64, 2.05);
  }
  const canopyFrame = new THREE.Mesh(
    new THREE.TorusGeometry(0.54, 0.022, 6, 28, Math.PI * 0.92),
    m.bodyDark,
  );
  canopyFrame.rotation.x = Math.PI / 2;
  canopyFrame.rotation.z = Math.PI * 0.04;
  canopyFrame.position.set(0, 0.4, 1.05);
  g.add(canopyFrame);
  const dorsalSpine = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 1.85), m.bodyAlt);
  dorsalSpine.position.set(0, 0.36, -0.42);
  g.add(dorsalSpine);

  if (hasCFT) addF16ConformalTanks(g, m.camo, m.bodyAlt);
  if (hasPod) addF16TargetingPod(g, m.bodyDark, 1);

  const lerx = planform([
    [ 0.42,  1.15], [ 0.92,  0.28], [ 0.92, -0.08], [ 0.42, -0.02],
    [-0.42, -0.02], [-0.92, -0.08], [-0.92,  0.28], [-0.42,  1.15],
  ], 0.07, m.bodyAlt);
  lerx.position.y = 0.05;
  g.add(lerx);

  const wing = planform([
    [ 0.5,  0.48], [ 2.82, -0.48], [ 2.85, -1.02], [ 0.5, -1.08],
    [-0.5, -1.08], [-2.85, -1.02], [-2.82, -0.48], [-0.5,  0.48],
  ], 0.12, m.body);
  wing.position.y = -0.04;
  g.add(wing);
  const wingUnderside = planform([
    [ 0.48,  0.45], [ 2.78, -0.45], [ 2.8, -0.98], [ 0.48, -1.04],
    [-0.48, -1.04], [-2.8, -0.98], [-2.78, -0.45], [-0.48,  0.45],
  ], 0.04, m.bodyLight);
  wingUnderside.position.set(0, -0.1, 0);
  g.add(wingUnderside);
  addF16GhostCamo(g, m.camo);
  addWingFence(g, m.bodyDark, -1.05, 0.02, 0.35, 0.52, 0.16);
  addWingFence(g, m.bodyDark,  1.05, 0.02, 0.35, 0.52, 0.16);
  for (const x of [-1.8, -0.6, 0.6, 1.8]) {
    const chord = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.012, 1.05), m.bodyDark);
    chord.position.set(x, 0.04, -0.15);
    g.add(chord);
  }

  const gunPort = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.055, 0.07), m.dark);
  gunPort.position.set(-0.5, 0.04, 0.98);
  g.add(gunPort);

  for (const z of [0.2, -0.35, -1.05]) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.008, 0.015), m.bodyDark);
    seam.position.set(0, 0.08, z);
    g.add(seam);
  }

  /* 탑뷰 표준 전투 탑재: AIM-120 윙팁 · AIM-9 외측 · 대형 내부탱크 · 센터라인 */
  addAmraamWingtip(g, m.decal, m.bodyAlt, m.bodyDark, -2.82, -0.38);
  addAmraamWingtip(g, m.decal, m.bodyAlt, m.bodyDark,  2.82, -0.38);
  addSidewinderPylon(g, m.decal, m.sensor, m.bodyDark, -2.08, -0.12);
  addSidewinderPylon(g, m.decal, m.sensor, m.bodyDark,  2.08, -0.12);
  addF16LargeFuelTank(g, m.decal, m.bodyDark, -1.22, -0.12);
  addF16LargeFuelTank(g, m.decal, m.bodyDark,  1.22, -0.12);
  addF16CenterlineTank(g, m.decal, m.bodyDark);

  if (isF16A) {
    addUSAFRoundel(g, 1, -0.05, -0.55);
    addF16TailMarkings(g, m.accent, new THREE.MeshStandardMaterial({ color: 0xc8a030, metalness: 0.35, roughness: 0.5 }));
    const serial = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.025, 0.04), m.accent);
    serial.position.set(0.22, 0.08, 2.55);
    g.add(serial);
  } else {
    addLowVisRoundel(g, 1, 0.02, -0.35);
    addWingTopRoundel(g, 1, 1.55, -0.35);
    addWingTopRoundel(g, -1, -1.55, -0.35);
    if (isBlock70) {
      addBlock70TailMarkings(g, m.accent);
    } else {
      const tailCode = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.05), m.accent);
      tailCode.position.set(0, 0.72, -1.0);
      g.add(tailCode);
    }
    addTailCheckerStripe(g);
  }

  const hStab = planform([
    [ 0.28,  0.22], [ 1.22, -0.38], [ 1.22, -0.72], [ 0.28, -0.58],
    [-0.28, -0.58], [-1.22, -0.72], [-1.22, -0.38], [-0.28,  0.22],
  ], 0.08, m.body);
  hStab.position.set(0, -0.02, -1.78);
  g.add(hStab);

  addVerticalStab(g, m.body, {
    height: 1.18, rootSpan: 1.42, tipSpan: 0.28, thickness: 0.11,
    yBase: 0.36, zCenter: -1.68, rootEmbed: 0.38, zForward: 0.58,
  });
  const tailIntake = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.08), m.intake);
  tailIntake.position.set(0, 0.38, -1.35);
  g.add(tailIntake);
  const tailLight = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.06, 0.28),
    new THREE.MeshStandardMaterial({ color: 0xc83838, emissive: 0x601010, emissiveIntensity: 0.35 }),
  );
  tailLight.position.set(0, 1.22, -1.58);
  g.add(tailLight);

  addVentralFin(g, m.bodyDark, -0.26, -0.44, -1.55, 0.34, 0.72,  0.38);
  addVentralFin(g, m.bodyDark,  0.26, -0.44, -1.55, 0.34, 0.72, -0.38);

  const nozzleOuter = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.44, 0.58, 20), m.dark);
  nozzleOuter.rotation.x = Math.PI / 2;
  nozzleOuter.position.z = -2.08;
  g.add(nozzleOuter);
  const nozzleInner = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.32, 0.42, 16),
    new THREE.MeshStandardMaterial({ color: 0x2a3038, metalness: 0.75, roughness: 0.35 }),
  );
  nozzleInner.rotation.x = Math.PI / 2;
  nozzleInner.position.z = -2.1;
  g.add(nozzleInner);
  for (let i = 0; i < 12; i++) {
    const petal = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.02), m.dark);
    petal.position.set(Math.cos(i / 12 * Math.PI * 2) * 0.3, Math.sin(i / 12 * Math.PI * 2) * 0.3, -2.12);
    petal.rotation.z = i / 12 * Math.PI * 2;
    g.add(petal);
  }

  addThrust(g, m.glow, 0, -2.58, 0.34, 1.08);
  g.userData.procedural = true;
  return g;
}
/* ====================== F-15 Eagle ======================
   참고 형상: McDonnell Douglas F-15A.
   - 쌍발 F100, 두 엔진이 가까이 나란히
   - 어깨 위 큰 사다리꼴 주익, 매우 큰 가동식 수평미익
   - 평행 쌍수직미익 (캔트 없음)
   - 매우 큰 사각형 측면 흡입구 (앞이 위로 들린 가변램프 형태 - 평행사변형)
   - 등쪽이 평평한 wide-body, 아래쪽도 평평
   - 노즈가 길고 평평 */
function buildF15(fighter, options) {
  const gltfMesh = Sky.AircraftModelLoader?.getClone?.('f15', fighter, options);
  if (gltfMesh) return gltfMesh;
  return buildF15Procedural(fighter);
}

function buildF15Procedural(fighter) {
  const m = makeMaterials(fighter.palette);
  const g = new THREE.Group();

  /* 동체: 평평하고 넓적한 타원 단면. */
  const body = roundedBody(1.3, 0.55, 4.6, m.body);
  g.add(body);
  /* 등쪽 페어링(낮고 부드럽게) */
  const dorsal = roundedBody(1.1, 0.22, 3.6, m.bodyAlt);
  dorsal.position.set(0, 0.36, -0.4);
  g.add(dorsal);

  /* 노즈: 길고 평평 */
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.6, 14), m.body);
  nose.rotation.x = Math.PI / 2;
  nose.scale.set(1.0, 0.55, 1.0);
  nose.position.set(0, -0.08, 2.7);
  g.add(nose);
  addPitot(g, m.dark, 3.55);

  /* 측면 사각 흡입구 — F-15의 가장 큰 식별 포인트.
     평행사변형 형태(앞이 위로 살짝 들림)를 살리려고 약간 X 회전 적용. */
  const intakeGeo = new THREE.BoxGeometry(0.48, 0.58, 1.85);
  const intakeL = new THREE.Mesh(intakeGeo, m.bodyAlt);
  intakeL.position.set(-0.88, -0.05, 0.55);
  intakeL.rotation.x = 0.06; // 앞쪽이 위로 살짝 들린 가변램프 흉내
  const intakeR = intakeL.clone();
  intakeR.position.x = 0.88;
  g.add(intakeL, intakeR);
  /* 흡입구 입구 — 큼지막한 직사각형 */
  const mouthGeo = new THREE.PlaneGeometry(0.42, 0.48);
  const mL = new THREE.Mesh(mouthGeo, m.intake);
  mL.position.set(-0.88, 0.0, 1.46);
  const mR = mL.clone();
  mR.position.x = 0.88;
  g.add(mL, mR);
  /* 흡입구와 동체 사이 splitter plate 라인 (얇은 액센트) */
  const splitterGeo = new THREE.BoxGeometry(0.04, 0.5, 0.4);
  const spL = new THREE.Mesh(splitterGeo, m.bodyDark);
  spL.position.set(-0.6, -0.05, 1.3);
  const spR = spL.clone();
  spR.position.x = 0.6;
  g.add(spL, spR);

  addCanopy(g, m.cockpit, 0, 0.38, 1.45, 0.85, 0.55, 1.55);

  /* 어깨 위 큰 사다리꼴 주익. 후퇴각 약 38도. */
  const wing = planform([
    [ 0.62,  1.25], [ 3.45, -0.25], [ 3.45, -0.95], [ 0.62, -1.05],
    [-0.62, -1.05], [-3.45, -0.95], [-3.45, -0.25], [-0.62,  1.25],
  ], 0.1, m.body);
  wing.position.y = 0.2;
  g.add(wing);

  /* 윙팁 발사 레일 + 다수 미사일 (F-15 의 자랑) */
  addWingtipRail(g, m.bodyDark, -3.5, -0.6);
  addWingtipRail(g, m.bodyDark,  3.5, -0.6);
  addPylonMissile(g, m.bodyDark, -1.4, 0.2);
  addPylonMissile(g, m.bodyDark,  1.4, 0.2);
  addPylonMissile(g, m.bodyDark, -2.4, -0.4);
  addPylonMissile(g, m.bodyDark,  2.4, -0.4);
  /* 동체 컨포멀 미사일(반매립 AIM-7) — 동체 옆 가지런히 */
  for (const x of [-0.55, 0.55]) {
    const m1 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.05, 8), m.bodyDark);
    m1.rotation.x = Math.PI / 2;
    m1.position.set(x, -0.28, 0.55);
    g.add(m1);
  }

  /* 평행 쌍수직미익 — F-15 는 캔트 없음(완전 수직). */
  addTwinVerticalStabs(g, m.body, { width: 0.1, height: 1.1, depth: 1.3, xSpan: 0.8, y: 0.6, z: -1.55 });

  /* 매우 큰 가동식 수평미익 (F-15는 슬랩 전체가 움직임) */
  const hStab = planform([
    [ 0.5,  0.35], [ 1.7, -0.4], [ 1.7, -0.9], [ 0.5, -0.8],
    [-0.5, -0.8], [-1.7, -0.9], [-1.7, -0.4], [-0.5,  0.35],
  ], 0.08, m.body);
  hStab.position.set(0, 0, -2.1);
  g.add(hStab);

  /* 쌍발 노즐 — F100 은 원형. 두 엔진이 가깝게 붙어있음. */
  const nzGeo = new THREE.CylinderGeometry(0.42, 0.5, 0.55, 16);
  const nzL = new THREE.Mesh(nzGeo, m.dark);
  nzL.rotation.x = Math.PI / 2;
  nzL.position.set(-0.45, -0.05, -2.5);
  const nzR = nzL.clone();
  nzR.position.x = 0.45;
  g.add(nzL, nzR);

  addThrust(g, m.glow, -0.45, -3.05, 0.36, 1.0);
  addThrust(g, m.glow.clone(),  0.45, -3.05, 0.36, 1.0);
  g.userData.procedural = true;
  return g;
}

/* ====================== F/A-18E Super Hornet ======================
   GLB 우선(F-16/F-15/F-22와 동일). assets/models/fa18.glb 필요.
   GLB가 없을 때 절차적 메쉬로 폴백.

   절차적 폴백 참고 형상: Boeing F/A-18E.
   - 쌍발 엔진, 측면 흡입구, LERX
   - 외측으로 기울어진(캔트) 쌍수직미익
   - 함재 다목적기 실루엣 (F-15보다 소형) */
function buildFa18(fighter, options) {
  const gltfMesh = Sky.AircraftModelLoader?.getClone?.('fa18', fighter, options);
  if (gltfMesh) return gltfMesh;
  return buildFa18Procedural(fighter);
}

function buildFa18Procedural(fighter) {
  const m = makeMaterials(fighter.palette);
  const g = new THREE.Group();

  const body = roundedBody(1.0, 0.5, 4.0, m.body);
  g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.4, 14), m.body);
  nose.rotation.x = Math.PI / 2;
  nose.scale.set(1, 0.6, 1);
  nose.position.set(0, -0.05, 2.35);
  g.add(nose);
  addPitot(g, m.dark, 3.1);

  const intakeGeo = new THREE.BoxGeometry(0.38, 0.45, 1.4);
  [-0.72, 0.72].forEach((x) => {
    const intake = new THREE.Mesh(intakeGeo, m.bodyAlt);
    intake.position.set(x, -0.08, 0.5);
    g.add(intake);
    const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.38), m.intake);
    mouth.position.set(x, -0.02, 1.22);
    g.add(mouth);
  });

  addCanopy(g, m.cockpit, 0, 0.36, 1.2, 0.8, 0.52, 1.4);

  const lerx = planform([
    [0.35, 0.9], [0.75, 0.15], [0.75, -0.1], [0.35, 0],
    [-0.35, 0], [-0.75, -0.1], [-0.75, 0.15], [-0.35, 0.9],
  ], 0.05, m.bodyAlt);
  lerx.position.y = 0.08;
  g.add(lerx);

  const wing = planform([
    [0.45, 0.5], [2.8, -0.3], [2.8, -0.85], [0.45, -0.9],
    [-0.45, -0.9], [-2.8, -0.85], [-2.8, -0.3], [-0.45, 0.5],
  ], 0.09, m.body);
  wing.position.y = -0.02;
  g.add(wing);

  addWingtipRail(g, m.bodyDark, -2.85, -0.35);
  addWingtipRail(g, m.bodyDark, 2.85, -0.35);
  addPylonMissile(g, m.bodyDark, -1.5, -0.2);
  addPylonMissile(g, m.bodyDark, 1.5, -0.2);

  const hStab = planform([
    [0.35, 0.2], [1.25, -0.3], [1.25, -0.65], [0.35, -0.55],
    [-0.35, -0.55], [-1.25, -0.65], [-1.25, -0.3], [-0.35, 0.2],
  ], 0.07, m.body);
  hStab.position.set(0, 0, -1.85);
  g.add(hStab);

  addTwinVerticalStabs(g, m.body, {
    width: 0.08, height: 0.95, depth: 1.05, xSpan: 0.65, y: 0.5, z: -1.45, roll: 0.22,
  });

  const nzGeo = new THREE.CylinderGeometry(0.36, 0.42, 0.5, 14);
  [-0.42, 0.42].forEach((x) => {
    const nz = new THREE.Mesh(nzGeo, m.dark);
    nz.rotation.x = Math.PI / 2;
    nz.position.set(x, -0.04, -2.15);
    g.add(nz);
    addThrust(g, m.glow, x, -2.65, 0.3, 0.9);
  });
  g.userData.procedural = true;
  return g;
}

/* ====================== F-14 Tomcat ======================
   GLB 우선(F-16/F-15와 동일). assets/models/f14.glb 필요.
   GLB가 없으면 사진 5장에 맞춰 재설계된 절차적 메쉬로 폴백.
   가변익은 G키로 천천히 접힘/펼침 (BattleManager). */

/* <!--
  가변익 hinge는 동체+글러브 외측 모서리 위치(절차적 동체 폭 2.85에 맞춤).
  좌표계: pivot 기준 X<0 = 윙 외측(좌), Y(+)=전방 chord.
  펼친 wingspan ≈ 2*(hinge.x + tip.x) = 약 7.2 (전장 6.85와 거의 1:1).
--> */
function attachF14SwingWings(parent, fighter) {
  const m = makeMaterials(fighter?.palette);
  const hinge = { x: 1.05, y: 0.12, z: 0.05 };
  addSwingWingHalf(parent, m.body, -1, [
    [-0.05,  0.95], [-2.55,  0.10], [-2.55, -0.65], [-0.05, -0.85],
  ], 0.10, hinge, F14_WING_FOLD_ANGLE, { gloveVane: true, pylonMissile: true, foldYaw: 0.1 });
  addSwingWingHalf(parent, m.body, 1, [
    [ 0.05,  0.95], [ 2.55,  0.10], [ 2.55, -0.65], [ 0.05, -0.85],
  ], 0.10, hinge, F14_WING_FOLD_ANGLE, { gloveVane: true, pylonMissile: true, foldYaw: 0.1 });
  parent.userData.swingWingExtended = 0;
}

function buildF14(fighter, options) {
  const gltfMesh = Sky.AircraftModelLoader?.getClone?.('f14', fighter, options);
  if (gltfMesh) return gltfMesh;
  return buildF14Procedural(fighter);
}

/* <!--
  F-14 Tomcat 절차적 메쉬 (사진 참조 재설계판).
  살리는 시그니처 디테일:
   1) 와이드 팬케이크 동체 + 등 융기 (dorsal hump): 두 엔진 사이가 양력면.
   2) 좌우로 벌어진 박스형 엔진 나셀 (캡슐이 아닌 사각에 가까운 단면).
   3) F-14 시그니처인 사각형 박스 흡입구 + 동체 측면 splitter.
   4) 길고 가는 노즈 + 노즈 아래 IRST/TCS 광학 포드 + 피토.
   5) 큰 탠덤 듀얼 캐노피 (조종사+RIO).
   6) 가변익 hinge 앞쪽 큰 글러브 평면 + 글러브 베인(swing-wing 함수 내부).
   7) 가변익 본체 (attachF14SwingWings).
   8) 복부 semi-recessed AIM-54 Phoenix 4발(노즈콘 포함).
   9) 외측 5° 캔트된 큰 쌍수직미익.
   10) 매우 큰 all-moving stabilator (taileron).
   11) 노즐 아래 외측 캔트 ventral fin 2개.
   12) 쌍발 원형 노즐 + 애프터버너 글로우.
--> */
function buildF14Procedural(fighter) {
  const m = makeMaterials(fighter.palette);
  const g = new THREE.Group();

  /* 1) 중앙 와이드 팬케이크 동체 */
  const pancake = roundedBody(2.85, 0.42, 3.85, m.body);
  g.add(pancake);

  /* 2) 등 융기 (캐노피 후방 → 수직미익 앞까지 매끄럽게 이어짐) */
  const dorsal = roundedBody(0.95, 0.30, 3.05, m.bodyAlt);
  dorsal.position.set(0, 0.34, -0.25);
  g.add(dorsal);

  /* 3) 복부 평면판: 페닉스 4발의 마운트 베이스 */
  const belly = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.18, 3.05), m.bodyDark);
  belly.position.set(0, -0.24, 0.05);
  g.add(belly);

  /* 4) 좌우 엔진 나셀: 박스에 가까운 둥근 단면 */
  for (const side of [-1, 1]) {
    const nacelle = roundedBody(0.95, 0.80, 4.25, m.bodyAlt);
    nacelle.position.set(side * 1.20, -0.04, -0.25);
    g.add(nacelle);

    /* 노즐 외부 링 (afterburner can) */
    const nzRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.50, 0.58, 0.55, 18),
      m.dark,
    );
    nzRing.rotation.x = Math.PI / 2;
    nzRing.position.set(side * 1.20, -0.04, -2.45);
    g.add(nzRing);

    /* 노즐 내부 (어두운 림) */
    const nzInner = new THREE.Mesh(
      new THREE.CylinderGeometry(0.40, 0.40, 0.20, 18),
      m.intake,
    );
    nzInner.rotation.x = Math.PI / 2;
    nzInner.position.set(side * 1.20, -0.04, -2.60);
    g.add(nzInner);

    /* 애프터버너 글로우 */
    addThrust(g, m.glow, side * 1.20, -3.05, 0.42, 1.08);
  }

  /* 5) F-14 시그니처: 사각형 박스 흡입구 (살짝 외측 캔트) */
  for (const side of [-1, 1]) {
    const intakeBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.82, 0.72, 1.05),
      m.bodyAlt,
    );
    intakeBox.position.set(side * 1.20, -0.05, 1.55);
    intakeBox.rotation.z = -side * 0.06;
    intakeBox.rotation.y = side * 0.03;
    g.add(intakeBox);

    /* 어두운 흡입구 입구(사각 검은 면) */
    const intakeMouth = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.62),
      m.intake,
    );
    intakeMouth.position.set(side * 1.20, -0.05, 2.10);
    intakeMouth.rotation.z = -side * 0.06;
    intakeMouth.rotation.y = side * 0.03;
    g.add(intakeMouth);

    /* 동체와 나셀 사이 splitter 판 (boundary layer plate) */
    const splitter = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.62, 1.05),
      m.bodyDark,
    );
    splitter.position.set(side * 0.76, -0.05, 1.55);
    g.add(splitter);
  }

  /* 6) 노즈: 길고 가는 라돔 */
  const noseBase = roundedBody(0.85, 0.55, 1.55, m.body);
  noseBase.position.set(0, 0.06, 1.95);
  g.add(noseBase);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 2.40, 18), m.radome);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.06, 2.85);
  g.add(nose);

  addPitot(g, m.dark, 4.10);

  /* 7) 노즈 아래 IRST/TCS 광학 포드 (사진 1·5에서 잘 보임) */
  const irstPod = new THREE.Mesh(
    createCapsuleGeometry(0.13, 0.32, 8, 12),
    m.bodyDark,
  );
  irstPod.rotation.x = Math.PI / 2;
  irstPod.position.set(0, -0.26, 2.55);
  g.add(irstPod);
  addIRST(g, m.sensor, 0, -0.26, 2.78, 0.11);

  /* 8) 탠덤 듀얼 캐노피 (조종사+RIO 2인승, 큰 버블) */
  addCanopy(g, m.cockpit, 0, 0.44, 1.40, 1.05, 0.66, 1.55);

  /* 캐노피 후방 페어링 (등 융기로 자연스럽게 이어지는 어두운 베이스) */
  const canopyRear = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.20, 0.55),
    m.bodyDark,
  );
  canopyRear.position.set(0, 0.40, 0.65);
  g.add(canopyRear);

  /* 9) 글러브(LERX): 가변익 hinge 앞에 큰 삼각형 평면. 동체와 일체. */
  for (const side of [-1, 1]) {
    const glove = planform([
      [side * 0.78,  1.60],
      [side * 2.00,  0.18],
      [side * 2.00, -0.28],
      [side * 0.78, -0.05],
    ], 0.16, m.body);
    glove.position.y = 0.06;
    g.add(glove);
  }

  /* 10) 가변익 본체 (글러브 베인·파일런 미사일 포함) */
  attachF14SwingWings(g, fighter);

  /* 11) 복부 semi-recessed AIM-54 Phoenix 4발 */
  const phoenixBodyGeo = new THREE.CylinderGeometry(0.105, 0.105, 1.55, 12);
  const phoenixNoseGeo = new THREE.ConeGeometry(0.105, 0.34, 12);
  const phoenixFinGeo = new THREE.BoxGeometry(0.30, 0.02, 0.16);
  const phoenixPositions = [
    [-0.46,  0.60],
    [ 0.46,  0.60],
    [-0.46, -0.55],
    [ 0.46, -0.55],
  ];
  for (const [px, pz] of phoenixPositions) {
    const body = new THREE.Mesh(phoenixBodyGeo, m.decal);
    body.rotation.x = Math.PI / 2;
    body.position.set(px, -0.42, pz);
    g.add(body);

    const tip = new THREE.Mesh(phoenixNoseGeo, m.bodyDark);
    tip.rotation.x = Math.PI / 2;
    tip.position.set(px, -0.42, pz + 0.92);
    g.add(tip);

    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(phoenixFinGeo, m.bodyDark);
      fin.position.set(px, -0.42, pz - 0.62);
      fin.rotation.z = (i * Math.PI) / 2;
      g.add(fin);
    }
  }

  /* 12) 쌍수직미익: 외측 5° 캔트, 큰 사다리꼴 */
  addTwinVerticalStabs(g, m.body, {
    height: 1.35,
    rootSpan: 1.48,
    tipSpan: 0.56,
    thickness: 0.10,
    xSpan: 0.80,
    yBase: 0.55,
    zCenter: -1.60,
    roll: 0.09,
  });

  /* 수직미익 끝단 RWR 안테나(작은 흰 fairing) */
  for (const side of [-1, 1]) {
    const rwr = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.10, 0.30), m.decal);
    rwr.position.set(side * 0.80, 1.88, -1.95);
    g.add(rwr);
  }

  /* 13) all-moving stabilator (좌우 한 덩어리로 표현) */
  const hStab = planform([
    [ 0.45,  0.55],
    [ 2.10, -0.55],
    [ 2.10, -1.20],
    [ 0.45, -0.88],
    [-0.45, -0.88],
    [-2.10, -1.20],
    [-2.10, -0.55],
    [-0.45,  0.55],
  ], 0.11, m.body);
  hStab.position.set(0, -0.02, -2.20);
  g.add(hStab);

  /* 14) 복부 ventral fin: 외측 캔트 */
  addVentralFin(g, m.bodyDark, -1.20, -0.45, -2.05, 0.45, 0.95, -0.32);
  addVentralFin(g, m.bodyDark,  1.20, -0.45, -2.05, 0.45, 0.95,  0.32);

  g.userData.procedural = true;
  return g;
}

/* ====================== F-22 Raptor ======================
   GLB 우선(F-16/F-15/F-14와 동일). assets/models/f22.glb 필요.
   GLB가 없거나 HTTPS/HTTP가 아닐 때는 사진 5장(정면·윗면×2·측면·아랫면) 기준
   절차적 메쉬로 폴백. 착륙장치(바퀴)는 제외.

   절차적 폴백 시그니처 디테일:
    1) 날카로운 다이아몬드 라돔 + 피토
    2) 노즈→wing root 챔퍼(chine) 라인 (planform alignment)
    3) 캐럿(caret) 흡입구 — 정면 평행사변형, 외측 sweep
    4) 1인 골드 틴트 버블 캐노피
    5) 클립트 다이아몬드 주익 (LE ~42°, TE ~17° sweep)
    6) 블렌디드 윙-바디 + 상부 플랫 덱 + 평평한 복부
    7) aft twin engine humps
    8) 중앙·측면 내부 무장창 라인 + sawtooth 도어 edge
    9) 28° 외측 캔트 쌍수직미익 (클립트 윗변)
   10) 주익과 정렬된 다이아몬드 all-moving taileron
   11) 사각 2D 추력편향 노즐 + chevron 배기 가장자리
   12) 2톤 로비저빌리티 캠o 패치
   13) 외부 미사일 없음 (내부 무장창만) */
function buildF22(fighter, options) {
  const gltfMesh = Sky.AircraftModelLoader?.getClone?.('f22', fighter, options);
  if (gltfMesh) return gltfMesh;
  return buildF22Procedural(fighter);
}

function buildF22Procedural(fighter) {
  const m = makeMaterials(fighter.palette);
  const g = new THREE.Group();

  /* <!-- 골드/앰ber 틴트 캐노피: 윗면·측면 사진의 반사 코팅 --> */
  const canopyMat = m.cockpit.clone();
  canopyMat.color = new THREE.Color(0x2a2418);
  canopyMat.emissive = new THREE.Color(0x4a3820);
  canopyMat.emissiveIntensity = 0.38;

  /* 1) 중앙 동체: 블렌디드 윙-바디 베이스 */
  const coreBody = roundedBody(1.38, 0.54, 4.60, m.body);
  coreBody.position.set(0, 0.02, -0.12);
  g.add(coreBody);

  /* 2) 상부 플랫 덱 (윗면 사진의 평평한 스텔스 상면) */
  const topDeck = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.14, 3.40), m.bodyAlt);
  topDeck.position.set(0, 0.37, -0.32);
  g.add(topDeck);

  /* 3) 복부 플랫 판 (아랫면 사진의 넓은 평평한 벨리) */
  const bellyPlate = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.10, 3.70), m.bodyDark);
  bellyPlate.position.set(0, -0.29, -0.04);
  g.add(bellyPlate);

  /* 4) aft twin engine humps (윗면·측면의 후방 엔진 융기) */
  for (const side of [-1, 1]) {
    const hump = roundedBody(0.74, 0.50, 2.20, m.bodyAlt);
    hump.position.set(side * 0.64, 0.15, -1.62);
    g.add(hump);
  }

  /* 5) 노즈: 날카로운 다이아몬드 라돔 (정면·측면) */
  const noseCone = new THREE.Mesh(new THREE.ConeGeometry(0.36, 2.05, 4), m.radome);
  noseCone.rotation.x = Math.PI / 2;
  noseCone.rotation.z = Math.PI / 4;
  noseCone.position.set(0, 0.04, 2.68);
  g.add(noseCone);

  const noseBase = roundedBody(0.74, 0.50, 1.18, m.body);
  noseBase.position.set(0, 0.02, 1.88);
  g.add(noseBase);
  addPitot(g, m.dark, 3.42);

  /* 6) 챔퍼(chine): 노즈 끝→wing LE까지 날카로운 측면 모서리 (정면·윗면) */
  for (const side of [-1, 1]) {
    const chineUpper = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.22, 3.90), m.bodyAlt);
    chineUpper.position.set(side * 0.80, 0.10, 0.02);
    chineUpper.rotation.z = side * -0.52;
    g.add(chineUpper);

    const chineLower = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 3.60), m.bodyDark);
    chineLower.position.set(side * 0.70, -0.15, -0.06);
    chineLower.rotation.z = side * 0.48;
    g.add(chineLower);

    /* wing LE 위 챔퍼 연장 (planform alignment) */
    const chineWing = planform([
      [side * 0.88,  0.65],
      [side * 2.44, -0.12],
      [side * 2.42, -0.32],
      [side * 0.88,  0.22],
    ], 0.06, m.bodyAlt);
    chineWing.position.set(0, 0.19, -0.06);
    g.add(chineWing);
  }

  /* 7) 캐럿(caret) 흡입구: 정면 평행사변형 + 측면 sweep (정면·측면 사진) */
  for (const side of [-1, 1]) {
    const duct = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.44, 1.48), m.bodyAlt);
    duct.position.set(side * 0.94, -0.06, 0.74);
    duct.rotation.y = side * 0.24;
    duct.rotation.z = side * -0.13;
    g.add(duct);

    const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.50, 0.40), m.intake);
    mouth.position.set(side * 1.04, -0.04, 1.50);
    mouth.rotation.y = side * 0.24;
    mouth.rotation.z = side * -0.15;
    g.add(mouth);

    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 1.38), m.bodyDark);
    lip.position.set(side * 0.90, 0.13, 0.72);
    lip.rotation.y = side * 0.22;
    g.add(lip);
  }

  /* 8) 1인 골드 틴트 버블 캐노피 (측면·윗면: 전방 배치) */
  addCanopy(g, canopyMat, 0, 0.47, 1.08, 0.90, 0.52, 1.72);

  const canopyFairing = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.16, 0.50), m.bodyDark);
  canopyFairing.position.set(0, 0.39, 0.44);
  g.add(canopyFairing);

  /* 9) 클립트 다이아몬드 주익 (윗면 사진: LE sweep ~42°, TE forward sweep, clipped tip) */
  const mainWing = planform([
    [ 0.90,  0.64], [ 2.44, -0.20], [ 2.44, -0.56], [ 0.90, -1.10],
    [-0.90, -1.10], [-2.44, -0.56], [-2.44, -0.20], [-0.90,  0.64],
  ], 0.11, m.body);
  mainWing.position.set(0, 0.01, -0.06);
  g.add(mainWing);

  for (const side of [-1, 1]) {
    const rootFair = planform([
      [side * 0.90,  0.64],
      [side * 1.38,  0.14],
      [side * 1.38, -0.56],
      [side * 0.90, -0.76],
    ], 0.14, m.bodyAlt);
    rootFair.position.set(0, 0.06, -0.06);
    g.add(rootFair);
  }

  /* 10) 내부 무장창 (아랫면·측면: 외부 미사일 없음, 도어 라인만) */
  const mainBay = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.025, 2.10), m.dark);
  mainBay.position.set(0, -0.345, -0.10);
  g.add(mainBay);

  for (const side of [-1, 1]) {
    const sideBay = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.022, 0.98), m.dark);
    sideBay.position.set(side * 0.56, -0.338, 0.38);
    g.add(sideBay);

    /* sawtooth edge: 스텔스 톱니 도어 (아랫면 사진) */
    for (let i = 0; i < 4; i++) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.06), m.dark);
      tooth.position.set(side * (0.40 + i * 0.09), -0.352, -0.22 + i * 0.18);
      tooth.rotation.z = side * 0.55;
      g.add(tooth);
    }
  }

  /* 복부 센서/접근 포트 (아랫면 사진의 작은 돔) */
  for (const pz of [-0.52, 0.18, 0.75]) {
    const port = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.025, 8), m.bodyDark);
    port.rotation.x = Math.PI / 2;
    port.position.set(0, -0.348, pz);
    g.add(port);
  }

  /* 11) 28° 외측 캔트 쌍수직미익 (정면·측면: V자형 twin tail) */
  addTwinVerticalStabs(g, m.body, {
    rootSpan: 1.45,
    tipSpan: 0.30,
    height: 1.15,
    thickness: 0.09,
    xSpan: 0.76,
    yBase: 0.55,
    zCenter: -2.02,
    roll: 0.49,
    sweep: 0.24,
    rootEmbed: 0.30,
  });

  /* 12) 다이아몬드 all-moving taileron (윗면: 주익과 동일 sweep 정렬) */
  const hStab = planform([
    [ 0.54,  0.18], [ 1.75, -0.46], [ 1.75, -0.84], [ 0.54, -0.74],
    [-0.54, -0.74], [-1.75, -0.84], [-1.75, -0.46], [-0.54,  0.18],
  ], 0.075, m.bodyAlt);
  hStab.position.set(0, 0.0, -2.44);
  g.add(hStab);

  /* 13) 사각 2D 추력편향 노즐 + chevron (측면·아랫면: flat rectangular nozzle) */
  for (const side of [-1, 1]) {
    const nzOuter = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.30, 0.64), m.dark);
    nzOuter.position.set(side * 0.50, -0.02, -2.98);
    g.add(nzOuter);

    const chevron = new THREE.Mesh(new THREE.BoxGeometry(0.53, 0.06, 0.12), m.bodyDark);
    chevron.position.set(side * 0.50, -0.15, -3.22);
    g.add(chevron);

    const throat = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.24), m.intake);
    throat.position.set(side * 0.50, -0.02, -3.26);
    throat.rotation.y = Math.PI;
    g.add(throat);

    addThrust(g, m.glow, side * 0.50, -3.46, 0.26, 0.95);
  }

  /* 14) 2톤 로비저빌리티 캠o 패치 (윗면 사진) */
  [
    { w: 0.78, h: 0.04, d: 1.48, x: 0, y: 0.405, z: -0.52 },
    { w: 1.38, h: 0.035, d: 0.88, x: 0, y: 0.405, z: -1.38 },
    { w: 0.58, h: 0.04, d: 1.12, x: -1.68, y: 0.065, z: -0.32 },
    { w: 0.58, h: 0.04, d: 1.12, x: 1.68, y: 0.065, z: -0.32 },
  ].forEach((p) => {
    const patch = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.d), m.camo);
    patch.position.set(p.x, p.y, p.z);
    g.add(patch);
  });

  g.userData.procedural = true;
  return g;
}

/* ====================== MiG-29 Fulcrum ======================
   참고 형상: Mikoyan MiG-29A "9-12".
   - 큰 LERX 두 장이 캐노피 바로 옆에서 시작해 주익까지 이어짐
   - 분리된 쌍발 RD-33 (지상 운용 시 메인 흡입구를 닫고 상부 보조 흡입구 사용)
   - 흡입구는 LERX 아래에 박스형으로 분리 배치
   - 쌍수직미익 — 약간 외측 캔트 (8도 정도)
   - 캐노피 앞 IRST/광학 센서 볼 (시그니처)
   - 윙 펜스(주익 위 작은 세로 판) */
function buildMig29(fighter, options) {
  const gltfMesh = Sky.AircraftModelLoader?.getClone?.('mig29', fighter, options);
  if (gltfMesh) return gltfMesh;
  return buildMig29Procedural(fighter);
}

function buildMig29Procedural(fighter) {
  const m = makeMaterials(fighter.palette);
  const g = new THREE.Group();

  /* 동체: 매끄러운 타원 단면 */
  const body = roundedBody(1.3, 0.5, 3.6, m.body);
  g.add(body);
  /* 등쪽 hump (라운드 페어링) */
  const dorsal = roundedBody(0.85, 0.26, 2.4, m.bodyAlt);
  dorsal.position.set(0, 0.35, -0.4);
  g.add(dorsal);

  /* 노즈 — 뾰족하고 살짝 가늘게 */
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.6, 14), m.body);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, -0.05, 2.45);
  g.add(nose);
  addPitot(g, m.dark, 3.35);

  /* IRST 광학 볼 — 캐노피 앞 우측에 살짝 오프셋 */
  addIRST(g, m.sensor, 0.12, 0.18, 1.55, 0.13);

  addCanopy(g, m.cockpit, 0, 0.34, 0.95, 0.85, 0.55, 1.4);

  /* MiG-29 의 핵심: 큰 LERX. 캐노피 옆에서 시작해 wing root까지 길게. */
  const lerx = planform([
    [ 0.7,  1.7], [ 1.4,  0.6], [ 1.4,  0.0], [ 0.7,  0.0],
    [-0.7,  0.0], [-1.4,  0.0], [-1.4,  0.6], [-0.7,  1.7],
  ], 0.08, m.bodyAlt);
  lerx.position.y = 0.05;
  g.add(lerx);

  /* 분리된 사각 흡입구 — LERX 아래, 동체에서 떨어진 위치 */
  const intakeGeo = new THREE.BoxGeometry(0.45, 0.4, 1.4);
  const inL = new THREE.Mesh(intakeGeo, m.bodyAlt);
  inL.position.set(-0.85, -0.25, 0.4);
  const inR = inL.clone();
  inR.position.x = 0.85;
  g.add(inL, inR);
  const mGeo = new THREE.PlaneGeometry(0.38, 0.34);
  const mL = new THREE.Mesh(mGeo, m.intake);
  mL.position.set(-0.85, -0.25, 1.11);
  const mR = mL.clone();
  mR.position.x = 0.85;
  g.add(mL, mR);

  /* 주익 */
  const wing = planform([
    [ 0.75,  0.3], [ 3.0, -0.65], [ 3.0, -1.2], [ 0.75, -1.3],
    [-0.75, -1.3], [-3.0, -1.2], [-3.0, -0.65], [-0.75,  0.3],
  ], 0.1, m.body);
  wing.position.y = -0.02;
  g.add(wing);

  /* 윙 펜스 — MiG-29의 윙 위 작은 세로 판 */
  addWingFence(g, m.bodyDark, -1.7, 0.07, -0.4, 0.5, 0.16);
  addWingFence(g, m.bodyDark,  1.7, 0.07, -0.4, 0.5, 0.16);

  /* R-73 / R-27 미사일 */
  addPylonMissile(g, m.bodyDark, -2.4, -0.6);
  addPylonMissile(g, m.bodyDark,  2.4, -0.6);
  addPylonMissile(g, m.bodyDark, -1.45, -0.5);
  addPylonMissile(g, m.bodyDark,  1.45, -0.5);

  /* 쌍수직미익 — 약간 외측 캔트 */
  addTwinVerticalStabs(g, m.body, { width: 0.1, height: 1.05, depth: 1.15, xSpan: 0.75, y: 0.55, z: -1.4, roll: 0.18 });

  /* 수평 미익 */
  const hStab = planform([
    [ 0.4,  0.2], [ 1.55, -0.45], [ 1.55, -0.85], [ 0.4, -0.7],
    [-0.4, -0.7], [-1.55, -0.85], [-1.55, -0.45], [-0.4,  0.2],
  ], 0.08, m.body);
  hStab.position.set(0, -0.05, -1.85);
  g.add(hStab);

  /* 쌍발 노즐 — RD-33 원형 */
  const nzGeo = new THREE.CylinderGeometry(0.4, 0.46, 0.55, 16);
  const nzL = new THREE.Mesh(nzGeo, m.dark);
  nzL.rotation.x = Math.PI / 2;
  nzL.position.set(-0.42, -0.15, -2.2);
  const nzR = nzL.clone();
  nzR.position.x = 0.42;
  g.add(nzL, nzR);

  addThrust(g, m.glow, -0.42, -2.75, 0.34, 0.9);
  addThrust(g, m.glow.clone(),  0.42, -2.75, 0.34, 0.9);
  return g;
}

/* ====================== Su-27 Flanker ======================
   참고 형상: Sukhoi Su-27S.
   - "Lifting body" 설계: 동체 자체가 양력 발생, 엔진이 동체 아래로 매달림
   - 엄청 큰 LERX, 부드럽게 주익과 블렌드
   - 매우 긴 노즈 + 살짝 처진 끝 (drooped radome)
   - 캐노피 앞 IRST 볼 (오프셋 없이 중앙선)
   - 엔진 사이 거대한 "스팅거" 꼬리 페어링
   - 큰 쌍수직미익 + 보조 복부 핀 두 장 */
function buildSu27(fighter, options) {
  const gltfMesh = Sky.AircraftModelLoader?.getClone?.('su27', fighter, options);
  if (gltfMesh) return gltfMesh;
  return buildSu27Procedural(fighter);
}

function buildSu27Procedural(fighter) {
  const m = makeMaterials(fighter.palette);
  const g = new THREE.Group();

  /* 동체 — 매우 길고 넓적, lifting body 의 매끄러운 타원 단면 */
  const body = roundedBody(1.7, 0.5, 4.8, m.body);
  g.add(body);
  /* 등쪽 hump (라운드) */
  const dorsal = roundedBody(1.2, 0.26, 3.6, m.bodyAlt);
  dorsal.position.set(0, 0.36, -0.4);
  g.add(dorsal);

  /* 매우 긴 노즈 (살짝 아래로 처진 느낌을 위해 y 약간 -) */
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.48, 2.1, 14), m.body);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, -0.08, 3.1);
  g.add(nose);
  addPitot(g, m.dark, 4.2);

  /* IRST 볼 — 중앙선 캐노피 앞 */
  addIRST(g, m.sensor, 0, 0.2, 1.85, 0.15);

  /* 엔진 — 동체 아래로 매달림, 멀리 떨어짐 */
  const nacelleGeo = createCapsuleGeometry(0.42, 3.0, 6, 12);
  const nL = new THREE.Mesh(nacelleGeo, m.bodyAlt);
  nL.rotation.x = Math.PI / 2;
  nL.position.set(-0.72, -0.35, -0.45);
  const nR = nL.clone();
  nR.position.x = 0.72;
  g.add(nL, nR);
  /* 흡입구 입구 */
  const mGeo = new THREE.PlaneGeometry(0.5, 0.45);
  const mL = new THREE.Mesh(mGeo, m.intake);
  mL.position.set(-0.72, -0.35, 1.1);
  const mR = mL.clone();
  mR.position.x = 0.72;
  g.add(mL, mR);

  addCanopy(g, m.cockpit, 0, 0.4, 1.4, 0.95, 0.6, 1.75);

  /* 거대한 LERX — 노즈 옆부터 주익 루트까지 길게 (Su-27 의 시그니처) */
  const lerx = planform([
    [ 0.95,  2.2], [ 1.5,  0.9], [ 1.5,  0.1], [ 0.95,  0.1],
    [-0.95,  0.1], [-1.5,  0.1], [-1.5,  0.9], [-0.95,  2.2],
  ], 0.08, m.bodyAlt);
  lerx.position.y = 0.06;
  g.add(lerx);

  /* 큰 주익 (블렌디드, 약 42도 후퇴각) */
  const wing = planform([
    [ 0.95,  0.5], [ 3.6, -0.7], [ 3.6, -1.35], [ 0.95, -1.55],
    [-0.95, -1.55], [-3.6, -1.35], [-3.6, -0.7], [-0.95,  0.5],
  ], 0.1, m.body);
  wing.position.y = 0.0;
  g.add(wing);

  /* 미사일 R-27 / R-73 다수 */
  for (const x of [-2.8, -1.7, -0.4, 0.4, 1.7, 2.8]) {
    addPylonMissile(g, m.bodyDark, x, -0.75);
  }

  /* 큰 쌍수직미익 — 약간 외측 */
  addTwinVerticalStabs(g, m.body, { width: 0.1, height: 1.2, depth: 1.4, xSpan: 0.72, y: 0.65, z: -1.7, roll: 0.16 });

  /* 복부 핀 — 큰 두 장 */
  addVentralFin(g, m.bodyDark, -0.72, -0.55, -1.6, 0.4, 0.85,  0.3);
  addVentralFin(g, m.bodyDark,  0.72, -0.55, -1.6, 0.4, 0.85, -0.3);

  /* 수평 미익 */
  const hStab = planform([
    [ 0.4,  0.3], [ 1.75, -0.55], [ 1.75, -1.05], [ 0.4, -0.9],
    [-0.4, -0.9], [-1.75, -1.05], [-1.75, -0.55], [-0.4,  0.3],
  ], 0.08, m.body);
  hStab.position.set(0, -0.12, -2.15);
  g.add(hStab);

  /* 엔진 사이 스팅거 — Su-27 의 시그니처 꼬리 페어링 */
  const stinger = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 1.5), m.bodyDark);
  stinger.position.set(0, -0.08, -2.4);
  g.add(stinger);
  /* 스팅거 끝 마무리 */
  const stingerTip = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 8), m.bodyDark);
  stingerTip.rotation.x = -Math.PI / 2;
  stingerTip.position.set(0, -0.08, -3.25);
  g.add(stingerTip);

  /* 쌍발 노즐 — AL-31F 원형 */
  const nzGeo = new THREE.CylinderGeometry(0.4, 0.46, 0.55, 16);
  const nzL = new THREE.Mesh(nzGeo, m.dark);
  nzL.rotation.x = Math.PI / 2;
  nzL.position.set(-0.72, -0.35, -2.6);
  const nzR = nzL.clone();
  nzR.position.x = 0.72;
  g.add(nzL, nzR);

  addThrust(g, m.glow, -0.72, -3.15, 0.34, 1.05);
  addThrust(g, m.glow.clone(),  0.72, -3.15, 0.34, 1.05);
  return g;
}

/* ====================== Su-30 Flanker-C ======================
   참고 형상: Sukhoi Su-30MK 계열.
   - Su-27 베이스 + 카나드(LERX 앞에 작은 가동면)
   - 2인 탠덤 캐노피 (조금 더 긴 캐노피)
   - 추력편향 노즐(살짝 외측 캔트)
   주의: Su-27 빌더와 의도적으로 유사한 외형을 공유합니다.
        식별 포인트는 카나드와 탠덤 캐노피, 엔진 노즐 각도입니다. */
function buildSu30(fighter, options) {
  const gltfMesh = Sky.AircraftModelLoader?.getClone?.('su30', fighter, options);
  if (gltfMesh) return gltfMesh;
  return buildSu30Procedural(fighter);
}

function buildSu30Procedural(fighter) {
  const m = makeMaterials(fighter.palette);
  const g = new THREE.Group();

  const body = roundedBody(1.7, 0.5, 4.8, m.body);
  g.add(body);
  const dorsal = roundedBody(1.2, 0.26, 3.6, m.bodyAlt);
  dorsal.position.set(0, 0.36, -0.4);
  g.add(dorsal);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.48, 2.1, 14), m.body);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, -0.08, 3.1);
  g.add(nose);
  addPitot(g, m.dark, 4.2);
  addIRST(g, m.sensor, 0, 0.2, 1.85, 0.15);

  const nacelleGeo = createCapsuleGeometry(0.42, 3.0, 6, 12);
  const nL = new THREE.Mesh(nacelleGeo, m.bodyAlt);
  nL.rotation.x = Math.PI / 2;
  nL.position.set(-0.72, -0.35, -0.45);
  const nR = nL.clone();
  nR.position.x = 0.72;
  g.add(nL, nR);
  const mGeo = new THREE.PlaneGeometry(0.5, 0.45);
  const mL = new THREE.Mesh(mGeo, m.intake);
  mL.position.set(-0.72, -0.35, 1.1);
  const mR = mL.clone();
  mR.position.x = 0.72;
  g.add(mL, mR);

  /* 2인 탠덤 캐노피 — Su-27 단좌형보다 더 길게 */
  addCanopy(g, m.cockpit, 0, 0.4, 1.4, 0.95, 0.6, 2.1);

  /* 카나드 — Su-30 의 가장 큰 식별 포인트. LERX 앞에 작은 가동면 */
  const canard = planform([
    [ 0.55,  0.15], [ 1.35, -0.35], [ 1.35, -0.6], [ 0.55, -0.5],
    [-0.55, -0.5], [-1.35, -0.6], [-1.35, -0.35], [-0.55,  0.15],
  ], 0.06, m.bodyAlt);
  canard.position.set(0, 0.2, 2.25);
  g.add(canard);

  /* LERX (Su-27 와 동일) */
  const lerx = planform([
    [ 0.95,  2.2], [ 1.5,  0.9], [ 1.5,  0.1], [ 0.95,  0.1],
    [-0.95,  0.1], [-1.5,  0.1], [-1.5,  0.9], [-0.95,  2.2],
  ], 0.08, m.bodyAlt);
  lerx.position.y = 0.06;
  g.add(lerx);

  const wing = planform([
    [ 0.95,  0.5], [ 3.6, -0.7], [ 3.6, -1.35], [ 0.95, -1.55],
    [-0.95, -1.55], [-3.6, -1.35], [-3.6, -0.7], [-0.95,  0.5],
  ], 0.1, m.body);
  wing.position.y = 0.0;
  g.add(wing);

  for (const x of [-2.8, -1.7, -0.4, 0.4, 1.7, 2.8]) {
    addPylonMissile(g, m.bodyDark, x, -0.75);
  }
  /* 추가 R-77 (다목적 강화) */
  addPylonMissile(g, m.bodyDark, -3.4, -0.95);
  addPylonMissile(g, m.bodyDark,  3.4, -0.95);

  addTwinVerticalStabs(g, m.body, { width: 0.1, height: 1.2, depth: 1.4, xSpan: 0.72, y: 0.65, z: -1.7, roll: 0.16 });

  addVentralFin(g, m.bodyDark, -0.72, -0.55, -1.6, 0.4, 0.85,  0.3);
  addVentralFin(g, m.bodyDark,  0.72, -0.55, -1.6, 0.4, 0.85, -0.3);

  const hStab = planform([
    [ 0.4,  0.3], [ 1.75, -0.55], [ 1.75, -1.05], [ 0.4, -0.9],
    [-0.4, -0.9], [-1.75, -1.05], [-1.75, -0.55], [-0.4,  0.3],
  ], 0.08, m.body);
  hStab.position.set(0, -0.12, -2.15);
  g.add(hStab);

  const stinger = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 1.5), m.bodyDark);
  stinger.position.set(0, -0.08, -2.4);
  g.add(stinger);
  const stingerTip = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 8), m.bodyDark);
  stingerTip.rotation.x = -Math.PI / 2;
  stingerTip.position.set(0, -0.08, -3.25);
  g.add(stingerTip);

  /* 노즐 — 추력편향을 흉내내기 위해 살짝 외측 캔트 */
  const nzGeo = new THREE.CylinderGeometry(0.4, 0.46, 0.55, 16);
  const nzL = new THREE.Mesh(nzGeo, m.dark);
  nzL.rotation.x = Math.PI / 2;
  nzL.rotation.z = 0.1;
  nzL.position.set(-0.72, -0.35, -2.6);
  const nzR = nzL.clone();
  nzR.position.x = 0.72;
  nzR.rotation.z = -0.1;
  g.add(nzL, nzR);

  const tL = addThrust(g, m.glow, -0.72, -3.15, 0.34, 1.05);
  tL.rotation.z = 0.1;
  const tR = addThrust(g, m.glow.clone(), 0.72, -3.15, 0.34, 1.05);
  tR.rotation.z = -0.1;
  return g;
}

/* ====================== Su-32 Strike Flanker ======================
   참고 형상: Sukhoi Su-34/32 폭격형.
   - 동체 앞부분이 매우 넓적해진 "오리너구리" 노즈 (사이드-바이-사이드 콕핏)
   - 노즈 끝은 평평하고, 앞쪽이 박스에 가깝게 두꺼움
   - Su-27 베이스의 큰 LERX/주익은 유지
   - 폭격형이라 카나드는 유지(작은 가동면)
   - 늘어난 후방 페어링(레이더/체프) */
function buildSu32(fighter, options) {
  const gltfMesh = Sky.AircraftModelLoader?.getClone?.('su32', fighter, options);
  if (gltfMesh) return gltfMesh;
  return buildSu32Procedural(fighter);
}

function buildSu32Procedural(fighter) {
  const m = makeMaterials(fighter.palette);
  const g = new THREE.Group();

  const body = roundedBody(1.75, 0.55, 4.8, m.body);
  g.add(body);
  const dorsal = roundedBody(1.25, 0.28, 3.6, m.bodyAlt);
  dorsal.position.set(0, 0.36, -0.4);
  g.add(dorsal);

  /* 오리너구리(platypus) 노즈 — 앞이 넓적한 박스 형태로 표현 */
  const platypus = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.55, 1.6), m.body);
  platypus.position.set(0, 0.05, 2.55);
  g.add(platypus);
  /* 노즈 끝 짧은 페어링 */
  const noseCap = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.45, 0.5), m.bodyAlt);
  noseCap.position.set(0, 0.0, 3.55);
  g.add(noseCap);
  /* 끝의 작은 콘(레이돔 마무리) */
  const radome = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.7, 10), m.bodyAlt);
  radome.rotation.x = Math.PI / 2;
  radome.position.set(0, 0.0, 4.05);
  g.add(radome);
  addPitot(g, m.dark, 4.5);
  addIRST(g, m.sensor, 0, 0.28, 2.3, 0.15);

  /* 평평한 윈드실드 (사이드-바이-사이드 캐노피의 앞 유리) */
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.32, 0.7), m.cockpit);
  windshield.position.set(0, 0.35, 2.75);
  g.add(windshield);
  /* 캐노피 본체 — 앞 동체 위에 폭이 넓은 캐노피 */
  addCanopy(g, m.cockpit, 0, 0.3, 2.05, 1.25, 0.45, 1.3);

  /* 엔진 — Su-27 과 동일한 매달림 구성 */
  const nacelleGeo = createCapsuleGeometry(0.45, 3.0, 6, 12);
  const nL = new THREE.Mesh(nacelleGeo, m.bodyAlt);
  nL.rotation.x = Math.PI / 2;
  nL.position.set(-0.75, -0.38, -0.45);
  const nR = nL.clone();
  nR.position.x = 0.75;
  g.add(nL, nR);
  const mGeo = new THREE.PlaneGeometry(0.55, 0.5);
  const mL = new THREE.Mesh(mGeo, m.intake);
  mL.position.set(-0.75, -0.38, 1.1);
  const mR = mL.clone();
  mR.position.x = 0.75;
  g.add(mL, mR);

  /* 카나드(소형, 폭격형은 약하게) */
  const canard = planform([
    [ 0.5,  0.1], [ 1.2, -0.3], [ 1.2, -0.5], [ 0.5, -0.4],
    [-0.5, -0.4], [-1.2, -0.5], [-1.2, -0.3], [-0.5,  0.1],
  ], 0.06, m.bodyAlt);
  canard.position.set(0, 0.22, 1.7);
  g.add(canard);

  const lerx = planform([
    [ 0.95,  1.7], [ 1.5,  0.8], [ 1.5,  0.1], [ 0.95,  0.1],
    [-0.95,  0.1], [-1.5,  0.1], [-1.5,  0.8], [-0.95,  1.7],
  ], 0.08, m.bodyAlt);
  lerx.position.y = 0.06;
  g.add(lerx);

  const wing = planform([
    [ 0.95,  0.5], [ 3.7, -0.7], [ 3.7, -1.35], [ 0.95, -1.55],
    [-0.95, -1.55], [-3.7, -1.35], [-3.7, -0.7], [-0.95,  0.5],
  ], 0.1, m.body);
  g.add(wing);

  /* 무거운 폭장 — 굵은 폭탄/공대지 미사일 묘사 */
  for (const x of [-3.0, -1.9, -0.5, 0.5, 1.9, 3.0]) {
    const big = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.3, 8), m.bodyDark);
    big.rotation.x = Math.PI / 2;
    big.position.set(x, -0.85, -0.1);
    g.add(big);
  }

  addTwinVerticalStabs(g, m.body, { width: 0.1, height: 1.2, depth: 1.4, xSpan: 0.75, y: 0.65, z: -1.7, roll: 0.16 });

  addVentralFin(g, m.bodyDark, -0.75, -0.55, -1.6, 0.4, 0.85,  0.3);
  addVentralFin(g, m.bodyDark,  0.75, -0.55, -1.6, 0.4, 0.85, -0.3);

  const hStab = planform([
    [ 0.4,  0.3], [ 1.75, -0.55], [ 1.75, -1.05], [ 0.4, -0.9],
    [-0.4, -0.9], [-1.75, -1.05], [-1.75, -0.55], [-0.4,  0.3],
  ], 0.08, m.body);
  hStab.position.set(0, -0.12, -2.15);
  g.add(hStab);

  /* 늘어난 후방 페어링 — Su-34 의 시그니처 (후방 레이더/연료 추가) */
  const stinger = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 1.85), m.bodyDark);
  stinger.position.set(0, -0.08, -2.5);
  g.add(stinger);
  const stingerTip = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 8), m.bodyDark);
  stingerTip.rotation.x = -Math.PI / 2;
  stingerTip.position.set(0, -0.08, -3.55);
  g.add(stingerTip);

  const nzGeo = new THREE.CylinderGeometry(0.4, 0.46, 0.55, 16);
  const nzL = new THREE.Mesh(nzGeo, m.dark);
  nzL.rotation.x = Math.PI / 2;
  nzL.position.set(-0.75, -0.38, -2.6);
  const nzR = nzL.clone();
  nzR.position.x = 0.75;
  g.add(nzL, nzR);

  addThrust(g, m.glow, -0.75, -3.15, 0.34, 1.05);
  addThrust(g, m.glow.clone(),  0.75, -3.15, 0.34, 1.05);
  return g;
}

/* ====================== Su-35S Flanker-E ======================
   참고 형상: Sukhoi Su-35S.
   - Su-27 베이스의 단좌형 + 4.5세대 발전형
   - 카나드 없음(Su-30/32 와 차별점)
   - 강하게 캔트된 추력편향 노즐(외측 13도 + 살짝 다운)
   - 등쪽 페어링이 더 매끄럽고 노즈가 약간 더 굵음
   - 동체 측면 두꺼운 인테이크 (큰 출력) */
function buildSu35(fighter, options) {
  const gltfMesh = Sky.AircraftModelLoader?.getClone?.('su35', fighter, options);
  if (gltfMesh) return gltfMesh;
  return buildSu35Procedural(fighter);
}

function buildSu35Procedural(fighter) {
  const m = makeMaterials(fighter.palette);
  const g = new THREE.Group();

  /* 동체 — Su-27 보다 약간 더 두꺼움 */
  const body = roundedBody(1.78, 0.55, 4.9, m.body);
  g.add(body);
  const dorsal = roundedBody(1.25, 0.3, 3.8, m.bodyAlt);
  dorsal.position.set(0, 0.38, -0.4);
  g.add(dorsal);

  /* 약간 더 굵은 노즈 (Irbis-E 레이더) */
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.52, 2.1, 14), m.body);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, -0.05, 3.1);
  g.add(nose);
  addPitot(g, m.dark, 4.2);
  addIRST(g, m.sensor, 0, 0.22, 1.9, 0.16);

  /* 두꺼운 엔진 나셀 */
  const nacelleGeo = createCapsuleGeometry(0.46, 3.1, 6, 12);
  const nL = new THREE.Mesh(nacelleGeo, m.bodyAlt);
  nL.rotation.x = Math.PI / 2;
  nL.position.set(-0.78, -0.35, -0.45);
  const nR = nL.clone();
  nR.position.x = 0.78;
  g.add(nL, nR);
  const mGeo = new THREE.PlaneGeometry(0.55, 0.5);
  const mL = new THREE.Mesh(mGeo, m.intake);
  mL.position.set(-0.78, -0.35, 1.15);
  const mR = mL.clone();
  mR.position.x = 0.78;
  g.add(mL, mR);

  addCanopy(g, m.cockpit, 0, 0.42, 1.4, 0.95, 0.62, 1.8);

  /* LERX — Su-27 동일 */
  const lerx = planform([
    [ 0.98,  2.25], [ 1.55,  0.9], [ 1.55,  0.1], [ 0.98,  0.1],
    [-0.98,  0.1], [-1.55,  0.1], [-1.55,  0.9], [-0.98,  2.25],
  ], 0.08, m.bodyAlt);
  lerx.position.y = 0.07;
  g.add(lerx);

  /* 주익 — 약간 더 큼 */
  const wing = planform([
    [ 0.98,  0.55], [ 3.7, -0.7], [ 3.7, -1.4], [ 0.98, -1.6],
    [-0.98, -1.6], [-3.7, -1.4], [-3.7, -0.7], [-0.98,  0.55],
  ], 0.1, m.body);
  g.add(wing);

  /* 미사일 적재 — Su-27 보다 많음 (개량형) */
  for (const x of [-3.4, -2.5, -1.5, -0.4, 0.4, 1.5, 2.5, 3.4]) {
    addPylonMissile(g, m.bodyDark, x, -0.75);
  }

  addTwinVerticalStabs(g, m.body, { width: 0.1, height: 1.25, depth: 1.45, xSpan: 0.78, y: 0.68, z: -1.7, roll: 0.18 });

  addVentralFin(g, m.bodyDark, -0.78, -0.55, -1.6, 0.4, 0.9,  0.3);
  addVentralFin(g, m.bodyDark,  0.78, -0.55, -1.6, 0.4, 0.9, -0.3);

  const hStab = planform([
    [ 0.4,  0.32], [ 1.8, -0.55], [ 1.8, -1.1], [ 0.4, -0.95],
    [-0.4, -0.95], [-1.8, -1.1], [-1.8, -0.55], [-0.4,  0.32],
  ], 0.08, m.body);
  hStab.position.set(0, -0.1, -2.15);
  g.add(hStab);

  const stinger = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 1.5), m.bodyDark);
  stinger.position.set(0, -0.08, -2.4);
  g.add(stinger);
  const stingerTip = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 8), m.bodyDark);
  stingerTip.rotation.x = -Math.PI / 2;
  stingerTip.position.set(0, -0.08, -3.25);
  g.add(stingerTip);

  /* 추력편향 노즐 — 외측 + 아래로 살짝 (3D TVC 흉내) */
  const nzGeo = new THREE.CylinderGeometry(0.42, 0.5, 0.6, 18);
  const nzL = new THREE.Mesh(nzGeo, m.dark);
  nzL.rotation.x = Math.PI / 2;
  nzL.rotation.z = 0.22;
  nzL.position.set(-0.78, -0.42, -2.6);
  const nzR = nzL.clone();
  nzR.position.x = 0.78;
  nzR.rotation.z = -0.22;
  g.add(nzL, nzR);

  const tL = addThrust(g, m.glow, -0.78, -3.2, 0.36, 1.1);
  tL.rotation.z = 0.22;
  const tR = addThrust(g, m.glow.clone(), 0.78, -3.2, 0.36, 1.1);
  tR.rotation.z = -0.22;
  return g;
}

/* ====================== Su-57 Felon ======================
   참고 형상: Sukhoi Su-57.
   - Su-27 계열의 멀리 떨어진 쌍발 + 5세대 스텔스 형상의 결합
   - LEVCON: 주익 앞에서 길게 뻗은 가변 면 (Su-57 시그니처)
   - 강하게 외측 캔트(28도)된 쌍수직미익 + 같은 각도의 캔트 수평미익
   - 평평한 윗면, 다이아몬드 단면 동체
   - DSI 형 곡선 흡입구 (스플리터 플레이트 없음)
   - 둥근 3D 추력편향 노즐 */
function buildSu57(fighter, options) {
  const gltfMesh = Sky.AircraftModelLoader?.getClone?.('su57', fighter, options);
  if (gltfMesh) return gltfMesh;
  return buildSu57Procedural(fighter);
}

function buildSu57Procedural(fighter) {
  const m = makeMaterials(fighter.palette);
  const g = new THREE.Group();

  /* 동체 — 라운드된 베이스 + 챔퍼 패널로 다이아몬드 단면 느낌
     (실사 Su-57 도 LEVCON 사이는 매끄럽고 둥근 lifting body) */
  const body = roundedBody(1.7, 0.55, 4.4, m.body);
  g.add(body);
  /* 평평한 윗면 (라운드 페어링) */
  const topDeck = roundedBody(1.15, 0.16, 3.4, m.bodyAlt);
  topDeck.position.set(0, 0.35, -0.4);
  g.add(topDeck);
  /* 챔퍼 패널 (다이아몬드 단면) */
  const chineGeo = new THREE.BoxGeometry(0.18, 0.36, 3.4);
  const chineL = new THREE.Mesh(chineGeo, m.bodyAlt);
  chineL.position.set(-0.9, 0.08, -0.2);
  chineL.rotation.z = -0.4;
  const chineR = chineL.clone();
  chineR.position.x = 0.9;
  chineR.rotation.z = 0.4;
  g.add(chineL, chineR);

  /* 길고 평평한 노즈 (8각 콘으로 스텔스 챔퍼 느낌) */
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.9, 8), m.body);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, -0.05, 2.85);
  g.add(nose);
  addPitot(g, m.dark, 3.85);

  /* IRST 볼 — 캐노피 앞 (오프셋 없이) */
  addIRST(g, m.sensor, 0, 0.2, 1.7, 0.14);

  /* DSI 형 곡선 흡입구 (DSI bump + 둥글둥글한 입구) */
  addDSIBump(g, m.bodyAlt, -0.82, -0.15, 0.8);
  addDSIBump(g, m.bodyAlt,  0.82, -0.15, 0.8);
  /* 흡입구 입구 */
  const mGeo = new THREE.CircleGeometry(0.22, 16);
  const mL = new THREE.Mesh(mGeo, m.intake);
  mL.scale.set(1, 0.85, 1);
  mL.position.set(-0.82, -0.15, 1.2);
  const mR = mL.clone();
  mR.position.x = 0.82;
  g.add(mL, mR);

  addCanopy(g, m.cockpit, 0, 0.36, 1.25, 0.95, 0.55, 1.75);

  /* LEVCON — 주익 앞에서 길게 뻗은 가변 면 (Su-57 시그니처). LERX 보다 더 앞으로. */
  const levcon = planform([
    [ 0.7,  1.85], [ 1.35,  0.7], [ 1.35,  0.2], [ 0.7,  0.2],
    [-0.7,  0.2], [-1.35,  0.2], [-1.35,  0.7], [-0.7,  1.85],
  ], 0.07, m.bodyAlt);
  levcon.position.y = 0.06;
  g.add(levcon);

  /* 주익 — 트라페조이드 (F-22 와 유사하지만 약간 더 가늘게) */
  const wing = planform([
    [ 0.9,  0.4], [ 3.4, -0.65], [ 3.2, -1.5], [ 0.9, -1.6],
    [-0.9, -1.6], [-3.2, -1.5], [-3.4, -0.65], [-0.9,  0.4],
  ], 0.1, m.body);
  wing.position.y = -0.02;
  g.add(wing);

  /* 강하게 외측 캔트된 쌍수직미익 */
  addTwinVerticalStabs(g, m.body, { width: 0.1, height: 1.0, depth: 1.35, xSpan: 0.85, y: 0.48, z: -1.55, roll: 0.55 });

  /* 캔트된 수평미익 (수직미익과 같은 방향으로 약간 기울어짐) */
  const hStab = planform([
    [ 0.45,  0.25], [ 1.65, -0.5], [ 1.65, -0.95], [ 0.45, -0.8],
    [-0.45, -0.8], [-1.65, -0.95], [-1.65, -0.5], [-0.45,  0.25],
  ], 0.08, m.body);
  hStab.position.set(0, -0.05, -2.0);
  g.add(hStab);

  /* 멀리 떨어진 쌍발 + 둥근 추력편향 노즐 (Su-27 처럼 동체 아래 매달림 X, 더 통합) */
  const nzGeo = new THREE.CylinderGeometry(0.4, 0.46, 0.55, 16);
  const nzL = new THREE.Mesh(nzGeo, m.dark);
  nzL.position.set(-0.58, -0.12, -2.5);
  nzL.rotation.x = Math.PI / 2;
  nzL.rotation.z = 0.16;
  const nzR = nzL.clone();
  nzR.position.x = 0.58;
  nzR.rotation.z = -0.16;
  g.add(nzL, nzR);

  const tL = addThrust(g, m.glow, -0.58, -3.05, 0.34, 1.0);
  tL.rotation.x = Math.PI / 2;
  tL.rotation.z = 0.16;
  const tR = addThrust(g, m.glow.clone(), 0.58, -3.05, 0.34, 1.0);
  tR.rotation.x = Math.PI / 2;
  tR.rotation.z = -0.16;
  return g;
}

/* ====================== Eurofighter Typhoon ======================
   참고 형상: Eurofighter Typhoon FGR4.
   - 큰 델타 주익 (약 53도 후퇴각)
   - 큰 close-coupled 카나드 (델타형, 캐노피 옆에 위치)
   - 단일 매우 큰 수직 미익
   - 턱밑 사각 흡입구 (단일 통합)
   - 쌍발 EJ200, 노즐 두 개가 가까이 */
function buildTyphoon(fighter, options) {
  const gltfMesh = Sky.AircraftModelLoader?.getClone?.('typhoon', fighter, options);
  if (gltfMesh) return gltfMesh;
  return buildTyphoonProcedural(fighter);
}

function buildTyphoonProcedural(fighter) {
  const m = makeMaterials(fighter.palette);
  const g = new THREE.Group();

  const body = new THREE.Mesh(createCapsuleGeometry(0.45, 2.8, 8, 16), m.body);
  body.rotation.x = Math.PI / 2;
  g.add(body);

  /* 노즈 */
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.7, 14), m.body);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 2.25;
  g.add(nose);
  addPitot(g, m.dark, 3.2);

  /* IRST 볼 */
  addIRST(g, m.sensor, 0.12, 0.15, 1.65, 0.12);

  /* 턱밑 사각 흡입구 — Typhoon의 큰 식별 포인트 */
  const intake = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.42, 1.5), m.bodyAlt);
  intake.position.set(0, -0.52, 0.55);
  g.add(intake);
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.32), m.intake);
  mouth.position.set(0, -0.52, 1.31);
  g.add(mouth);

  addCanopy(g, m.cockpit, 0, 0.34, 1.0, 0.85, 0.55, 1.55);

  /* 큰 close-coupled 카나드 (델타형, 캐노피 옆) */
  const canard = planform([
    [ 0.45,  0.3], [ 1.55, -0.4], [ 1.55, -0.6], [ 0.45, -0.5],
    [-0.45, -0.5], [-1.55, -0.6], [-1.55, -0.4], [-0.45,  0.3],
  ], 0.07, m.bodyAlt);
  canard.position.set(0, 0.05, 1.6);
  g.add(canard);

  /* 큰 델타 주익 (53도 후퇴각) */
  const wing = planform([
    [ 0.5,  0.4], [ 3.05, -1.5], [ 0.5, -1.6],
    [-0.5, -1.6], [-3.05, -1.5], [-0.5,  0.4],
  ], 0.1, m.body);
  wing.position.y = -0.08;
  g.add(wing);

  /* 미사일 */
  addPylonMissile(g, m.bodyDark, -1.6, -0.7);
  addPylonMissile(g, m.bodyDark,  1.6, -0.7);
  addPylonMissile(g, m.bodyDark, -2.4, -1.0);
  addPylonMissile(g, m.bodyDark,  2.4, -1.0);
  /* 동체 반매립 미사일 */
  for (const x of [-0.35, 0.35]) {
    const ms = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.0, 8), m.bodyDark);
    ms.rotation.x = Math.PI / 2;
    ms.position.set(x, -0.35, 0.0);
    g.add(ms);
  }

  /* 단일 매우 큰 수직 미익 (Typhoon은 단일 fin) */
  addVerticalStab(g, m.body, { height: 1.15, rootSpan: 1.2, tipSpan: 0.3, thickness: 0.08, yBase: 0.6, zCenter: -1.4 });

  /* 쌍발 EJ200 노즐 (가깝게) */
  const nzGeo = new THREE.CylinderGeometry(0.38, 0.44, 0.5, 14);
  const nzL = new THREE.Mesh(nzGeo, m.dark);
  nzL.rotation.x = Math.PI / 2;
  nzL.position.set(-0.3, -0.05, -2.1);
  const nzR = nzL.clone();
  nzR.position.x = 0.3;
  g.add(nzL, nzR);

  addThrust(g, m.glow, -0.3, -2.65, 0.3, 0.9);
  addThrust(g, m.glow.clone(),  0.3, -2.65, 0.3, 0.9);
  return g;
}

/* ====================== Dassault Rafale ======================
   참고 형상: Dassault Rafale C/M.
   - 컴팩트 델타 + 작은 카나드 (Typhoon보다 작고, 흡입구 위에 위치 = 높은 카나드)
   - 단일 수직미익 (Typhoon 보다 작음)
   - 반원형 측면 흡입구 (반월형)
   - 쌍발 M88
   - 고정형 공중급유 프로브 (우현 노즈 옆) */
function buildRafale(fighter, options) {
  const gltfMesh = Sky.AircraftModelLoader?.getClone?.('rafale', fighter, options);
  if (gltfMesh) return gltfMesh;
  return buildRafaleProcedural(fighter);
}

function buildRafaleProcedural(fighter) {
  const m = makeMaterials(fighter.palette);
  const g = new THREE.Group();

  const body = new THREE.Mesh(createCapsuleGeometry(0.4, 2.4, 8, 14), m.body);
  body.rotation.x = Math.PI / 2;
  g.add(body);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.36, 1.4, 14), m.body);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 1.9;
  g.add(nose);
  addPitot(g, m.dark, 2.75);

  /* 고정형 공중급유 프로브 (우현 노즈 옆) — Rafale 시그니처 */
  addRefuelProbe(g, m.dark, 0.25, 0.12, 1.6, 0.6);

  /* 반원형 측면 흡입구 — 캡슐을 측면에 배치해 반원 입구 흉내 */
  const intakeGeo = createCapsuleGeometry(0.25, 1.0, 5, 10);
  const inL = new THREE.Mesh(intakeGeo, m.bodyAlt);
  inL.rotation.x = Math.PI / 2;
  inL.position.set(-0.6, -0.15, 0.55);
  const inR = inL.clone();
  inR.position.x = 0.6;
  g.add(inL, inR);
  const mGeo = new THREE.CircleGeometry(0.22, 14);
  const mL = new THREE.Mesh(mGeo, m.intake);
  mL.position.set(-0.6, -0.15, 1.06);
  const mR = mL.clone();
  mR.position.x = 0.6;
  g.add(mL, mR);

  addCanopy(g, m.cockpit, 0, 0.3, 0.9, 0.8, 0.55, 1.4);

  /* 작은 카나드 — 흡입구 위에 높이 마운트 (Rafale 시그니처) */
  const canard = planform([
    [ 0.4,  0.1], [ 1.05, -0.25], [ 1.05, -0.5], [ 0.4, -0.4],
    [-0.4, -0.4], [-1.05, -0.5], [-1.05, -0.25], [-0.4,  0.1],
  ], 0.06, m.bodyAlt);
  canard.position.set(0, 0.22, 1.1);
  g.add(canard);

  /* 컴팩트 델타 */
  const wing = planform([
    [ 0.5,  0.1], [ 2.7, -1.4], [ 0.5, -1.4],
    [-0.5, -1.4], [-2.7, -1.4], [-0.5,  0.1],
  ], 0.1, m.body);
  wing.position.y = -0.06;
  g.add(wing);

  addPylonMissile(g, m.bodyDark, -2.2, -0.8);
  addPylonMissile(g, m.bodyDark,  2.2, -0.8);
  addPylonMissile(g, m.bodyDark, -1.3, -0.6);
  addPylonMissile(g, m.bodyDark,  1.3, -0.6);

  addVerticalStab(g, m.body, { height: 0.95, rootSpan: 1.05, tipSpan: 0.26, thickness: 0.08, yBase: 0.52, zCenter: -1.3 });

  /* 쌍발 M88 노즐 */
  const nzGeo = new THREE.CylinderGeometry(0.34, 0.4, 0.5, 14);
  const nzL = new THREE.Mesh(nzGeo, m.dark);
  nzL.rotation.x = Math.PI / 2;
  nzL.position.set(-0.27, -0.05, -1.9);
  const nzR = nzL.clone();
  nzR.position.x = 0.27;
  g.add(nzL, nzR);

  addThrust(g, m.glow, -0.27, -2.4, 0.27, 0.85);
  addThrust(g, m.glow.clone(),  0.27, -2.4, 0.27, 0.85);
  return g;
}

/* ====================== Panavia Tornado ======================
   참고 형상: Panavia Tornado GR4 / IDS.
   - 가변익(여기서는 펼친 ≈ 25도)
   - 매우 큰 단일 수직 미익 (Tornado의 가장 큰 식별 포인트)
   - 두꺼운 박스형 동체, 어깨 위 윙
   - 직사각 측면 흡입구
   - 2인 탠덤 캐노피
   - 고정형 공중급유 프로브 (우현) */
function buildTornado(fighter, options) {
  const gltfMesh = Sky.AircraftModelLoader?.getClone?.('tornado', fighter, options);
  if (gltfMesh) return gltfMesh;
  return buildTornadoProcedural(fighter);
}

function buildTornadoProcedural(fighter) {
  const m = makeMaterials(fighter.palette);
  const g = new THREE.Group();

  /* 두꺼운 동체 (단면은 둥글지만 부피감이 큰 형상) */
  const body = roundedBody(1.25, 0.62, 4.2, m.body);
  g.add(body);
  /* 등쪽 hump */
  const dorsal = roundedBody(0.9, 0.26, 3.0, m.bodyAlt);
  dorsal.position.set(0, 0.42, -0.4);
  g.add(dorsal);

  /* 짧고 뭉툭한 노즈 */
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.46, 1.3, 14), m.body);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, -0.05, 2.65);
  g.add(nose);
  addPitot(g, m.dark, 3.4);

  /* 공중급유 프로브 (우현) */
  addRefuelProbe(g, m.dark, 0.32, 0.1, 2.0, 0.55);

  /* 큰 직사각 측면 흡입구 — Tornado 의 박스형 시그니처 */
  const intakeGeo = new THREE.BoxGeometry(0.42, 0.58, 1.75);
  const inL = new THREE.Mesh(intakeGeo, m.bodyAlt);
  inL.position.set(-0.8, -0.02, 0.55);
  const inR = inL.clone();
  inR.position.x = 0.8;
  g.add(inL, inR);
  const mGeo = new THREE.PlaneGeometry(0.37, 0.52);
  const mL = new THREE.Mesh(mGeo, m.intake);
  mL.position.set(-0.8, -0.02, 1.43);
  const mR = mL.clone();
  mR.position.x = 0.8;
  g.add(mL, mR);

  /* 2인 탠덤 캐노피 */
  addCanopy(g, m.cockpit, 0, 0.38, 1.2, 0.85, 0.55, 2.05);

  /* 가변익 (펼친 상태) — 어깨 힌지 */
  addSwingWingHalf(g, m.body, -1, [
    [-0.46,  0.65], [-3.15, -0.05], [-3.15, -0.7], [-0.46, -0.85],
  ], 0.1, { x: 0.46, y: 0.22, z: 0.05 }, 0.76);
  addSwingWingHalf(g, m.body, 1, [
    [ 0.46,  0.65], [ 3.15, -0.05], [ 3.15, -0.7], [ 0.46, -0.85],
  ], 0.1, { x: 0.46, y: 0.22, z: 0.05 }, 0.76);

  /* 윙 글러브 (가변익 회전축 고정부) */
  const glove = planform([
    [ 0.5,  1.4], [ 0.88,  0.65], [ 0.88, -0.7], [ 0.5, -0.9],
    [-0.5, -0.9], [-0.88, -0.7], [-0.88,  0.65], [-0.5,  1.4],
  ], 0.08, m.bodyAlt);
  glove.position.y = 0.18;
  g.add(glove);

  /* 다용도 무장 */
  for (const x of [-0.5, 0.5]) {
    const m1 = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.3, 8), m.bodyDark);
    m1.rotation.x = Math.PI / 2;
    m1.position.set(x, -0.42, 0.4);
    g.add(m1);
  }
  addPylonMissile(g, m.bodyDark, -1.6, -0.4);
  addPylonMissile(g, m.bodyDark,  1.6, -0.4);

  /* 매우 큰 단일 수직 미익 — Tornado 의 가장 큰 식별 포인트 */
  addVerticalStab(g, m.body, {
    height: 1.45, rootSpan: 1.55, tipSpan: 0.4, thickness: 0.12,
    yBase: 0.42, zCenter: -1.55, rootEmbed: 0.35,
  });
  /* 미익 상단 페어링 (EW/ECM 안테나 흉내) */
  const finCap = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.5), m.bodyDark);
  finCap.position.set(0, 1.48, -1.48);
  g.add(finCap);

  /* 수평 미익 */
  const hStab = planform([
    [ 0.36,  0.25], [ 1.5, -0.4], [ 1.5, -0.8], [ 0.36, -0.65],
    [-0.36, -0.65], [-1.5, -0.8], [-1.5, -0.4], [-0.36,  0.25],
  ], 0.08, m.body);
  hStab.position.set(0, 0.02, -1.95);
  g.add(hStab);

  /* 쌍발 RB199 노즐 (가깝게 붙음) */
  const nzGeo = new THREE.CylinderGeometry(0.36, 0.42, 0.55, 14);
  const nzL = new THREE.Mesh(nzGeo, m.dark);
  nzL.rotation.x = Math.PI / 2;
  nzL.position.set(-0.32, -0.08, -2.25);
  const nzR = nzL.clone();
  nzR.position.x = 0.32;
  g.add(nzL, nzR);

  addThrust(g, m.glow, -0.32, -2.8, 0.3, 0.9);
  addThrust(g, m.glow.clone(),  0.32, -2.8, 0.3, 0.9);
  return g;
}

/* ====================== KF-21 Boramae Block 1 ======================
   참고 형상: KAI KF-21 Block 1.
   - "준-스텔스" 외형: 트라페조이드 윙, 외측 약 12-15도 캔트된 쌍수직미익
   - DSI(Diverterless Supersonic Inlet) — 흡입구 앞 동체에 부드러운 융기
   - F-22 보다 작고 덜 각진, F-16 보다 큰 4.5세대 형상
   - Block 1 은 외부 무장창 (내부 무장창 미장착) */
function buildKF21(fighter, options) {
  const gltfMesh = Sky.AircraftModelLoader?.getClone?.('kf21', fighter, options);
  if (gltfMesh) return gltfMesh;
  return buildKF21Procedural(fighter);
}

function buildKF21Procedural(fighter) {
  const m = makeMaterials(fighter.palette);
  const g = new THREE.Group();

  const body = roundedBody(1.3, 0.55, 4.1, m.body);
  g.add(body);
  const dorsal = roundedBody(0.88, 0.22, 2.8, m.bodyAlt);
  dorsal.position.set(0, 0.36, -0.4);
  g.add(dorsal);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.46, 1.7, 14), m.body);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, -0.05, 2.6);
  g.add(nose);
  addPitot(g, m.dark, 3.5);

  /* DSI 범프 — 측면 흡입구 앞 부드러운 융기 */
  addDSIBump(g, m.bodyAlt, -0.78, -0.12, 0.85);
  addDSIBump(g, m.bodyAlt,  0.78, -0.12, 0.85);
  /* 흡입구 입구 */
  const mGeo = new THREE.CircleGeometry(0.22, 16);
  const mL = new THREE.Mesh(mGeo, m.intake);
  mL.scale.set(1, 0.9, 1);
  mL.position.set(-0.78, -0.12, 1.21);
  const mR = mL.clone();
  mR.position.x = 0.78;
  g.add(mL, mR);

  addCanopy(g, m.cockpit, 0, 0.36, 1.2, 0.9, 0.55, 1.65);

  /* 트라페조이드 주익 */
  const wing = planform([
    [ 0.7,  0.65], [ 3.05, -0.5], [ 3.05, -1.2], [ 0.7, -1.35],
    [-0.7, -1.35], [-3.05, -1.2], [-3.05, -0.5], [-0.7,  0.65],
  ], 0.1, m.body);
  wing.position.y = 0.0;
  g.add(wing);

  /* 외부 무장 (Block 1 의 특징) */
  addPylonMissile(g, m.bodyDark, -2.2, -0.5);
  addPylonMissile(g, m.bodyDark,  2.2, -0.5);
  addPylonMissile(g, m.bodyDark, -1.3, -0.4);
  addPylonMissile(g, m.bodyDark,  1.3, -0.4);

  /* 약하게 캔트된 쌍수직미익 (F-22 보다 더 직립에 가까움) */
  addTwinVerticalStabs(g, m.body, { width: 0.1, height: 1.0, depth: 1.2, xSpan: 0.7, y: 0.52, z: -1.5, roll: 0.24 });

  const hStab = planform([
    [ 0.4,  0.25], [ 1.55, -0.5], [ 1.55, -0.95], [ 0.4, -0.8],
    [-0.4, -0.8], [-1.55, -0.95], [-1.55, -0.5], [-0.4,  0.25],
  ], 0.08, m.body);
  hStab.position.set(0, -0.05, -2.0);
  g.add(hStab);

  /* 쌍발 F414 노즐 */
  const nzGeo = new THREE.CylinderGeometry(0.38, 0.44, 0.5, 14);
  const nzL = new THREE.Mesh(nzGeo, m.dark);
  nzL.rotation.x = Math.PI / 2;
  nzL.position.set(-0.4, -0.05, -2.3);
  const nzR = nzL.clone();
  nzR.position.x = 0.4;
  g.add(nzL, nzR);

  addThrust(g, m.glow, -0.4, -2.85, 0.3, 0.95);
  addThrust(g, m.glow.clone(),  0.4, -2.85, 0.3, 0.95);
  return g;
}

/* ====================== FA-50 Fighting Eagle ======================
   참고 형상: KAI FA-50 / T-50 베이스.
   - 매우 컴팩트한 단발기 (F-16 의 작은 사촌격)
   - 작은 측면 흡입구, 짧은 노즈
   - 단일 수직미익, 비교적 짧은 주익
   - LEX (작은 leading edge extension) */
function buildFA50(fighter, options) {
  const gltfMesh = Sky.AircraftModelLoader?.getClone?.('fa50', fighter, options);
  if (gltfMesh) return gltfMesh;
  return buildFA50Procedural(fighter);
}

function buildFA50Procedural(fighter) {
  const m = makeMaterials(fighter.palette);
  const g = new THREE.Group();

  const body = new THREE.Mesh(createCapsuleGeometry(0.36, 2.3, 8, 14), m.body);
  body.rotation.x = Math.PI / 2;
  g.add(body);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.2, 14), m.body);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 1.75;
  g.add(nose);
  addPitot(g, m.dark, 2.45);

  /* 작은 LEX */
  const lex = planform([
    [ 0.42,  0.9], [ 0.85,  0.1], [ 0.85, -0.1], [ 0.42, -0.05],
    [-0.42, -0.05], [-0.85, -0.1], [-0.85,  0.1], [-0.42,  0.9],
  ], 0.05, m.bodyAlt);
  lex.position.y = 0.05;
  g.add(lex);

  /* 작은 측면 흡입구 */
  const intakeGeo = new THREE.BoxGeometry(0.32, 0.42, 1.3);
  const inL = new THREE.Mesh(intakeGeo, m.bodyAlt);
  inL.position.set(-0.6, -0.05, 0.3);
  const inR = inL.clone();
  inR.position.x = 0.6;
  g.add(inL, inR);
  const mGeo = new THREE.PlaneGeometry(0.28, 0.36);
  const mL = new THREE.Mesh(mGeo, m.intake);
  mL.position.set(-0.6, -0.05, 0.96);
  const mR = mL.clone();
  mR.position.x = 0.6;
  g.add(mL, mR);

  /* 2인 탠덤 (TA-50 가정해서 길게) */
  addCanopy(g, m.cockpit, 0, 0.32, 0.75, 0.8, 0.55, 1.75);

  const wing = planform([
    [ 0.4,  0.35], [ 2.3, -0.55], [ 2.3, -1.0], [ 0.4, -1.0],
    [-0.4, -1.0], [-2.3, -1.0], [-2.3, -0.55], [-0.4,  0.35],
  ], 0.09, m.body);
  wing.position.y = -0.05;
  g.add(wing);

  addWingtipRail(g, m.bodyDark, -2.35, -0.5);
  addWingtipRail(g, m.bodyDark,  2.35, -0.5);
  addPylonMissile(g, m.bodyDark, -1.5, -0.4);
  addPylonMissile(g, m.bodyDark,  1.5, -0.4);

  addVerticalStab(g, m.body, { height: 0.95, rootSpan: 1.05, tipSpan: 0.26, thickness: 0.08, yBase: 0.55, zCenter: -1.25 });

  const hStab = planform([
    [ 0.28,  0.18], [ 1.2, -0.35], [ 1.2, -0.7], [ 0.28, -0.55],
    [-0.28, -0.55], [-1.2, -0.7], [-1.2, -0.35], [-0.28,  0.18],
  ], 0.07, m.body);
  hStab.position.set(0, 0, -1.55);
  g.add(hStab);

  /* 단발 F404 노즐 */
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.45, 16), m.dark);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.z = -1.85;
  g.add(nozzle);

  addThrust(g, m.glow, 0, -2.3, 0.28, 0.85);
  return g;
}

/* ====================== J-20 Mighty Dragon ======================
   참고 형상: Chengdu J-20A.
   - 매우 긴 동체 (5세대 중 가장 김)
   - 큰 close-coupled 카나드 (F-22 와 다른 점)
   - 외측 강하게 캔트된 쌍수직미익
   - 복부 핀 두 장 (스텔스기 중 드문 특징)
   - DSI 흡입구
   - 길고 평평한 노즈 */
function buildJ20(fighter, options) {
  const gltfMesh = Sky.AircraftModelLoader?.getClone?.('j20', fighter, options);
  if (gltfMesh) return gltfMesh;
  return buildJ20Procedural(fighter);
}

function buildJ20Procedural(fighter) {
  const m = makeMaterials(fighter.palette);
  const g = new THREE.Group();

  /* 매우 긴 동체 — 라운드 베이스 + 챔퍼 측면으로 스텔스 식별감 유지 */
  const body = roundedBody(1.35, 0.7, 4.8, m.body);
  g.add(body);
  const dorsal = roundedBody(0.95, 0.22, 3.2, m.bodyAlt);
  dorsal.position.set(0, 0.42, -0.4);
  g.add(dorsal);
  /* 챔퍼 측면 */
  const chineGeo = new THREE.BoxGeometry(0.15, 0.35, 3.4);
  const chineL = new THREE.Mesh(chineGeo, m.bodyAlt);
  chineL.position.set(-0.72, 0.18, -0.2);
  chineL.rotation.z = -0.4;
  const chineR = chineL.clone();
  chineR.position.x = 0.72;
  chineR.rotation.z = 0.4;
  g.add(chineL, chineR);

  /* 길고 각진 노즈 (8각) */
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.45, 2.1, 8), m.body);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, -0.05, 3.1);
  g.add(nose);
  addPitot(g, m.dark, 4.2);

  /* DSI 범프 */
  addDSIBump(g, m.bodyAlt, -0.75, -0.2, 1.0);
  addDSIBump(g, m.bodyAlt,  0.75, -0.2, 1.0);
  /* 흡입구 입구 */
  const mGeo = new THREE.CircleGeometry(0.2, 16);
  const mL = new THREE.Mesh(mGeo, m.intake);
  mL.scale.set(1.1, 0.85, 1);
  mL.position.set(-0.75, -0.2, 1.4);
  const mR = mL.clone();
  mR.position.x = 0.75;
  g.add(mL, mR);

  addCanopy(g, m.cockpit, 0, 0.42, 1.4, 0.9, 0.55, 1.85);

  /* 큰 close-coupled 카나드 (J-20 의 가장 큰 식별 포인트) */
  const canard = planform([
    [ 0.5,  0.15], [ 1.45, -0.35], [ 1.45, -0.65], [ 0.5, -0.55],
    [-0.5, -0.55], [-1.45, -0.65], [-1.45, -0.35], [-0.5,  0.15],
  ], 0.07, m.bodyAlt);
  canard.position.set(0, 0.2, 1.95);
  g.add(canard);

  /* 델타 주익 */
  const wing = planform([
    [ 0.65,  0.5], [ 3.2, -1.0], [ 0.65, -1.6],
    [-0.65, -1.6], [-3.2, -1.0], [-0.65,  0.5],
  ], 0.1, m.body);
  wing.position.y = -0.05;
  g.add(wing);

  /* 강하게 외측 캔트된 쌍수직미익 */
  addTwinVerticalStabs(g, m.body, { width: 0.1, height: 0.95, depth: 1.3, xSpan: 0.75, y: 0.5, z: -1.7, roll: 0.45 });

  /* 복부 핀 — J-20 의 시그니처 (스텔스기 중 보기 드문) */
  addVentralFin(g, m.bodyDark, -0.4, -0.55, -1.55, 0.42, 0.85,  0.35);
  addVentralFin(g, m.bodyDark,  0.4, -0.55, -1.55, 0.42, 0.85, -0.35);

  /* 쌍발 노즐 (현재 WS-10, 향후 WS-15) */
  const nzGeo = new THREE.CylinderGeometry(0.4, 0.46, 0.55, 16);
  const nzL = new THREE.Mesh(nzGeo, m.dark);
  nzL.rotation.x = Math.PI / 2;
  nzL.position.set(-0.42, -0.05, -2.55);
  const nzR = nzL.clone();
  nzR.position.x = 0.42;
  g.add(nzL, nzR);

  addThrust(g, m.glow, -0.42, -3.1, 0.34, 1.0);
  addThrust(g, m.glow.clone(),  0.42, -3.1, 0.34, 1.0);
  return g;
}

/* ====================== J-10A Vigorous Dragon ======================
   참고 형상: Chengdu J-10A.
   - 단발 AL-31F (WS-10)
   - 카나드 + 델타 무미익 구성 (canard-delta)
   - 배밑 직사각형 흡입구 (J-10A 시그니처, 분리된 splitter plate)
   - 단일 큰 수직미익
   - 두 장 복부 핀 */
function buildJ10(fighter, options) {
  const gltfMesh = Sky.AircraftModelLoader?.getClone?.('j10', fighter, options);
  if (gltfMesh) return gltfMesh;
  return buildJ10Procedural(fighter);
}

function buildJ10Procedural(fighter) {
  const m = makeMaterials(fighter.palette);
  const g = new THREE.Group();

  const body = new THREE.Mesh(createCapsuleGeometry(0.42, 2.7, 8, 14), m.body);
  body.rotation.x = Math.PI / 2;
  g.add(body);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.5, 14), m.body);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 2.1;
  g.add(nose);
  addPitot(g, m.dark, 2.9);

  /* 배밑 직사각 흡입구 — J-10A 의 시그니처 */
  const intake = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.42, 1.5), m.bodyAlt);
  intake.position.set(0, -0.5, 0.6);
  g.add(intake);
  /* 분리된 스플리터 플레이트 (J-10A 의 가장 큰 식별 포인트 — J-10C 는 DSI 라 없음) */
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.08, 0.18), m.bodyDark);
  splitter.position.set(0, -0.42, 1.35);
  g.add(splitter);
  /* 흡입구 입구 */
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.32), m.intake);
  mouth.position.set(0, -0.5, 1.355);
  g.add(mouth);

  addCanopy(g, m.cockpit, 0, 0.34, 0.85, 0.85, 0.55, 1.55);

  /* 카나드 (직사각 + 살짝 후퇴) */
  const canard = planform([
    [ 0.4,  0.15], [ 1.1, -0.3], [ 1.1, -0.55], [ 0.4, -0.45],
    [-0.4, -0.45], [-1.1, -0.55], [-1.1, -0.3], [-0.4,  0.15],
  ], 0.06, m.bodyAlt);
  canard.position.set(0, 0.1, 1.55);
  g.add(canard);

  /* 큰 델타 주익 */
  const wing = planform([
    [ 0.5,  0.0], [ 2.8, -1.3], [ 0.5, -1.45],
    [-0.5, -1.45], [-2.8, -1.3], [-0.5,  0.0],
  ], 0.1, m.body);
  wing.position.y = -0.05;
  g.add(wing);

  addPylonMissile(g, m.bodyDark, -1.6, -0.6);
  addPylonMissile(g, m.bodyDark,  1.6, -0.6);
  addPylonMissile(g, m.bodyDark, -2.3, -0.9);
  addPylonMissile(g, m.bodyDark,  2.3, -0.9);

  /* 단일 큰 수직 미익 */
  addVerticalStab(g, m.body, { height: 1.05, rootSpan: 1.15, tipSpan: 0.28, thickness: 0.08, yBase: 0.6, zCenter: -1.3 });

  /* 두 장 복부 핀 */
  addVentralFin(g, m.bodyDark, -0.25, -0.42, -1.5, 0.32, 0.7,  0.3);
  addVentralFin(g, m.bodyDark,  0.25, -0.42, -1.5, 0.32, 0.7, -0.3);

  /* 단발 AL-31FN 노즐 */
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.44, 0.5, 16), m.dark);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.z = -2.0;
  g.add(nozzle);

  addThrust(g, m.glow, 0, -2.5, 0.32, 0.95);
  return g;
}

/* ====================== Generic 폴백 ====================== */
function buildGeneric(fighter) {
  const m = makeMaterials(fighter.palette);
  const g = new THREE.Group();
  const body = new THREE.Mesh(createCapsuleGeometry(0.5, 2.6, 8, 14), m.body);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.48, 1.4, 14), m.body);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 2.0;
  g.add(nose);
  addCanopy(g, m.cockpit, 0, 0.32, 0.5, 0.85, 0.55, 1.4);
  const wing = planform([
    [ 0.5,  0.5], [ 2.6, -0.5], [ 2.6, -1.0], [ 0.5, -1.0],
    [-0.5, -1.0], [-2.6, -1.0], [-2.6, -0.5], [-0.5,  0.5],
  ], 0.1, m.body);
  g.add(wing);
  addVerticalStab(g, m.body, { height: 0.9, rootSpan: 0.9, tipSpan: 0.22, thickness: 0.08, yBase: 0.5, zCenter: -1.4 });
  const hStab = planform([
    [ 0.3,  0.2], [ 1.2, -0.3], [ 1.2, -0.6], [ 0.3, -0.5],
    [-0.3, -0.5], [-1.2, -0.6], [-1.2, -0.3], [-0.3,  0.2],
  ], 0.07, m.body);
  hStab.position.set(0, 0, -1.7);
  g.add(hStab);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.46, 0.5, 14), m.dark);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.z = -1.95;
  g.add(nozzle);
  addThrust(g, m.glow, 0, -2.45, 0.32, 0.95);
  return g;
}

/* ====================== 디스패처 ====================== */
const BUILDERS = {
  f16: buildF16,
  f15: buildF15,
  fa18: buildFa18,
  f14: buildF14,
  f22: buildF22,
  mig29: buildMig29,
  su27: buildSu27,
  su30: buildSu30,
  su32: buildSu32,
  su35: buildSu35,
  su57: buildSu57,
  typhoon: buildTyphoon,
  rafale: buildRafale,
  tornado: buildTornado,
  kf21: buildKF21,
  fa50: buildFA50,
  j20: buildJ20,
  j10: buildJ10,
};

const GLTF_FIRST_MESH_TYPES = new Set([
  'f16', 'f15', 'f14', 'f22', 'fa18',
  'mig29', 'su27', 'su30', 'su32', 'su35', 'su57',
  'typhoon', 'rafale', 'tornado', 'kf21', 'fa50', 'j10', 'j20',
]);

function buildAircraftMesh(fighter, options) {
  const meshType = fighter?.meshType;
  const builder = BUILDERS[meshType] ?? buildGeneric;
  try {
    const group = GLTF_FIRST_MESH_TYPES.has(meshType)
      ? BUILDERS[meshType](fighter ?? {}, options)
      : builder(fighter ?? {});
    group.name = fighter?.modelName ?? 'Aircraft';
    group.traverse((obj) => { obj.castShadow = false; obj.receiveShadow = false; });
    return group;
  } catch (err) {
    console.warn('[Aircraft] builder failed, falling back to generic:', meshType, err);
    try {
      const group = buildGeneric(fighter ?? {});
      group.name = fighter?.modelName ?? 'Aircraft';
      group.traverse((obj) => { obj.castShadow = false; obj.receiveShadow = false; });
      return group;
    } catch (genericErr) {
      console.warn('[Aircraft] generic builder failed, using emergency mesh:', genericErr);
      return buildEmergencyAircraftMesh();
    }
  }
}

/* <!--
  긴급 폴백: Capsule/Extrude 없이 Box·Cone 만 사용.
  Three.js 로드 문제·메시 빌드 실패 시에도 전투기 실루엣을 보장합니다.
--> */
function buildEmergencyAircraftMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x8a96a4 });
  const fuselage = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.55, 4.2), mat);
  fuselage.position.z = 0.15;
  g.add(fuselage);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.2, 8), mat);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 2.55;
  g.add(nose);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.1, 1.35), mat);
  wing.position.set(0, -0.04, 0.1);
  g.add(wing);
  addVerticalStab(g, mat, {
    height: 1.05, rootSpan: 0.85, tipSpan: 0.22, thickness: 0.12,
    yBase: 0.52, zCenter: -1.65,
  });
  g.name = 'Emergency Fighter';
  g.traverse((obj) => { obj.castShadow = false; obj.receiveShadow = false; });
  return g;
}

const ENEMY_MESH_TYPES = ['mig29', 'su27', 'su57', 'f14', 'j10', 'j20', 'tornado'];

  Sky.Aircraft = {
    buildAircraftMesh,
    buildEmergencyAircraftMesh,
    attachF14SwingWings,
    ENEMY_MESH_TYPES,
    SWING_WING_MESH_TYPES,
    applySwingWingFold,
  };
})(window.Sky = window.Sky || {}, window.THREE);
