"""API proxy for the preschool safety training standalone page.

The browser sends Coze, ASR, and TTS requests to this Flask service. The
service keeps cloud keys on the server and relays the responses back to the
static training page through HTTP, SSE, and optional WebSocket endpoints.
"""

from __future__ import annotations

import base64
import configparser
import io
import json
import logging
import os
import re
import sys
import threading
import wave
from pathlib import Path
from typing import Any

from flask import Flask, Response, jsonify, request, stream_with_context
from flask_sock import Sock
from cozepy import COZE_CN_BASE_URL, ChatEventType, Coze, Message, TokenAuth

ROOT_DIR = Path(__file__).resolve().parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

ASR_IMPORT_ERROR = ""
TTS_IMPORT_ERROR = ""

try:
    from fun_asr import DEFAULT_ASR_MODEL, DEFAULT_SAMPLE_RATE, recognize_pcm_once
except Exception as exc:  # pragma: no cover - dependency may be unavailable on some machines.
    ASR_IMPORT_ERROR = str(exc)
    DEFAULT_ASR_MODEL = "fun-asr-realtime"
    DEFAULT_SAMPLE_RATE = 16000
    recognize_pcm_once = None

try:
    from qwen_realtime_tts import (
        AudioFormat,
        DEFAULT_LANGUAGE_TYPE,
        DEFAULT_MODE,
        DEFAULT_VOICE,
        MODEL_NAME,
        QwenTtsRealtime,
        QwenTtsRealtimeCallback,
        REALTIME_URL,
        SAMPLE_RATE,
        StreamingTextBuffer,
        load_dashscope_api_key,
)
except Exception as exc:  # pragma: no cover - dependency may be unavailable on some machines.
    TTS_IMPORT_ERROR = str(exc)
    AudioFormat = None
    DEFAULT_LANGUAGE_TYPE = "Chinese"
    DEFAULT_MODE = "server_commit"
    DEFAULT_VOICE = "Cherry"
    MODEL_NAME = "qwen3-tts-flash-realtime"
    QwenTtsRealtime = None
    QwenTtsRealtimeCallback = object
    REALTIME_URL = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
    SAMPLE_RATE = 24000
    StreamingTextBuffer = None
    load_dashscope_api_key = None

CONFIG_PATHS = [
    ROOT_DIR / "coze_config.ini",
    Path.home() / ".coze_config.ini",
]
DEFAULT_BOT_ID = "7526753101240631330"
DEFAULT_USER_ID = "user_xiaodie"
MAX_ASR_UPLOAD_BYTES = 5 * 1024 * 1024
SYSTEM_PROMPT = os.environ.get(
    "SYSTEM_PROMPT",
    "你是学前教育安全实训网页的智能助教。"
    "用户是高职学前教育专业学生，不是幼儿。"
    "请严格按前端传入的练习模式、场景和测评要求回答。"
    "只输出纯文本，不要输出图片、Markdown、链接或表格。",
)

app = Flask(__name__, static_folder=None)
sock = Sock(app)
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

_coze_client: Coze | None = None
_asr_jobs: dict[str, dict[str, Any]] = {}
_asr_counter = 0


def read_runtime_config() -> configparser.ConfigParser:
    """Read local demo config files without requiring them all to exist."""
    parser = configparser.ConfigParser()
    for path in CONFIG_PATHS:
        if path.exists():
            parser.read(path, encoding="utf-8")
    return parser


def get_config_value(section: str, key: str, env_name: str, default: str = "") -> str:
    """Load a single setting from env first, then config files, then a default."""
    env_value = os.environ.get(env_name)
    if env_value:
        return env_value
    config = read_runtime_config()
    return config.get(section, key, fallback=default)


def get_allowed_origins() -> set[str]:
    """Return browser origins allowed to call this standalone proxy service."""
    raw_value = get_config_value("server", "allow_origins", "ALLOW_ORIGINS", "*")
    origins = {
        origin.strip()
        for origin in raw_value.split(",")
        if origin.strip()
    }
    return origins or {"*"}


