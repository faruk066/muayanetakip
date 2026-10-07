import type { SupabaseClient } from "@supabase/supabase-js";
import type { Apartment, Building } from "../App";

type BuildingRow = {
  id: string;
  name: string;
  apartment_count: number;
  info_note: string | null;
  updated_at: string;
};

type ApartmentRow = {
  building_id: string;
  no: number;
  status: string;
  serial: string;
  water_serial?: string;
  old_index: string;
  note: string;
  inspection: boolean;
  updated_at: string | null;
};

const APT_COLS_FULL = "building_id,no,status,serial,water_serial,old_index,note,inspection,updated_at";
const APT_COLS_BASE = "building_id,no,status,serial,old_index,note,inspection,updated_at";

/** Supabase hatasını kullanıcı diline çevirir (eksik migration'ı işaret eder). */
export const friendlySyncError = (e: unknown, fallback: string): string => {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  if (/water_serial/i.test(msg))
    return "Supabase'te 0002 eksik: SQL Editor'da 0002_water_serial.sql'i koşun.";
  if (/direction_status/i.test(msg))
    return "Supabase'te 0003 eksik: SQL Editor'da 0003_drop_direction_status.sql'i koşun.";
  return msg || fallback;
};

const toTime = (iso?: string): number => {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
};

const isApartmentStatus = (s: string): s is Apartment["status"] =>
  s === "degisen" || s === "degismeyen" || s === "bekliyor";

/**
 * Yerel + bulut verisini birleştirir: daire bazında updatedAt'i yeni olan kazanır,
 * sadece bulutta olan binalar sona eklenir. Çift tarafta da değişmişse veri kaybı
 * olmaz — her daire için en güncel kayıt korunur (last-write-wins).
 */
export const mergeStates = (local: Building[], cloud: Building[]): Building[] => {
  const cloudById = new Map(cloud.map((b) => [b.id, b]));
  const merged: Building[] = local.map((localB) => {
    const cloudB = cloudById.get(localB.id);
    if (!cloudB) return localB;
    const localByNo = new Map(localB.apartments.map((a) => [a.no, a]));
    const cloudByNo = new Map(cloudB.apartments.map((a) => [a.no, a]));
    const nos = [...new Set([...localByNo.keys(), ...cloudByNo.keys()])].sort((a, b) => a - b);
    const union: Apartment[] = nos.map((no) => {
      const l = localByNo.get(no);
      const c = cloudByNo.get(no);
      if (!l) return c as Apartment;
      if (!c) return l;
      return toTime(c.updatedAt) > toTime(l.updatedAt) ? c : l;
    });

    const localTs = toTime(localB.updatedAt);
    const cloudTs = toTime(cloudB.updatedAt);

    // Tarih yoksa (eski veri) mevcut birleştirici davranışı koru.
    if (localTs === 0 && cloudTs === 0) {
      return {
        ...localB,
        apartmentCount: Math.max(localB.apartmentCount, cloudB.apartmentCount, union.length),
        apartments: union,
      };
    }

    // Bina bazında son yazan kazanır; böylece sonradan düzeltilen daire sayısı
    // (özellikle azaltma) birleştirmede geri alınmaz.
    const cloudWins = cloudTs > localTs;
    const winnerTs = cloudWins ? cloudTs : localTs;
    const winnerCount = Math.max(
      0,
      Math.min(Math.floor(cloudWins ? cloudB.apartmentCount : localB.apartmentCount), 500),
    );
    // Kazanan tarafın sayısının üstündeki "hayalet" daireleri at; ama kazanan
    // güncellemeden SONRA gerçekten dokunulmuş satırları koru (eşzamanlı çalışma).
    const kept = union.filter((a) => a.no <= winnerCount || toTime(a.updatedAt) > winnerTs);
    const apartmentCount = Math.max(winnerCount, kept.reduce((maxNo, a) => Math.max(maxNo, a.no), 0));
    return {
      ...localB,
      ...(cloudWins ? { name: cloudB.name, infoNote: cloudB.infoNote, updatedAt: cloudB.updatedAt } : {}),
      apartmentCount,
      apartments: kept,
    };
  });
  const localIds = new Set(local.map((b) => b.id));
  for (const cloudB of cloud) {
    if (!localIds.has(cloudB.id)) merged.push(cloudB);
  }
  return merged;
};

