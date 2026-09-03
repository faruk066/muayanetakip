import * as Tesseract from "tesseract.js";

export type OcrResult = { digits: string; confidence: number };

export const MAX_SERIAL_LEN = 10;
export const MIN_SERIAL_LEN = 4;

/** Ham OCR metninden seri numarası çıkarır: sadece rakam, en fazla 10 hane. */
export const extractSerialDigits = (rawText: string, maxLen = MAX_SERIAL_LEN): string =>
  rawText.replace(/\D/g, "").slice(0, maxLen);

/** Sayfa konumundan bağımsız mutlak URL üretir (worker içi göreli çözümlemeyi ezer). */
const abs = (p: string) => new URL(p.replace(/^\.\//, ""), window.location.href).href;

let workerPromise: Promise<Tesseract.Worker> | null = null;

/** OCR worker'ı tembel yükler; tüm dosyalar uygulamayla birlikte yerelde (offline çalışır). */
export const getOcrWorker = (): Promise<Tesseract.Worker> => {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await Tesseract.createWorker("eng", Tesseract.OEM.LSTM_ONLY, {
        langPath: abs("./tessdata"),
        workerPath: abs("./vendor/tesseract/worker.min.js"),
        corePath: abs("./vendor/tesseract/tesseract-core-simd-lstm.js"),
        gzip: false,
      });
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

/** Video karesini büyütüp gri-tonlamaya çevirir (koyu sayaç panolarında okunurluğu artırır). */
export const frameToCanvas = (video: HTMLVideoElement, scale = 2): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.floor(video.videoHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas desteklenmiyor");
  ctx.filter = "grayscale(1) contrast(1.25) brightness(1.05)";
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
};

/** Kameradaki sayaç ekranı/plakasından seri numarasını okur. */
export const recognizeSerialDigits = async (video: HTMLVideoElement): Promise<OcrResult> => {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(frameToCanvas(video));
  return { digits: extractSerialDigits(data.text), confidence: Math.round(data.confidence) };
};
