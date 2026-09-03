import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  extractSerialDigits,
  describeErr,
  parseOcrSpaceResponse,
  cloudReadDigits,
  MAX_SERIAL_LEN,
} from './ocr';

describe('extractSerialDigits', () => {
  it('keeps only digits', () => {
    expect(extractSerialDigits('SN: 24A0013-56B')).toBe('24001356');
  });

  it('caps at 10 digits', () => {
    expect(extractSerialDigits('12345678901234')).toHaveLength(MAX_SERIAL_LEN);
    expect(extractSerialDigits('12345678901234')).toBe('1234567890');
  });

  it('handles empty and digit-free input', () => {
    expect(extractSerialDigits('')).toBe('');
    expect(extractSerialDigits('ABC-DEF')).toBe('');
  });

  it('joins multiline OCR output', () => {
    expect(extractSerialDigits('12\n34\n56')).toBe('123456');
  });

  it('strips spaces and dots from formatted readings', () => {
    expect(extractSerialDigits('1 234.567')).toBe('1234567');
  });
});

describe('parseOcrSpaceResponse', () => {
  it('extracts ParsedText', () => {
    expect(parseOcrSpaceResponse({ ParsedResults: [{ ParsedText: '60597823\r\n' }] })).toBe('60597823\r\n');
  });

  it('returns empty on malformed payloads', () => {
    expect(parseOcrSpaceResponse(null)).toBe('');
    expect(parseOcrSpaceResponse({})).toBe('');
    expect(parseOcrSpaceResponse({ ParsedResults: [] })).toBe('');
  });
});

describe('cloudReadDigits', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const fakeCanvas = () =>
    ({
      toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(['x'], { type: 'image/jpeg' })),
    }) as unknown as HTMLCanvasElement;

  it('returns digits from cloud response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ParsedResults: [{ ParsedText: 'SN 60597823' }] }),
    }));
    await expect(cloudReadDigits(fakeCanvas(), 'key')).resolves.toBe('60597823');
  });

  it('returns null without key or offline', async () => {
    await expect(cloudReadDigits(fakeCanvas(), undefined)).resolves.toBeNull();
  });

  it('returns null when cloud finds too few digits', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ParsedResults: [{ ParsedText: 'ABC' }] }),
    }));
    await expect(cloudReadDigits(fakeCanvas(), 'key')).resolves.toBeNull();
  });
});

describe('describeErr', () => {
  it('reads Error messages', () => {
    expect(describeErr(new Error('patladi'))).toBe('patladi');
  });

  it('reads plain strings', () => {
    expect(describeErr('kablo yok')).toBe('kablo yok');
  });

  it('reads nested reason objects and event types', () => {
    expect(describeErr({ reason: 'zaman asimi' })).toBe('zaman asimi');
    expect(describeErr({ type: 'error' })).toBe('olay: error');
  });

  it('falls back for empty values', () => {
    expect(describeErr(undefined)).toBe('bilinmeyen hata');
    expect(describeErr(null)).toBe('bilinmeyen hata');
  });
});
