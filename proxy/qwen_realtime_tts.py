# -*- coding: utf-8 -*-
"""Reusable Qwen-TTS realtime playback helpers for local chat clients."""

from __future__ import annotations

import base64
import configparser
import importlib
import os
import queue
import sys
import threading
from pathlib import Path

import dashscope
from dashscope.audio.qwen_tts_realtime import (
    AudioFormat,
    QwenTtsRealtime,
    QwenTtsRealtimeCallback,
)


MODEL_NAME = "qwen3-tts-flash-realtime"
REALTIME_URL = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
DEFAULT_VOICE = "Cherry"
DEFAULT_LANGUAGE_TYPE = "Chinese"
DEFAULT_MODE = "server_commit"
SAMPLE_RATE = 24000
CHANNELS = 1
STOP_SIGNAL = None
SENTENCE_SEPARATORS = "，。！？；,.!?;\n"


def configure_console() -> None:
    """Configure Windows terminals to print Chinese logs without GBK errors."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass


def load_dashscope_api_key(config_paths: list[Path] | None = None) -> str:
    """Load the DashScope API key from env, config files, or the old demo script."""
    api_key = os.getenv("DASHSCOPE_API_KEY")
    if api_key:
        return api_key

    parser = configparser.ConfigParser()
    for path in config_paths or []:
        if path.exists():
            parser.read(path, encoding="utf-8")

    for section in ("dashscope", "bailian", "aliyun"):
        if parser.has_section(section):
            api_key = parser.get(section, "api_key", fallback="")
            if api_key:
                return api_key

    legacy_key = _load_legacy_demo_api_key()
    if legacy_key:
        return legacy_key

    raise RuntimeError(
        "Missing DashScope API key. Set DASHSCOPE_API_KEY or add "
        "[dashscope] api_key = xxx to coze_config.ini."
    )


def _load_legacy_demo_api_key() -> str | None:
    """Reuse the existing realtime_play_tts.py key loader when it is available."""
    try:
        module = importlib.import_module("realtime_play_tts")
        loader = getattr(module, "load_api_key", None)
        if callable(loader):
            return loader()
    except Exception:
        return None
    return None


class PcmStreamPlayer:
    """Queue streamed PCM chunks and play them on a background audio thread."""

    def __init__(self, sample_rate: int = SAMPLE_RATE, channels: int = CHANNELS):
        import pyaudio

        self._pyaudio = pyaudio
        self.audio = self._pyaudio.PyAudio()
        self.stream = self.audio.open(
            format=self._pyaudio.paInt16,
            channels=channels,
            rate=sample_rate,
            output=True,
        )
        self.chunks: queue.Queue[bytes | None] = queue.Queue()
        self.thread = threading.Thread(target=self._play_loop, daemon=True)
        self.thread.start()

    def write(self, pcm_data: bytes) -> None:
        """Queue one PCM chunk received from the realtime API."""
        if pcm_data:
            self.chunks.put(pcm_data)

    def _play_loop(self) -> None:
        """Drain queued PCM bytes into the active audio output device."""
        while True:
            pcm_data = self.chunks.get()
            if pcm_data is STOP_SIGNAL:
                break
            self.stream.write(pcm_data)

    def close(self) -> None:
        """Release PortAudio resources after all queued chunks are played."""
        self.chunks.put(STOP_SIGNAL)
        self.thread.join()
        self.stream.stop_stream()
        self.stream.close()
        self.audio.terminate()


class RealtimePlaybackCallback(QwenTtsRealtimeCallback):
    """Forward Qwen-TTS audio delta events into a PCM player."""

    def __init__(
        self,
        player: PcmStreamPlayer,
        save_pcm_path: Path | None = None,
        verbose: bool = False,
    ):
        super().__init__()
        self.player = player
        self.save_pcm_path = save_pcm_path
        self.verbose = verbose
        self.finished = threading.Event()
        self.pcm_file = None

        if self.save_pcm_path is not None:
            self.save_pcm_path.parent.mkdir(parents=True, exist_ok=True)
            self.pcm_file = self.save_pcm_path.open("wb")

    def on_open(self) -> None:
        if self.verbose:
            print("TTS realtime connection opened", file=sys.stderr)

    def on_close(self, close_status_code, close_msg) -> None:
        if self.pcm_file is not None:
            self.pcm_file.close()
            self.pcm_file = None
        if self.verbose:
            print(
                f"TTS realtime connection closed: {close_status_code}, {close_msg}",
                file=sys.stderr,
            )

    def on_event(self, message: dict) -> None:
        event_type = message.get("type")

        if event_type == "response.audio.delta":
            pcm_data = base64.b64decode(message["delta"])
            if self.pcm_file is not None:
                self.pcm_file.write(pcm_data)
            self.player.write(pcm_data)
            return

        if event_type == "session.finished":
            self.finished.set()
            return

        if event_type == "error":
            error = message.get("error", {})
            print(
                f"TTS error: {error.get('code')} - {error.get('message')}",
                file=sys.stderr,
            )
            self.finished.set()
            return

        if self.verbose and event_type in {"session.created", "session.updated", "response.done"}:
            print(f"TTS event: {event_type}", file=sys.stderr)

    def wait_finished(self, timeout: float = 300) -> None:
        """Wait until the realtime session reports completion."""
        if not self.finished.wait(timeout=timeout):
            raise TimeoutError("TTS realtime session did not finish before timeout")


class StreamingTextBuffer:
    """Split streamed assistant text into speakable sentence-sized chunks."""

    def __init__(self, max_chars: int = 48):
        self.max_chars = max_chars
        self.buffer = ""

    def feed(self, text: str) -> list[str]:
        """Append streamed text and return chunks ready for TTS playback."""
        self.buffer += text
        chunks: list[str] = []

        while True:
            split_index = self._find_sentence_end()
            if split_index is None:
                break
            chunks.append(self.buffer[:split_index].strip())
            self.buffer = self.buffer[split_index:]

        if len(self.buffer) >= self.max_chars:
            chunks.append(self.buffer.strip())
            self.buffer = ""

        return [chunk for chunk in chunks if chunk]

    def flush(self) -> list[str]:
        """Return the remaining text when the assistant response is complete."""
        tail = self.buffer.strip()
        self.buffer = ""
        return [tail] if tail else []

    def _find_sentence_end(self) -> int | None:
        """Find the first sentence boundary in the buffered text."""
        indexes = [
            self.buffer.find(separator) + 1
            for separator in SENTENCE_SEPARATORS
            if separator in self.buffer
        ]
        if not indexes:
            return None
        return min(index for index in indexes if index > 0)


class QwenRealtimeTtsPlayer:
    """Manage one Qwen-TTS realtime session for streamed text playback."""

    def __init__(
        self,
        api_key: str,
        voice: str = DEFAULT_VOICE,
        language_type: str = DEFAULT_LANGUAGE_TYPE,
        mode: str = DEFAULT_MODE,
        save_pcm_path: Path | None = None,
        verbose: bool = False,
    ):
        self.api_key = api_key
        self.voice = voice
        self.language_type = language_type
        self.mode = mode
        self.save_pcm_path = save_pcm_path
        self.verbose = verbose
        self.player: PcmStreamPlayer | None = None
        self.callback: RealtimePlaybackCallback | None = None
        self.client: QwenTtsRealtime | None = None
        self.started = False
        self.finished = False

    def start(self) -> None:
        """Open WebSocket and configure a realtime TTS session."""
        if self.started:
            return

        dashscope.api_key = self.api_key
        self.player = PcmStreamPlayer()
        self.callback = RealtimePlaybackCallback(
            player=self.player,
            save_pcm_path=self.save_pcm_path,
            verbose=self.verbose,
        )
        self.client = QwenTtsRealtime(
            model=MODEL_NAME,
            callback=self.callback,
            url=REALTIME_URL,
        )
        self.client.connect()
        self.client.update_session(
            voice=self.voice,
            response_format=AudioFormat.PCM_24000HZ_MONO_16BIT,
            mode=self.mode,
            language_type=self.language_type,
        )
        self.started = True

    def append_text(self, text: str) -> None:
        """Send one text chunk into the active realtime synthesis session."""
        if not text.strip():
            return
        self.start()
        assert self.client is not None
        self.client.append_text(text)
        if self.mode == "commit":
            self.client.commit()

    def finish(self, wait: bool = True) -> None:
        """Finish text input and optionally wait until all audio is received."""
        if not self.started or self.finished:
            return
        assert self.client is not None
        self.client.finish()
        self.finished = True
        if wait and self.callback is not None:
            self.callback.wait_finished()

    def cancel(self) -> None:
        """Cancel the current response when the caller stops playback early."""
        if self.client is not None:
            try:
                self.client.cancel_response()
            except Exception:
                pass

    def close(self) -> None:
        """Close WebSocket and release the local audio device."""
        if self.client is not None:
            try:
                self.client.close()
            except Exception:
                pass
            self.client = None
        if self.player is not None:
            self.player.close()
            self.player = None
