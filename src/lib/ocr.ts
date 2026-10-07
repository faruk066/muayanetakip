import * as Tesseract from "tesseract.js";

export type OcrResult = { digits: string; confidence: number };
export type OcrProgress = (status: string, progress: number) => void;

export type OcrModel = "auto" | "dots-ocr" | "deepseek-ocr-2" | "nvidia" | "local";
export type OcrEngine = "dots-ocr" | "deepseek-ocr-2" | "nvidia" | "ocrspace" | "local";
export type SerialReading = {
  digits: string;
  confidence: number;
  engine: OcrEngine;
  nvidiaNote?: string;
  engineNote?: string;
};

export type OcrModelOption = {
  id: OcrModel;
  name: string;
  provider: string;
  badge: string;
  desc: string;
};

export const OCR_MODEL_OPTIONS: OcrModelOption[] = [
  {
    id: "auto",
    name: "Otomatik",
    provider: "Akıllı Seçim",
    badge: "Auto",
    desc: "En uygun modeli sırayla dener (Evren → NVIDIA → Cihaz)",
  },
  {
    id: "dots-ocr",
    name: "dots-ocr",
    provider: "RedNote / Evren",
    badge: "Evren",
    desc: "İnteraktif Belge & Sayaç OCR",
  },
  {
    id: "deepseek-ocr-2",
    name: "deepseek-ocr-2",
    provider: "DeepSeek / Evren",
    badge: "Evren",
    desc: "Toplu Arşiv & Sayaç OCR",
  },
  {
    id: "nvidia",
    name: "NVIDIA Vision",
    provider: "Llama 3.2 11B",
    badge: "NVIDIA",
    desc: "Llama 3.2 Vision Instruct",
  },
  {
    id: "local",
    name: "Cihaz İçi",
    provider: "Tesseract LSTM",
    badge: "Çevrimdışı",
    desc: "Yerel tarayıcı motoru (İnternetsiz)",
  },
];

export const formatEngineName = (engine: OcrEngine): string => {
  switch (engine) {
    case "dots-ocr":
      return "dots-ocr (Evren)";
    case "deepseek-ocr-2":
      return "deepseek-ocr-2 (Evren)";
    case "nvidia":
      return "NVIDIA Vision";
    case "ocrspace":
      return "OCR.space";
    case "local":
      return "Cihaz (Yerel)";
  }
};

export const OCR_MODEL_STORAGE = "heathack_selected_ocr_model";
export const EVREN_KEY_STORAGE = "heathack_evren_api_key";

export const getSavedOcrModel = (): OcrModel => {
  try {
    const m = localStorage.getItem(OCR_MODEL_STORAGE);
    if (m === "dots-ocr" || m === "deepseek-ocr-2" || m === "nvidia" || m === "local" || m === "auto") {
      return m;
    }
  } catch {
    // yoksay
  }
  return "auto";
};

export const setSavedOcrModel = (model: OcrModel): void => {
  try {
    localStorage.setItem(OCR_MODEL_STORAGE, model);
  } catch {
    // yoksay
  }
};

export const getStoredEvrenKey = (): string => {
  try {
    return (localStorage.getItem(EVREN_KEY_STORAGE) || localStorage.getItem("evren_api_key") || "").trim();
  } catch {
    return "";
  }
};

export const setStoredEvrenKey = (key: string): void => {
  try {
    const trimmed = key.trim();
    if (trimmed) {
      localStorage.setItem(EVREN_KEY_STORAGE, trimmed);
    } else {
      localStorage.removeItem(EVREN_KEY_STORAGE);
      localStorage.removeItem("evren_api_key");
    }
  } catch {
    // yoksay
  }
};

export const MAX_SERIAL_LEN = 10;
export const MIN_SERIAL_LEN = 4;
/** Telefon kameraları devasa kare verir — OCR için bu genişlik fazlasıyla yeter. */
export const MAX_FRAME_SIDE = 1600;
const WORKER_TIMEOUT_MS = 90000;
const RECOGNIZE_TIMEOUT_MS = 30000;

/** Ham OCR metninden seri numarası çıkarır: en uzun rakam öbeği (max 10 hane).
 *  Etiketteki "1 -", "2 -" gibi tekil rakamların seri hanesine karışmasını önler. */
export const extractSerialDigits = (rawText: string, maxLen = MAX_SERIAL_LEN): string => {
  const runs = rawText.match(/\d+/g) ?? [];
  const good = runs
    .filter((r) => r.length >= MIN_SERIAL_LEN)
    .sort((a, b) => b.length - a.length || rawText.indexOf(a) - rawText.indexOf(b));
  if (good.length > 0) return good[0].slice(0, maxLen);
  return runs.join("").slice(0, maxLen);
};

