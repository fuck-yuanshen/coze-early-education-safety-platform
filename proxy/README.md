# 安全实训 API 代理服务器

这个目录是给 `coze-standalone` 单机网页使用的服务端中转。网页仍然可以双击 `index.html` 打开，但 Coze 问答、DashScope ASR、DashScope TTS 统一发到这个代理服务，避免浏览器直连云接口时遇到 CORS 或网络限制。

## 接口

- `GET /api/health`：检查 Coze、ASR、TTS 是否配置可用。
- `POST /api/chat`：转发 Coze 问答，返回 SSE 文本流。
- `POST /api/asr/start`：接收浏览器录音 WAV，启动 DashScope ASR。
- `GET /api/asr/result/<job_id>`：轮询 ASR 识别结果。
- `POST /api/tts`：接收文本，返回 DashScope 云 TTS 生成的 WAV。
- `WS /api/tts/ws`：可选的流式 TTS WebSocket 中转。

## Windows 服务器运行

```powershell
cd D:\coze_web\api-proxy-server
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

默认监听 `0.0.0.0:5000`。如果 Windows 防火墙拦截，需要放行 TCP 5000。

## Linux 服务器运行

```bash
cd /opt/coze_web/api-proxy-server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

## 配置密钥

复制示例配置：

```bash
cp coze_config.example.ini coze_config.ini
```

编辑 `coze_config.ini`：

```ini
[coze]
token = your_coze_pat_token
bot_id = your_coze_bot_id
user_id = user_xiaodie

[dashscope]
api_key = your_dashscope_api_key

[server]
host = 0.0.0.0
allow_origins = *
```

`allow_origins = *` 方便单机 HTML、局域网和公网页面调用。正式部署如果要收紧，可以写成：

```ini
allow_origins = https://your-domain.com,http://127.0.0.1:8099
```

## 前端填写方式

打开 `coze-standalone/index.html`，进入左上角 `菜单 -> 场景设置 -> API代理服务器`。

本机测试填写：

```text
http://127.0.0.1:5000/api
```

服务器 IP 访问填写：

```text
http://服务器IP:5000/api
```

有 HTTPS 域名和 Nginx 反代时填写：

```text
https://your-domain.com/api
```

填写后点击 `测试代理`，如果显示 Coze、TTS、ASR 可用，网页的问答、语音识别和语音播报都会走这个代理。

## Nginx 反向代理示例

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    location /api/ {
        proxy_pass http://127.0.0.1:5000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }

    location /api/tts/ws {
        proxy_pass http://127.0.0.1:5000/api/tts/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;
    }
}
```

网页如果通过公网 HTTPS 打开，浏览器才会稳定允许麦克风录音；`localhost` 和 `127.0.0.1` 是浏览器例外，也允许录音。
