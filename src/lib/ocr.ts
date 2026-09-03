import * as Tesseract from "tesseract.js";

export type OcrResult = { digits: string; confidence: number };
export type OcrProgress = (status: string, progress: number) => void;

export const MAX_SERIAL_LEN = 10;
export const MIN_SERIAL_LEN = 4;
/** Telefon kameraları devasa kare verir — OCR için bu genişlik fazlasıyla yeter. */
export const MAX_FRAME_SIDE = 1600;
const WORKER_TIMEOUT_MS = 90000;
const RECOGNIZE_TIMEOUT_MS = 30000;

/** Ham OCR metninden seri numarası çıkarır: sadece rakam, en fazla 10 hane. */
export const extractSerialDigits = (rawText: string, maxLen = MAX_SERIAL_LEN): string =>
  rawText.replace(/\D/g, "").slice(0, maxLen);

/**
 * Fırlatılan her tür değeri (Error, DOMException, string, Event, ErrorEvent…)
 * okunabilir metne çevirir. `instanceof Error` tek başına yetmez: worker ve
 * WASM katmanı çoğu zaman Error olmayan değerler fırlatır.
 */
export const describeErr = (e: unknown): string => {
  if (e instanceof Error && e.message) return e.message;
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

/** Kameradaki sayaç ekranı/plakasından seri numarasını okur. */
export const recognizeSerialDigits = async (
  video: HTMLVideoElement,
  onProgress?: OcrProgress,
): Promise<OcrResult> => {
  const worker = await getOcrWorker(onProgress);
  const { data } = await withTimeout(
    worker.recognize(frameToCanvas(video)),
    RECOGNIZE_TIMEOUT_MS,
    "Okuma",
  );
  return { digits: extractSerialDigits(data.text), confidence: Math.round(data.confidence) };
};
