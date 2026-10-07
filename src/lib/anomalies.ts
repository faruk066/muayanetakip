import type { Building } from "../App";
import { MIN_SERIAL_LEN } from "./ocr";

/** Anomali önem derecesi: kritik = kesin veri hatası, uyari = gözden geçirilmeli. */
export type AnomalySeverity = "kritik" | "uyari";

export type AnomalyKind =
  | "mukerrer-seri"
  | "mukerrer-su-seri"
  | "isi-su-cakismasi"
  | "kisa-seri"
  | "gecersiz-endeks"
  | "eksik-seri"
  | "eksik-endeks"
  | "bos-kayit";

export const ANOMALY_KIND_LABELS: Record<AnomalyKind, string> = {
  "mukerrer-seri": "Mükerrer kalorimetre seri no",
  "mukerrer-su-seri": "Mükerrer sıcak su seri no",
  "isi-su-cakismasi": "Isı-su seri çakışması",
  "kisa-seri": "Kısa / eksik seri no",
  "gecersiz-endeks": "Geçersiz eski endeks",
  "eksik-seri": "Eksik seri no",
  "eksik-endeks": "Eksik eski endeks",
  "bos-kayit": "Boş tamamlanmış kayıt",
};

export type Anomaly = {
  kind: AnomalyKind;
  severity: AnomalySeverity;
  buildingId: string;
  buildingName: string;
  apartmentNo: number;
  /** Sorunun geçtiği ham değer (seri no vb.), boş olabilir. */
  value: string;
  /** Mükerrer eşleşmede diğer kayıtların konumu ("Bina / Daire N"). */
  conflictsWith: string[];
  message: string;
};

const trim = (s: string) => s.trim();

const locationOf = (buildingName: string, no: number) => `${buildingName} / Daire ${no}`;

type Occurrence = { buildingId: string; buildingName: string; no: number };

const pushOcc = (map: Map<string, Occurrence[]>, value: string, occ: Occurrence) => {
  const list = map.get(value) ?? [];
  list.push(occ);
  map.set(value, list);
};
/** Tüm binaları tarar; mükerrer tespiti binalar arası yapılır.
 *  Sonuç önem sırasına (kritik önce), sonra bina adı ve daire nosuna göre sıralıdır. */
export const findAnomalies = (buildings: Building[]): Anomaly[] => {
  const anomalies: Anomaly[] = [];

  // Seri -> daire konumları (binalar arası mükerrer tespiti için)
  const heatIndex = new Map<string, Occurrence[]>();
  const waterIndex = new Map<string, Occurrence[]>();
  for (const building of buildings) {
    for (const apartment of building.apartments) {
      const occ: Occurrence = { buildingId: building.id, buildingName: building.name, no: apartment.no };
      const serial = trim(apartment.serial);
      const waterSerial = trim(apartment.waterSerial);
      if (serial) pushOcc(heatIndex, serial, occ);
      if (waterSerial) pushOcc(waterIndex, waterSerial, occ);
    }
  }

  for (const building of buildings) {
    for (const apartment of building.apartments) {
      const serial = trim(apartment.serial);
      const waterSerial = trim(apartment.waterSerial);
      const oldIndex = trim(apartment.oldIndex);
      const hasAny =
        Boolean(serial || waterSerial || oldIndex || apartment.note.trim()) || apartment.inspection;
      // Dokunulmamış bekleyen daireler anomali üretmez
      if (apartment.status === "bekliyor" && !hasAny) continue;

      const base = {
        buildingId: building.id,
        buildingName: building.name,
        apartmentNo: apartment.no,
      };

      const add = (kind: AnomalyKind, severity: AnomalySeverity, message: string, value: string, conflictsWith: string[] = []) =>
        anomalies.push({ kind, severity, ...base, value, conflictsWith, message });

      if (serial && serial.length < MIN_SERIAL_LEN) {
        add("kisa-seri", "uyari", `Kalorimetre seri no ${MIN_SERIAL_LEN} hane sınırının altında, OCR kırpılması şüpheli.`, serial);
      }
      if (waterSerial && waterSerial.length < MIN_SERIAL_LEN) {
        add("kisa-seri", "uyari", `Sıcak su seri no ${MIN_SERIAL_LEN} hane sınırının altında, OCR kırpılması şüpheli.`, waterSerial);
      }

      if (serial && waterSerial && serial === waterSerial) {
        add("isi-su-cakismasi", "kritik", "Kalorimetre ve sıcak su seri numarası aynı — biri yanlış okunmuş olmalı.", serial);
      }

      for (const [value, index, kind, label] of [
        [serial, heatIndex, "mukerrer-seri", "Kalorimetre seri no"],
        [waterSerial, waterIndex, "mukerrer-su-seri", "Sıcak su seri no"],
      ] as const) {
        if (!value) continue;
        const occ = index.get(value) ?? [];
        if (occ.length > 1) {
          const others = occ
            .filter((o) => !(o.buildingId === building.id && o.no === apartment.no))
            .map((o) => locationOf(o.buildingName, o.no));
          add(kind, "kritik", `${label} başka kayıtlarda da var: ${others.join(", ")}`, value, others);
        }
      }

      if (oldIndex && !/^\d+$/.test(oldIndex)) {
        add("gecersiz-endeks", "uyari", "Eski endeks yalnızca pozitif tam sayı olmalı (ondalık/negatif/yazı yazılmış).", oldIndex);
      }

      if (apartment.status === "degisen" && !serial) {
        add("eksik-seri", "uyari", "Sayaç değişti olarak işaretlenmiş ama kalorimetre seri no boş.", "");
      }
      if (apartment.status === "degisen" && !oldIndex) {
        add("eksik-endeks", "uyari", "Sayaç değişti olarak işaretlenmiş ama eski endeks boş.", "");
      }
      if (apartment.status === "degismeyen" && !hasAny) {
        add("bos-kayit", "uyari", "Kayıt tamamlandı ama hiçbir alan doldurulmamış.", "");
      }
    }
  }

  const severityRank: Record<AnomalySeverity, number> = { kritik: 0, uyari: 1 };
  return anomalies.sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      a.buildingName.localeCompare(b.buildingName, "tr") ||
      a.apartmentNo - b.apartmentNo,
  );
};

export const summarizeAnomalies = (anomalies: Anomaly[]) => ({
  critical: anomalies.filter((a) => a.severity === "kritik").length,
  warning: anomalies.filter((a) => a.severity === "uyari").length,
});