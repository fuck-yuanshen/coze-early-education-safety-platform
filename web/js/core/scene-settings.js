(function () {
  const {
    DEFAULT_SCENE_ID,
    SCENE_CHANGE_EVENT,
    SCENE_PRESETS,
    getScenesForMode,
    getMissingBackgroundScenes,
    getScenePreset,
    sceneSupportsMode,
  } = window.SafetyTrainingPresets;
  const {
    DEFAULT_EVALUATION_RUBRIC,
    DEFAULT_LEARNING_MODE,
    MODE_STORAGE_KEY,
    normalizeLearningMode,
  } = window.SafetyTrainingFlow;

  const STORAGE_KEY = "standalone_scene_settings_v1";
  const DEFAULT_SETTINGS = {
    currentSceneId: DEFAULT_SCENE_ID,
    sceneOverrides: {},
    api: { proxyApiBase: getDefaultProxyApiBase() },
    answerBubble: { scale: 1, width: 520, x: 0, y: 0 },
    questionBubble: { scale: 1, width: 360, x: 240, y: -70 },
    background: { scale: 1, x: 0, y: 0 },
    characters: {
      teacher: { scale: 1, x: -0.78, y: 0, rotationX: 0, rotationY: 0 },
      girl: { scale: 1, x: 0.92, y: 0, rotationX: 0, rotationY: 0 },
    },
  };

  function createSceneSettings(options) {
    let activeMode = getInitialLearningMode();
    let backgroundRequestId = 0;
    const settings = loadSettings();

    populateSceneSelect();
    renderMissingBackgrounds();
    syncInputs(settings);
    applySettings(settings);
    applyApiSettings(settings);
    bindEvents();
    dispatchSceneChange();

    return {
      getSceneContext,
      goToPreviousScene,
      goToNextScene,
      setCurrentScene,
      setMode,
      setModeAndScene,
      getMode: getActiveMode,
    };

    function bindEvents() {
      options.menuButton?.addEventListener("click", () => {
        const isHidden = options.submenu?.classList.toggle("is-hidden");
        options.menuButton.setAttribute("aria-expanded", String(!isHidden));
        if (isHidden) hideMenu();
      });

      options.modeMenuButton?.addEventListener("click", () => {
        const isHidden = options.modeMenu?.classList.toggle("is-hidden");
        options.modeMenuButton.setAttribute("aria-expanded", String(!isHidden));
      });

      document.addEventListener("click", (event) => {
        if (!options.menu?.contains(event.target)) hideMenu();
      });

      options.toggleButton?.addEventListener("click", () => {
        options.panel.classList.toggle("is-hidden");
        hideMenu();
      });

      options.closeButton.addEventListener("click", () => {
        options.panel.classList.add("is-hidden");
      });

      options.sceneSelect.addEventListener("change", () => {
        setCurrentScene(options.sceneSelect.value);
      });

      options.apiProxyUrlInput?.addEventListener("change", () => {
        updateProxyApiBase(options.apiProxyUrlInput.value);
      });
      options.apiProxyUrlInput?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          updateProxyApiBase(options.apiProxyUrlInput.value);
        }
      });
      options.apiProxyTestButton?.addEventListener("click", () => {
        void testApiProxy();
      });

      options.sceneQuestionInput.addEventListener("input", () => {
        updateActiveSceneOverride("question", options.sceneQuestionInput.value.trim());
        saveAndDispatch();
      });
      options.sceneCorrectAnswerInput.addEventListener("input", () => {
        updateActiveSceneOverride("correctAnswer", options.sceneCorrectAnswerInput.value.trim());
        saveAndDispatch();
      });
      options.sceneSystemPromptInput.addEventListener("input", () => {
        updateActiveSceneOverride("systemPrompt", options.sceneSystemPromptInput.value.trim());
        saveAndDispatch();
      });
      options.sceneQuizPromptInput?.addEventListener("input", () => {
        updateNestedSceneOverride("quiz", "prompt", options.sceneQuizPromptInput.value.trim());
        saveAndDispatch();
      });
      options.sceneQuizOptionsInput?.addEventListener("input", () => {
        updateActiveSceneOptions(parseOptionsInput(options.sceneQuizOptionsInput.value));
        saveAndDispatch();
      });
      options.sceneQuizCorrectIdsInput?.addEventListener("input", () => {
        updateNestedSceneOverride("quiz", "correctOptionIds", parseOptionIdsInput(options.sceneQuizCorrectIdsInput.value));
        saveAndDispatch();
      });
      options.sceneQuizExplanationInput?.addEventListener("input", () => {
        updateNestedSceneOverride("quiz", "explanation", options.sceneQuizExplanationInput.value.trim());
        saveAndDispatch();
      });
      options.sceneChildPromptInput?.addEventListener("input", () => {
        updateNestedSceneOverride("assessment", "childPrompt", options.sceneChildPromptInput.value.trim());
        saveAndDispatch();
      });
      options.sceneAssessmentFocusInput?.addEventListener("input", () => {
        updateNestedSceneOverride("assessment", "focus", options.sceneAssessmentFocusInput.value.trim());
        saveAndDispatch();
      });
      options.sceneIdealTeacherResponseInput?.addEventListener("input", () => {
        updateNestedSceneOverride("assessment", "idealTeacherResponse", options.sceneIdealTeacherResponseInput.value.trim());
        saveAndDispatch();
      });
      options.sceneEvaluationRubricInput?.addEventListener("input", () => {
        const preset = getScenePreset(settings.currentSceneId);
        updateActiveSceneOverrideValue(
          "evaluationRubric",
          options.sceneEvaluationRubricInput.value.trim(),
          preset.evaluationRubric || DEFAULT_EVALUATION_RUBRIC,
        );
        saveAndDispatch();
      });
      options.sceneEvaluationPromptInput?.addEventListener("input", () => {
        updateActiveSceneOverride("evaluationPrompt", options.sceneEvaluationPromptInput.value.trim());
        saveAndDispatch();
      });

      options.sceneBackgroundUrlInput.addEventListener("change", () => {
        const value = options.sceneBackgroundUrlInput.value.trim();
        setActiveSceneBackground(value ? { type: "url", url: value } : null);
        applyAndSave(settings);
        dispatchSceneChange();
      });

      options.sceneBackgroundFileInput.addEventListener("change", async () => {
        const file = options.sceneBackgroundFileInput.files?.[0];
        if (!file) return;
        try {
          const dataUrl = await readFileAsDataUrl(file);
          setActiveSceneBackground({ type: "data", url: dataUrl, name: file.name });
          options.sceneBackgroundUrlInput.value = "";
          options.sceneBackgroundStatus.textContent = `已替换背景图：${file.name}`;
          applyAndSave(settings);
          dispatchSceneChange();
        } catch (error) {
          options.sceneBackgroundStatus.textContent = `背景图读取失败：${error.message}`;
        } finally {
          options.sceneBackgroundFileInput.value = "";
        }
      });

      options.resetButton.addEventListener("click", () => {
        const nextSettings = cloneDefaultSettings();
        Object.assign(settings, nextSettings);
        ensureModeSafeCurrentScene(settings);
        syncInputs(settings);
        applyAndSave(settings);
        applyApiSettings(settings);
        writeUrlParams({ scene: settings.currentSceneId });
        dispatchSceneChange();
      });

      rangeInputs().forEach((input) => {
        input.addEventListener("input", () => {
          readRangeInputs(settings);
          applyAndSave(settings);
        });
      });
    }

    function populateSceneSelect() {
      options.sceneSelect.textContent = "";
      getActiveModeScenes().forEach((scene) => {
        const item = document.createElement("option");
        item.value = scene.id;
        item.textContent = `${scene.category}｜${scene.title}`;
        options.sceneSelect.append(item);
      });
    }

    function hideMenu() {
      options.submenu?.classList.add("is-hidden");
      options.modeMenu?.classList.add("is-hidden");
      options.menuButton?.setAttribute("aria-expanded", "false");
      options.modeMenuButton?.setAttribute("aria-expanded", "false");
    }

    function setMode(mode) {
      activeMode = normalizeLearningMode(mode);
      localStorage.setItem(MODE_STORAGE_KEY, activeMode);
      populateSceneSelect();
      ensureModeSafeCurrentScene(settings);
      syncInputs(settings);
      applyAndSave(settings);
      writeUrlParams({ mode: activeMode, scene: settings.currentSceneId });
      dispatchSceneChange();
    }

    function setModeAndScene(mode, sceneId) {
      activeMode = normalizeLearningMode(mode);
      localStorage.setItem(MODE_STORAGE_KEY, activeMode);
      populateSceneSelect();
      settings.currentSceneId = getModeSafeScene(sceneId).id;
      options.sceneSelect.value = settings.currentSceneId;
      syncInputs(settings);
      applyAndSave(settings);
      writeUrlParams({ mode: activeMode, scene: settings.currentSceneId });
      dispatchSceneChange();
      return getSceneContext();
    }

    function goToNextScene() {
      const modeScenes = getActiveModeScenes();
      const currentIndex = modeScenes.findIndex((scene) => scene.id === settings.currentSceneId);
      const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % modeScenes.length : 0;
      return setCurrentScene(modeScenes[nextIndex].id);
    }

    function goToPreviousScene() {
      const modeScenes = getActiveModeScenes();
      const currentIndex = modeScenes.findIndex((scene) => scene.id === settings.currentSceneId);
      const previousIndex = currentIndex >= 0 ? (currentIndex - 1 + modeScenes.length) % modeScenes.length : 0;
      return setCurrentScene(modeScenes[previousIndex].id);
    }

    function setCurrentScene(sceneId) {
      const nextScene = getModeSafeScene(sceneId);
      settings.currentSceneId = nextScene.id;
      options.sceneSelect.value = nextScene.id;
      syncSceneInputs(settings);
      applyAndSave(settings);
      writeUrlParams({ scene: nextScene.id });
      dispatchSceneChange();
      return getSceneContext();
    }

    function rangeInputs() {
      return [
        options.answerBubbleScaleInput,
        options.answerBubbleWidthInput,
        options.answerBubbleXInput,
        options.answerBubbleYInput,
        options.childBubbleScaleInput,
        options.childBubbleWidthInput,
        options.childBubbleXInput,
        options.childBubbleYInput,
        options.backgroundScaleInput,
        options.backgroundXInput,
        options.backgroundYInput,
        options.teacherScaleInput,
        options.teacherXInput,
        options.teacherYInput,
        options.teacherRotationXInput,
        options.teacherRotationYInput,
        options.girlScaleInput,
        options.girlXInput,
        options.girlYInput,
        options.girlRotationXInput,
        options.girlRotationYInput,
      ].filter(Boolean);
    }

    function readRangeInputs(value) {
      value.answerBubble.scale = Number(options.answerBubbleScaleInput.value);
      value.answerBubble.width = Number(options.answerBubbleWidthInput.value);
      value.answerBubble.x = Number(options.answerBubbleXInput.value);
      value.answerBubble.y = Number(options.answerBubbleYInput.value);
      value.questionBubble.scale = Number(options.childBubbleScaleInput.value);
      value.questionBubble.width = Number(options.childBubbleWidthInput.value);
      value.questionBubble.x = Number(options.childBubbleXInput.value);
      value.questionBubble.y = Number(options.childBubbleYInput.value);
      value.background.scale = Number(options.backgroundScaleInput.value);
      value.background.x = Number(options.backgroundXInput.value);
      value.background.y = Number(options.backgroundYInput.value);
      value.characters.teacher.scale = Number(options.teacherScaleInput.value);
      value.characters.teacher.x = Number(options.teacherXInput.value);
      value.characters.teacher.y = Number(options.teacherYInput.value);
      value.characters.teacher.rotationX = Number(options.teacherRotationXInput?.value || 0);
      value.characters.teacher.rotationY = Number(options.teacherRotationYInput?.value || 0);
      value.characters.girl.scale = Number(options.girlScaleInput.value);
      value.characters.girl.x = Number(options.girlXInput.value);
      value.characters.girl.y = Math.min(0, Number(options.girlYInput.value));
      value.characters.girl.rotationX = Number(options.girlRotationXInput?.value || 0);
      value.characters.girl.rotationY = Number(options.girlRotationYInput?.value || 0);
    }

    function syncInputs(value) {
      if (options.apiProxyUrlInput) options.apiProxyUrlInput.value = value.api?.proxyApiBase || "";
      renderApiProxyStatus(value);
      options.sceneSelect.value = value.currentSceneId;
      syncSceneInputs(value);
      options.answerBubbleScaleInput.value = String(value.answerBubble.scale);
      options.answerBubbleWidthInput.value = String(value.answerBubble.width);
      options.answerBubbleXInput.value = String(value.answerBubble.x);
      options.answerBubbleYInput.value = String(value.answerBubble.y);
      options.childBubbleScaleInput.value = String(value.questionBubble.scale);
      options.childBubbleWidthInput.value = String(value.questionBubble.width);
      options.childBubbleXInput.value = String(value.questionBubble.x);
      options.childBubbleYInput.value = String(value.questionBubble.y);
      options.backgroundScaleInput.value = String(value.background.scale);
      options.backgroundXInput.value = String(value.background.x);
      options.backgroundYInput.value = String(value.background.y);
      options.teacherScaleInput.value = String(value.characters.teacher.scale);
      options.teacherXInput.value = String(value.characters.teacher.x);
      options.teacherYInput.value = String(value.characters.teacher.y);
      if (options.teacherRotationXInput) options.teacherRotationXInput.value = String(value.characters.teacher.rotationX || 0);
      if (options.teacherRotationYInput) options.teacherRotationYInput.value = String(value.characters.teacher.rotationY || 0);
      options.girlScaleInput.value = String(value.characters.girl.scale);
      options.girlXInput.value = String(value.characters.girl.x);
      options.girlYInput.value = String(value.characters.girl.y);
      if (options.girlRotationXInput) options.girlRotationXInput.value = String(value.characters.girl.rotationX || 0);
      if (options.girlRotationYInput) options.girlRotationYInput.value = String(value.characters.girl.rotationY || 0);
    }

    function syncSceneInputs(value) {
      const context = getSceneContext(value);
      options.sceneQuestionInput.value = context.question;
      options.sceneCorrectAnswerInput.value = context.correctAnswer;
      options.sceneSystemPromptInput.value = context.systemPrompt;
      syncQuizContentInputs(context);
      syncAssessmentContentInputs(context);
      options.sceneBackgroundUrlInput.value = ["preset", "url"].includes(context.background?.type) ? context.background.url : "";
      options.sceneBackgroundStatus.textContent = getBackgroundStatusText(context);
    }

    function syncQuizContentInputs(context) {
      const hasQuiz = Boolean(context.quiz);
      setSectionHidden(options.quizContentSection, !hasQuiz);
      setInputValue(options.sceneQuizPromptInput, context.quiz?.prompt || "");
      setInputValue(options.sceneQuizOptionsInput, formatOptionsInput(context.options));
      setInputValue(options.sceneQuizCorrectIdsInput, formatOptionIds(context.quiz?.correctOptionIds));
      setInputValue(options.sceneQuizExplanationInput, context.quiz?.explanation || "");
    }

    function syncAssessmentContentInputs(context) {
      const hasAssessment = Boolean(context.assessment);
      setSectionHidden(options.assessmentContentSection, !hasAssessment);
      setInputValue(options.sceneChildPromptInput, context.assessment?.childPrompt || "");
      setInputValue(options.sceneAssessmentFocusInput, context.assessment?.focus || "");
      setInputValue(options.sceneIdealTeacherResponseInput, context.assessment?.idealTeacherResponse || "");
      setInputValue(options.sceneEvaluationRubricInput, hasAssessment ? context.evaluationRubric || DEFAULT_EVALUATION_RUBRIC : "");
      setInputValue(options.sceneEvaluationPromptInput, context.evaluationPrompt || "");
    }

    function renderMissingBackgrounds() {
      if (!options.sceneMissingBackgrounds) return;
      const missingScenes = getMissingBackgroundScenes();
      options.sceneMissingBackgrounds.textContent = missingScenes.length
        ? `缺少背景图：${missingScenes.map((scene) => `${scene.title}(${scene.expectedBackground})`).join("；")}`
        : "背景图已全部配置。";
    }

    function saveAndDispatch() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      dispatchSceneChange();
    }

    function applyAndSave(value) {
      applySettings(value);
      applyApiSettings(value);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    }

    function applySettings(value) {
      const context = getSceneContext(value);
      applySceneBackground(context);
      options.answerBubble.style.setProperty("--answer-bubble-scale", value.answerBubble.scale);
      options.answerBubble.style.setProperty("--answer-bubble-width", `${value.answerBubble.width}px`);
      options.answerBubble.style.setProperty("--answer-bubble-x", `${value.answerBubble.x}px`);
      options.answerBubble.style.setProperty("--answer-bubble-y", `${value.answerBubble.y}px`);
      options.questionBubble?.style.setProperty("--child-bubble-scale", value.questionBubble.scale);
      options.questionBubble?.style.setProperty("--child-bubble-width", `${value.questionBubble.width}px`);
      options.questionBubble?.style.setProperty("--child-bubble-x", `${value.questionBubble.x}px`);
      options.questionBubble?.style.setProperty("--child-bubble-y", `${value.questionBubble.y}px`);
      options.stage.style.setProperty("--bg-scale", value.background.scale);
      options.stage.style.setProperty("--bg-x", `${value.background.x}%`);
      options.stage.style.setProperty("--bg-y", `${value.background.y}%`);
      options.scene.updateCharacterSettings(value.characters);
    }

    function updateProxyApiBase(rawValue) {
      if (!settings.api) settings.api = {};
      settings.api.proxyApiBase = trimTrailingSlash(String(rawValue || "").trim());
      if (options.apiProxyUrlInput) options.apiProxyUrlInput.value = settings.api.proxyApiBase;
      applyApiSettings(settings);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      renderApiProxyStatus(settings);
    }

    async function testApiProxy() {
      updateProxyApiBase(options.apiProxyUrlInput?.value || "");
      const apiBase = settings.api?.proxyApiBase || "";
      if (!apiBase) {
        setApiProxyStatus("未填写代理地址，将尝试浏览器直连云接口。", true);
        return;
      }
      setApiProxyStatus("正在测试代理服务器...");
      try {
        const response = await fetch(`${apiBase}/health`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || data.ok === false) {
          throw new Error(data.error || data.message || response.statusText);
        }
        const parts = [
          data.coze_configured ? "Coze已配置" : "Coze未配置",
          data.tts_available ? "TTS可用" : "TTS不可用",
          data.asr_available ? "ASR可用" : "ASR不可用",
        ];
        setApiProxyStatus(`代理连接正常：${parts.join("，")}。`);
      } catch (error) {
        setApiProxyStatus(`代理连接失败：${error?.message || error}`, true);
      }
    }

    function applyApiSettings(value) {
      const apiBase = trimTrailingSlash(value.api?.proxyApiBase || "");
      if (!window.SAFETY_TRAINING_CLOUD_CONFIG) window.SAFETY_TRAINING_CLOUD_CONFIG = {};
      if (!window.SAFETY_TRAINING_CLOUD_CONFIG.proxy) window.SAFETY_TRAINING_CLOUD_CONFIG.proxy = {};
      window.SAFETY_TRAINING_CLOUD_CONFIG.proxy.enabled = Boolean(apiBase);
      window.SAFETY_TRAINING_CLOUD_CONFIG.proxy.apiBase = apiBase;
      window.dispatchEvent(new CustomEvent("safety-api-proxy-change", { detail: { apiBase } }));
    }

    function renderApiProxyStatus(value) {
      const apiBase = value.api?.proxyApiBase || "";
      setApiProxyStatus(apiBase
        ? `当前代理：${apiBase}`
        : "未填写代理地址，将尝试浏览器直连云接口。");
    }

    function setApiProxyStatus(text, isError = false) {
      if (!options.apiProxyStatus) return;
      options.apiProxyStatus.textContent = text;
      options.apiProxyStatus.style.color = isError ? "#ffb1a8" : "";
    }

    function applySceneBackground(context) {
      const requestId = ++backgroundRequestId;
      const background = context.background;
      const imageUrl = background?.url || "";
      const fallbackUrl = context.defaultBackgroundUrl || "";
      if (!imageUrl) {
        setStageBackground("");
        options.sceneBackgroundStatus.textContent = getBackgroundStatusText(context);
        return;
      }

      verifyImageLoad(imageUrl)
        .then(() => {
          if (requestId !== backgroundRequestId) return;
          setStageBackground(imageUrl);
          options.sceneBackgroundStatus.textContent = getBackgroundStatusText(context);
        })
        .catch(() => {
          if (requestId !== backgroundRequestId) return;
          if (fallbackUrl && fallbackUrl !== imageUrl) {
            setStageBackground(fallbackUrl);
            options.sceneBackgroundStatus.textContent = `背景图加载失败，已回退到预设背景：${fallbackUrl}`;
            return;
          }
          setStageBackground("");
          options.sceneBackgroundStatus.textContent = `背景图加载失败：${imageUrl}`;
        });
    }

    function setStageBackground(imageUrl) {
      options.stage.style.setProperty("--bg-image", imageUrl ? `url("${escapeCssUrl(resolveCssImageUrl(imageUrl))}")` : "none");
    }

    function getSceneContext(value = settings) {
      const preset = getScenePreset(value.currentSceneId);
      const override = value.sceneOverrides?.[preset.id] || {};
      const quiz = mergeQuizContext(preset.quiz, override.quiz);
      const assessment = mergeAssessmentContext(preset.assessment, override.assessment);
      return {
        ...preset,
        question: resolveStringOverride(override.question, preset.question),
        options: resolveArrayOverride(override.options, preset.options),
        correctAnswer: resolveStringOverride(override.correctAnswer, preset.correctAnswer),
        systemPrompt: resolveStringOverride(override.systemPrompt, preset.systemPrompt),
        evaluationPrompt: resolveStringOverride(override.evaluationPrompt, preset.evaluationPrompt),
        evaluationRubric: resolveStringOverride(override.evaluationRubric, preset.evaluationRubric || DEFAULT_EVALUATION_RUBRIC),
        quiz,
        assessment,
        background: normalizeSceneBackground(override.background || getDefaultBackground(preset), preset),
      };
    }

    function mergeQuizContext(presetQuiz, overrideQuiz) {
      if (!presetQuiz) return undefined;
      const merged = { ...presetQuiz, ...(isPlainObject(overrideQuiz) ? overrideQuiz : {}) };
      merged.correctOptionIds = Array.isArray(merged.correctOptionIds) ? merged.correctOptionIds : [];
      return merged;
    }

    function mergeAssessmentContext(presetAssessment, overrideAssessment) {
      if (!presetAssessment) return undefined;
      return { ...presetAssessment, ...(isPlainObject(overrideAssessment) ? overrideAssessment : {}) };
    }

    function getDefaultBackground(preset) {
      if (!preset.defaultBackgroundUrl) return { type: "none" };
      return { type: "preset", url: preset.defaultBackgroundUrl, name: "默认背景" };
    }

    function normalizeSceneBackground(background, preset) {
      if (!background?.url) return background;
      const normalizedUrl = normalizeBackgroundUrl(background.url);
      if (normalizedUrl === background.url) return background;
      return {
        ...background,
        url: normalizedUrl,
        migratedFrom: background.url,
        name: background.name || preset.title,
      };
    }

    function normalizeBackgroundUrl(url) {
      return String(url)
        .replace("./assets/scenes/", "./assets/backgrounds/")
        .replace("/assets/scenes/", "/assets/backgrounds/");
    }

    function getBackgroundStatusText(context) {
      if (context.background?.type === "data") return `当前背景：${context.background.name || "已上传图片"}`;
      if (context.background?.type === "url") return `当前背景：${context.background.url}`;
      if (context.background?.type === "preset") return `当前背景：${context.expectedBackground}`;
      return `还没有背景图，建议补：${context.expectedBackground}`;
    }

    function updateActiveSceneOverride(key, value) {
      const preset = getScenePreset(settings.currentSceneId);
      updateActiveSceneOverrideValue(key, value, preset[key]);
    }

    function updateActiveSceneOverrideValue(key, value, defaultValue) {
      const preset = getScenePreset(settings.currentSceneId);
      const override = ensureActiveSceneOverride();
      if (isEmptyOverrideValue(value) || valuesMatch(value, defaultValue)) {
        delete override[key];
      } else {
        override[key] = value;
      }
      cleanupEmptyOverride(preset.id);
    }

    function updateActiveSceneOptions(value) {
      const preset = getScenePreset(settings.currentSceneId);
      updateActiveSceneOverrideValue("options", value, preset.options);
    }

    function updateNestedSceneOverride(sectionName, key, value) {
      const preset = getScenePreset(settings.currentSceneId);
      const sectionDefaults = sectionName === "quiz" ? preset.quiz : preset.assessment;
      if (!sectionDefaults) return;
      const override = ensureActiveSceneOverride();
      if (!isPlainObject(override[sectionName])) override[sectionName] = {};
      if (isEmptyOverrideValue(value) || valuesMatch(value, sectionDefaults[key])) {
        delete override[sectionName][key];
      } else {
        override[sectionName][key] = value;
      }
      if (Object.keys(override[sectionName]).length === 0) delete override[sectionName];
      cleanupEmptyOverride(preset.id);
    }

    function setActiveSceneBackground(background) {
      const preset = getScenePreset(settings.currentSceneId);
      const override = ensureActiveSceneOverride();
      if (!background) {
        delete override.background;
      } else {
        override.background = background;
      }
      cleanupEmptyOverride(preset.id);
    }

    function ensureActiveSceneOverride() {
      if (!settings.sceneOverrides) settings.sceneOverrides = {};
      if (!settings.sceneOverrides[settings.currentSceneId]) settings.sceneOverrides[settings.currentSceneId] = {};
      return settings.sceneOverrides[settings.currentSceneId];
    }

    function cleanupEmptyOverride(sceneId) {
      const override = settings.sceneOverrides?.[sceneId];
      if (override && Object.keys(override).length === 0) delete settings.sceneOverrides[sceneId];
    }

    function dispatchSceneChange() {
      window.dispatchEvent(new CustomEvent(SCENE_CHANGE_EVENT, { detail: getSceneContext() }));
    }

    function loadSettings() {
      const nextSettings = cloneDefaultSettings();
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        mergeSettings(nextSettings, saved);
      } catch {
        // Invalid local storage should not block the training page from opening.
      }
      applyUrlState(nextSettings);
      sanitizeSettings(nextSettings);
      ensureModeSafeCurrentScene(nextSettings);
      return nextSettings;
    }

    function mergeSettings(target, source) {
      if (!source || typeof source !== "object") return;
      if (typeof source.currentSceneId === "string" && SCENE_PRESETS.some((scene) => scene.id === source.currentSceneId)) {
        target.currentSceneId = source.currentSceneId;
      }
      if (source.sceneOverrides && typeof source.sceneOverrides === "object") target.sceneOverrides = source.sceneOverrides;
      if (typeof source.api?.proxyApiBase === "string") target.api.proxyApiBase = trimTrailingSlash(source.api.proxyApiBase);
      mergeNumber(target.answerBubble, source.answerBubble, "scale");
      mergeNumber(target.answerBubble, source.answerBubble, "width");
      mergeNumber(target.answerBubble, source.answerBubble, "x");
      mergeNumber(target.answerBubble, source.answerBubble, "y");
      mergeNumber(target.questionBubble, source.questionBubble, "scale");
      mergeNumber(target.questionBubble, source.questionBubble, "width");
      mergeNumber(target.questionBubble, source.questionBubble, "x");
      mergeNumber(target.questionBubble, source.questionBubble, "y");
      mergeNumber(target.background, source.background, "scale");
      mergeNumber(target.background, source.background, "x");
      mergeNumber(target.background, source.background, "y");
      mergeNumber(target.characters.teacher, source.characters?.teacher, "scale");
      mergeNumber(target.characters.teacher, source.characters?.teacher, "x");
      mergeNumber(target.characters.teacher, source.characters?.teacher, "y");
      mergeNumber(target.characters.teacher, source.characters?.teacher, "rotationX");
      mergeNumber(target.characters.teacher, source.characters?.teacher, "rotationY");
      mergeNumber(target.characters.girl, source.characters?.girl, "scale");
      mergeNumber(target.characters.girl, source.characters?.girl, "x");
      mergeNumber(target.characters.girl, source.characters?.girl, "y");
      mergeNumber(target.characters.girl, source.characters?.girl, "rotationX");
      mergeNumber(target.characters.girl, source.characters?.girl, "rotationY");
    }

    function applyUrlState(value) {
      const mode = readUrlParam("mode");
      if (mode) {
        activeMode = normalizeLearningMode(mode);
        localStorage.setItem(MODE_STORAGE_KEY, activeMode);
      }
      const sceneId = readUrlParam("scene");
      if (sceneId && getActiveModeScenes().some((scene) => scene.id === sceneId)) {
        value.currentSceneId = sceneId;
      }
    }

    function sanitizeSettings(value) {
      value.questionBubble.x = clampNumber(value.questionBubble.x, 0, 1500);
      value.questionBubble.width = clampNumber(value.questionBubble.width, 260, 620);
      value.questionBubble.scale = clampNumber(value.questionBubble.scale, 0.75, 1.35);
      value.questionBubble.y = clampNumber(value.questionBubble.y, -620, 220);
      value.characters.girl.y = clampNumber(value.characters.girl.y, -0.6, 0);
    }

    function ensureModeSafeCurrentScene(value) {
      const currentScene = getScenePreset(value.currentSceneId);
      if (!sceneSupportsMode(currentScene, getActiveMode())) {
        value.currentSceneId = getActiveModeScenes()[0].id;
      }
    }

    function getModeSafeScene(sceneId) {
      const scene = getScenePreset(sceneId);
      if (sceneSupportsMode(scene, getActiveMode())) return scene;
      return getActiveModeScenes()[0];
    }

    function getActiveModeScenes() {
      return getScenesForMode(getActiveMode());
    }

    function getActiveMode() {
      return activeMode;
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(reader.result));
      reader.addEventListener("error", () => reject(reader.error || new Error("file read failed")));
      reader.readAsDataURL(file);
    });
  }

  function verifyImageLoad(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(url);
      image.onerror = () => reject(new Error("image load failed"));
      image.src = url;
    });
  }

  function readUrlParam(name) {
    return new URL(window.location.href).searchParams.get(name) || "";
  }

  function getInitialLearningMode() {
    return normalizeLearningMode(readUrlParam("mode") || DEFAULT_LEARNING_MODE);
  }

  function writeUrlParams(params) {
    const url = new URL(window.location.href);
    Object.entries(params).forEach(([key, value]) => {
      if (value === null || value === undefined || value === "") url.searchParams.delete(key);
      else url.searchParams.set(key, String(value));
    });
    if (url.href !== window.location.href) window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function mergeNumber(target, source, key) {
    if (Number.isFinite(source?.[key])) target[key] = source[key];
  }

  function clampNumber(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
  }

  function cloneDefaultSettings() {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }

  function getDefaultProxyApiBase() {
    return trimTrailingSlash(window.SAFETY_TRAINING_CLOUD_CONFIG?.proxy?.apiBase || "http://127.0.0.1:5000/api");
  }

  function trimTrailingSlash(value) {
    return String(value || "").replace(/\/+$/, "");
  }

  function escapeCssUrl(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function resolveCssImageUrl(url) {
    const value = String(url || "");
    if (/^(data:|blob:|https?:|file:)/i.test(value)) {
      return value;
    }
    try {
      return new URL(value, window.location.href).href;
    } catch {
      return value;
    }
  }

  function setSectionHidden(section, hidden) {
    if (section) section.hidden = hidden;
  }

  function setInputValue(input, value) {
    if (input) input.value = value;
  }

  function parseOptionsInput(value) {
    return String(value).split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  }

  function formatOptionsInput(options) {
    return Array.isArray(options) ? options.join("\n") : "";
  }

  function parseOptionIdsInput(value) {
    const ids = String(value)
      .split(/[,\s，、；;]+/)
      .map((item) => item.trim().toUpperCase())
      .filter((item) => /^[A-Z]$/.test(item));
    return [...new Set(ids)];
  }

  function formatOptionIds(ids) {
    return Array.isArray(ids) ? ids.join(",") : "";
  }

  function resolveStringOverride(value, fallback = "") {
    return typeof value === "string" && value ? value : fallback || "";
  }

  function resolveArrayOverride(value, fallback = []) {
    return Array.isArray(value) && value.length ? value : fallback || [];
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function isEmptyOverrideValue(value) {
    if (Array.isArray(value)) return value.length === 0;
    return !value;
  }

  function valuesMatch(left, right) {
    if (Array.isArray(left) || Array.isArray(right)) {
      return normalizeArray(left).join("\n") === normalizeArray(right).join("\n");
    }
    return left === right;
  }

  function normalizeArray(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  window.SafetySceneSettings = {
    createSceneSettings,
  };
}());