/**
 * Fırlatılan her tür değeri (Error, DOMException, string, Event, ErrorEvent…)
 * okunabilir metne çevirir. `instanceof Error` tek başına yetmez: worker ve
 * WASM katmanı çoğu zaman Error olmayan değerler fırlatır.
 */
export const describeErr = (e: unknown): string => {
  if (e instanceof Error) return e.message || e.name || "boş hata";
  if (typeof e === "string" && e) return e;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    for (const key of ["message", "reason", "error", "detail"]) {
      const v = o[key];
      if (typeof v === "string" && v) return v;
      if (v instanceof Error && v.message) return v.message;
    }
    if (typeof o["type"] === "string") return `olay: ${o["type"]}`;
    try {
      const s = JSON.stringify(o);
      if (s && s !== "{}") return s.slice(0, 160);
    } catch {
      // yoksay
    }
  }
  return "bilinmeyen hata";
};

const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    p,
    new Promise<never>((_, reject) =>
      window.setTimeout(() => reject(new Error(`${label} zaman aşımı`)), ms),
    ),
  ]);

/** Sayfa konumundan bağımsız mutlak URL üretir (worker içi göreli çözümlemeyi ezer). */
const abs = (p: string) => new URL(p.replace(/^\.\//, ""), window.location.href).href;

/** WASM SIMD desteği yoksa (eski cihaz) SIMD çekirdek çöker — önceden tespit et. */
const simdSupported = async (): Promise<boolean> => {
  try {
    return await WebAssembly.validate(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]),
    );
  } catch {
    return false;
  }
};

let workerPromise: Promise<Tesseract.Worker> | null = null;

/** OCR worker'ı tembel yükler; tüm dosyalar uygulamayla birlikte yerelde (offline çalışır). */
export const getOcrWorker = (onProgress?: OcrProgress): Promise<Tesseract.Worker> => {
  if (!workerPromise) {
    workerPromise = (async () => {
      const simd = await simdSupported();
      const coreFile = simd ? "tesseract-core-simd-lstm.js" : "tesseract-core-lstm.js";
      const worker = await withTimeout(
        Tesseract.createWorker("eng", Tesseract.OEM.LSTM_ONLY, {
          langPath: abs("./tessdata"),
          workerPath: abs("./vendor/tesseract/worker.min.js"),
          corePath: abs(`./vendor/tesseract/${coreFile}`),
          gzip: false,
          logger: onProgress
            ? (m) => onProgress(`${m.status} %${Math.round(m.progress * 100)}`, m.progress)
            : undefined,
        }),
        WORKER_TIMEOUT_MS,
        "OCR motoru",
      );
      await worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
        tessedit_char_whitelist: "0123456789",
      });
      return worker;
    })().catch((err: unknown) => {
      workerPromise = null;
      throw new Error(describeErr(err));
    });
  }
  return workerPromise;
};

/** Kamera açılırken motoru arka planda ısıtır — Çek ve Oku'ya basıldığında hazır olur. */
export const warmOcrWorker = (onProgress?: OcrProgress): void => {
  void getOcrWorker(onProgress).catch(() => {
    // Hata Çek ve Oku anında gösterilir, burada sessiz geç.
  });
};

/**
 * Video karesini OCR'a hazırlar: büyük telefon sensörlerini MAX_FRAME_SIDE'a
 * indirir (aksi halde worker bellek şişer ve sekme kilitlenir) + gri/kontrast.
 */
