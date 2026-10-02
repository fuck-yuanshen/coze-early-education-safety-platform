(function () {
  const { SCENE_CHANGE_EVENT } = window.SafetyTrainingPresets;
  const {
    DEFAULT_LEARNING_MODE,
    LEARNING_MODES,
    MODE_STORAGE_KEY,
    buildOfflineExplanation,
    evaluateQuizSelection,
    evaluateTeacherResponse,
    getChildPrompt,
    getModeConfig,
    getOpeningText,
    getQuizOptions,
    normalizeLearningMode,
  } = window.SafetyTrainingFlow;

  const ANSWER_COLLAPSE_LIMIT = 120;
  const RECORDING_HINT_TEXT = "结束语音输入请按‘结束录音’";

  function createOfflineAssistant(options) {
    const cloud = window.SafetyCloudServices.createCloudServices(window.SAFETY_TRAINING_CLOUD_CONFIG);
    const state = {
      mode: getInitialLearningMode(),
      selectedQuizIds: new Set(),
      quizPanelCollapsed: false,
      answerFullText: "",
      answerExpanded: false,
      isBusy: false,
      isRecording: false,
      isStartingRecording: false,
      isRecognizingSpeech: false,
      recordingSession: null,
      recordingId: 0,
      audioContext: null,
      activeSources: [],
      audioPlaybackId: 0,
      hasUserGesture: false,
      pendingChildPrompt: "",
      speechFallbackActive: false,
      assessmentResultText: "",
      assessmentModalCollapsed: false,
    };

    bindEvents();
    setMode(state.mode, { forceRender: true });

    return { renderCurrentMode, setMode };

    function bindEvents() {
      window.addEventListener("pointerdown", markUserGesture, { capture: true });
      window.addEventListener("keydown", markUserGesture, { capture: true });

      options.formElement.addEventListener("submit", (event) => {
        event.preventDefault();
        if (state.mode === LEARNING_MODES.quiz.id) {
          submitQuizSelection();
          return;
        }
        void sendMessage(options.inputElement.value);
      });
      options.micButton.addEventListener("click", () => {
        if (state.isRecording) {
          void finishManualRecording();
          return;
        }
        if (state.isBusy || state.isStartingRecording) return;
        if (state.activeSources.length || state.speechFallbackActive) {
          stopAudio();
          setStatus("已停止语音播放。");
          return;
        }
        if (state.mode === LEARNING_MODES.assessment.id && state.pendingChildPrompt) {
          const prompt = state.pendingChildPrompt;
          state.pendingChildPrompt = "";
          updateMicLabel();
          void speakText(prompt, { voice: cloud.config.dashscope.childTtsVoice, childPrompt: true });
          return;
        }
        if (state.mode === LEARNING_MODES.quiz.id) {
          speakCurrentAnswer();
          return;
        }
        void recognizeAndSend();
      });
      options.newChatButton.addEventListener("click", startNewConversation);
      options.answerExpandButton?.addEventListener("click", toggleAnswerExpansion);
      options.prevSceneButton?.addEventListener("click", goPreviousScene);
      options.nextSceneButton?.addEventListener("click", goNextScene);
      options.quizSubmitButton?.addEventListener("click", submitQuizSelection);
      options.quizMinimizeButton?.addEventListener("click", collapseQuizPanel);
      options.quizReopenButton?.addEventListener("click", restoreQuizPanel);
      options.assessmentCloseButton?.addEventListener("click", collapseAssessmentModal);
      options.assessmentReopenButton?.addEventListener("click", restoreAssessmentModal);
      options.assessmentRestartButton?.addEventListener("click", startNewConversation);
      options.assessmentNextButton?.addEventListener("click", goNextScene);

      options.modeButtons.forEach((button) => {
        button.addEventListener("click", () => setMode(button.dataset.mode));
      });

      window.addEventListener(SCENE_CHANGE_EVENT, (event) => {
        stopAudio();
        cancelActiveRecording();
        resetQuizSelection();
        clearAssessmentModal();
        renderCurrentMode(event.detail, { readChildPrompt: true });
      });
    }

    function setMode(mode, modeOptions = {}) {
      const nextMode = normalizeLearningMode(mode);
      const modeChanged = nextMode !== state.mode;
      stopAudio();
      cancelActiveRecording();
      state.quizPanelCollapsed = false;
      state.mode = nextMode;
      localStorage.setItem(MODE_STORAGE_KEY, state.mode);
      if (modeChanged && !modeOptions.skipSceneSync) options.onModeChange?.(state.mode);
      updateModeButtons();
      updateConsoleForMode();
      resetQuizSelection();
      clearAssessmentModal();
      if (modeOptions.forceRender || (modeChanged && typeof options.onModeChange !== "function")) {
        renderCurrentMode(options.getSceneContext(), { readChildPrompt: true });
      }
    }

    function updateModeButtons() {
      options.modeButtons.forEach((button) => {
        const isActive = button.dataset.mode === state.mode;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
      });
    }

    function updateConsoleForMode() {
      const config = getModeConfig(state.mode);
      options.inputElement.placeholder = config.inputPlaceholder;
      options.sendButton.textContent = config.sendLabel;
      const isQuizMode = state.mode === LEARNING_MODES.quiz.id;
      const isVoiceLocked = state.isBusy || state.isStartingRecording || state.isRecording;
      options.inputElement.disabled = isQuizMode || isVoiceLocked;
      options.sendButton.disabled = isVoiceLocked;
      options.quizSubmitButton.disabled = !isQuizMode || isVoiceLocked;
      options.micButton.disabled = (state.isBusy || state.isStartingRecording) && !state.isRecording;
      options.micButton.setAttribute("aria-pressed", String(state.isRecording || state.activeSources.length || state.speechFallbackActive));
      updateMicLabel();
    }

    function renderCurrentMode(sceneContext = options.getSceneContext(), renderOptions = {}) {
      if (!sceneContext) return;
      const childPrompt = getChildPrompt(sceneContext, state.mode);
      if (state.mode !== LEARNING_MODES.assessment.id || !childPrompt) {
        state.pendingChildPrompt = "";
      }
      setAnswer(getOpeningText(sceneContext, state.mode), false);
      showQuestion(childPrompt);
      renderQuizPanel(sceneContext);
      updateConsoleForMode();
      setStatus(getModeStatus(sceneContext));
      if (renderOptions.readChildPrompt && state.mode === LEARNING_MODES.assessment.id && childPrompt) {
        if (state.hasUserGesture) {
          void speakText(childPrompt, { voice: cloud.config.dashscope.childTtsVoice, childPrompt: true });
        } else {
          state.pendingChildPrompt = childPrompt;
          updateMicLabel();
          setStatus(`${getModeStatus(sceneContext)}：点击“播放提问”后播放幼儿问题。`);
        }
      }
    }

    function getModeStatus(sceneContext) {
      if (state.mode === LEARNING_MODES.quiz.id) return `做题模式：${sceneContext.title}`;
      if (state.mode === LEARNING_MODES.assessment.id) return `AI测评模式：${sceneContext.title}`;
      return `AI智能体教师：${sceneContext.title}`;
    }

    function renderQuizPanel(sceneContext) {
      if (!options.quizPanel) return;
      const isQuizMode = state.mode === LEARNING_MODES.quiz.id;
      if (!isQuizMode || !sceneContext?.quiz) {
        options.quizPanel.classList.add("is-hidden");
        options.quizReopenButton?.classList.add("is-hidden");
        return;
      }
      syncQuizPanelVisibility();
      options.quizTitle.textContent = `${sceneContext.category}｜${sceneContext.title}`;
      options.quizPrompt.textContent = sceneContext.quiz.prompt;
      options.quizOptions.textContent = "";
      getQuizOptions(sceneContext).forEach((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "quiz-option";
        button.dataset.optionId = option.id;
        button.setAttribute("aria-pressed", String(state.selectedQuizIds.has(option.id)));
        button.textContent = `${option.id}. ${option.text}`;
        button.addEventListener("click", () => toggleQuizOption(option.id));
        options.quizOptions.append(button);
      });
      syncQuizOptionButtons();
    }

    function collapseQuizPanel() {
      if (state.mode !== LEARNING_MODES.quiz.id) return;
      state.quizPanelCollapsed = true;
      syncQuizPanelVisibility();
    }

    function restoreQuizPanel() {
      if (state.mode !== LEARNING_MODES.quiz.id) return;
      state.quizPanelCollapsed = false;
      syncQuizPanelVisibility();
    }

    function syncQuizPanelVisibility() {
      const sceneContext = options.getSceneContext();
      const canShowQuiz = state.mode === LEARNING_MODES.quiz.id && sceneContext?.quiz;
      if (!canShowQuiz) {
        options.quizPanel?.classList.add("is-hidden");
        options.quizReopenButton?.classList.add("is-hidden");
        return;
      }
      options.quizPanel?.classList.toggle("is-hidden", state.quizPanelCollapsed);
      options.quizReopenButton?.classList.toggle("is-hidden", !state.quizPanelCollapsed);
    }

    function toggleQuizOption(optionId) {
      if (state.mode !== LEARNING_MODES.quiz.id || state.isBusy) return;
      if (state.selectedQuizIds.has(optionId)) state.selectedQuizIds.delete(optionId);
      else state.selectedQuizIds.add(optionId);
      syncQuizOptionButtons();
    }

    function syncQuizOptionButtons() {
      options.quizOptions?.querySelectorAll(".quiz-option").forEach((button) => {
        const isSelected = state.selectedQuizIds.has(button.dataset.optionId);
        button.classList.toggle("is-selected", isSelected);
        button.setAttribute("aria-pressed", String(isSelected));
      });
    }

    function submitQuizSelection() {
      const sceneContext = options.getSceneContext();
      if (!sceneContext?.quiz) {
        setStatus("当前场景没有配置做题题目。", true);
        return;
      }
      if (!state.selectedQuizIds.size) {
        setStatus("请至少选择一个选项。", true);
        return;
      }
      const result = evaluateQuizSelection(sceneContext, [...state.selectedQuizIds]);
      setAnswer(result.text, false);
      void speakText(result.text);
      setStatus("题目讲解已显示，可以进入下一个场景。");
    }

    async function recognizeAndSend() {
      if (!cloud.isDashScopeReady()) {
        setStatus("云 ASR 未配置，请在 js/config.js 填 DashScope apiKey。", true);
        return;
      }
      stopAudio();
      state.isStartingRecording = true;
      state.recordingId += 1;
      const recordingId = state.recordingId;
      updateConsoleForMode();
      setStatus("正在启动麦克风录音...");
      try {
        const session = await cloud.startSpeechRecording();
        if (recordingId !== state.recordingId) {
          await session.cancel?.();
          return;
        }
        state.recordingSession = session;
        state.isRecording = true;
        setRecordingHint();
        setStatus("正在录音，回答完成后请点击“结束录音”。");
      } catch (error) {
        if (recordingId === state.recordingId) {
          setStatus(`启动录音失败：${formatCloudError(error)}`, true);
        }
      } finally {
        if (recordingId === state.recordingId) {
          state.isStartingRecording = false;
          updateConsoleForMode();
        }
      }
    }

    async function finishManualRecording() {
      const session = state.recordingSession;
      const recordingId = state.recordingId;
      if (!session) return;
      state.recordingSession = null;
      state.isRecording = false;
      state.isRecognizingSpeech = true;
      setBusy(true);
      setStatus("正在结束录音并发送到云端 ASR...");
      try {
        const recording = await session.stop();
        if (recordingId !== state.recordingId) return;
        const text = await cloud.recognizeRecordedSpeech(recording);
        if (recordingId !== state.recordingId) return;
        options.inputElement.value = text;
        setBusy(false);
        await sendMessage(text);
      } catch (error) {
        if (recordingId === state.recordingId) {
          setStatus(`云 ASR 识别失败：${formatCloudError(error)}`, true);
          restoreQuestionAfterRecording();
        }
      } finally {
        if (recordingId === state.recordingId) {
          state.isRecording = false;
          state.recordingSession = null;
          state.isRecognizingSpeech = false;
          setBusy(false);
        }
      }
    }

    function cancelActiveRecording() {
      if (!state.recordingSession && !state.isRecording && !state.isStartingRecording && !state.isRecognizingSpeech) return;
      state.recordingId += 1;
      const session = state.recordingSession;
      state.recordingSession = null;
      state.isRecording = false;
      state.isStartingRecording = false;
      state.isRecognizingSpeech = false;
      session?.cancel?.().catch(() => {});
      if (state.isBusy) state.isBusy = false;
      updateConsoleForMode();
    }

    async function sendMessage(rawText) {
      const text = String(rawText || "").trim();
      if (!text && state.mode !== LEARNING_MODES.assessment.id) return;
      if (state.isBusy) return;

      const sceneContext = options.getSceneContext();
      stopAudio();
      options.inputElement.value = "";
      setBusy(true);

      try {
        if (state.mode === LEARNING_MODES.assessment.id) {
          await handleAssessment(sceneContext, text);
          return;
        }
        await handleDefaultChat(sceneContext, text);
      } finally {
        setBusy(false);
      }
    }

    async function handleDefaultChat(sceneContext, text) {
      showQuestion(text);
      setAnswer(sceneContext?.isHome ? "正在请 Coze 生成幼教问答..." : "正在请 Coze 生成安全知识讲解...", true);
      setStatus("正在调用 Coze API...");
      let answer = "";
      try {
        answer = await requestCoze(sceneContext, text, "default");
        setStatus("Coze 回答已显示，正在生成云端语音...");
      } catch (error) {
        answer = buildOfflineExplanation(sceneContext, text);
        setStatus(`Coze 调用失败，已使用本地预设讲解。原因：${formatCloudError(error)}`, true);
      }
      setAnswer(answer, false);
      await speakText(answer);
    }

    async function handleAssessment(sceneContext, text) {
      showQuestion(getChildPrompt(sceneContext, state.mode));
      setAnswer(text || "未输入教师回应。", false);
      showAssessmentModal("正在请 Coze 测评你的教师回应...");
      setStatus("正在调用 Coze API 测评...");
      try {
        const result = await requestCoze(sceneContext, text, "assessment");
        showAssessmentModal(result);
        setStatus("AI测评结果已生成，可以重开或进入下一场景。");
      } catch (error) {
        const fallback = evaluateTeacherResponse(sceneContext, text);
        showAssessmentModal(`${fallback}\n\n云测评失败，以上为本地评分。原因：${formatCloudError(error)}`);
        setStatus("Coze 测评失败，已使用本地评分。", true);
      }
    }

    async function requestCoze(sceneContext, text, mode) {
      if (!cloud.isCozeReady()) {
        throw new Error("Coze 配置不完整，请在 js/config.js 填 token、botId、userId。");
      }
      return cloud.chat({
        mode,
        userText: text,
        scene: sceneContext,
        systemPrompt: getRequestSystemPrompt(sceneContext, mode),
      });
    }

    function getRequestSystemPrompt(sceneContext, mode) {
      if (mode === "assessment") {
        return sceneContext?.evaluationPrompt || sceneContext?.systemPrompt || "";
      }
      if (sceneContext?.isHome) {
        return sceneContext.systemPrompt || [
          "你是学前教育专业的AI智能体教师。",
          "只回答幼儿教育、幼儿园安全教育、保育护理、家园沟通、班级管理、活动设计、儿童发展观察和教师专业成长相关问题。",
          "如果问题明显无关，请简短说明只能讨论幼教相关内容。",
        ].join("");
      }
      return sceneContext?.systemPrompt || "";
    }

    function startNewConversation() {
      stopAudio();
      cancelActiveRecording();
      resetQuizSelection();
      clearAssessmentModal();
      renderCurrentMode(options.getSceneContext(), { readChildPrompt: true });
      setStatus("已重置当前练习。");
    }

    function goNextScene() {
      stopAudio();
      cancelActiveRecording();
      const nextScene = options.goToNextScene();
      setStatus(nextScene ? `已进入场景：${nextScene.title}` : "已进入下一个场景。");
    }

    function goPreviousScene() {
      stopAudio();
      cancelActiveRecording();
      const previousScene = options.goToPreviousScene();
      setStatus(previousScene ? `已进入场景：${previousScene.title}` : "已进入上一个场景。");
    }

    function resetQuizSelection() {
      state.selectedQuizIds.clear();
      syncQuizOptionButtons();
    }

    function setAnswer(text, isThinking) {
      state.answerFullText = String(text || "");
      state.answerExpanded = false;
      renderAnswer();
      options.answerBubble.classList.toggle("is-thinking", Boolean(isThinking));
    }

    function toggleAnswerExpansion() {
      state.answerExpanded = !state.answerExpanded;
      renderAnswer();
    }

    function renderAnswer() {
      const shouldCollapse = state.answerFullText.length > ANSWER_COLLAPSE_LIMIT;
      const visibleText = shouldCollapse && !state.answerExpanded
        ? `${state.answerFullText.slice(0, ANSWER_COLLAPSE_LIMIT)}...`
        : state.answerFullText;
      options.answerText.textContent = visibleText;
      options.answerBubble.classList.toggle("is-expanded", shouldCollapse && state.answerExpanded);
      options.answerBubble.classList.toggle("is-collapsible", shouldCollapse);
      options.answerExpandButton?.classList.toggle("is-hidden", !shouldCollapse);
      if (options.answerExpandButton) {
        options.answerExpandButton.textContent = state.answerExpanded ? "收起" : "展开";
        options.answerExpandButton.setAttribute("aria-expanded", String(state.answerExpanded));
      }
    }

    function showQuestion(text) {
      if (!text) {
        options.questionBubble.textContent = "";
        options.questionBubble.classList.add("is-hidden");
        return;
      }
      options.questionBubble.textContent = text;
      options.questionBubble.classList.remove("is-hidden");
    }

    function setRecordingHint() {
      const childPrompt = getChildPrompt(options.getSceneContext(), state.mode);
      showQuestion([childPrompt, RECORDING_HINT_TEXT].filter(Boolean).join("\n"));
    }

    function restoreQuestionAfterRecording() {
      showQuestion(getChildPrompt(options.getSceneContext(), state.mode));
    }

    function showAssessmentModal(text) {
      state.assessmentResultText = text;
      state.assessmentModalCollapsed = false;
      options.assessmentResultText.textContent = text;
      options.assessmentResultText.scrollTop = options.assessmentResultText.scrollHeight;
      options.assessmentModal.classList.remove("is-hidden");
      options.assessmentReopenButton?.classList.add("is-hidden");
    }

    function collapseAssessmentModal() {
      if (!state.assessmentResultText) return;
      state.assessmentModalCollapsed = true;
      options.assessmentModal.classList.add("is-hidden");
      options.assessmentReopenButton?.classList.remove("is-hidden");
    }

    function restoreAssessmentModal() {
      if (!state.assessmentResultText) return;
      state.assessmentModalCollapsed = false;
      options.assessmentModal.classList.remove("is-hidden");
      options.assessmentReopenButton?.classList.add("is-hidden");
    }

    function clearAssessmentModal() {
      state.assessmentResultText = "";
      state.assessmentModalCollapsed = false;
      options.assessmentModal?.classList.add("is-hidden");
      options.assessmentReopenButton?.classList.add("is-hidden");
      if (options.assessmentResultText) options.assessmentResultText.textContent = "";
    }

    function speakCurrentAnswer() {
      void speakText(state.answerFullText);
    }

    async function speakText(text, speechOptions = {}) {
      if (!text) return false;
      stopAudio();
      const playbackId = state.audioPlaybackId;

      if (!cloud.isDashScopeReady()) {
        speakWithBrowser(text, speechOptions, playbackId);
        if (!speechOptions.childPrompt) {
          setStatus("DashScope TTS 未配置，已使用浏览器内置朗读。");
        }
        return false;
      }

      try {
        setStatus(speechOptions.childPrompt ? "正在生成幼儿提问语音..." : "正在生成云端语音...");
        const audioBlob = await cloud.synthesizeSpeech(text, speechOptions);
        if (!audioBlob || !isCurrentAudioPlayback(playbackId)) return false;
        const didPlay = await playAudioBlob(audioBlob, playbackId);
        if (!didPlay || !isCurrentAudioPlayback(playbackId)) return false;
        setStatus(speechOptions.childPrompt ? "幼儿提问播放完成，请以教师身份回答。" : "云端语音播放完成。");
        return true;
      } catch (error) {
        if (!isCurrentAudioPlayback(playbackId)) return false;
        speakWithBrowser(text, speechOptions, playbackId);
        setStatus(`云 TTS 失败，已使用浏览器内置朗读。原因：${formatCloudError(error)}`, true);
        return false;
      }
    }

    function playAudioBlob(blob, playbackId) {
      return new Promise((resolve, reject) => {
        prepareAudioOutput()
          .then((audioContext) => blob.arrayBuffer()
            .then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer.slice(0)))
            .then((audioBuffer) => {
              if (!isCurrentAudioPlayback(playbackId)) {
                resolve(false);
                return;
              }
              const source = audioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(audioContext.destination);
              state.activeSources.push(source);
              options.micButton.setAttribute("aria-pressed", "true");
              options.micLabel.textContent = "停止播放";
              options.onAnswerStart?.();
              source.onended = () => {
                state.activeSources = state.activeSources.filter((item) => item !== source);
                if (isCurrentAudioPlayback(playbackId)) finishAudioUi();
                resolve(isCurrentAudioPlayback(playbackId));
              };
              source.start();
            }))
          .catch((error) => {
            if (isCurrentAudioPlayback(playbackId)) finishAudioUi();
            reject(error);
          });
      });
    }

    function speakWithBrowser(text, speechOptions = {}, playbackId = state.audioPlaybackId) {
      if (!("speechSynthesis" in window)) return;
      if (!isCurrentAudioPlayback(playbackId)) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "zh-CN";
      utterance.rate = speechOptions.childPrompt ? 1.05 : 1;
      utterance.pitch = speechOptions.childPrompt ? 1.25 : 1;
      utterance.onstart = () => {
        if (!isCurrentAudioPlayback(playbackId)) {
          window.speechSynthesis.cancel();
          return;
        }
        state.speechFallbackActive = true;
        options.micButton.setAttribute("aria-pressed", "true");
        options.micLabel.textContent = "停止播放";
        options.onAnswerStart?.();
      };
      utterance.onend = () => finishAudioUiForPlayback(playbackId);
      utterance.onerror = () => finishAudioUiForPlayback(playbackId);
      window.speechSynthesis.speak(utterance);
    }

    function stopAudio() {
      state.audioPlaybackId += 1;
      state.activeSources.forEach((source) => {
        try {
          source.stop();
        } catch {
          // Source nodes may already be stopped when scene changes or playback ends.
        }
      });
      state.activeSources = [];
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      finishAudioUi();
    }

    function isCurrentAudioPlayback(playbackId) {
      return playbackId === state.audioPlaybackId;
    }

    function finishAudioUiForPlayback(playbackId) {
      if (isCurrentAudioPlayback(playbackId)) finishAudioUi();
    }

    function finishAudioUi() {
      state.speechFallbackActive = false;
      options.micButton.setAttribute("aria-pressed", String(state.isRecording));
      updateMicLabel();
      options.onAnswerEnd?.();
    }

    function updateMicLabel() {
      if (state.isRecording) {
        options.micLabel.textContent = "结束录音";
        return;
      }
      if (state.activeSources.length || state.speechFallbackActive) {
        options.micLabel.textContent = "停止播放";
        return;
      }
      if (state.mode === LEARNING_MODES.assessment.id && state.pendingChildPrompt) {
        options.micLabel.textContent = "播放提问";
        return;
      }
      options.micLabel.textContent = state.mode === LEARNING_MODES.quiz.id ? "朗读/停止" : "开始语音";
    }

    function markUserGesture() {
      state.hasUserGesture = true;
      prepareAudioOutput().catch(() => {});
    }

    async function prepareAudioOutput() {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("当前浏览器不支持 Web Audio。");
      if (!state.audioContext) {
        state.audioContext = new AudioContextClass();
      }
      if (state.audioContext.state === "suspended") {
        await state.audioContext.resume();
      }
      return state.audioContext;
    }

    function setBusy(isBusy) {
      state.isBusy = isBusy;
      updateConsoleForMode();
    }

    function setStatus(text, isError = false) {
      options.statusElement.textContent = text;
      options.statusElement.style.color = isError ? "#ffb1a8" : "";
    }
  }

  function readUrlParam(name) {
    return new URL(window.location.href).searchParams.get(name) || "";
  }

  function getInitialLearningMode() {
    return normalizeLearningMode(readUrlParam("mode") || DEFAULT_LEARNING_MODE);
  }

  function formatCloudError(error) {
    const message = error?.message || String(error || "unknown error");
    if (message.includes("Failed to fetch")) {
      return "浏览器直连云接口被网络/CORS 拦截，或本机无法访问该云服务。";
    }
    return message;
  }

  window.SafetyOfflineAssistant = {
    createOfflineAssistant,
  };
}());
