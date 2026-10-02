(function () {
  const DEFAULT_RECORD_MS = 4000;
  const ASR_SAMPLE_RATE = 16000;

  function createCloudServices(config) {
    const normalizedConfig = normalizeConfig(config);
    syncProxyFromRuntimeConfig(normalizedConfig);
    window.addEventListener("safety-api-proxy-change", (event) => {
      setProxyApiBase(normalizedConfig, event.detail?.apiBase || "");
    });

    return {
      config: normalizedConfig,
      isCozeReady() {
        syncProxyFromRuntimeConfig(normalizedConfig);
        return Boolean(isProxyReady(normalizedConfig.proxy) || (normalizedConfig.coze.enabled && normalizedConfig.coze.token && normalizedConfig.coze.botId));
      },
      isDashScopeReady() {
        syncProxyFromRuntimeConfig(normalizedConfig);
        return Boolean(isProxyReady(normalizedConfig.proxy) || (normalizedConfig.dashscope.enabled && normalizedConfig.dashscope.apiKey));
      },
      async chat(payload) {
        syncProxyFromRuntimeConfig(normalizedConfig);
        return chatWithCoze(normalizedConfig.coze, payload, normalizedConfig.proxy);
      },
      async recognizeSpeech() {
        syncProxyFromRuntimeConfig(normalizedConfig);
        return recognizeSpeechWithDashScope(normalizedConfig.dashscope, normalizedConfig.proxy);
      },
      async startSpeechRecording() {
        return createBrowserAudioRecorder();
      },
      async recognizeRecordedSpeech(recording) {
        syncProxyFromRuntimeConfig(normalizedConfig);
        return recognizeRecordedSpeechWithDashScope(normalizedConfig.dashscope, normalizedConfig.proxy, recording);
      },
      async synthesizeSpeech(text, options = {}) {
        syncProxyFromRuntimeConfig(normalizedConfig);
        return synthesizeSpeechWithDashScope(normalizedConfig.dashscope, text, options, normalizedConfig.proxy);
      },
    };
  }

  function normalizeConfig(config) {
    const source = config || {};
    return {
      coze: {
        enabled: source.coze?.enabled !== false,
        token: source.coze?.token || "",
        botId: source.coze?.botId || source.coze?.bot_id || "",
        userId: source.coze?.userId || source.coze?.user_id || "standalone_user",
        baseUrl: trimTrailingSlash(source.coze?.baseUrl || "https://api.coze.cn"),
      },
      dashscope: {
        enabled: source.dashscope?.enabled !== false,
        apiKey: source.dashscope?.apiKey || source.dashscope?.api_key || "",
        asrModel: source.dashscope?.asrModel || "qwen-asr",
        ttsModel: source.dashscope?.ttsModel || "qwen-tts",
        ttsVoice: source.dashscope?.ttsVoice || "Cherry",
        childTtsVoice: source.dashscope?.childTtsVoice || "Bunny",
        baseUrl: trimTrailingSlash(source.dashscope?.baseUrl || "https://dashscope.aliyuncs.com"),
      },
      proxy: {
        enabled: source.proxy?.enabled !== false,
        apiBase: trimTrailingSlash(source.proxy?.apiBase || "http://127.0.0.1:5000/api"),
      },
    };
  }

  async function chatWithCoze(config, payload, proxyConfig) {
    if (isProxyReady(proxyConfig)) {
      return chatWithProxy(proxyConfig, payload);
    }
    if ((!config.enabled || !config.token || !config.botId) && !proxyConfig?.enabled) {
      throw new Error("Coze 配置不完整，请在 js/config.js 填 token 和 botId。");
    }

    let answer = "";
    try {
      const response = await fetch(`${config.baseUrl}/v3/chat`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bot_id: config.botId,
          user_id: config.userId,
          stream: true,
          auto_save_history: false,
          additional_messages: [
            {
              role: "user",
              content: buildCozeUserMessage(payload),
              content_type: "text",
            },
          ],
        }),
      });
      answer = await readCozeAnswer(response);
    } catch (error) {
      if (!shouldUseProxy(error, proxyConfig)) throw error;
      answer = await chatWithProxy(proxyConfig, payload);
    }

    if (!answer) {
      throw new Error("Coze 没有返回可显示的回答内容。");
    }
    return answer;
  }

  function buildCozeUserMessage(payload) {
    return [
      payload.systemPrompt ? `系统提示词：${payload.systemPrompt}` : "",
      `练习模式：${payload.mode || ""}`,
      `场景：${payload.scene?.title || ""}`,
      `地点：${payload.scene?.place || ""}`,
      payload.scene?.question ? `场景问题：${payload.scene.question}` : "",
      payload.scene?.correctAnswer ? `知识要点：${payload.scene.correctAnswer}` : "",
      payload.scene?.assessment?.childPrompt ? `幼儿提问：${payload.scene.assessment.childPrompt}` : "",
      payload.scene?.assessment?.focus ? `测评重点：${payload.scene.assessment.focus}` : "",
      payload.scene?.assessment?.idealTeacherResponse ? `参考回答：${payload.scene.assessment.idealTeacherResponse}` : "",
      payload.scene?.evaluationRubric ? `评分标准：${payload.scene.evaluationRubric}` : "",
      `用户输入：${payload.userText || ""}`,
      payload.mode === "assessment"
        ? "请输出总分、等级、分项得分、优点、需要改进和示范回答。"
        : payload.scene?.isHome
          ? "请只围绕幼教相关内容回答。若用户问题与幼教无关，请简短说明只能讨论幼教相关内容，并引导改问幼教问题。"
        : "请面向高职学前教育学生讲解，不要把用户当成幼儿。",
    ].filter(Boolean).join("\n");
  }

  async function readCozeAnswer(response) {
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Coze ${response.status}: ${detail || response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!response.body || contentType.includes("application/json")) {
      const data = await response.json();
      return extractCozeAnswer(data);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventType = "";
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith("event:")) {
          eventType = line.slice(6).trim();
          continue;
        }
        if (!line.startsWith("data:")) continue;

        const dataText = line.slice(5).trim();
        if (!dataText || dataText === "[DONE]") continue;
        const data = parseJson(dataText);
        if (!data) continue;

        if (eventType.includes("error") || data.code || data.error) {
          const message = data.msg || data.message || data.error?.message || data.error || "Coze stream error";
          throw new Error(message);
        }

        const content = extractCozeChunk(data, eventType);
        if (content) fullText += content;
      }
    }

    return cleanVisibleText(fullText);
  }

  function extractCozeAnswer(data) {
    const directContent = data?.data?.messages
      ?.filter((message) => message.type === "answer" || message.role === "assistant")
      ?.map((message) => message.content)
      ?.filter(Boolean)
      ?.join("");
    if (directContent) return cleanVisibleText(directContent);

    const output = data?.data?.output || data?.data?.answer || data?.answer || "";
    if (typeof output === "string") return cleanVisibleText(output);
    return "";
  }

  function extractCozeChunk(data, eventType) {
    if (eventType && !eventType.includes("message") && !eventType.includes("answer")) {
      return "";
    }
    if (data.type && !["answer", "message"].includes(data.type)) {
      return "";
    }
    return data.content || data.delta || data.message?.content || data.data?.content || "";
  }

  async function recognizeSpeechWithDashScope(config, proxyConfig) {
    if ((!config.enabled || !config.apiKey) && !isProxyReady(proxyConfig)) {
      throw new Error("DashScope 配置不完整，请在 js/config.js 填 apiKey。");
    }

    const recording = await recordBrowserAudio(DEFAULT_RECORD_MS);
    return recognizeRecordedSpeechWithDashScope(config, proxyConfig, recording);
  }

  async function recognizeRecordedSpeechWithDashScope(config, proxyConfig, recording) {
    if ((!config.enabled || !config.apiKey) && !isProxyReady(proxyConfig)) {
      throw new Error("DashScope 配置不完整，请在 js/config.js 填 apiKey。");
    }

    const wavBlob = recording instanceof Blob ? recording : createAsrWavBlob(recording);
    if (isProxyReady(proxyConfig)) {
      return recognizeSpeechWithProxy(proxyConfig, wavBlob);
    }
    try {
      return await recognizeSpeechDirect(config, wavBlob);
    } catch (error) {
      if (!shouldUseProxy(error, proxyConfig)) throw error;
      return recognizeSpeechWithProxy(proxyConfig, wavBlob);
    }
  }

  async function recognizeSpeechDirect(config, wavBlob) {
    const formData = new FormData();
    formData.append("model", config.asrModel);
    formData.append("response_format", "json");
    formData.append("file", wavBlob, "speech.wav");
    const response = await fetch(`${config.baseUrl}/compatible-mode/v1/audio/transcriptions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
      },
      body: formData,
    });

    const data = await readJsonResponse(response, "DashScope ASR");
    const text = data.text || data.output?.text || data.result?.text || "";
    if (!text) {
      throw new Error("ASR 没有返回识别文本。");
    }
    return text;
  }

  async function synthesizeSpeechWithDashScope(config, text, options = {}, proxyConfig) {
    if (!text) return null;
    if (isProxyReady(proxyConfig)) {
      return synthesizeSpeechWithProxy(proxyConfig, text, options);
    }
    if ((!config.enabled || !config.apiKey) && proxyConfig?.enabled) {
      return synthesizeSpeechWithProxy(proxyConfig, text, options);
    }
    if (!config.enabled || !config.apiKey) return null;

    try {
      return await synthesizeSpeechDirect(config, text, options);
    } catch (error) {
      if (!shouldUseProxy(error, proxyConfig)) throw error;
      return synthesizeSpeechWithProxy(proxyConfig, text, options);
    }
  }

  async function synthesizeSpeechDirect(config, text, options = {}) {
    const voice = options.voice || config.ttsVoice;
    const response = await fetch(`${config.baseUrl}/compatible-mode/v1/audio/speech`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.ttsModel,
        voice,
        input: normalizeSpeakText(text),
        response_format: "wav",
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`DashScope TTS ${response.status}: ${detail || response.statusText}`);
    }

    return response.blob();
  }

  async function chatWithProxy(proxyConfig, payload) {
    assertProxyReady(proxyConfig);
    const response = await fetch(`${proxyConfig.apiBase}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: buildCozeUserMessage(payload),
        system_prompt: payload.systemPrompt || "",
        scene_id: payload.scene?.id || "",
        conversation_id: "",
      }),
    });
    return readProxyAnswerStream(response);
  }

  async function readProxyAnswerStream(response) {
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Proxy chat ${response.status}: ${detail || response.statusText}`);
    }
    if (!response.body) {
      const data = await response.json();
      return data.answer || data.content || "";
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventType = "";
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith("event:")) {
          eventType = line.slice(6).trim();
          continue;
        }
        if (!line.startsWith("data:")) continue;

        const data = parseJson(line.slice(5).trim());
        if (!data) continue;
        if (eventType === "error") throw new Error(data.error || "Proxy chat error");
        if (eventType === "answer" && data.content) fullText += data.content;
      }
    }
    return cleanVisibleText(fullText);
  }

  async function recognizeSpeechWithProxy(proxyConfig, wavBlob) {
    assertProxyReady(proxyConfig);
    const formData = new FormData();
    formData.append("audio", wavBlob, "speech.wav");
    const response = await fetch(`${proxyConfig.apiBase}/asr/start`, {
      method: "POST",
      body: formData,
    });
    const data = await readJsonResponse(response, "Proxy ASR start");
    return waitForProxyAsrResult(proxyConfig, data.job_id);
  }

  async function waitForProxyAsrResult(proxyConfig, jobId) {
    for (let i = 0; i < 50; i += 1) {
      const response = await fetch(`${proxyConfig.apiBase}/asr/result/${jobId}`);
      const data = await readJsonResponse(response, "Proxy ASR result");
      if (data.status === "completed") {
        if (!data.text) throw new Error("Proxy ASR returned empty text");
        return data.text;
      }
      if (data.status === "failed") {
        throw new Error(data.error || "Proxy ASR failed");
      }
      await wait(500);
    }
    throw new Error("Proxy ASR timeout");
  }

  async function synthesizeSpeechWithProxy(proxyConfig, text, options = {}) {
    assertProxyReady(proxyConfig);
    const response = await fetch(`${proxyConfig.apiBase}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: normalizeSpeakText(text),
        voice: options.voice,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Proxy TTS ${response.status}: ${detail || response.statusText}`);
    }
    return response.blob();
  }

  function shouldUseProxy(error, proxyConfig) {
    if (!proxyConfig?.enabled || !proxyConfig.apiBase) return false;
    const message = error?.message || String(error || "");
    return message.includes("Failed to fetch")
      || message.includes("CORS")
      || message.includes("NetworkError")
      || message.includes("Load failed");
  }

  function assertProxyReady(proxyConfig) {
    if (!isProxyReady(proxyConfig)) {
      throw new Error("代理服务未配置，请在 js/config.js 设置 proxy.apiBase。");
    }
  }

  function isProxyReady(proxyConfig) {
    return Boolean(proxyConfig?.enabled && proxyConfig.apiBase);
  }

  function syncProxyFromRuntimeConfig(config) {
    const runtimeProxy = window.SAFETY_TRAINING_CLOUD_CONFIG?.proxy;
    if (!runtimeProxy) return;
    config.proxy.enabled = runtimeProxy.enabled !== false;
    config.proxy.apiBase = trimTrailingSlash(runtimeProxy.apiBase || "");
  }

  function setProxyApiBase(config, apiBase) {
    config.proxy.apiBase = trimTrailingSlash(apiBase || "");
    config.proxy.enabled = Boolean(config.proxy.apiBase);
  }

  async function recordBrowserAudio(recordMs) {
    const recorder = await createBrowserAudioRecorder();
    await wait(recordMs);
    return recorder.stop();
  }

  async function createBrowserAudioRecorder() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("浏览器麦克风不可用；双击本地 HTML 时部分浏览器可能限制录音，请改用 Chrome 或通过 http://localhost 打开。");
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("当前浏览器不支持音频采集。");
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error) {
      throw new Error(getMicrophoneErrorMessage(error));
    }

    const audioContext = new AudioContextClass();
    const chunks = [];
    let source = null;
    let processor = null;
    let isClosed = false;

    try {
      source = audioContext.createMediaStreamSource(stream);
      processor = audioContext.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(input));
        event.outputBuffer.getChannelData(0).fill(0);
      };
      source.connect(processor);
      processor.connect(audioContext.destination);
      if (audioContext.state === "suspended") await audioContext.resume();
      return {
        async stop() {
          if (isClosed) throw new Error("录音已经结束。");
          const samples = mergeFloat32Chunks(chunks);
          await closeRecorder();
          if (!samples.length) throw new Error("没有采集到麦克风音频。");
          return { samples, sampleRate: audioContext.sampleRate };
        },
        async cancel() {
          await closeRecorder();
        },
      };
    } catch (error) {
      await closeRecorder();
      throw error;
    }

    async function closeRecorder() {
      if (isClosed) return;
      isClosed = true;
      if (processor) {
        processor.onaudioprocess = null;
        processor.disconnect();
      }
      if (source) source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      await audioContext.close().catch(() => {});
    }
  }

  function createAsrWavBlob(recording) {
    const samples = resampleFloat32Samples(recording.samples, recording.sampleRate, ASR_SAMPLE_RATE);
    return encodeMonoPcmWav(samples, ASR_SAMPLE_RATE);
  }

  function mergeFloat32Chunks(chunks) {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    chunks.forEach((chunk) => {
      merged.set(chunk, offset);
      offset += chunk.length;
    });
    return merged;
  }

  function resampleFloat32Samples(samples, sourceRate, targetRate) {
    if (sourceRate === targetRate) return samples;
    const ratio = sourceRate / targetRate;
    const targetLength = Math.max(1, Math.round(samples.length / ratio));
    const result = new Float32Array(targetLength);
    for (let i = 0; i < targetLength; i += 1) {
      const sourceIndex = i * ratio;
      const leftIndex = Math.floor(sourceIndex);
      const rightIndex = Math.min(leftIndex + 1, samples.length - 1);
      const weight = sourceIndex - leftIndex;
      result[i] = samples[leftIndex] * (1 - weight) + samples[rightIndex] * weight;
    }
    return result;
  }

  function encodeMonoPcmWav(samples, sampleRate) {
    const bytesPerSample = 2;
    const dataSize = samples.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, dataSize, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
    return new Blob([view], { type: "audio/wav" });
  }

  function writeAscii(view, offset, text) {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  }

  async function readJsonResponse(response, label) {
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      if (!response.ok) throw new Error(`${label} ${response.status}: ${text || response.statusText}`);
      throw new Error(`${label} 返回了非 JSON 内容。`);
    }

    if (!response.ok) {
      const message = data.message || data.error?.message || data.error || text || response.statusText;
      throw new Error(`${label} ${response.status}: ${message}`);
    }
    return data;
  }

  function normalizeSpeakText(text) {
    return cleanVisibleText(text)
      .replace(/`{1,3}/g, "")
      .replace(/[*_#>-]+/g, "")
      .trim()
      .slice(0, 1000);
  }

  function cleanVisibleText(text) {
    return String(text || "")
      .replace(/!\[[^\]]*]\([^)]*\)/g, "")
      .replace(/\[[^\]]+]\([^)]*\)/g, "")
      .replace(/https?:\/\/\S+/g, "")
      .trim();
  }

  function parseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function getMicrophoneErrorMessage(error) {
    if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
      return "浏览器麦克风权限被拒绝，请允许网页使用麦克风。";
    }
    if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
      return "没有找到可用的麦克风设备。";
    }
    if (error?.name === "NotReadableError" || error?.name === "TrackStartError") {
      return "麦克风正在被其他程序占用，或系统不允许浏览器录音。";
    }
    return error?.message || "浏览器麦克风不可用。";
  }

  function trimTrailingSlash(value) {
    return String(value || "").replace(/\/+$/, "");
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  window.SafetyCloudServices = {
    createCloudServices,
  };
}());
