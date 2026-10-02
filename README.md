# 基于 Coze 的学前教育安全实训平台

本项目提供面向学前教育安全培训的交互式网页、3D 场景资源和云服务代理，支持本地题库训练、语音识别、语音合成与智能问答降级流程。

## 目录

- `web/`：静态训练网页和场景资源
- `proxy/`：Coze、DashScope ASR/TTS 代理服务

## 配置

仓库只保留配置模板。运行代理前请复制 `proxy/coze_config.example.ini`，或通过环境变量设置 `COZE_TOKEN`、`COZE_BOT_ID`、`DASHSCOPE_API_KEY`。浏览器端不应直接写入真实密钥。

## 运行

先在 `proxy/` 安装 Python 依赖并启动 Flask 服务，再打开 `web/index.html`，将页面中的代理地址指向本地服务。
