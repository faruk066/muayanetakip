import { describe, it, expect } from 'vitest';
import { mergeStates, friendlySyncError } from './sync';
import type { Building } from '../App';

const apt = (no: number, updatedAt?: string, serial = '') => ({
  no,
  status: 'degisen' as const,
  serial,
  waterSerial: '',
  oldIndex: '',
  note: '',
  inspection: true,
  updatedAt,
});

const bld = (id: string, apartments: ReturnType<typeof apt>[], apartmentCount?: number): Building => ({
  id,
  name: id,
  apartmentCount: apartmentCount ?? apartments.length,
  apartments,
});

describe('mergeStates', () => {
  it('returns local when cloud is empty', () => {
    const local = [bld('a', [apt(1, '2026-01-01T10:00:00.000Z')])];
    expect(mergeStates(local, [])).toEqual(local);
  });

  it('returns cloud-only buildings appended', () => {
    const local = [bld('a', [apt(1)])];
    const cloud = [bld('a', [apt(1)]), bld('b', [apt(1)])];
    const merged = mergeStates(local, cloud);
    expect(merged.map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('newer updatedAt wins per apartment (cloud newer)', () => {
    const local = [bld('a', [apt(1, '2026-01-01T10:00:00.000Z', 'LOCAL')])];
    const cloud = [bld('a', [apt(1, '2026-02-01T10:00:00.000Z', 'CLOUD')])];
    expect(mergeStates(local, cloud)[0].apartments[0].serial).toBe('CLOUD');
  });

  it('newer updatedAt wins per apartment (local newer)', () => {
    const local = [bld('a', [apt(1, '2026-03-01T10:00:00.000Z', 'LOCAL')])];
    const cloud = [bld('a', [apt(1, '2026-02-01T10:00:00.000Z', 'CLOUD')])];
    expect(mergeStates(local, cloud)[0].apartments[0].serial).toBe('LOCAL');
  });

  it('unions apartment numbers from both sides', () => {
    const local = [bld('a', [apt(1), apt(2)])];
    const cloud = [bld('a', [apt(2), apt(3)])];
    const merged = mergeStates(local, cloud);
    expect(merged[0].apartments.map((a) => a.no)).toEqual([1, 2, 3]);
  });
});

describe('friendlySyncError', () => {
  it('points to 0002 when water_serial is missing', () => {
    expect(friendlySyncError(new Error("Could not find the 'water_serial' column"), 'x')).toContain('0002');
  });

  it('points to 0003 when direction_status is involved', () => {
    expect(friendlySyncError(new Error("column direction_status does not exist"), 'x')).toContain('0003');
  });

  it('falls back to raw message otherwise', () => {
    expect(friendlySyncError(new Error('Network down'), 'yedek')).toBe('Network down');
    expect(friendlySyncError(undefined, 'yedek')).toBe('yedek');
  });
});