def get_coze_settings() -> tuple[str, str, str]:
    """Return Coze token, bot ID, and user ID for SDK calls."""
    token = get_config_value("coze", "token", "COZE_TOKEN")
    bot_id = get_config_value("coze", "bot_id", "COZE_BOT_ID", DEFAULT_BOT_ID)
    user_id = get_config_value("coze", "user_id", "COZE_USER_ID", DEFAULT_USER_ID)
    if not token:
        raise RuntimeError("Missing Coze token. Set COZE_TOKEN or [coze] token in coze_config.ini.")
    return token, bot_id, user_id


def get_coze_client() -> Coze:
    """Create the Coze SDK client lazily so config changes are picked up after restart."""
    global _coze_client
    if _coze_client is None:
        token, _, _ = get_coze_settings()
        _coze_client = Coze(auth=TokenAuth(token=token), base_url=COZE_CN_BASE_URL)
    return _coze_client


def is_tech_json(text: str) -> bool:
    """Detect Coze internal JSON messages that should not be shown or spoken."""
    text = text.strip()
    if not text:
        return True
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return False
    return isinstance(data, dict) and data.get("msg_type") in {
        "knowledge_recall",
        "generate_answer_finish",
    }


def clean_visible_text(text: str) -> str:
    """Remove links and Markdown image fragments before showing or speaking text."""
    text = re.sub(r"!\[[^\]]*]\([^)]*\)", "", text)
    text = re.sub(r"\[[^\]]+]\([^)]*\)", "", text)
    text = re.sub(r"https?://\S+", "", text)
    return text


def normalize_tts_text(text: str) -> str:
    """Convert assistant text into plain speakable text before cloud TTS."""
    text = clean_visible_text(text)
    text = re.sub(r"`{1,3}", "", text)
    text = re.sub(r"[*_#>-]+", "", text)
    return text.strip()


class BrowserTtsCallback(QwenTtsRealtimeCallback):
    """Collect DashScope Qwen realtime TTS chunks for browser WAV playback."""

    def __init__(self):
        super().__init__()
        self.finished = threading.Event()
        self.chunks: list[bytes] = []
        self.error = ""

    def on_event(self, message: dict) -> None:
        event_type = message.get("type")
        if event_type == "response.audio.delta":
            self.chunks.append(base64.b64decode(message["delta"]))
            return
        if event_type == "session.finished":
            self.finished.set()
            return
        if event_type == "error":
            error = message.get("error", {})
            self.error = f"{error.get('code') or 'TTS error'} - {error.get('message') or ''}".strip()
            self.finished.set()

    def wait_finished(self, timeout: float = 90) -> None:
        if not self.finished.wait(timeout=timeout):
            raise TimeoutError("TTS realtime session timed out")
        if self.error:
            raise RuntimeError(self.error)


class WebsocketTtsCallback(QwenTtsRealtimeCallback):
    """Forward DashScope Qwen realtime TTS PCM chunks to the browser WebSocket."""

    def __init__(self, ws):
        super().__init__()
        self.ws = ws
        self.finished = threading.Event()
        self.error = ""

    def on_event(self, message: dict) -> None:
        event_type = message.get("type")
        if event_type == "response.audio.delta":
            self.send_binary(base64.b64decode(message["delta"]))
            return
        if event_type == "session.finished":
            self.finished.set()
            return
        if event_type == "error":
            error = message.get("error", {})
            self.error = f"{error.get('code') or 'TTS error'} - {error.get('message') or ''}".strip()
            self.finished.set()

    def send_binary(self, data: bytes) -> None:
        try:
            self.ws.send(data)
        except Exception as exc:
            self.error = str(exc)
            self.finished.set()

    def wait_finished(self, timeout: float = 90) -> None:
        if not self.finished.wait(timeout=timeout):
            raise TimeoutError("TTS realtime session timed out")
        if self.error:
            raise RuntimeError(self.error)


def pcm_to_wav(pcm_data: bytes) -> bytes:
    """Wrap 24kHz mono 16-bit PCM data in a WAV container for browser playback."""
    output = io.BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(SAMPLE_RATE)
        wav_file.writeframes(pcm_data)
    return output.getvalue()


