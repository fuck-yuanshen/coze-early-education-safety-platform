window.SAFETY_TRAINING_CLOUD_CONFIG = {
  // 这个文件用于单机版直接调用云服务。发给别人时，里面的 key 会随文件一起暴露。
  coze: {
    enabled: false,
    token: "",
    botId: "",
    userId: "user_xiaodie",
    baseUrl: "https://api.coze.cn",
  },
  dashscope: {
    enabled: false,
    apiKey: "",
    asrModel: "qwen-asr",
    ttsModel: "qwen-tts",
    ttsVoice: "Cherry",
    childTtsVoice: "Bunny",
    baseUrl: "https://dashscope.aliyuncs.com",
  },
  proxy: {
    enabled: true,
    apiBase: "http://127.0.0.1:5000/api",
  },
};

