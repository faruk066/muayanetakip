import { describe, expect, it } from "vitest";
import { findAnomalies, summarizeAnomalies } from "./anomalies";
import type { Apartment, Building } from "../App";

const apt = (no: number, overrides: Partial<Apartment> = {}): Apartment => ({
  no,
  status: "bekliyor",
  serial: "",
  waterSerial: "",
  oldIndex: "",
  note: "",
  inspection: false,
  updatedAt: undefined,
  ...overrides,
});

const bld = (
  id: string,
  apartmentOverrides: Partial<Apartment>[] = [],
  updatedAt?: string,
  name = id,
): Building => ({
  id,
  name,
  apartmentCount: apartmentOverrides.length,
  apartments: apartmentOverrides.map((o, i) => apt(i + 1, o)),
  updatedAt,
});

describe("findAnomalies", () => {
  it("temiz veride anomali üretmez", () => {
    const buildings = [
      bld("b1", [
        { status: "degisen", serial: "12345678", waterSerial: "87654321", oldIndex: "1250" },
        { status: "degismeyen", oldIndex: "900" },
      ]),
    ];
    expect(findAnomalies(buildings)).toEqual([]);
  });

  it("aynı binada mükerrer ısı seri noları kritik anomali üretir", () => {
    const buildings = [
      bld("b1", [
        { status: "degisen", serial: "12345678", oldIndex: "10" },
        { status: "degisen", serial: "12345678", oldIndex: "20" },
      ]),
    ];
    const anomalies = findAnomalies(buildings);
    const dups = anomalies.filter((a) => a.kind === "mukerrer-seri");
    expect(dups).toHaveLength(2);
    expect(dups.every((a) => a.severity === "kritik")).toBe(true);
    expect(dups[0].conflictsWith).toContain("b1 / Daire 2");
    expect(dups[1].conflictsWith).toContain("b1 / Daire 1");
  });

  it("binalar arası mükerrer su seri nolarını yakalar", () => {
    const buildings = [
      bld("b1", [{ status: "degisen", serial: "11112222", waterSerial: "55556666", oldIndex: "1" }], undefined, "Alp"),
      bld("b2", [{ status: "degisen", serial: "33334444", waterSerial: "55556666", oldIndex: "2" }], undefined, "Bora"),
    ];
    const anomalies = findAnomalies(buildings);
    const dups = anomalies.filter((a) => a.kind === "mukerrer-su-seri");
    expect(dups).toHaveLength(2);
    expect(dups.some((a) => a.buildingName === "Alp" && a.conflictsWith.includes("Bora / Daire 1"))).toBe(true);
  });

  it("aynı dairede ısı ve su serisi aynıysa çakışma bildirir", () => {
    const buildings = [
      bld("b1", [{ status: "degisen", serial: "99998888", waterSerial: "99998888", oldIndex: "5" }]),
    ];
    const anomalies = findAnomalies(buildings);
    expect(anomalies.some((a) => a.kind === "isi-su-cakismasi" && a.severity === "kritik")).toBe(true);
  });

  it("kısa seri ve geçersiz endeks uyarısı üretir", () => {
    const buildings = [
      bld("b1", [{ status: "degisen", serial: "12", waterSerial: "123", oldIndex: "-4" }]),
    ];
    const anomalies = findAnomalies(buildings);
    expect(anomalies.filter((a) => a.kind === "kisa-seri")).toHaveLength(2);
    expect(anomalies.some((a) => a.kind === "gecersiz-endeks" && a.value === "-4")).toBe(true);
  });

  it("ondalıklı eski endeksler (virgül/nokta) geçerlidir", () => {
    const buildings = [
      bld("b1", [
        { status: "degisen", serial: "12345678", waterSerial: "87654321", oldIndex: "5,1" },
        { status: "degisen", serial: "22345678", waterSerial: "77654321", oldIndex: "5.1" },
        { status: "degismeyen", oldIndex: "12875" },
      ]),
    ];
    const anomalies = findAnomalies(buildings);
    expect(anomalies.filter((a) => a.kind === "gecersiz-endeks")).toEqual([]);
    expect(anomalies).toEqual([]);
  });

  it("değişti ama seri eksikse uyarır, boş eski endeks normaldir", () => {
    const buildings = [bld("b1", [{ status: "degisen", oldIndex: "" }, apt(2)])];
    const anomalies = findAnomalies(buildings);
    expect(anomalies.map((a) => a.kind)).toEqual(["eksik-seri"]);
  });

  it("özet sayımı önem ayrımını doğru verir", () => {
    const buildings = [
      bld("b1", [
        { status: "degisen", serial: "12345678", oldIndex: "1" },
        { status: "degisen", serial: "12345678", oldIndex: "2" },
        { status: "degisen", serial: "22", oldIndex: "3" },
      ]),
    ];
    const summary = summarizeAnomalies(findAnomalies(buildings));
    expect(summary.critical).toBe(2);
    expect(summary.warning).toBeGreaterThanOrEqual(1);
  });
});