def extract_pcm_from_wav(wav_bytes: bytes) -> bytes:
    """Validate browser-recorded WAV audio and extract raw PCM for DashScope ASR."""
    if not wav_bytes:
        raise ValueError("audio file is empty")
    if len(wav_bytes) > MAX_ASR_UPLOAD_BYTES:
        raise ValueError("audio file is too large")

    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as wav_file:
            channels = wav_file.getnchannels()
            sample_width = wav_file.getsampwidth()
            sample_rate = wav_file.getframerate()
            if channels != 1 or sample_width != 2 or sample_rate != DEFAULT_SAMPLE_RATE:
                raise ValueError("audio must be 16kHz mono 16-bit WAV")
            return wav_file.readframes(wav_file.getnframes())
    except (wave.Error, EOFError) as exc:
        raise ValueError("audio must be a valid WAV file") from exc


def synthesize_tts_wav(text: str, body: dict[str, Any]) -> bytes:
    """Use the same Qwen realtime cloud TTS path as the voice demo and return WAV."""
    if QwenTtsRealtime is None or AudioFormat is None or StreamingTextBuffer is None or load_dashscope_api_key is None:
        raise RuntimeError("TTS dependencies are not available")

    api_key = load_dashscope_api_key(CONFIG_PATHS)
    import dashscope

    dashscope.api_key = api_key
    callback = BrowserTtsCallback()
    client = QwenTtsRealtime(
        model=MODEL_NAME,
        callback=callback,
        url=REALTIME_URL,
    )

    try:
        client.connect()
        mode = body.get("mode") or DEFAULT_MODE
        client.update_session(
            voice=body.get("voice") or DEFAULT_VOICE,
            response_format=AudioFormat.PCM_24000HZ_MONO_16BIT,
            mode=mode,
            language_type=body.get("language_type") or DEFAULT_LANGUAGE_TYPE,
        )

        buffer = StreamingTextBuffer()
        for chunk in [*buffer.feed(text), *buffer.flush()]:
            client.append_text(chunk)
            if mode == "commit":
                client.commit()

        client.finish()
        callback.wait_finished()
    finally:
        try:
            client.close()
        except Exception:
            pass

    pcm_data = b"".join(callback.chunks)
    if not pcm_data:
        raise RuntimeError("TTS returned empty audio")
    return pcm_to_wav(pcm_data)


def send_ws_json(ws, payload: dict[str, Any]) -> None:
    """Send one small JSON control message over the browser WebSocket."""
    ws.send(json.dumps(payload, ensure_ascii=False))


def stream_tts_to_websocket(text: str, body: dict[str, Any], ws) -> None:
    """Relay Qwen realtime cloud TTS PCM chunks to the frontend WebSocket."""
    if QwenTtsRealtime is None or AudioFormat is None or StreamingTextBuffer is None or load_dashscope_api_key is None:
        raise RuntimeError("TTS dependencies are not available")

    api_key = load_dashscope_api_key(CONFIG_PATHS)
    import dashscope

    dashscope.api_key = api_key
    callback = WebsocketTtsCallback(ws)
    client = QwenTtsRealtime(
        model=MODEL_NAME,
        callback=callback,
        url=REALTIME_URL,
    )

    try:
        client.connect()
        mode = body.get("mode") or DEFAULT_MODE
        voice = body.get("voice") or DEFAULT_VOICE
        language_type = body.get("language_type") or DEFAULT_LANGUAGE_TYPE
        client.update_session(
            voice=voice,
            response_format=AudioFormat.PCM_24000HZ_MONO_16BIT,
            mode=mode,
            language_type=language_type,
        )
        send_ws_json(ws, {
            "type": "meta",
            "format": "pcm_s16le",
            "sample_rate": SAMPLE_RATE,
            "channels": 1,
            "voice": voice,
        })

        buffer = StreamingTextBuffer()
        for chunk in [*buffer.feed(text), *buffer.flush()]:
            client.append_text(chunk)
            if mode == "commit":
                client.commit()

        client.finish()
        callback.wait_finished()
        send_ws_json(ws, {"type": "done"})
    finally:
        try:
            client.close()
        except Exception:
            pass


def format_sse(event: str, data: dict[str, Any]) -> bytes:
    """Build one UTF-8 Server-Sent Events frame."""
    return f"event:{event}\ndata:{json.dumps(data, ensure_ascii=False)}\n\n".encode("utf-8")


@app.after_request
def add_cors_headers(response):
    """Allow configured static pages and local file demos to call the API."""
    origin = request.headers.get("Origin", "")
    allowed_origins = get_allowed_origins()
    if "*" in allowed_origins:
        response.headers["Access-Control-Allow-Origin"] = "*" if not origin else origin
        response.headers["Vary"] = "Origin"
    elif origin and origin in allowed_origins:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
    elif not origin:
        response.headers["Access-Control-Allow-Origin"] = "*"

    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    return response


