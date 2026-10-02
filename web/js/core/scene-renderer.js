(function () {
  const MODELS = [
    {
      key: "teacher",
      height: 2.42,
      defaultPosition: { x: -0.78, y: 0 },
      position: new THREE.Vector3(-0.78, 0, 0.05),
      rotationY: -Math.PI / 2,
    },
    {
      key: "girl",
      height: 1.82,
      defaultPosition: { x: 0.92, y: 0 },
      position: new THREE.Vector3(0.92, 0, 0.18),
      rotationY: -Math.PI / 2,
    },
  ];
  const CHARACTER_LIMITS = {
    girl: {
      minY: -0.6,
      maxY: 0,
    },
  };

  function createSafetyScene(options) {
    const canvas = options.canvas;
    const loadingElement = options.loadingElement;
    const loadingTextElement = options.loadingTextElement;
    const scene = new THREE.Scene();
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 1000);
    const loader = new THREE.GLTFLoader();
    const state = {
      groups: new Map(),
      configs: new Map(MODELS.map((config) => [config.key, config])),
      characterSettings: {},
      speaking: false,
    };

    initRenderer();
    initLights();
    resize();
    window.addEventListener("resize", resize);
    loadCharacters();
    animate();

    return {
      focusCharacters,
      updateCharacterSettings,
      setSpeaking,
    };

    function initRenderer() {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputEncoding = THREE.sRGBEncoding;
      camera.position.set(0, 1.42, 7.15);
    }

    function initLights() {
      scene.add(new THREE.HemisphereLight(0xffffff, 0x26323a, 2.6));

      const keyLight = new THREE.DirectionalLight(0xffffff, 3.6);
      keyLight.position.set(3.5, 6.5, 5);
      scene.add(keyLight);

      const fillLight = new THREE.DirectionalLight(0xffcf9b, 1.8);
      fillLight.position.set(-4, 3.2, 2.5);
      scene.add(fillLight);

      const rimLight = new THREE.DirectionalLight(0xbfe8ff, 1.1);
      rimLight.position.set(0, 4, -5);
      scene.add(rimLight);
    }

    function resize() {
      const rect = canvas.parentElement.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    }

    function loadCharacters() {
      showLoading("正在加载老师和小朋友...");
      try {
        MODELS.forEach((config) => {
          const arrayBuffer = base64ToArrayBuffer(window.SAFETY_TRAINING_MODEL_DATA?.[config.key]);
          loader.parse(arrayBuffer, "", (gltf) => {
            const group = createCharacterGroup(gltf.scene, config);
            scene.add(group);
            state.groups.set(group.userData.key, group);
            applyCharacterSettings(config.key);
            if (state.groups.size === MODELS.length) {
              hideLoading();
              focusCharacters();
            }
          }, (error) => {
            console.error(error);
            showLoading("模型解析失败，请检查 js/data/model-data.js。");
          });
        });
      } catch (error) {
        console.error(error);
        showLoading("模型加载失败，请检查单机版资源目录。");
      }
    }

    function createCharacterGroup(model, config) {
      const group = new THREE.Group();
      group.userData.key = config.key;

      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const scale = config.height / Math.max(size.y, 0.001);

      group.userData.baseScale = scale;
      model.position.set(-center.x, -center.y + size.y / 2, -center.z);
      group.scale.setScalar(scale);
      group.position.copy(config.position);
      group.rotation.y = config.rotationY;
      group.add(model);

      return group;
    }

    function updateCharacterSettings(nextSettings) {
      state.characterSettings = nextSettings || {};
      applyCharacterSettings("teacher");
      applyCharacterSettings("girl");
    }

    function applyCharacterSettings(key) {
      const group = state.groups.get(key);
      const config = state.configs.get(key);
      if (!group || !config) return;

      const characterSettings = state.characterSettings[key] || {};
      const scale = characterSettings.scale ?? 1;
      const x = characterSettings.x ?? config.defaultPosition.x;
      const y = clampCharacterY(key, characterSettings.y ?? config.defaultPosition.y);
      const rotationX = (characterSettings.rotationX ?? 0) * Math.PI / 180;
      const rotationYDeg = characterSettings.rotationY ?? -90;
      const rotationY = rotationYDeg * Math.PI / 180;

      group.scale.setScalar(group.userData.baseScale * scale);
      group.position.set(x, y, config.position.z);
      group.rotation.x = rotationX;
      group.rotation.y = rotationY;
    }

    function clampCharacterY(key, value) {
      const limit = CHARACTER_LIMITS[key];
      if (!limit) return value;
      return Math.min(limit.maxY, Math.max(limit.minY, value));
    }

    function focusCharacters() {
      camera.position.set(0, 1.42, 7.15);
      camera.lookAt(0.02, 1.05, 0);
    }

    function setSpeaking(isSpeaking) {
      state.speaking = isSpeaking;
    }

    function showLoading(text) {
      loadingTextElement.textContent = text;
      loadingElement.classList.remove("is-hidden");
    }

    function hideLoading() {
      loadingElement.classList.add("is-hidden");
    }

    function animate() {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    }
  }

  function base64ToArrayBuffer(base64) {
    if (!base64) {
      throw new Error("model data missing");
    }
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  window.SafetySceneRenderer = {
    createSafetyScene,
  };
}());
