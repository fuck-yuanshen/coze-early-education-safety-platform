(function () {
  const scene = createSceneAdapter();
  let offlineAssistant = null;

  const sceneSettings = window.SafetySceneSettings.createSceneSettings({
    scene,
    stage: document.querySelector(".scene-stage"),
    menu: document.getElementById("sceneMenu"),
    menuButton: document.getElementById("sceneMenuButton"),
    submenu: document.getElementById("sceneSubmenu"),
    modeMenuButton: document.getElementById("modeMenuButton"),
    modeMenu: document.getElementById("modeSwitcher"),
    panel: document.getElementById("settingsPanel"),
    answerBubble: document.getElementById("answerBubble"),
    questionBubble: document.getElementById("questionBubble"),
    toggleButton: document.getElementById("settingsButton"),
    closeButton: document.getElementById("closeSettingsButton"),
    resetButton: document.getElementById("resetSceneButton"),
    apiProxyUrlInput: document.getElementById("apiProxyUrl"),
    apiProxyTestButton: document.getElementById("apiProxyTestButton"),
    apiProxyStatus: document.getElementById("apiProxyStatus"),
    sceneSelect: document.getElementById("sceneSelect"),
    sceneBackgroundFileInput: document.getElementById("sceneBackgroundFile"),
    sceneBackgroundUrlInput: document.getElementById("sceneBackgroundUrl"),
    sceneQuestionInput: document.getElementById("sceneQuestion"),
    sceneCorrectAnswerInput: document.getElementById("sceneCorrectAnswer"),
    sceneSystemPromptInput: document.getElementById("sceneSystemPrompt"),
    quizContentSection: document.getElementById("quizContentSection"),
    sceneQuizPromptInput: document.getElementById("sceneQuizPrompt"),
    sceneQuizOptionsInput: document.getElementById("sceneQuizOptions"),
    sceneQuizCorrectIdsInput: document.getElementById("sceneQuizCorrectIds"),
    sceneQuizExplanationInput: document.getElementById("sceneQuizExplanation"),
    assessmentContentSection: document.getElementById("assessmentContentSection"),
    sceneChildPromptInput: document.getElementById("sceneChildPrompt"),
    sceneAssessmentFocusInput: document.getElementById("sceneAssessmentFocus"),
    sceneIdealTeacherResponseInput: document.getElementById("sceneIdealTeacherResponse"),
    sceneEvaluationRubricInput: document.getElementById("sceneEvaluationRubric"),
    sceneEvaluationPromptInput: document.getElementById("sceneEvaluationPrompt"),
    sceneBackgroundStatus: document.getElementById("sceneBackgroundStatus"),
    sceneMissingBackgrounds: document.getElementById("sceneMissingBackgrounds"),
    answerBubbleScaleInput: document.getElementById("answerBubbleScale"),
    answerBubbleWidthInput: document.getElementById("answerBubbleWidth"),
    answerBubbleXInput: document.getElementById("answerBubbleX"),
    answerBubbleYInput: document.getElementById("answerBubbleY"),
    childBubbleScaleInput: document.getElementById("childBubbleScale"),
    childBubbleWidthInput: document.getElementById("childBubbleWidth"),
    childBubbleXInput: document.getElementById("childBubbleX"),
    childBubbleYInput: document.getElementById("childBubbleY"),
    backgroundScaleInput: document.getElementById("backgroundScale"),
    backgroundXInput: document.getElementById("backgroundX"),
    backgroundYInput: document.getElementById("backgroundY"),
    teacherScaleInput: document.getElementById("teacherScale"),
    teacherXInput: document.getElementById("teacherX"),
    teacherYInput: document.getElementById("teacherY"),
    teacherRotationXInput: document.getElementById("teacherRotationX"),
    teacherRotationYInput: document.getElementById("teacherRotationY"),
    girlScaleInput: document.getElementById("girlScale"),
    girlXInput: document.getElementById("girlX"),
    girlYInput: document.getElementById("girlY"),
    girlRotationXInput: document.getElementById("girlRotationX"),
    girlRotationYInput: document.getElementById("girlRotationY"),
  });

  const treeMenu = window.SafetyTreeMenu.createTreeMenu({
    targetElement: document.body,
    openSettingsPanel: (sectionId) => {
      const panel = document.getElementById("settingsPanel");
      panel.classList.remove("is-hidden");
      
      const sectionMap = {
        "api-proxy": 0,
        "current-scene": 1,
        "quiz-content": 2,
        "assessment-content": 3,
        "answer-bubble": 4,
        "child-bubble": 5,
        "background": 6,
        "characters": 7,
      };
      
      const sections = panel.querySelectorAll(".settings-section");
      const targetIndex = sectionMap[sectionId];
      if (targetIndex !== undefined && sections[targetIndex]) {
        sections[targetIndex].scrollIntoView({ behavior: "smooth", block: "start" });
        sections[targetIndex].style.background = "rgba(245, 189, 69, 0.15)";
        setTimeout(() => {
          sections[targetIndex].style.background = "";
        }, 1500);
      }
    },
    onItemClick: (item) => {
      if (item.type === "vr") {
        window.alert(item.dialogMessage || "欢迎体验VR！");
        return;
      }
      if (item.sceneId) {
        if (item.mode) {
          offlineAssistant?.setMode(item.mode, { skipSceneSync: true });
          sceneSettings.setModeAndScene(item.mode, item.sceneId);
          return;
        }
        sceneSettings.setCurrentScene(item.sceneId);
      }
    },
    onClose: () => {
      document.getElementById("treeMenuOpenButton").focus();
    },
  });

  document.getElementById("treeMenuOpenButton").addEventListener("click", () => {
    treeMenu.open();
  });

  offlineAssistant = window.SafetyOfflineAssistant.createOfflineAssistant({
    formElement: document.getElementById("askForm"),
    inputElement: document.getElementById("messageInput"),
    sendButton: document.getElementById("sendButton"),
    micButton: document.getElementById("micButton"),
    micLabel: document.getElementById("micLabel"),
    newChatButton: document.getElementById("newChatButton"),
    answerBubble: document.getElementById("answerBubble"),
    answerText: document.getElementById("answerText"),
    answerExpandButton: document.getElementById("answerExpandButton"),
    prevSceneButton: document.getElementById("prevSceneButton"),
    nextSceneButton: document.getElementById("nextSceneButton"),
    questionBubble: document.getElementById("questionBubble"),
    modeButtons: Array.from(document.querySelectorAll("[data-mode]")),
    quizPanel: document.getElementById("quizPanel"),
    quizTitle: document.getElementById("quizTitle"),
    quizPrompt: document.getElementById("quizPrompt"),
    quizOptions: document.getElementById("quizOptions"),
    quizSubmitButton: document.getElementById("quizSubmitButton"),
    quizMinimizeButton: document.getElementById("quizMinimizeButton"),
    quizReopenButton: document.getElementById("quizReopenButton"),
    assessmentModal: document.getElementById("assessmentModal"),
    assessmentResultText: document.getElementById("assessmentResultText"),
    assessmentCloseButton: document.getElementById("assessmentCloseButton"),
    assessmentReopenButton: document.getElementById("assessmentReopenButton"),
    assessmentRestartButton: document.getElementById("assessmentRestartButton"),
    assessmentNextButton: document.getElementById("assessmentNextButton"),
    statusElement: document.getElementById("statusText"),
    getSceneContext: () => sceneSettings.getSceneContext(),
    goToPreviousScene: () => sceneSettings.goToPreviousScene(),
    goToNextScene: () => sceneSettings.goToNextScene(),
    onModeChange: (mode) => sceneSettings.setMode(mode),
    onAnswerStart: () => scene.setSpeaking(true),
    onAnswerEnd: () => scene.setSpeaking(false),
  });

  document.getElementById("sceneCanvas").addEventListener("dblclick", () => {
    scene.focusCharacters();
  });

  function createSceneAdapter() {
    const loadingElement = document.getElementById("sceneLoading");
    const loadingTextElement = document.getElementById("sceneLoadingText");
    try {
      return window.SafetySceneRenderer.createSafetyScene({
        canvas: document.getElementById("sceneCanvas"),
        loadingElement,
        loadingTextElement,
      });
    } catch (error) {
      console.error("Scene renderer failed", error);
      if (loadingTextElement) {
        loadingTextElement.textContent = "3D 场景加载失败，但练习功能仍可使用。";
      }
      if (loadingElement) {
        window.setTimeout(() => loadingElement.classList.add("is-hidden"), 1800);
      }
      return {
        focusCharacters() {},
        updateCharacterSettings() {},
        setSpeaking() {},
      };
    }
  }
}());
