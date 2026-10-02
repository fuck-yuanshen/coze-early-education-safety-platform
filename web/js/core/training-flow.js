(function () {
  const LEARNING_MODES = {
    default: {
      id: "default",
      label: "AI智能体教师",
      inputPlaceholder: "输入幼教相关问题",
      sendLabel: "提问",
    },
    quiz: {
      id: "quiz",
      label: "做题模式",
      inputPlaceholder: "请先选择右侧选项",
      sendLabel: "提交",
    },
    assessment: {
      id: "assessment",
      label: "AI测评",
      inputPlaceholder: "以幼儿教师身份回答幼儿",
      sendLabel: "测评",
    },
  };
  const DEFAULT_LEARNING_MODE = LEARNING_MODES.default.id;
  const MODE_STORAGE_KEY = "standalone_safety_learning_mode_v1";
  const DEFAULT_EVALUATION_RUBRIC = "安全内容准确性25分，幼儿化表达适配性25分，引导流程完整性20分，引导实效性20分，职业素养10分。等级：90-100优秀，80-89良好，70-79中等，60-69及格，60分以下不及格。";

  function normalizeLearningMode(mode) {
    return LEARNING_MODES[mode]?.id || DEFAULT_LEARNING_MODE;
  }

  function getModeConfig(mode) {
    return LEARNING_MODES[normalizeLearningMode(mode)];
  }

  function getQuizOptions(sceneContext) {
    return (sceneContext?.options || []).map((text, index) => ({
      id: String.fromCharCode(65 + index),
      text,
    }));
  }

  function evaluateQuizSelection(sceneContext, selectedIds) {
    const quiz = sceneContext?.quiz;
    const correctIds = new Set(quiz?.correctOptionIds || []);
    const selected = new Set(selectedIds);
    const options = getQuizOptions(sceneContext);
    const selectedLabels = formatOptionList(options.filter((option) => selected.has(option.id)));
    const correctLabels = formatOptionList(options.filter((option) => correctIds.has(option.id)));
    const isCorrect = selected.size === correctIds.size
      && [...selected].every((id) => correctIds.has(id));

    return {
      isCorrect,
      text: [
        `作答结果：${isCorrect ? "回答正确" : "回答不完整或有误"}`,
        `你的选择：${selectedLabels || "未选择"}`,
        `正确答案：${correctLabels || "暂无"}`,
        `知识讲解：${quiz?.explanation || sceneContext?.correctAnswer || ""}`,
      ].join("\n"),
    };
  }

  function getOpeningText(sceneContext, mode) {
    const normalizedMode = normalizeLearningMode(mode);
    if (!sceneContext) return "请选择一个练习场景。";

    if (normalizedMode === LEARNING_MODES.quiz.id) {
      return [
        sceneContext.quiz?.prompt || sceneContext.question,
        "请选择所有正确选项后提交。",
      ].join("\n");
    }

    if (normalizedMode === LEARNING_MODES.assessment.id) {
      return [
        "AI测评模式：请以幼儿教师身份回答幼儿。",
        "系统会按100分制，从安全内容、幼儿化表达、引导流程、引导实效和职业素养进行测评。",
      ].join("\n");
    }

    return [
      `AI智能体教师：${sceneContext.title}`,
      sceneContext.question,
      "你可以咨询幼儿教育、安全教育、保育护理、家园沟通、班级管理等幼教相关问题。",
    ].join("\n");
  }

  function getChildPrompt(sceneContext, mode) {
    if (normalizeLearningMode(mode) !== LEARNING_MODES.assessment.id) {
      return "";
    }
    return sceneContext?.assessment?.childPrompt || "";
  }

  function buildOfflineExplanation(sceneContext, userText) {
    const normalizedInput = String(userText || "").trim();
    if (!sceneContext) return "当前没有可用场景。";
    if (!normalizedInput) return getOpeningText(sceneContext, LEARNING_MODES.default.id);
    if (sceneContext.isHome) {
      return [
        `你的问题：${normalizedInput}`,
        "当前云端问答不可用。AI智能体教师只回答幼教相关问题，可以围绕幼儿安全教育、保育护理、班级管理、家园沟通、活动设计或儿童发展观察继续提问。",
      ].join("\n");
    }

    return [
      `场景：${sceneContext.title}`,
      `你的问题：${normalizedInput}`,
      `讲解：${sceneContext.correctAnswer}`,
      "教师回应时要先保证安全，再安抚幼儿情绪，最后用幼儿能理解的话说明下一步做法。",
    ].join("\n");
  }

  function evaluateTeacherResponse(sceneContext, userText) {
    const text = String(userText || "").trim();
    const lowerText = text.toLowerCase();
    const assessment = sceneContext?.assessment || {};
    const rules = [
      {
        label: "安全内容准确性",
        max: 25,
        patterns: buildKeywordPatterns(sceneContext, assessment, "safety"),
      },
      {
        label: "幼儿化表达适配性",
        max: 25,
        patterns: ["别怕", "老师", "陪", "慢慢", "可以", "一起", "不要怕", "我在"],
      },
      {
        label: "引导流程完整性",
        max: 20,
        patterns: ["先", "然后", "马上", "现在", "观察", "离开", "去", "告诉"],
      },
      {
        label: "引导实效性",
        max: 20,
        patterns: buildKeywordPatterns(sceneContext, assessment, "action"),
      },
      {
        label: "职业素养",
        max: 10,
        patterns: ["不怪", "不是你的错", "保护", "安全", "告诉老师", "告诉家长", "可信"],
      },
    ];

    const scoreItems = rules.map((rule) => {
      const hitCount = rule.patterns.filter((pattern) => lowerText.includes(String(pattern).toLowerCase())).length;
      const ratio = rule.patterns.length ? Math.min(1, hitCount / Math.min(rule.patterns.length, 4)) : 0;
      const score = Math.round(rule.max * ratio);
      return { ...rule, score };
    });
    const lengthBonus = text.length >= 20 && text.length <= 160 ? 6 : text.length > 0 ? 3 : 0;
    const total = Math.min(100, scoreItems.reduce((sum, item) => sum + item.score, 0) + lengthBonus);
    const level = total >= 90 ? "优秀" : total >= 80 ? "良好" : total >= 70 ? "中等" : total >= 60 ? "及格" : "需改进";
    const missed = scoreItems
      .filter((item) => item.score < item.max * 0.55)
      .map((item) => item.label)
      .join("、");

    return [
      `总分：${total}分`,
      `等级：${level}`,
      `分项得分：${scoreItems.map((item) => `${item.label}${item.score}/${item.max}`).join("；")}`,
      `优点：${pickStrengthText(total, text)}`,
      `需要改进：${missed ? `重点补足${missed}。` : "整体回应比较完整，可以继续优化语气和步骤的清晰度。"}`,
      `测评重点：${assessment.focus || sceneContext?.question || ""}`,
      `示范回答：${assessment.idealTeacherResponse || sceneContext?.correctAnswer || ""}`,
    ].join("\n");
  }

  function buildKeywordPatterns(sceneContext, assessment, type) {
    const text = [
      sceneContext?.title,
      sceneContext?.correctAnswer,
      assessment?.focus,
      assessment?.idealTeacherResponse,
    ].filter(Boolean).join(" ");
    const common = type === "action"
      ? ["远离", "不要", "马上", "离开", "告诉", "拨打", "冷敷", "保护", "躲", "撤离"]
      : ["安全", "不要", "不能", "就医", "保护", "冷敷", "远离", "拒绝", "撤离", "呼救"];
    const extracted = common.filter((keyword) => text.includes(keyword));
    return extracted.length ? extracted : common.slice(0, 5);
  }

  function pickStrengthText(total, text) {
    if (!text) return "尚未形成有效回应。";
    if (total >= 80) return "能结合幼儿情绪和安全处置进行回应，具有较好的教师角色意识。";
    if (total >= 60) return "已经包含部分安全提醒，但步骤和幼儿化表达还需要更明确。";
    return "回应内容偏少或关键安全步骤不足，需要先说清楚立即行动。";
  }

  function formatOptionList(options) {
    return options.map((option) => `${option.id}.${option.text}`).join("；");
  }

  window.SafetyTrainingFlow = {
    LEARNING_MODES,
    DEFAULT_LEARNING_MODE,
    MODE_STORAGE_KEY,
    DEFAULT_EVALUATION_RUBRIC,
    normalizeLearningMode,
    getModeConfig,
    getQuizOptions,
    evaluateQuizSelection,
    getOpeningText,
    getChildPrompt,
    buildOfflineExplanation,
    evaluateTeacherResponse,
  };
}());