export const frameToCanvas = (video: HTMLVideoElement): HTMLCanvasElement => {
  const w = video.videoWidth || 640;
  const h = video.videoHeight || 480;
  const scale = Math.min(2, MAX_FRAME_SIDE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(w * scale));
  canvas.height = Math.max(1, Math.floor(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas desteklenmiyor");
  ctx.filter = "grayscale(1) contrast(1.25) brightness(1.05)";
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
};

/** OCR.space yanıtından ham metni çıkarır (saf fonksiyon — test edilebilir). */
export const parseOcrSpaceResponse = (json: unknown): string => {
  if (!json || typeof json !== "object") return "";
  const results = (json as { ParsedResults?: unknown }).ParsedResults;
  if (!Array.isArray(results) || results.length === 0) return "";
  const first = results[0] as { ParsedText?: unknown };
  return typeof first.ParsedText === "string" ? first.ParsedText : "";
};

const CLOUD_TIMEOUT_MS = 25000;

/** Bulut OCR (çevrimiçi, yüksek doğruluk). Anahtar yoksa/çevrimdışıyken atlar. */
export const cloudReadDigits = async (
  canvas: HTMLCanvasElement,
  apiKey: string | undefined,
): Promise<string | null> => {
  if (!apiKey || !navigator.onLine) return null;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) return null;
  const form = new FormData();
  form.append("apikey", apiKey);
  form.append("file", blob, "serial.jpg");
  form.append("OCREngine", "2");
  form.append("scale", "true");
  const res = await withTimeout(
    fetch("https://api.ocr.space/parse/image", { method: "POST", body: form }),
    CLOUD_TIMEOUT_MS,
    "Bulut OCR",
  );
  if (!res.ok) throw new Error(`Bulut OCR ${res.status}`);
  const json: unknown = await res.json();
  const digits = extractSerialDigits(parseOcrSpaceResponse(json));
  return digits.length >= MIN_SERIAL_LEN ? digits : null;
};

/** Evren LLM OCR yanıtından metni çıkarır (saf fonksiyon — test edilebilir). */
export const parseEvrenResponse = (json: unknown): string => {
  if (!json || typeof json !== "object") return "";
  const text = (json as { text?: unknown }).text;
  if (typeof text === "string") return text;
  const output = (json as { output?: unknown }).output;
  if (typeof output === "string") return output;
  return "";
};

export const EVREN_PROXY_URL = "api/ocr-evren";

/** Evren LLM OCR API (dots-ocr, deepseek-ocr-2). */
export const evrenReadDigits = async (
  canvas: HTMLCanvasElement,
  model: "dots-ocr" | "deepseek-ocr-2" = "dots-ocr",
  apiKey?: string,
): Promise<string | null> => {
  if (!navigator.onLine) return null;
  const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  const effectiveKey =
    (apiKey && apiKey.trim()) ||
    getStoredEvrenKey() ||
    ((import.meta.env.VITE_EVREN_API_KEY as string | undefined)?.trim() ?? "");

  const res = await withTimeout(
    fetch(EVREN_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, image: dataUrl, apiKey: effectiveKey || undefined }),
    }),
    CLOUD_TIMEOUT_MS,
    `Evren (${model}) OCR`,
  );
  if (!res.ok) {
    let msg = `Evren OCR ${res.status}`;
    try {
      const errJson: unknown = await res.json();
      const errText = (errJson as { error?: unknown }).error;
      if (typeof errText === "string" && errText) msg = errText;
    } catch {
      // yoksay
    }
    throw new Error(msg);
  }
  const json: unknown = await res.json();
  const rawText = parseEvrenResponse(json);
  const digits = extractSerialDigits(rawText);
  return digits.length >= MIN_SERIAL_LEN ? digits : null;
};

/** NVIDIA NIM yanıtından model metnini çıkarır (saf fonksiyon — test edilebilir). */
export const parseNvidiaResponse = (json: unknown): string => {
  if (!json || typeof json !== "object") return "";
  const choices = (json as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join(" ");
  }
  return "";
};

/** NVIDIA hosted vision modeli (Nemotron OCR v2 yalnızca kendi sunucusunda NIM olarak
 *  çalışıyor, bulutta yok — doğrulanan alternatif: Llama 3.2 Vision).
 *  NOT: NVIDIA tarayıcı CORS'una kapalı; istek Vercel sunucusuz fonksiyonu
 *  (api/ocr-nvidia) üzerinden gider, anahtar istemciye gömülmez. */
export const NVIDIA_PROXY_URL = "api/ocr-nvidia";
export const nvidiaReadDigits = async (
  canvas: HTMLCanvasElement,
): Promise<string | null> => {
  if (!navigator.onLine) return null;
  const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  const res = await withTimeout(
    fetch(NVIDIA_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl }),
    }),
    CLOUD_TIMEOUT_MS,
    "NVIDIA OCR",
  );
  if (!res.ok) {
    let msg = `NVIDIA OCR ${res.status}`;
    try {
      const errJson: unknown = await res.json();
      const errText = (errJson as { error?: unknown }).error;
      if (typeof errText === "string" && errText) msg = errText;
    } catch {
      // yoksay, varsayılan mesaj kullanılır
    }
    throw new Error(msg);
  }
  const json: unknown = await res.json();
  const rawText = (json as { text?: unknown }).text;
  const digits = extractSerialDigits(typeof rawText === "string" ? rawText : "");
  return digits.length >= MIN_SERIAL_LEN ? digits : null;
};

