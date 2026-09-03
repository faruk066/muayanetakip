import { AnimatePresence, motion } from "framer-motion";
import { FormEvent, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import * as ExcelJS from "exceljs";
import { deleteCloudBuilding, fetchCloudState, friendlySyncError, mergeStates, pushState } from "./lib/sync";
import { MIN_SERIAL_LEN, readSerialDigits, warmOcrWorker } from "./lib/ocr";
import { getSupabase, isSupabaseConfigured } from "./lib/supabase";

export type ApartmentStatus = "degisen" | "degismeyen" | "bekliyor";

export type Apartment = {
  no: number;
  status: ApartmentStatus;
  serial: string;
  waterSerial: string;
  oldIndex: string;
  note: string;
  inspection: boolean;
  updatedAt?: string;
};

export type Building = {
  id: string;
  name: string;
  apartmentCount: number;
  infoNote?: string;
  apartments: Apartment[];
};

export type AppState = {
  buildings: Building[];
};

export type Action =
  | { type: "add-building"; payload: { name: string; apartmentCount: number; infoNote: string } }
  | { type: "delete-building"; payload: { buildingId: string } }
  | { type: "replace-all"; payload: { buildings: Building[] } }
  | { type: "update-apartment"; payload: { buildingId: string; apartment: Apartment } }
  | { type: "delete-apartment-record"; payload: { buildingId: string; apartmentNo: number } };

export const STORAGE_KEY = "heathack-binalar-v1";

export const APP_VERSION =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

let audioCtx: AudioContext | null = null;

const playBeep = () => {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") {
      void audioCtx.resume();
    }
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type = "sine";
    oscillator.frequency.value = 800; // Beep frequency

    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime); // Volume
    gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.1);

    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.1);
  } catch (err) {
    console.error("AudioContext could not be started", err);
  }
};

export const createApartments = (count: number): Apartment[] => {
  const safeCount = Math.max(0, Math.min(Math.floor(count), 500));
  return Array.from({ length: safeCount }, (_, index) => ({
    no: index + 1,
    status: "bekliyor" as ApartmentStatus,
    serial: "",
    waterSerial: "",
    oldIndex: "",
    note: "",
    inspection: false,
    updatedAt: undefined,
  }));
};

const trTRFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const formatDate = (date?: string) => {
  if (!date) return "Tarih yok";
  try {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return "Geçersiz tarih";
    return trTRFormatter.format(d);
  } catch {
    return "Geçersiz tarih";
  }
};

export const getBuildingStats = (building: Building) => {
  let changed = 0;
  let unchanged = 0;

  const apartments = building.apartments;
  for (let i = 0; i < apartments.length; i++) {
    const status = apartments[i].status;
    if (status === "degisen") changed++;
    else if (status === "degismeyen") unchanged++;
  }

  const completed = changed + unchanged;
  const total = Math.max(building.apartmentCount, apartments.length, 0);
  const waiting = Math.max(0, total - completed);
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return { changed, unchanged, completed, waiting, percent };
};

export const reducer = (state: AppState, action: Action): AppState => {
  switch (action.type) {
    case "add-building": {
      const id = `${action.payload.name.toLocaleLowerCase("tr-TR").replace(/[^a-z0-9ğüşöçıİĞÜŞÖÇ]+/gi, "-")}-${Date.now()}`;
      return {
        buildings: [
          {
            id,
            name: action.payload.name,
            apartmentCount: action.payload.apartmentCount,
            infoNote: action.payload.infoNote,
            apartments: createApartments(action.payload.apartmentCount),
          },
          ...state.buildings,
        ],
      };
    }
    case "delete-building":
      return { buildings: state.buildings.filter((building) => building.id !== action.payload.buildingId) };
    case "replace-all":
      return { buildings: action.payload.buildings };
    case "update-apartment":
      return {
        buildings: state.buildings.map((building) =>
          building.id === action.payload.buildingId
            ? {
                ...building,
                apartments: building.apartments.map((apartment) =>
                  apartment.no === action.payload.apartment.no ? action.payload.apartment : apartment,
                ),
              }
            : building,
        ),
      };
    case "delete-apartment-record":
      return {
        buildings: state.buildings.map((building) =>
          building.id === action.payload.buildingId
            ? {
                ...building,
                apartments: building.apartments.map((apartment) =>
                  apartment.no === action.payload.apartmentNo
                    ? { ...apartment, status: "bekliyor", serial: "", waterSerial: "", oldIndex: "", note: "", inspection: false, updatedAt: undefined }
                    : apartment,
                ),
              }
            : building,
        ),
      };
    default:
      return state;
  }
};

const isValidStatus = (s: unknown): s is ApartmentStatus =>
  s === "degisen" || s === "degismeyen" || s === "bekliyor";