@app.route("/")
def service_index():
    return jsonify({
        "ok": True,
        "name": "safety-training-api-proxy",
        "health": "/api/health",
        "chat": "/api/chat",
        "asr": "/api/asr/start",
        "tts": "/api/tts",
    })


@app.route("/api/chat", methods=["POST", "OPTIONS"])
def chat():
    """Stream Coze answers to the browser as compact SSE frames."""
    if request.method == "OPTIONS":
        return ("", 204)

    body = request.get_json(force=True, silent=True) or {}
    message = (body.get("message") or "").strip()
    scene_system_prompt = (body.get("system_prompt") or "").strip()
    conversation_id = body.get("conversation_id") or ""
    if not message:
        return jsonify({"error": "message is required"}), 400
    if len(message) > 2000:
        return jsonify({"error": "message too long (max 2000 chars)"}), 400
    if len(scene_system_prompt) > 3000:
        return jsonify({"error": "system_prompt too long (max 3000 chars)"}), 400

    prompts = [prompt for prompt in (SYSTEM_PROMPT, scene_system_prompt) if prompt]
    augmented_message = "\n\n".join([*prompts, message]) if prompts else message

    def generate():
        try:
            _, bot_id, user_id = get_coze_settings()
            kwargs: dict[str, Any] = {
                "bot_id": bot_id,
                "user_id": user_id,
                "additional_messages": [Message.build_user_question_text(augmented_message)],
            }
            if conversation_id:
                kwargs["conversation_id"] = conversation_id

            full_reply = ""
            new_conversation_id = None
            json_buffer = ""

            for event in get_coze_client().chat.stream(**kwargs):
                if event.event == ChatEventType.CONVERSATION_CHAT_CREATED:
                    new_conversation_id = event.chat.conversation_id
                    yield format_sse("start", {"conversation_id": new_conversation_id or ""})
                    continue

                if event.event == ChatEventType.CONVERSATION_MESSAGE_DELTA:
                    chunk = event.message.content or ""
                    if not chunk:
                        continue

                    if chunk.strip().startswith("{"):
                        json_buffer += chunk
                        continue

                    if json_buffer:
                        if not is_tech_json(json_buffer):
                            full_reply += json_buffer
                        json_buffer = ""

                    full_reply += chunk
                    continue

                if event.event == ChatEventType.CONVERSATION_CHAT_COMPLETED:
                    if json_buffer and not is_tech_json(json_buffer):
                        full_reply += json_buffer

                    conversation = new_conversation_id or conversation_id or ""
                    cleaned_reply = clean_visible_text(full_reply).strip()
                    if cleaned_reply:
                        yield format_sse("answer", {"content": cleaned_reply})
                        yield format_sse("completed", {"conversation_id": conversation})
                        yield format_sse("done", {"conversation_id": conversation})
                    else:
                        yield format_sse("error", {"error": "Coze returned empty answer"})
                    return

            if full_reply.strip():
                cleaned_reply = clean_visible_text(full_reply).strip()
                if cleaned_reply:
                    yield format_sse("answer", {"content": cleaned_reply})
                    yield format_sse("done", {"conversation_id": new_conversation_id or conversation_id or ""})
                else:
                    yield format_sse("error", {"error": "Coze returned empty answer"})
            else:
                yield format_sse("error", {"error": "Coze returned empty answer"})
        except Exception as exc:
            log.exception("coze stream failed")
            yield format_sse("error", {"error": str(exc)})

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.route("/api/new", methods=["POST", "OPTIONS"])
def new_conversation():
    if request.method == "OPTIONS":
        return ("", 204)
    return jsonify({"ok": True, "message": "Conversation reset."})


