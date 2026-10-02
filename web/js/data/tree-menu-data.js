(function () {
  const EDUCATION_CONTENT = [
    {
      id: "ai-agent-teacher",
      title: "AI智能体教师",
      type: "scene",
      sceneId: "home_default",
      mode: "default",
    },
    {
      id: "natural-disaster",
      title: "自然灾害突发事件的安全教育",
      children: [
        {
          id: "earthquake",
          title: "地震的基本常识与安全教育",
          children: [
            { id: "earthquake-quiz", title: "AI练一练", type: "quiz", sceneId: "earthquake_classroom", mode: "assessment" }
          ]
        },
        {
          id: "thunderstorm",
          title: "雷电极端天气的应对与安全教育",
          children: [
            { id: "thunderstorm-quiz", title: "AI练一练", type: "quiz", sceneId: "thunderstorm_park", mode: "assessment" }
          ]
        },
        {
          id: "haze",
          title: "雾霾天气的应对与安全教育",
          children: [
            { id: "haze-scene", title: "场景模拟", type: "scene", sceneId: "haze_school_route", mode: "quiz" }
          ]
        },
        {
          id: "snow",
          title: "雪灾的预防与应对",
          children: [
            { id: "snow-scene", title: "场景模拟", type: "scene", sceneId: "snow_after_school", mode: "quiz" }
          ]
        }
      ]
    },
    {
      id: "accident-injury",
      title: "幼儿常见意外伤害的预防与护理",
      children: [
        {
          id: "scald",
          title: "烫伤",
          children: [
            { id: "scald-scene", title: "场景模拟", type: "scene", sceneId: "scald_kitchen", mode: "quiz" }
          ]
        },
        {
          id: "fall",
          title: "跌落伤",
          children: [
            { id: "fall-quiz", title: "AI练一练", type: "quiz", sceneId: "fall_home", mode: "assessment" }
          ]
        },
        {
          id: "choking",
          title: "窒息",
          children: [
            { id: "choking-quiz", title: "AI练一练", type: "quiz", sceneId: "choking_home", mode: "assessment" }
          ]
        },
        {
          id: "animal-bite",
          title: "动物伤害",
          children: [
            { id: "animal-bite-scene", title: "场景模拟", type: "scene", sceneId: "animal_bite_outdoor", mode: "quiz" }
          ]
        }
      ]
    },
    {
      id: "social-safety",
      title: "社会安全教育",
      children: [
        {
          id: "abduction",
          title: "防拐骗安全管理与教育",
          children: [
            { id: "abduction-quiz", title: "AI练一练", type: "quiz", sceneId: "anti_abduction_gate", mode: "assessment" }
          ]
        },
        {
          id: "terrorism",
          title: "恐暴事件的应对与安全教育",
          children: [
            { id: "terrorism-quiz", title: "AI练一练", type: "quiz", sceneId: "kindergarten_gate_security", mode: "assessment" }
          ]
        },
        {
          id: "teacher-ethics",
          title: "幼儿园师德事件管理",
          children: [
            { id: "teacher-ethics-scene", title: "场景模拟", type: "scene", sceneId: "classroom_teacher_ethics", mode: "quiz" }
          ]
        },
        {
          id: "sexual-assault",
          title: "性侵害的应对与安全教育（VR）",
          children: [
            { id: "sexual-assault-vr", title: "VR体验", type: "vr", dialogMessage: "VR体验功能正在建设中，暂未开放。" }
          ]
        }
      ]
    }
  ];

  const SETTINGS_SECTIONS = [
    { id: "api-proxy", title: "API代理服务器" },
    { id: "current-scene", title: "当前场景" },
    { id: "quiz-content", title: "做题内容" },
    { id: "assessment-content", title: "AI测评内容" },
    { id: "answer-bubble", title: "回答气泡" },
    { id: "child-bubble", title: "幼儿提问气泡" },
    { id: "background", title: "背景" },
    { id: "characters", title: "角色" },
  ];

  const TREE_MENU_DATA = [
    {
      id: "education-content",
      title: "教育内容",
      children: EDUCATION_CONTENT
    },
    {
      id: "settings-header",
      title: "场景设置",
      children: SETTINGS_SECTIONS.map((section) => ({
        ...section,
        sectionId: section.id,
        type: "settings-section",
      }))
    }
  ];

  function getTreeMenuItemById(itemId) {
    function search(items) {
      for (const item of items) {
        if (item.id === itemId) return item;
        if (item.children) {
          const found = search(item.children);
          if (found) return found;
        }
      }
      return null;
    }
    return search(TREE_MENU_DATA);
  }

  window.SafetyTrainingTreeMenuData = {
    TREE_MENU_DATA,
    SETTINGS_SECTIONS,
    getTreeMenuItemById,
  };
}());