const sanitizeLoadedBuildings = (raw: unknown): Building[] | null => {
  if (!Array.isArray(raw)) return null;
  const out: Building[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const b = item as Record<string, unknown>;
    if (typeof b["id"] !== "string" || typeof b["name"] !== "string") return null;
    if (typeof b["apartmentCount"] !== "number" || !Number.isFinite(b["apartmentCount"])) return null;
    if (!Array.isArray(b["apartments"])) return null;
    const count = Math.max(0, Math.min(Math.floor(b["apartmentCount"] as number), 1000));
    const apartments = b["apartments"] as Apartment[];
    if (apartments.length !== count) return null;
    for (const a of apartments) {
      if (typeof a?.no !== "number" || !isValidStatus(a?.status)) return null;
    }
    out.push({
      id: b["id"] as string,
      name: b["name"] as string,
      apartmentCount: count,
      infoNote: typeof b["infoNote"] === "string" ? b["infoNote"] : undefined,
      apartments,
    });
  }
  return out;
};

export const loadInitialState = (): AppState => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      const buildings = sanitizeLoadedBuildings(parsed);
      if (buildings) return { buildings };
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }

  return { buildings: [] };
};

export const sanitizeFileName = (name: string, fallback = "Bina"): string => {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
};

/** site_adı_rapor_YYYY-MM-DD formatında Excel dosya adı üretir. */
export const toReportFileName = (siteName: string): string => {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${sanitizeFileName(siteName, "Bina").replace(/-/g, "_")}_rapor_${stamp}`;
};

const mapApartmentToExportRow = (apartment: Apartment, buildingName?: string) => {
  const row: Record<string, string | number | boolean> = {};
  if (buildingName) {
    row["Bina Adı"] = buildingName;
  }
  row["Daire No"] = apartment.no;
  row["Durum"] = apartment.status === "degisen" ? "Değişen" : apartment.status === "degismeyen" ? "Değişmeyen" : "Bekliyor";
  row["Kalori Seri No"] = apartment.serial;
  row["Sıcak Su Seri No"] = apartment.waterSerial;
  row["Eski Endeks"] = apartment.oldIndex;
  row["Muayene"] = apartment.inspection ? "Evet" : "Hayır";
  row["İşlem Tarihi"] = apartment.updatedAt ? formatDate(apartment.updatedAt) : "";
  row["Açıklama"] = apartment.note;
  return row;
};

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const exportWorkbook = async (fileName: string, rows: Record<string, string | number | boolean>[]) => {
  const sanitizedRows = rows.map((row) => {
    const newRow: Record<string, string | number | boolean> = {};
    for (const key in row) {
      const value = row[key];
      if (typeof value === "string" && /^[=+\-@]/.test(value)) {
        newRow[key] = `'${value}`;
      } else {
        newRow[key] = value;
      }
    }
    return newRow;
  });
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Muayene Takip");
  if (sanitizedRows.length > 0) {
    sheet.columns = Object.keys(sanitizedRows[0]).map((key) => ({ header: key, key }));
    sheet.addRows(sanitizedRows);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${fileName}.xlsx`,
  );
};

function HeatIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22c3.4-1.8 5-4.2 5-7.1 0-2.9-1.7-5.2-4-7.4-.6 2.3-1.7 3.8-3.1 4.6.2-2.8-.7-5.2-2.7-7.1C4.5 7.2 3 10.2 3 13.7 3 18.1 6.6 21.1 12 22Z" />
      <path d="M12 22c1.5-.9 2.2-2.1 2.2-3.5 0-1.5-.8-2.6-2-3.7-.3 1.2-.9 2-1.7 2.4.1-1.4-.4-2.6-1.3-3.6-1.3 1.2-2 2.7-2 4.4 0 2.2 1.8 3.7 4.8 4Z" />
    </svg>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-300 transition hover:border-orange-400/40 hover:text-orange-300"
    >
      {children}
    </button>
  );
}

function StatPanel({ label, value, tone }: { label: string; value: number | string; tone?: "green" | "red" | "orange" }) {
  const toneClass = tone === "green" ? "text-emerald-400" : tone === "red" ? "text-red-400" : "text-orange-300";

  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-950/55 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p className={`mt-2 text-3xl font-black tracking-tight ${toneClass}`}>{value}</p>
    </div>
  );
}

function AddBuildingModal({ onClose, onSave }: { onClose: () => void; onSave: (data: { name: string; apartmentCount: number; infoNote: string }) => void }) {
  const [name, setName] = useState("");
  const [apartmentCount, setApartmentCount] = useState("");
  const [infoNote, setInfoNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const count = Number(apartmentCount);
    if (!name.trim()) {
      setError("Bina adı zorunludur.");
      return;
    }
    if (!Number.isFinite(count) || count < 1 || count > 500) {
      setError("Daire sayısı 1-500 arasında olmalıdır.");
      return;
    }
    setError(null);
    onSave({ name: name.trim(), apartmentCount: Math.floor(count), infoNote: infoNote.trim() });
  };

  return (
    <ModalShell onClose={onClose} title="Yeni Bina Ekle">
      <form onSubmit={submit} className="space-y-4">
        <LabeledInput label="BİNA ADI *" value={name} onChange={setName} placeholder="Örn. Elif Park sitesi" required />
        <LabeledInput label="DAİRE SAYISI * (1-500)" value={apartmentCount} onChange={setApartmentCount} placeholder="Örn. 30" type="number" required />
        {error && (
          <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm font-bold text-red-300">
            {error}
          </p>
        )}
        <label className="block space-y-2">
          <span className="text-xs font-bold tracking-[0.18em] text-zinc-400">BİLGİ NOTU (isteğe bağlı)</span>
          <textarea
            value={infoNote}
            onChange={(event) => setInfoNote(event.target.value)}
            rows={4}
            maxLength={1000}
            className="w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-orange-400/70"
            placeholder="Kazan dairesi, blok veya ekip notu"
          />
        </label>
        <button type="submit" className="w-full rounded-2xl bg-orange-500 px-5 py-4 text-sm font-black tracking-[0.16em] text-zinc-950 transition hover:bg-orange-400">
          BİNAYI KAYDET
        </button>
      </form>
    </ModalShell>
  );
}

function LabeledInput({ label, value, onChange, placeholder, type = "text", required, suffix, maxLength = 255 }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; required?: boolean; suffix?: ReactNode; maxLength?: number }) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-bold tracking-[0.18em] text-zinc-400">{label}</span>
      <span className="flex items-center rounded-2xl border border-white/10 bg-black/30 pr-2 transition focus-within:border-orange-400/70">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          type={type}
          required={required}
          maxLength={maxLength}
          className="min-w-0 flex-1 bg-transparent px-4 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
          placeholder={placeholder}
        />
        {suffix}
      </span>
    </label>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-[2rem] border border-white/10 bg-zinc-950 p-5 shadow-2xl shadow-black/60"
        initial={{ y: 36, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 30, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 360, damping: 34 }}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-black tracking-tight text-white">{title}</h2>
          <IconButton label="Pencereyi kapat" onClick={onClose}>
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </IconButton>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

function ApartmentModal({ apartment, onClose, onSave }: { apartment: Apartment; onClose: () => void; onSave: (apartment: Apartment) => void }) {
  const [serial, setSerial] = useState(apartment.serial);
  const [waterSerial, setWaterSerial] = useState(apartment.waterSerial);
  const scanTargetRef = useRef<"heat" | "water">("heat");
  const [oldIndex, setOldIndex] = useState(apartment.oldIndex);
  const [note, setNote] = useState(apartment.note);
  const [inspection, setInspection] = useState(apartment.inspection);
  const [isScanning, setIsScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState("Barkod tarayıcı hazır");
  const [ocrArmed, setOcrArmed] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [serialAuto, setSerialAuto] = useState(false);
  const [waterAuto, setWaterAuto] = useState(false);
  const [ocrCheck, setOcrCheck] = useState(false);
  const mustConfirm = (serialAuto || waterAuto) && !ocrCheck;

  const fillSerial = (target: "heat" | "water", value: string) => {
    if (target === "heat") {
      setSerial(value);
      setSerialAuto(true);
    } else {
      setWaterSerial(value);
      setWaterAuto(true);
    }
    setOcrCheck(false);
  };
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const isComponentMounted = useRef(true);

  useEffect(() => {
    isComponentMounted.current = true;
    return () => {
      isComponentMounted.current = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  const startScan = async (target: "heat" | "water" = "heat") => {
    if (isScanning && scanTargetRef.current === target) return; // Prevent duplicate scanning streams
    scanTargetRef.current = target;

    try {
      const Detector = (window as unknown as { BarcodeDetector?: new (options?: { formats?: string[] }) => { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
      if (!Detector) {
        setScanMessage("Bu tarayıcı kamera ile barkod okumayı desteklemiyor. Seri numarasını elle girebilirsiniz.");
        return;
      }

      setIsScanning(true);
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (!isComponentMounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (!videoRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setIsScanning(false);
        return;
      }
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      try {
        const track = stream.getVideoTracks()[0];
        const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
        setTorchSupported(Boolean(caps.torch));
      } catch {
        setTorchSupported(false);
      }
      setTorchOn(false);
      setScanMessage("Kamera açık, barkodu çerçeveye yaklaştırın.");
      // OCR motorunu arka planda ısıt ki Çek ve Oku anında hazır olsun
      warmOcrWorker((status) => {
        if (isComponentMounted.current) setScanMessage(`OCR hazırlanıyor: ${status}`);
      });

      const detector = new Detector({ formats: ["code_128", "code_39", "ean_13", "qr_code"] });
      const scanFrame = async () => {
        // Halt recursive scanning if component unmounted or stream is gone
        if (!isComponentMounted.current || !videoRef.current || !streamRef.current) return;

        try {
          const codes = await detector.detect(videoRef.current);
          if (codes[0]?.rawValue) {
            playBeep();
            fillSerial(scanTargetRef.current, codes[0].rawValue);
            setScanMessage("Barkod okundu ve seri numarasına aktarıldı.");
            if (streamRef.current) {
              streamRef.current.getTracks().forEach((track) => track.stop());
              streamRef.current = null;
            }
            setIsScanning(false);
            setTorchOn(false);
            return;
          }
        } catch (err) {
           console.error("Scanning error", err);
        }

        if (isComponentMounted.current && streamRef.current) {
          window.setTimeout(scanFrame, 500);
        }
      };
      scanFrame();
    } catch {
      setIsScanning(false);
      setScanMessage("Kamera izni alınamadı. Seri numarasını elle girebilirsiniz.");
    }
  };

  const toggleTorch = async () => {
    const stream = streamRef.current;
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as unknown as MediaTrackConstraintSet] });
      setTorchOn((v) => !v);
    } catch {
      setTorchSupported(false);
      setScanMessage("Bu cihazda flaş desteklenmiyor.");
    }
  };

  const startOcr = async (target: "heat" | "water" = "heat") => {
    scanTargetRef.current = target;
    if (!isScanning) {
      await startScan(target);
    }
    if (!isComponentMounted.current) return;
    setOcrArmed(true);
    setScanMessage("Seri numarasını çerçeveye ortalayın, ardından Çek ve Oku'ya basın.");
  };

  const captureOcr = async () => {
    if (!videoRef.current || ocrBusy) return;
    setOcrBusy(true);
    setScanMessage("Rakamlar okunuyor, kamerayı sabit tutun…");
    try {
      const { digits, confidence, engine } = await readSerialDigits(
        videoRef.current,
        (status) => {
          if (isComponentMounted.current) setScanMessage(`OCR hazırlanıyor: ${status}`);
        },
      );
      if (digits.length >= MIN_SERIAL_LEN) {
        fillSerial(scanTargetRef.current, digits);
        setScanMessage(
          engine === "cloud"
            ? `Bulut okudu: ${digits}. Kontrol edip Kaydet'e basın.`
            : `Cihaz okudu: ${digits} (%${confidence} güven). Kontrol edip Kaydet'e basın.`,
        );
        setOcrArmed(false);
      } else {
        setScanMessage("Rakamlar net okunamadı. Flaş açıp tekrar deneyin.");
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : "bilinmeyen hata";
      console.error("OCR error", e);
      setScanMessage(`OCR çalışmadı (${reason}). Seri numarasını elle girebilirsiniz.`);
    } finally {
      if (isComponentMounted.current) setOcrBusy(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Kaydetmeden önce kamerayı kapat: akışı ve tarama döngüsünü durdur
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsScanning(false);
    setTorchOn(false);
    setOcrArmed(false);
    const heat = serial.trim();
    const water = waterSerial.trim();
    const derived: ApartmentStatus = heat || water ? "degisen" : "bekliyor";
    onSave({ ...apartment, serial: heat, waterSerial: water, status: derived, oldIndex, note, inspection, updatedAt: new Date().toISOString() });
  };

  const scanSuffix = (target: "heat" | "water") => (
    <span className="flex items-center gap-1">
      <button type="button" onClick={() => startScan(target)} className="rounded-xl bg-orange-500/15 p-2 text-orange-300 transition hover:bg-orange-500/25" aria-label="Barkod tarayıcıyı aç">
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7V5a1 1 0 0 1 1-1h2" /><path d="M17 4h2a1 1 0 0 1 1 1v2" /><path d="M20 17v2a1 1 0 0 1-1 1h-2" /><path d="M7 20H5a1 1 0 0 1-1-1v-2" /><path d="M7 12h10" /><path d="M8 9v6" /><path d="M12 9v6" /><path d="M16 9v6" /></svg>
      </button>
      <button type="button" onClick={() => startOcr(target)} className="rounded-xl bg-orange-500/15 px-2 py-2 text-xs font-black text-orange-300 transition hover:bg-orange-500/25" aria-label="OCR ile seri numarasını kameradan okut">
        123
      </button>
    </span>
  );

  return (
    <ModalShell title={`Daire ${apartment.no} - Veri Girişi`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <LabeledInput
          label="1 - KALORİ SERİ NO"
          value={serial}
          onChange={(v) => {
            setSerial(v);
            setSerialAuto(false);
          }}
          placeholder="Kalorimetre seri numarası"
          suffix={scanSuffix("heat")}
        />
        <LabeledInput
          label="2 - SICAK SU SERİ NO"
          value={waterSerial}
          onChange={(v) => {
            setWaterSerial(v);
            setWaterAuto(false);
          }}
          placeholder="Sıcak su sayaç seri numarası"
          suffix={scanSuffix("water")}
        />
        <LabeledInput label="ESKİ ENDEKS" value={oldIndex} onChange={setOldIndex} placeholder="Örn. 12875" type="number" />
        <label className="block space-y-2">
          <span className="text-xs font-bold tracking-[0.18em] text-zinc-400">AÇIKLAMA</span>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={1000} className="w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-orange-400/70" placeholder="Daire veya sayaç notu" />
        </label>
        <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm font-bold text-zinc-200">
          <input type="checkbox" checked={inspection} onChange={(event) => setInspection(event.target.checked)} className="h-5 w-5 accent-orange-500" />
          Muayene
        </label>
        <video ref={videoRef} className={`${isScanning ? "block" : "hidden"} max-h-40 w-full rounded-2xl border border-orange-400/30 object-cover`} muted playsInline />
        <p className="text-xs text-zinc-500">{scanMessage}</p>
        {isScanning && (
          <div className="flex gap-2">
            {ocrArmed && (
              <button
                type="button"
                onClick={captureOcr}
                disabled={ocrBusy}
                className="flex-1 rounded-2xl border border-orange-400/40 bg-orange-500/10 px-5 py-3 text-sm font-black tracking-[0.12em] text-orange-300 transition hover:bg-orange-500/20 disabled:opacity-50"
              >
                {ocrBusy ? "OKUNUYOR…" : "ÇEK VE OKU"}
              </button>
            )}
            {torchSupported && (
              <button
                type="button"
                onClick={toggleTorch}
                className={`rounded-2xl border px-4 py-3 text-sm font-black transition ${torchOn ? "border-yellow-300/60 bg-yellow-400/20 text-yellow-200" : "border-white/10 bg-white/[0.03] text-zinc-300"}`}
              >
                {torchOn ? "FLAŞ KAPAT" : "FLAŞ AÇ"}
              </button>
            )}
          </div>
        )}
        {mustConfirm && (
          <label className="flex items-center gap-3 rounded-2xl border border-orange-400/40 bg-orange-500/10 p-4 text-sm font-bold text-orange-200">
            <input
              type="checkbox"
              checked={ocrCheck}
              onChange={(event) => setOcrCheck(event.target.checked)}
              className="h-5 w-5 accent-orange-500"
            />
            Okunan değeri kontrol ettim, doğru
          </label>
        )}
        <button type="submit" disabled={mustConfirm} className="w-full rounded-2xl bg-orange-500 px-5 py-4 text-sm font-black tracking-[0.16em] text-zinc-950 transition hover:bg-orange-400 disabled:opacity-40">KAYDET</button>
      </form>
    </ModalShell>
  );
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitialState);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedApartmentNo, setSelectedApartmentNo] = useState<number | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState<ServiceWorker | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  type SyncStatus = "idle" | "loading" | "saving" | "synced" | "error" | "offline" | "disabled";
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(isSupabaseConfigured ? "idle" : "disabled");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [cloudReady, setCloudReady] = useState(!isSupabaseConfigured);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);

  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<ServiceWorker>;
      setUpdateAvailable(customEvent.detail);
    };
    window.addEventListener("sw-update-found", handleUpdate);
    return () => {
      window.removeEventListener("sw-update-found", handleUpdate);
    };
  }, []);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => {
      setOnline(false);
      setSyncStatus((s) => (s === "disabled" ? s : "offline"));
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Açılışta buluttan çek + daire bazında en güncel kayıtla birleştir
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const client = getSupabase();
    if (!client) {
      setCloudReady(true);
      return;
    }
    if (!navigator.onLine) {
      setSyncStatus("offline");
      setCloudReady(true);
      return;
    }
    let cancelled = false;
    setSyncStatus("loading");
    void (async () => {
      try {
        const cloud = await fetchCloudState(client);
        if (cancelled) return;
        dispatch({ type: "replace-all", payload: { buildings: mergeStates(loadInitialState().buildings, cloud) } });
        setSyncError(null);
      } catch (e) {
        if (!cancelled) {
          setSyncStatus("error");
          setSyncError(friendlySyncError(e, "Bulut okunamadı"));
        }
      } finally {
        if (!cancelled) setCloudReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Her değişiklikte debounce'lu push (ilk bulut yüklemesi bitmeden yazma)
  useEffect(() => {
    if (!isSupabaseConfigured || !cloudReady || !online) return;
    const client = getSupabase();
    if (!client) return;
    setSyncStatus("saving");
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          await pushState(client, state.buildings);
          setSyncStatus("synced");
          setSyncError(null);
        } catch (e) {
          setSyncStatus("error");
          setSyncError(friendlySyncError(e, "Buluta yazılamadı"));
        }
      })();
    }, 1200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.buildings, cloudReady, online]);

  useEffect(() => {
    try {
      const payload = JSON.stringify(state.buildings);
      // ~5MB karakter sayacı (Türkçe karakterlerde byte'tan sapar, güvenli tarafta kal).
      if (payload.length > 4500000) {
        setSaveError("Veri çok büyük, otomatik kayıt yapılamadı. Excel ile yedek alın.");
        return;
      }
      localStorage.setItem(STORAGE_KEY, payload);
      setSaveError(null);
    } catch {
      setSaveError("Otomatik kayıt başarısız oldu. Depolama dolu olabilir, Excel ile yedek alın.");
    }
  }, [state.buildings]);

  const selectedBuilding = state.buildings.find((building) => building.id === selectedBuildingId) ?? null;
  const selectedApartment = selectedBuilding?.apartments.find((apartment) => apartment.no === selectedApartmentNo) ?? null;

  const totals = useMemo(
    () =>
      state.buildings.reduce(
        (acc, building) => {
          const stats = getBuildingStats(building);
          acc.changed += stats.changed;
          acc.unchanged += stats.unchanged;
          acc.waiting += stats.waiting;
          return acc;
        },
        { changed: 0, unchanged: 0, waiting: 0 },
      ),
    [state.buildings],
  );

  const exportAll = () => {
    const rows = state.buildings.flatMap((building) =>
      building.apartments.map((apartment) => mapApartmentToExportRow(apartment, building.name)),
    );
    exportWorkbook(toReportFileName("toplu"), rows);
  };

  const exportBuilding = (building: Building) => {
    exportWorkbook(
      toReportFileName(building.name),
      building.apartments.map((apartment) => mapApartmentToExportRow(apartment)),
    );
  };

  const handleUpdate = () => {
    if (updateAvailable) {
      updateAvailable.postMessage({ type: "SKIP_WAITING" });
    }
  };

  const refreshFromCloud = () => {
    const client = getSupabase();
    if (!client || !online) return;
    setSyncStatus("loading");
    void (async () => {
      try {
        const cloud = await fetchCloudState(client);
        dispatch({ type: "replace-all", payload: { buildings: mergeStates(state.buildings, cloud) } });
        setSyncStatus("synced");
        setSyncError(null);
      } catch (e) {
        setSyncStatus("error");
        setSyncError(friendlySyncError(e, "Bulut okunamadı"));
      }
    })();
  };

  const handleDeleteBuilding = (id: string) => {
    dispatch({ type: "delete-building", payload: { buildingId: id } });
    const client = getSupabase();
    if (client && cloudReady) {
      void deleteCloudBuilding(client, id).catch((e) => {
        setSyncStatus("error");
        setSyncError(friendlySyncError(e, "Buluttan silinemedi"));
      });
    }
  };

  const syncLabel =
    syncStatus === "loading"
      ? "Yükleniyor…"
      : syncStatus === "saving"
        ? "Kaydediliyor…"
        : syncStatus === "synced"
          ? "Bulut ✓"
          : syncStatus === "offline"
            ? "Çevrimdışı"
            : syncStatus === "error"
              ? "Senkron hatası"
              : "Bulut";

  return (
    <div className="min-h-screen bg-[#090807] text-zinc-100">
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_50%_-10%,rgba(249,115,22,0.20),transparent_36%),linear-gradient(180deg,#14100d_0%,#090807_42%)]" />
      {saveError && (
        <div role="alert" className="sticky top-0 z-50 flex items-center justify-between gap-3 bg-red-500 px-4 py-3 text-sm font-bold text-white shadow-lg">
          <span>{saveError}</span>
          <button
            type="button"
            onClick={exportAll}
            className="shrink-0 rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-bold text-red-300 transition hover:bg-zinc-800"
          >
            Excel Al
          </button>
        </div>
      )}
      {updateAvailable && (
        <div className="sticky top-0 z-50 flex items-center justify-between bg-orange-500 px-4 py-3 text-zinc-950 shadow-lg">
          <span className="text-sm font-bold">Yeni bir güncelleme geldi! (şu an: v{APP_VERSION})</span>
          <button
            onClick={handleUpdate}
            className="rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-bold text-orange-400 transition hover:bg-zinc-800"
          >
            Güncelle
          </button>
        </div>
      )}
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 pb-6 pt-4 sm:px-6">
        <header className="relative overflow-hidden rounded-b-[2rem] border-b border-orange-400/20 pb-5">
          <motion.div className="absolute left-12 top-2 h-24 w-24 rounded-full bg-orange-500/20 blur-3xl" animate={{ scale: [1, 1.16, 1], opacity: [0.45, 0.8, 0.45] }} transition={{ repeat: Infinity, duration: 5, ease: "easeInOut" }} />
          <div className="relative flex items-start justify-between gap-4">
            <button type="button" onClick={() => setSelectedBuildingId(null)} className="flex items-center gap-2 text-left" aria-label="Bina listesine dön">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-orange-500 text-zinc-950 shadow-lg shadow-orange-950/50">
                <HeatIcon />
              </span>
              <span>
                <span className="block text-sm font-black tracking-[0.22em] text-orange-300">ACAREN</span>
                <span className="block text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">HeatHack</span>
              </span>
            </button>
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-2">
                <div className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-zinc-400">PWA hazır</div>
            {syncStatus !== "disabled" && (
              <button
                type="button"
                onClick={refreshFromCloud}
                title={syncError ?? "Buluttan yenilemek için dokun"}
                className={`rounded-full border px-3 py-2 text-xs font-bold transition ${
                  syncStatus === "error"
                    ? "border-red-400/40 bg-red-500/10 text-red-300"
                    : syncStatus === "synced"
                      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                      : "border-white/10 text-zinc-400 hover:border-orange-400/40 hover:text-orange-300"
                }`}
              >
                {syncLabel}
              </button>
            )}
              </div>
              <span className="px-1 text-[11px] font-bold tracking-widest text-zinc-600">v{APP_VERSION}</span>
            </div>
          </div>
          {!selectedBuilding && (
            <motion.div className="relative mt-8" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
              <h1 className="text-4xl font-black tracking-tight text-white">MUAYENE TAKİP</h1>
              <p className="mt-2 text-sm font-medium text-zinc-400">Acaran Muayene Takip Sistemi</p>
            </motion.div>
          )}
        </header>

        <main className="flex-1 pt-6">
          <AnimatePresence mode="wait">
            {selectedBuilding ? (
              <BuildingDetail
                key={selectedBuilding.id}
                building={selectedBuilding}
                onBack={() => setSelectedBuildingId(null)}
                onExport={() => exportBuilding(selectedBuilding)}
                selectedApartmentNo={selectedApartmentNo}
                onSelectApartment={(no) => setSelectedApartmentNo(no)}
                onDeleteRecord={(no) => dispatch({ type: "delete-apartment-record", payload: { buildingId: selectedBuilding.id, apartmentNo: no } })}
              />
            ) : (
              <BuildingList
                key="liste"
                buildings={state.buildings}
                totals={totals}
                onExportAll={exportAll}
                onAdd={() => setIsAddOpen(true)}
                onSelect={(id) => setSelectedBuildingId(id)}
                onDelete={handleDeleteBuilding}
              />
            )}
          </AnimatePresence>
        </main>
      </div>

      <AnimatePresence>
        {isAddOpen && (
          <AddBuildingModal
            onClose={() => setIsAddOpen(false)}
            onSave={(data) => {
              dispatch({ type: "add-building", payload: data });
              setIsAddOpen(false);
            }}
          />
        )}
        {selectedBuilding && selectedApartment && (
          <ApartmentModal
            apartment={selectedApartment}
            onClose={() => setSelectedApartmentNo(null)}
            onSave={(apartment) => {
              dispatch({ type: "update-apartment", payload: { buildingId: selectedBuilding.id, apartment } });
              setSelectedApartmentNo(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function BuildingListItem({ building, index, stats, onSelect, onDelete }: { building: Building; index: number; stats: ReturnType<typeof getBuildingStats>; onSelect: (id: string) => void; onDelete: (id: string) => void }) {
  return (
    <motion.article className="group rounded-[1.6rem] border border-white/10 bg-zinc-950/60 p-4 transition hover:border-orange-400/40" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
      <button type="button" onClick={() => onSelect(building.id)} className="w-full text-left" aria-label={`${building.name} detayını aç`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-black text-white">{building.name}</h3>
            <p className="mt-1 text-sm text-zinc-500">{building.apartmentCount} daire</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-black text-orange-300">%{stats.percent}</p>
            <p className="text-xs text-zinc-500">{stats.completed}/{building.apartmentCount} tamamlandı</p>
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-800">
          <motion.div className="h-full rounded-full bg-emerald-400" initial={{ width: 0 }} animate={{ width: `${stats.percent}%` }} transition={{ duration: 0.75, ease: "easeOut" }} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-zinc-400">
          <span><strong className="text-emerald-400">{stats.changed}</strong> değişen daire</span>
        </div>
      </button>
      <div className="mt-4 flex justify-end gap-2">
        <IconButton label="Binayı sil" onClick={() => onDelete(building.id)}>
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v5" /><path d="M14 11v5" /></svg>
        </IconButton>
      </div>
    </motion.article>
  );
}

function BuildingList({ buildings, totals, onExportAll, onAdd, onSelect, onDelete }: { buildings: Building[]; totals: { changed: number; unchanged: number; waiting: number }; onExportAll: () => void; onAdd: () => void; onSelect: (id: string) => void; onDelete: (id: string) => void }) {
  return (
    <motion.section initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.28 }} className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black tracking-[0.22em] text-zinc-400">KAYITLI BİNALAR</h2>
          <p className="mt-1 text-3xl font-black text-white">{buildings.length} bina</p>
        </div>
        <button type="button" onClick={onExportAll} className="rounded-2xl border border-orange-400/30 bg-orange-500/10 px-4 py-3 text-sm font-black text-orange-300 transition hover:bg-orange-500 hover:text-zinc-950">Toplu Aktar</button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatPanel label="Toplam Değişen" value={totals.changed} tone="green" />
        <StatPanel label="Toplam Değişmeyen" value={totals.unchanged} tone="red" />
        <StatPanel label="Bekleyen" value={totals.waiting} tone="orange" />
      </div>

      {buildings.length === 0 && (
        <div className="rounded-[1.6rem] border border-dashed border-white/15 bg-zinc-950/40 p-6 text-center">
          <p className="text-base font-black text-white">Henüz bina kaydı yok</p>
          <p className="mt-1 text-sm text-zinc-400">Aşağıdaki butonla ilk binayı ekleyin.</p>
        </div>
      )}

      <div className="space-y-3">
        {buildings.map((building, index) => {
          const stats = getBuildingStats(building);
          return (
            <BuildingListItem
              key={building.id}
              building={building}
              index={index}
              stats={stats}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          );
        })}
      </div>

      <motion.button type="button" onClick={onAdd} className="sticky bottom-4 w-full rounded-[1.4rem] bg-orange-500 px-5 py-5 text-base font-black tracking-[0.16em] text-zinc-950 shadow-2xl shadow-orange-950/50 transition hover:bg-orange-400" whileTap={{ scale: 0.98 }}>
        YENİ BİNA EKLE
      </motion.button>
    </motion.section>
  );
}

function BuildingDetail({ building, selectedApartmentNo, onBack, onExport, onSelectApartment, onDeleteRecord }: { building: Building; selectedApartmentNo: number | null; onBack: () => void; onExport: () => void; onSelectApartment: (no: number) => void; onDeleteRecord: (no: number) => void }) {
  const stats = getBuildingStats(building);
  const completedApartments = building.apartments.filter((apartment) => apartment.status !== "bekliyor");
  const [showAllCompleted, setShowAllCompleted] = useState(false);
  const visibleCompleted = showAllCompleted ? completedApartments : completedApartments.slice(0, 30);

  return (
    <motion.section initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.28 }} className="space-y-6">
      <div className="space-y-4">
        <button type="button" onClick={onBack} className="text-sm font-bold text-orange-300">Listeye dön</button>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-white">{building.name}</h1>
            <p className="mt-1 text-sm text-zinc-400">{stats.completed}/{building.apartmentCount} daire tamamlandı</p>
          </div>
          <button type="button" onClick={onExport} className="rounded-2xl bg-orange-500 px-4 py-3 text-sm font-black text-zinc-950 transition hover:bg-orange-400">Excel indir</button>
        </div>
        <div>
          <div className="h-3 overflow-hidden rounded-full bg-zinc-800">
            <motion.div className="h-full rounded-full bg-emerald-400" initial={{ width: 0 }} animate={{ width: `${stats.percent}%` }} transition={{ duration: 0.8, ease: "easeOut" }} />
          </div>
          <p className="mt-2 text-sm text-zinc-500">%{stats.percent} tamamlandı, {stats.waiting} daire kaldı</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatPanel label="Değişen" value={stats.changed} tone="green" />
        <StatPanel label="Değişmeyen" value={stats.unchanged} tone="red" />
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-black tracking-[0.22em] text-zinc-400">DAİRE SEÇİN</h2>
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-7" style={{ contentVisibility: "auto" }}>
          {building.apartments.map((apartment) => {
            const isSelected = selectedApartmentNo === apartment.no;
            const statusLabel = apartment.status === "degisen" ? "Değişti" : apartment.status === "degismeyen" ? "Değişmedi" : "Bekliyor";
            const colorClass = isSelected
              ? "bg-orange-500 text-zinc-950 ring-2 ring-orange-200/70"
              : apartment.status === "degisen"
                ? "bg-emerald-500 text-zinc-950"
                : apartment.status === "degismeyen"
                  ? "bg-red-500 text-white ring-1 ring-red-200/50"
                  : "bg-zinc-700 text-zinc-300 hover:bg-orange-500 hover:text-zinc-950";

            return (
            <button
              key={apartment.no}
              type="button"
              onClick={() => onSelectApartment(apartment.no)}
              aria-label={`Daire ${apartment.no}, ${isSelected ? "Seçili, " : ""}${statusLabel}`}
              className={`aspect-square rounded-2xl text-sm font-black transition active:scale-95 ${colorClass}`}
            >
              {apartment.no}
            </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-zinc-400 sm:grid-cols-4">
          <Legend color="bg-emerald-500" label="Değişti" />
          <Legend color="bg-red-500" label="Değişmedi" />
          <Legend color="bg-zinc-600" label="Bekliyor" />
          <Legend color="bg-orange-500" label="Seçili" />
        </div>
      </section>

      <section className="space-y-3 pb-3">
        <h2 className="text-sm font-black tracking-[0.22em] text-zinc-400">TAMAMLANANLAR</h2>
        {completedApartments.length === 0 && (
          <p className="rounded-2xl border border-dashed border-white/15 bg-zinc-950/40 p-4 text-center text-sm text-zinc-400">
            Henüz tamamlanan daire yok. Yukarıdan bir daire seçerek başlayın.
          </p>
        )}
        <div className="space-y-2">
          {visibleCompleted.map((apartment) => (
            <div key={apartment.no} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-zinc-950/55 p-3">
              <div>
                <p className="font-black text-white">Daire {apartment.no}</p>
                <p className="mt-1 text-xs text-zinc-500">{formatDate(apartment.updatedAt)}</p>
                {(apartment.serial || apartment.waterSerial) && (
                  <p className="mt-1 text-xs text-zinc-400">
                    {apartment.serial ? `K: ${apartment.serial}` : "K: —"}
                    {apartment.waterSerial ? ` • S: ${apartment.waterSerial}` : ""}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-[11px] font-black ${apartment.status === "degismeyen" ? "bg-red-500/15 text-red-300" : "bg-emerald-500/15 text-emerald-300"}`}>{apartment.status === "degismeyen" ? "DEĞİŞMEDİ" : "DEĞİŞTİ"}</span>
                <IconButton label="Kaydı sil" onClick={() => onDeleteRecord(apartment.no)}>
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
                </IconButton>
              </div>
            </div>
          ))}
        </div>
        {completedApartments.length > 30 && (
          <button
            type="button"
            onClick={() => setShowAllCompleted((v) => !v)}
            className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-bold text-zinc-300 transition hover:border-orange-400/40 hover:text-orange-300"
          >
            {showAllCompleted ? "Daralt" : `Tümünü göster (${completedApartments.length})`}
          </button>
        )}
      </section>
    </motion.section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-2">
      <span className={`h-3 w-3 rounded-full ${color}`} />
      {label}
    </div>
  );
}