@app.route("/api/asr/start", methods=["POST", "OPTIONS"])
def asr_start():
    """Start one DashScope ASR job from browser-uploaded WAV audio."""
    if request.method == "OPTIONS":
        return ("", 204)
    if recognize_pcm_once is None or load_dashscope_api_key is None:
        return jsonify({
            "error": "ASR dependencies are not available",
            "detail": ASR_IMPORT_ERROR or TTS_IMPORT_ERROR or "unknown import error",
        }), 500

    if request.content_length and request.content_length > MAX_ASR_UPLOAD_BYTES:
        return jsonify({"error": "audio file is too large"}), 413

    audio_file = request.files.get("audio")
    if audio_file is None:
        return jsonify({"error": "audio file is required"}), 400

    model = request.form.get("model") or DEFAULT_ASR_MODEL
    try:
        pcm_data = extract_pcm_from_wav(audio_file.read())
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    global _asr_counter
    _asr_counter += 1
    job_id = str(_asr_counter)
    job: dict[str, Any] = {"status": "running", "text": "", "error": ""}
    _asr_jobs[job_id] = job

    def worker():
        try:
            api_key = load_dashscope_api_key(CONFIG_PATHS)
            job["text"] = recognize_pcm_once(
                api_key=api_key,
                pcm_data=pcm_data,
                model=model,
                sample_rate=DEFAULT_SAMPLE_RATE,
                verbose=False,
            )
            job["status"] = "completed"
        except Exception as exc:
            job["error"] = str(exc)
            job["status"] = "failed"

    threading.Thread(target=worker, daemon=True).start()
    return jsonify({"job_id": job_id, "status": "running"})


@app.route("/api/asr/result/<job_id>")
def asr_result(job_id: str):
    job = _asr_jobs.get(job_id)
    if not job:
        return jsonify({"error": "ASR job not found"}), 404
    return jsonify(job)


@app.route("/api/tts", methods=["POST", "OPTIONS"])
def tts():
    """Return one assistant answer as WAV audio for browser playback."""
    if request.method == "OPTIONS":
        return ("", 204)
    if QwenTtsRealtime is None or AudioFormat is None or StreamingTextBuffer is None or load_dashscope_api_key is None:
        return jsonify({"error": "TTS dependencies are not available"}), 500

    body = request.get_json(force=True, silent=True) or {}
    text = normalize_tts_text(body.get("text") or "")
    if not text:
        return jsonify({"error": "text is required"}), 400
    if len(text) > 1000:
        return jsonify({"error": "text too long (max 1000 chars)"}), 400

    try:
        audio_bytes = synthesize_tts_wav(text, body)
    except Exception as exc:
        log.exception("tts synthesis failed")
        return jsonify({"error": str(exc)}), 500

    return Response(
        audio_bytes,
        mimetype="audio/wav",
        headers={"Cache-Control": "no-store"},
    )


@sock.route("/api/tts/ws")
def tts_ws(ws):
    """Relay one cloud TTS request to the browser as streaming PCM over WebSocket."""
    try:
        raw_message = ws.receive()
        body = json.loads(raw_message or "{}")
        text = normalize_tts_text(body.get("text") or "")
        if not text:
            send_ws_json(ws, {"type": "error", "error": "text is required"})
            return
        if len(text) > 1000:
            send_ws_json(ws, {"type": "error", "error": "text too long (max 1000 chars)"})
            return

        stream_tts_to_websocket(text, body, ws)
    except Exception as exc:
        log.exception("tts websocket relay failed")
        try:
            send_ws_json(ws, {"type": "error", "error": str(exc)})
        except Exception:
            pass


@app.route("/api/health")
def health():
    token, bot_id, user_id = ("", "", "")
    try:
        token, bot_id, user_id = get_coze_settings()
    except Exception:
        pass
    return jsonify({
        "ok": True,
        "status": "running",
        "coze_configured": bool(token),
        "bot_id": bot_id,
        "user_id": user_id,
        "asr_available": recognize_pcm_once is not None and load_dashscope_api_key is not None,
        "tts_available": QwenTtsRealtime is not None and AudioFormat is not None and load_dashscope_api_key is not None,
        "asr_error": ASR_IMPORT_ERROR,
        "tts_error": TTS_IMPORT_ERROR,
        "asr_provider": "DashScope Fun-ASR realtime cloud",
        "tts_provider": "DashScope Qwen realtime cloud TTS",
    })


if __name__ == "__main__":
    host = os.environ.get("HOST", get_config_value("server", "host", "HOST", "0.0.0.0"))
    port = int(os.environ.get("PORT", 5000))
    app.run(host=host, port=port, threaded=True, debug=False)
