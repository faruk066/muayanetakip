import * as Tesseract from "tesseract.js";

export type OcrResult = { digits: string; confidence: number };

export const MAX_SERIAL_LEN = 10;
export const MIN_SERIAL_LEN = 4;
/** Telefon kameraları devasa kare verir — OCR için bu genişlik fazlasıyla yeter. */
export const MAX_FRAME_SIDE = 1600;
const WORKER_TIMEOUT_MS = 90000;
const RECOGNIZE_TIMEOUT_MS = 30000;

/** Ham OCR metninden seri numarası çıkarır: sadece rakam, en fazla 10 hane. */
export const extractSerialDigits = (rawText: string, maxLen = MAX_SERIAL_LEN): string =>
  rawText.replace(/\D/g, "").slice(0, maxLen);

const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    p,
    new Promise<never>((_, reject) =>
      window.setTimeout(() => reject(new Error(`${label} zaman aşımı`)), ms),
    ),
  ]);

/** Sayfa konumundan bağımsız mutlak URL üretir (worker içi göreli çözümlemeyi ezer). */
const abs = (p: string) => new URL(p.replace(/^\.\//, ""), window.location.href).href;

let workerPromise: Promise<Tesseract.Worker> | null = null;

/** OCR worker'ı tembel yükler; tüm dosyalar uygulamayla birlikte yerelde (offline çalışır). */
export const getOcrWorker = (): Promise<Tesseract.Worker> => {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await withTimeout(
        Tesseract.createWorker("eng", Tesseract.OEM.LSTM_ONLY, {
          langPath: abs("./tessdata"),
          workerPath: abs("./vendor/tesseract/worker.min.js"),
          corePath: abs("./vendor/tesseract/tesseract-core-simd-lstm.js"),
          gzip: false,
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
      throw err;
    });
  }
  return workerPromise;
};

/** Kamera açılırken motoru arka planda ısıtır — Çek ve Oku'ya basıldığında hazır olur. */
export const warmOcrWorker = (): void => {
  void getOcrWorker().catch(() => {
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
export const recognizeSerialDigits = async (video: HTMLVideoElement): Promise<OcrResult> => {
  const worker = await getOcrWorker();
  const { data } = await withTimeout(
    worker.recognize(frameToCanvas(video)),
    RECOGNIZE_TIMEOUT_MS,
    "Okuma",
  );
  return { digits: extractSerialDigits(data.text), confidence: Math.round(data.confidence) };
};
