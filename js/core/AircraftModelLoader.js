/* <!--
  AircraftModelLoader  ?? GLB/GLTF ??? ?? ?????.
  - ?? ?? +Z, Sketchfab F-16? ?? ? ?? +X ? Y? -90 ??.
  - ?????? ??? ?? ? ??.
--> */
(function (Sky, THREE) {
  'use strict';

  const LOADER_VERSION = 20260620;
  const GROUND_PART_HINTS = ['landing', 'gear', 'wheel', 'tire', 'undercarriage'];
  const _centerScratch = new THREE.Vector3();
  const _sizeScratch = new THREE.Vector3();

  const MODEL_REGISTRY = {
    f16: {
      url: './assets/models/f16.glb',
      targetLength: 5.25,
      preset: 'xPlusToZPlus',
    },
    f15: {
      url: './assets/models/f15.glb',
      targetLength: 6.45,
      preset: 'xPlusToZPlus',
      twinThrust: true,
    },
    f14: {
      url: './assets/models/f14.glb',
      targetLength: 6.85,
      preset: 'xPlusToZPlus',
      twinThrust: true,
      swingWing: true,
    },
  };

  const _templates = new Map();
  const _loading = new Map();
  const _readyListeners = new Set();

  function _canFetchAssets() {
    return typeof location !== 'undefined'
      && (location.protocol === 'http:' || location.protocol === 'https:');
  }

  function _notifyReady(key) {
    _readyListeners.forEach((cb) => {
      try { cb(key); } catch (err) { console.warn('[AircraftModelLoader] ready listener failed:', err); }
    });
  }

  /* <!--
    GLTFLoader? ??? Object_N ???? ?? ?? ?? ??? ??? ???.
    ? ?? ??? ?? airframe/landing ??? ?? ?????.
  --> */
  function _meshNameHint(obj) {
    const parts = [];
    let cur = obj;
    while (cur) {
      const raw = (cur.name || '').trim();
      if (!raw) {
        cur = cur.parent;
        continue;
      }
      const lower = raw.toLowerCase();
      if (/^object_\d+$/i.test(raw)) {
        cur = cur.parent;
        continue;
      }
      if (lower === 'root' || lower.includes('sketchfab') || lower.includes('gltf_scene')) {
        cur = cur.parent;
        continue;
      }
      parts.push(lower);
      cur = cur.parent;
    }
    return parts.join(' ');
  }

  function _isGroundPart(obj) {
    const name = _meshNameHint(obj);
    return GROUND_PART_HINTS.some((h) => name.includes(h));
  }

  function _hideGroundParts(root) {
    root.traverse((obj) => {
      if (!obj.isMesh) return;
      if (_isGroundPart(obj)) obj.visible = false;
    });
  }

  function _findAirframeMesh(root) {
    let airframe = null;
    root.traverse((obj) => {
      if (!obj.isMesh || !obj.visible) return;
      if (_meshNameHint(obj).includes('airframe')) airframe = obj;
    });
    return airframe;
  }

  function _applyOrientationPreset(root, cfg) {
    if (cfg.preset === 'xPlusToZPlus') {
      root.rotation.y = -Math.PI / 2;
      return;
    }

    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    box.getSize(_sizeScratch);
    const axes = [
      { axis: 'x', len: _sizeScratch.x, rotY: Math.PI / 2 },
      { axis: 'y', len: _sizeScratch.y, rotY: 0 },
      { axis: 'z', len: _sizeScratch.z, rotY: 0 },
    ].sort((a, b) => b.len - a.len);

    if (axes[0].axis === 'x') {
      root.rotation.y = axes[0].rotY;
    } else if (axes[0].axis === 'y') {
      root.rotation.x = -Math.PI / 2;
    }

    if (cfg.rotationOffsetY) {
      root.rotation.y += cfg.rotationOffsetY;
    }
  }

  function _normalizeRoot(root, cfg) {
    _hideGroundParts(root);
    root.updateMatrixWorld(true);

    _applyOrientationPreset(root, cfg);

    const measureTarget = _findAirframeMesh(root) ?? root;
    root.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(measureTarget);
    box.getCenter(_centerScratch);
    root.position.sub(_centerScratch);

    root.updateMatrixWorld(true);
    box.setFromObject(measureTarget);
    box.getSize(_sizeScratch);
    const lengthZ = Math.max(_sizeScratch.z, 0.01);
    const scale = cfg.targetLength / lengthZ;
    root.scale.setScalar(scale);

    root.updateMatrixWorld(true);
    const finalBox = new THREE.Box3().setFromObject(measureTarget);
    root.userData.modelBounds = { minZ: finalBox.min.z, maxZ: finalBox.max.z };
    root.userData.loaderVersion = LOADER_VERSION;
    return root;
  }

  function _applyGltfPalette(root, palette) {
    const body = new THREE.Color(palette?.body ?? 0x8a929c);
    const belly = new THREE.Color(palette?.belly ?? body);
    const radome = new THREE.Color(palette?.radome ?? 0x505860);
    const canopy = new THREE.Color(palette?.cockpit ?? 0x3a4654);
    const dark = new THREE.Color(palette?.accent ?? 0x3a444f);

    root.traverse((obj) => {
      if (!obj.isMesh || !obj.material || !obj.visible) return;
      const name = _meshNameHint(obj);
      const isGlass = name.includes('glass') || name.includes('instr');
      const isCanopy = name.includes('canopy');
      const isRadome = name.includes('radome') || name.includes('nose');
      const isDark = name.includes('rail') || name.includes('missile') || name.includes('pod')
        || name.includes('hud');

      let color;
      if (isGlass || isCanopy) {
        color = canopy.clone();
      } else if (isRadome) {
        color = radome.clone();
      } else if (isDark) {
        color = dark.clone();
      } else {
        color = body.clone().lerp(belly, 0.22);
      }

      obj.material = new THREE.MeshLambertMaterial({
        color,
        transparent: isGlass,
        opacity: isGlass ? 0.5 : 1,
        side: THREE.DoubleSide,
      });
    });
  }

  function _bindGltfSwingWingMeshes(root, foldAngle) {
    const hints = ['wing', 'sweep', 'variable'];
    const skip = ['horizontal', 'h-stab', 'hstab', 'tail'];
    const candidates = [];
    root.traverse((obj) => {
      if (!obj.isMesh || !obj.visible || obj.parent?.userData?.swingWingPivot) return;
      const name = _meshNameHint(obj);
      const lower = name.toLowerCase();
      if (!hints.some((h) => lower.includes(h))) return;
      if (skip.some((s) => lower.includes(s))) return;
      candidates.push(obj);
    });
    if (candidates.length < 2) return false;

    let bound = 0;
    candidates.forEach((mesh) => {
      const side = mesh.position.x < -0.01 ? -1 : (mesh.position.x > 0.01 ? 1 : 0);
      if (!side) return;

      const parent = mesh.parent;
      if (!parent) return;
      const pivot = new THREE.Group();
      pivot.name = side < 0 ? 'swingWingPivotL' : 'swingWingPivotR';
      pivot.userData.swingWingPivot = true;
      const worldPos = new THREE.Vector3();
      mesh.getWorldPosition(worldPos);
      parent.worldToLocal(worldPos);
      pivot.position.copy(worldPos);
      parent.add(pivot);
      pivot.attach(mesh);

      root.userData.swingWings = root.userData.swingWings || [];
      root.userData.swingWings.push({
        pivot,
        foldedRot: (side < 0 ? 1 : -1) * (foldAngle ?? 1.12),
        foldedYaw: (side < 0 ? -1 : 1) * 0.1,
      });
      bound += 1;
    });
    return bound >= 2;
  }

  function _addThrustCones(wrapper, model, accentHex, cfg) {
    model.updateMatrixWorld(true);
    const measure = _findAirframeMesh(model) ?? model;
    const box = new THREE.Box3().setFromObject(measure);
    const tailZ = box.min.z;
    const cy = (box.min.y + box.max.y) * 0.5;
    const cx = (box.min.x + box.max.x) * 0.5;
    const spread = Math.max(0.32, (box.max.x - box.min.x) * 0.11);
    const offsets = cfg?.twinThrust ? [-spread, spread] : [0];
    offsets.forEach((dx) => {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(cfg?.twinThrust ? 0.14 : 0.16, 0.38, 10, 1, true),
        new THREE.MeshBasicMaterial({
          color: accentHex ?? 0xff9955,
          transparent: true,
          opacity: 0.28,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      cone.rotation.x = Math.PI / 2;
      cone.position.set(cx + dx, cy, tailZ - 0.05);
      cone.name = 'thrust';
      wrapper.add(cone);
    });
  }

  function _buildTemplate(scene, cfg, palette) {
    const root = new THREE.Group();
    root.name = 'GLTF Aircraft Root';
    root.add(scene);
    _normalizeRoot(root, cfg);
    _applyGltfPalette(root, palette);
    root.traverse((obj) => {
      obj.castShadow = false;
      obj.receiveShadow = false;
    });
    return root;
  }

  function _invalidateStaleTemplates() {
    _templates.forEach((tpl, key) => {
      if (tpl.userData?.loaderVersion !== LOADER_VERSION) {
        _templates.delete(key);
      }
    });
  }

  function preload(key, palette) {
    _invalidateStaleTemplates();
    const cfg = MODEL_REGISTRY[key];
    if (!cfg || _templates.has(key) || _loading.has(key)) {
      return _loading.get(key) ?? Promise.resolve(_templates.has(key));
    }
    if (!_canFetchAssets() || typeof THREE.GLTFLoader !== 'function') {
      return Promise.resolve(false);
    }

    const promise = new Promise((resolve) => {
      const loader = new THREE.GLTFLoader();
      loader.load(
        cfg.url,
        (gltf) => {
          try {
            const template = _buildTemplate(gltf.scene, cfg, palette);
            _templates.set(key, template);
            _notifyReady(key);
            resolve(true);
          } catch (err) {
            console.warn('[AircraftModelLoader] normalize failed:', key, err);
            resolve(false);
          }
        },
        undefined,
        (err) => {
          console.warn('[AircraftModelLoader] load failed:', key, cfg.url, err);
          resolve(false);
        },
      );
    });

    _loading.set(key, promise);
    return promise;
  }

  function preloadAll(defaultPalette) {
    return Promise.all(Object.keys(MODEL_REGISTRY).map((key) => preload(key, defaultPalette)));
  }

  function isReady(key) {
    _invalidateStaleTemplates();
    return _templates.has(key);
  }

  function whenReady(callback) {
    _readyListeners.add(callback);
    Object.keys(MODEL_REGISTRY).forEach((key) => {
      if (_templates.has(key)) callback(key);
    });
    return () => _readyListeners.delete(callback);
  }

  function getClone(key, fighter, options) {
    _invalidateStaleTemplates();
    const template = _templates.get(key);
    if (!template) return null;

    const opts = options ?? {};
    const wrapper = new THREE.Group();
    wrapper.name = fighter?.modelName ?? 'F-16 Fighting Falcon';
    wrapper.userData.procedural = false;
    wrapper.userData.gltf = true;
    wrapper.userData.modelKey = key;

    const model = template.clone(true);
    _hideGroundParts(model);
    if (fighter?.palette) _applyGltfPalette(model, fighter.palette);
    wrapper.add(model);

    if (opts.thrust !== false) {
      _addThrustCones(wrapper, model, 0xff9955, MODEL_REGISTRY[key]);
    }

    const cfg = MODEL_REGISTRY[key];
    if (cfg?.swingWing) {
      const bound = _bindGltfSwingWingMeshes(wrapper, cfg.swingFoldAngle ?? 1.12);
      wrapper.userData.swingWingBound = bound;
      if (!bound && typeof Sky.Aircraft?.attachF14SwingWings === 'function') {
        Sky.Aircraft.attachF14SwingWings(wrapper, fighter);
      }
    }

    wrapper.traverse((obj) => { obj.castShadow = false; obj.receiveShadow = false; });
    return wrapper;
  }

  Sky.AircraftModelLoader = {
    MODEL_REGISTRY,
    LOADER_VERSION,
    preload,
    preloadAll,
    isReady,
    whenReady,
    getClone,
    canUseExternalModels: _canFetchAssets,
  };

  if (_canFetchAssets() && typeof THREE.GLTFLoader === 'function') {
    preloadAll({
      body: 0x8a929c,
      belly: 0x9aa4ae,
      radome: 0x505860,
      cockpit: 0x3a4654,
      accent: 0x3a444f,
    });
  }
})(window.Sky = window.Sky || {}, window.THREE);