export const fetchCloudState = async (client: SupabaseClient): Promise<Building[]> => {
  const { data: buildingRows, error: bErr } = await client
    .from("buildings")
    .select("id,name,apartment_count,info_note,updated_at");
  if (bErr) throw bErr;
  let apartmentRows: ApartmentRow[] | null = null;
  {
    const full = await client.from("apartments").select(APT_COLS_FULL);
    if (!full.error) {
      apartmentRows = full.data as ApartmentRow[];
    } else if (/water_serial/i.test(full.error.message)) {
      // 0002 henüz koşulmamış eski şema: su serisiz devam et
      const base = await client.from("apartments").select(APT_COLS_BASE);
      if (base.error) throw base.error;
      apartmentRows = base.data as ApartmentRow[];
    } else {
      throw full.error;
    }
  }

  const byBuilding = new Map<string, Apartment[]>();
  for (const r of (apartmentRows ?? []) as ApartmentRow[]) {
    const list = byBuilding.get(r.building_id) ?? [];
    list.push({
      no: r.no,
      status: isApartmentStatus(r.status) ? r.status : "bekliyor",
      serial: r.serial ?? "",
      waterSerial: r.water_serial ?? "",
      oldIndex: r.old_index ?? "",
      note: r.note ?? "",
      inspection: Boolean(r.inspection),
      updatedAt: r.updated_at ?? undefined,
    });
    byBuilding.set(r.building_id, list);
  }
  return ((buildingRows ?? []) as BuildingRow[]).map((b) => ({
    id: b.id,
    name: b.name,
    apartmentCount: b.apartment_count,
    infoNote: b.info_note ?? undefined,
    updatedAt: b.updated_at ?? undefined,
    // Artık (silinmiş) daire satırları geri gelmesin: bina sayısının üstünü ele.
    apartments: (byBuilding.get(b.id) ?? [])
      .filter((a) => a.no <= b.apartment_count)
      .sort((a, b2) => a.no - b2.no),
  }));
};

export const pushState = async (client: SupabaseClient, buildings: Building[]): Promise<void> => {
  if (buildings.length === 0) return;
  const { error: bErr } = await client.from("buildings").upsert(
    buildings.map((b) => ({
      id: b.id,
      name: b.name,
      apartment_count: b.apartmentCount,
      info_note: b.infoNote ?? null,
      // Yerel düzenleme zamanını taşı ki birleştirmede LWW doğru çalışsın.
      updated_at: b.updatedAt ?? new Date().toISOString(),
    })),
    { onConflict: "id" },
  );
  if (bErr) throw bErr;

  const rows: ApartmentRow[] = buildings.flatMap((b) =>
    b.apartments.map((a) => ({
      building_id: b.id,
      no: a.no,
      status: a.status,
      serial: a.serial,
      water_serial: a.waterSerial,
      old_index: a.oldIndex,
      note: a.note,
      inspection: a.inspection,
      updated_at: a.updatedAt ?? null,
    })),
  );
  // Büyük binalarda tek seferde yollamak yerine parçala
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error: aErr } = await client
      .from("apartments")
      .upsert(chunk, { onConflict: "building_id,no" });
    if (aErr && /water_serial/i.test(aErr.message)) {
      // 0002 henüz koşulmamış eski şema: su serisiz tekrar dene
      const stripped = chunk.map(({ water_serial: _dropped, ...rest }) => rest);
      const { error: retryErr } = await client
        .from("apartments")
        .upsert(stripped, { onConflict: "building_id,no" });
      if (retryErr) throw retryErr;
    } else if (aErr) {
      throw aErr;
    }
  }

  // Daire sayısı azaltıldıysa buluttaki artık satırları temizle ki birleştirmede
  // eski daireler geri gelmesin. Silme izni yoksa senkronu bozma, sadece uyar.
  await Promise.all(
    buildings.map(async (b) => {
      const { error } = await client.from("apartments").delete().eq("building_id", b.id).gt("no", b.apartmentCount);
      if (error) console.warn("Fazladan daire kaydı silinemedi:", error.message);
    }),
  );
};

export const deleteCloudBuilding = async (client: SupabaseClient, buildingId: string): Promise<void> => {
  const { error } = await client.from("buildings").delete().eq("id", buildingId);
  if (error) throw error;
};
