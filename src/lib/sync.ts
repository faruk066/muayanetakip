import type { SupabaseClient } from "@supabase/supabase-js";
import type { Apartment, Building } from "../App";

type BuildingRow = {
  id: string;
  name: string;
  apartment_count: number;
  direction_status: string;
  info_note: string | null;
  updated_at: string;
};

type ApartmentRow = {
  building_id: string;
  no: number;
  status: string;
  serial: string;
  old_index: string;
  note: string;
  inspection: boolean;
  updated_at: string | null;
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
    const apartments: Apartment[] = nos.map((no) => {
      const l = localByNo.get(no);
      const c = cloudByNo.get(no);
      if (!l) return c as Apartment;
      if (!c) return l;
      return toTime(c.updatedAt) > toTime(l.updatedAt) ? c : l;
    });
    return {
      ...localB,
      apartmentCount: Math.max(localB.apartmentCount, cloudB.apartmentCount, apartments.length),
      apartments,
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
    .select("id,name,apartment_count,direction_status,info_note,updated_at");
  if (bErr) throw bErr;
  const { data: apartmentRows, error: aErr } = await client
    .from("apartments")
    .select("building_id,no,status,serial,old_index,note,inspection,updated_at");
  if (aErr) throw aErr;

  const byBuilding = new Map<string, Apartment[]>();
  for (const r of (apartmentRows ?? []) as ApartmentRow[]) {
    const list = byBuilding.get(r.building_id) ?? [];
    list.push({
      no: r.no,
      status: isApartmentStatus(r.status) ? r.status : "bekliyor",
      serial: r.serial ?? "",
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
    directionStatus: b.direction_status,
    infoNote: b.info_note ?? undefined,
    apartments: (byBuilding.get(b.id) ?? []).sort((a, b2) => a.no - b2.no),
  }));
};

export const pushState = async (client: SupabaseClient, buildings: Building[]): Promise<void> => {
  if (buildings.length === 0) return;
  const { error: bErr } = await client.from("buildings").upsert(
    buildings.map((b) => ({
      id: b.id,
      name: b.name,
      apartment_count: b.apartmentCount,
      direction_status: b.directionStatus,
      info_note: b.infoNote ?? null,
      updated_at: new Date().toISOString(),
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
      old_index: a.oldIndex,
      note: a.note,
      inspection: a.inspection,
      updated_at: a.updatedAt ?? null,
    })),
  );
  // Büyük binalarda tek seferde yollamak yerine parçala
  for (let i = 0; i < rows.length; i += 200) {
    const { error: aErr } = await client
      .from("apartments")
      .upsert(rows.slice(i, i + 200), { onConflict: "building_id,no" });
    if (aErr) throw aErr;
  }
};

export const deleteCloudBuilding = async (client: SupabaseClient, buildingId: string): Promise<void> => {
  const { error } = await client.from("buildings").delete().eq("id", buildingId);
  if (error) throw error;
};
