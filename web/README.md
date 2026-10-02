# 学前教育安全实训单机版

## 打开方式

双击 `index.html` 进入页面。

这个版本是多文件结构，主要文件：

- `index.html`：页面入口。
- `js/config.js`：云服务 key 和模型配置。
- `js/data/scene-presets.js`：场景、题目、幼儿问题、评分标准预设。
- `js/core/cloud-services.js`：Coze、DashScope ASR、DashScope TTS 请求逻辑。
- `js/core/offline-assistant.js`：页面交互、模式切换、题目判分、测评弹窗。
- `js/core/scene-settings.js`：背景、人物、气泡和题库设置。
- `js/core/scene-renderer.js`：3D 老师和小女孩渲染。
- `css/styles.css`：界面样式。

## 配置 key

打开 `js/config.js`，填写：

```js
window.SAFETY_TRAINING_CLOUD_CONFIG = {
  coze: {
    enabled: true,
    token: "你的 Coze token",
    botId: "你的 bot_id",
    userId: "standalone_user",
    baseUrl: "https://api.coze.cn",
  },
  dashscope: {
    enabled: true,
    apiKey: "你的 DashScope API Key",
    asrModel: "qwen-asr",
    ttsModel: "qwen-tts",
    ttsVoice: "Cherry",
    childTtsVoice: "Bunny",
    baseUrl: "https://dashscope.aliyuncs.com",
  },
};
```

## 云功能说明

- 默认模式：用户输入或语音识别后，优先调用 Coze API 回答，再调用 DashScope 云 TTS 播报。
- 做题模式：本地根据预设正确答案判分，讲解内容优先调用 DashScope 云 TTS 播报。
- AI测评模式：幼儿问题优先用 `Bunny` 播报，用户以教师身份回答后，优先调用 Coze 测评并在弹窗显示结果。
- 如果 Coze 调用失败，会降级为本地预设讲解或本地评分。
- 如果 DashScope TTS 调用失败，会降级为浏览器内置朗读。

## 推荐：使用 API 代理服务器

浏览器直连 Coze、DashScope 经常会被 CORS 或网络策略拦截。推荐启动 `../api-proxy-server`，然后在页面左上角 `菜单 -> 场景设置 -> API代理服务器` 填写：

```text
http://127.0.0.1:5000/api
```

部署到云服务器后填写：

```text
http://服务器IP:5000/api
```

如果做了 HTTPS 域名反代，填写：

```text
https://your-domain.com/api
```

点击 `测试代理`，显示 Coze、TTS、ASR 可用后，网页的问答、云 ASR 和云 TTS 都会通过服务器中转。

## 重要限制

key 写在 JS 里会被使用者直接看到，适合本地演示，不适合公开发布。

双击 HTML 属于 `file://` 页面，浏览器直连 Coze 或 DashScope 时可能遇到 CORS、网络策略或麦克风权限限制。出现 `Failed to fetch` 时，通常不是代码没发请求，而是浏览器或云接口不允许前端直接跨域调用。稳定部署时建议继续使用服务器中转版。
