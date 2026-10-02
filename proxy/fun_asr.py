# -*- coding: utf-8 -*-
"""Speech recognition helpers backed by DashScope Fun-ASR."""

from __future__ import annotations

import argparse
import sys
import threading
import time
from pathlib import Path

import dashscope
from dashscope.audio.asr import Recognition, RecognitionCallback, RecognitionResult


DEFAULT_ASR_MODEL = "fun-asr-realtime"
DEFAULT_SAMPLE_RATE = 16000
DEFAULT_CHANNELS = 1
DEFAULT_CHUNK_FRAMES = 3200
DEFAULT_AUDIO_FORMAT = "pcm"


def configure_console() -> None:
    """Configure Windows terminals to print Chinese logs without GBK errors."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass


class FunAsrCallback(RecognitionCallback):
    """Collect final and intermediate recognition text from Fun-ASR callbacks."""

    def __init__(self, verbose: bool = False):
        super().__init__()
        self.verbose = verbose
        self.final_sentences: list[str] = []
        self.latest_text = ""
        self.error: str | None = None
        self.completed = threading.Event()

    def on_open(self) -> None:
        if self.verbose:
            print("ASR connection opened", file=sys.stderr)

    def on_complete(self) -> None:
        if self.verbose:
            print("ASR recognition completed", file=sys.stderr)
        self.completed.set()

    def on_error(self, result: RecognitionResult) -> None:
        self.error = getattr(result, "message", None) or str(result)
        print(f"ASR error: {self.error}", file=sys.stderr)
        self.completed.set()

    def on_close(self) -> None:
        if self.verbose:
            print("ASR connection closed", file=sys.stderr)

    def on_event(self, result: RecognitionResult) -> None:
        sentence = result.get_sentence()
        if not isinstance(sentence, dict):
            return

        text = sentence.get("text") or ""
        if not text:
            return

        self.latest_text = text
        if RecognitionResult.is_sentence_end(sentence):
            self.final_sentences.append(text)
            if self.verbose:
                print(f"ASR final: {text}", file=sys.stderr)
        elif self.verbose:
            print(f"ASR partial: {text}", file=sys.stderr)

    def get_text(self) -> str:
        """Return final recognition text, falling back to the latest partial text."""
        text = "".join(self.final_sentences).strip()
        if text:
            return text
        return self.latest_text.strip()


def recognize_microphone_once(
    api_key: str,
    model: str = DEFAULT_ASR_MODEL,
    sample_rate: int = DEFAULT_SAMPLE_RATE,
    chunk_frames: int = DEFAULT_CHUNK_FRAMES,
    record_seconds: float | None = None,
    verbose: bool = False,
) -> str:
    """Record microphone audio and return one Fun-ASR transcription result."""
    import pyaudio

    configure_console()
    dashscope.api_key = api_key

    callback = FunAsrCallback(verbose=verbose)
    recognizer = Recognition(
        model=model,
        format=DEFAULT_AUDIO_FORMAT,
        sample_rate=sample_rate,
        callback=callback,
    )

    mic = pyaudio.PyAudio()
    stream = None
    stop_recording = threading.Event()
    worker_error: list[Exception] = []

    def send_microphone_audio() -> None:
        while not stop_recording.is_set():
            try:
                audio_frame = stream.read(chunk_frames, exception_on_overflow=False)
                recognizer.send_audio_frame(audio_frame)
            except Exception as exc:
                worker_error.append(exc)
                stop_recording.set()
                break

    try:
        recognizer.start()
        stream = mic.open(
            format=pyaudio.paInt16,
            channels=DEFAULT_CHANNELS,
            rate=sample_rate,
            input=True,
            frames_per_buffer=chunk_frames,
        )

        print("开始录音，请说话。", flush=True)
        worker = threading.Thread(target=send_microphone_audio, daemon=True)
        worker.start()

        if record_seconds is None:
            input("说完后按 Enter 结束录音...")
        else:
            deadline = time.time() + record_seconds
            while time.time() < deadline and not stop_recording.is_set():
                time.sleep(0.05)

        stop_recording.set()
        worker.join(timeout=2)

        if worker_error:
            raise worker_error[0]

        recognizer.stop()
        if callback.error:
            raise RuntimeError(callback.error)

        text = callback.get_text()
        if not text:
            raise RuntimeError("ASR returned empty text")
        return text
    finally:
        stop_recording.set()
        if stream is not None:
            try:
                stream.stop_stream()
                stream.close()
            except Exception:
                pass
        mic.terminate()


def recognize_pcm_once(
    api_key: str,
    pcm_data: bytes,
    model: str = DEFAULT_ASR_MODEL,
    sample_rate: int = DEFAULT_SAMPLE_RATE,
    chunk_frames: int = DEFAULT_CHUNK_FRAMES,
    verbose: bool = False,
) -> str:
    """Send one 16-bit mono PCM buffer to Fun-ASR and return the transcription."""
    if not pcm_data:
        raise RuntimeError("ASR audio is empty")

    configure_console()
    dashscope.api_key = api_key

    callback = FunAsrCallback(verbose=verbose)
    recognizer = Recognition(
        model=model,
        format=DEFAULT_AUDIO_FORMAT,
        sample_rate=sample_rate,
        callback=callback,
    )

    bytes_per_frame = 2
    chunk_size = max(1, int(chunk_frames)) * bytes_per_frame

    try:
        recognizer.start()
        for offset in range(0, len(pcm_data), chunk_size):
            recognizer.send_audio_frame(pcm_data[offset:offset + chunk_size])
            time.sleep(0.01)

        recognizer.stop()
        if callback.error:
            raise RuntimeError(callback.error)

        text = callback.get_text()
        if not text:
            raise RuntimeError("ASR returned empty text")
        return text
    finally:
        try:
            recognizer.stop()
        except Exception:
            pass


def parse_args() -> argparse.Namespace:
    """Parse command-line options for standalone ASR testing."""
    parser = argparse.ArgumentParser(description="Recognize microphone speech with Fun-ASR.")
    parser.add_argument("--model", default=DEFAULT_ASR_MODEL, help="Fun-ASR model name.")
    parser.add_argument(
        "--seconds",
        type=float,
        default=None,
        help="Record this many seconds. Default waits for Enter.",
    )
    parser.add_argument("--verbose", action="store_true", help="Print ASR events.")
    return parser.parse_args()


def main() -> int:
    """Run a standalone microphone recognition test."""
    from qwen_realtime_tts import load_dashscope_api_key

    configure_console()
    args = parse_args()
    config_paths = [
        Path.cwd() / "coze_config.ini",
        Path.cwd() / "coze" / "coze_config.ini",
        Path.home() / ".coze_config.ini",
    ]
    text = recognize_microphone_once(
        api_key=load_dashscope_api_key(config_paths),
        model=args.model,
        record_seconds=args.seconds,
        verbose=args.verbose,
    )
    print(f"识别结果: {text}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        configure_console()
        print(f"Run failed: {exc}")
        raise SystemExit(1)