/**
 * OCR okuma fonksiyonu:
 * - Belirli bir model seçildiyse doğrudan o modelle okur.
 * - "auto" modunda: Evren (dots-ocr) -> Evren (deepseek-ocr-2) -> NVIDIA -> OCR.space -> Yerel Cihaz sırasıyla dener.
 */
export const readSerialDigits = async (
  video: HTMLVideoElement,
  onProgress?: OcrProgress,
  selectedModel: OcrModel = "auto",
  evrenApiKey?: string,
): Promise<SerialReading> => {
  const canvas = frameToCanvas(video);

  // 1. Manuel seçilen model
  if (selectedModel === "dots-ocr" || selectedModel === "deepseek-ocr-2") {
    if (!navigator.onLine) {
      throw new Error(`${selectedModel} için internet bağlantısı gerekiyor`);
    }
    onProgress?.(`${selectedModel} okuyor…`, 0.3);
    const digits = await evrenReadDigits(canvas, selectedModel, evrenApiKey);
    if (digits) {
      return { digits, confidence: 0, engine: selectedModel };
    }
    throw new Error(`${selectedModel} rakam tespit edemedi`);
  }

  if (selectedModel === "nvidia") {
    if (!navigator.onLine) {
      throw new Error("NVIDIA için internet bağlantısı gerekiyor");
    }
    onProgress?.("NVIDIA okuyor…", 0.3);
    const digits = await nvidiaReadDigits(canvas);
    if (digits) {
      return { digits, confidence: 0, engine: "nvidia" };
    }
    throw new Error("NVIDIA rakam tespit edemedi");
  }

  if (selectedModel === "local") {
    onProgress?.("Cihaz içi motor okuyor…", 0.3);
    const worker = await getOcrWorker(onProgress);
    const { data } = await withTimeout(
      worker.recognize(canvas),
      RECOGNIZE_TIMEOUT_MS,
      "Okuma",
    );
    const digits = extractSerialDigits(data.text);
    return {
      digits,
      confidence: Math.round(data.confidence),
      engine: "local",
    };
  }

  // 2. Otomatik mod (Akıllı fallback zinciri)
  let lastNote: string | undefined;

  if (navigator.onLine) {
    // 2.1 dots-ocr (Evren)
    try {
      onProgress?.("dots-ocr deneniyor…", 0.2);
      const dots = await evrenReadDigits(canvas, "dots-ocr", evrenApiKey);
      if (dots) return { digits: dots, confidence: 0, engine: "dots-ocr" };
    } catch (e) {
      lastNote = `dots-ocr: ${describeErr(e)}`;
    }

    // 2.2 deepseek-ocr-2 (Evren)
    try {
      onProgress?.("deepseek-ocr-2 deneniyor…", 0.35);
      const ds = await evrenReadDigits(canvas, "deepseek-ocr-2", evrenApiKey);
      if (ds) return { digits: ds, confidence: 0, engine: "deepseek-ocr-2", nvidiaNote: lastNote };
    } catch (e) {
      lastNote = `deepseek-ocr-2: ${describeErr(e)}`;
    }

    // 2.3 NVIDIA Vision
    try {
      onProgress?.("NVIDIA deneniyor…", 0.5);
      const nvidia = await nvidiaReadDigits(canvas);
      if (nvidia) return { digits: nvidia, confidence: 0, engine: "nvidia", nvidiaNote: lastNote };
    } catch (e) {
      lastNote = `nvidia: ${describeErr(e)}`;
    }

    // 2.4 OCR.space
    const apiKey = import.meta.env.VITE_OCRSPACE_KEY as string | undefined;
    if (apiKey) {
      try {
        onProgress?.("OCR.space deneniyor…", 0.65);
        const cloud = await cloudReadDigits(canvas, apiKey);
        if (cloud) return { digits: cloud, confidence: 0, engine: "ocrspace", nvidiaNote: lastNote };
      } catch {
        // yoksay
      }
    }
  } else {
    lastNote = "çevrimdışı";
  }

  // 2.5 Cihaz-içi yerel Tesseract motoru
  onProgress?.("Cihaz içi motor çalışıyor…", 0.8);
  const worker = await getOcrWorker(onProgress);
  const { data } = await withTimeout(
    worker.recognize(canvas),
    RECOGNIZE_TIMEOUT_MS,
    "Okuma",
  );
  return {
    digits: extractSerialDigits(data.text),
    confidence: Math.round(data.confidence),
    engine: "local",
    nvidiaNote: lastNote,
  };
};
