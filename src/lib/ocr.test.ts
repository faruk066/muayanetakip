import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  extractSerialDigits,
  describeErr,
  parseOcrSpaceResponse,
  parseNvidiaResponse,
  cloudReadDigits,
  nvidiaReadDigits,
  MAX_SERIAL_LEN,
} from './ocr';

describe('extractSerialDigits', () => {
  it('picks the longest digit run (ignores label numbers)', () => {
    expect(extractSerialDigits('2 - SICAK SU\n1 - KALORI\n60600653')).toBe('60600653');
  });

  it('keeps only digits', () => {
    expect(extractSerialDigits('SN: 24A0013-56B')).toBe('0013');
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

describe('parseNvidiaResponse', () => {
  it('extracts string content', () => {
    expect(parseNvidiaResponse({ choices: [{ message: { content: '60600653' } }] })).toBe('60600653');
  });

  it('joins array content parts', () => {
    expect(
      parseNvidiaResponse({ choices: [{ message: { content: [{ text: '6060' }, { text: '0653' }] } }] }),
    ).toBe('6060 0653');
  });

  it('returns empty on malformed payloads', () => {
    expect(parseNvidiaResponse(null)).toBe('');
    expect(parseNvidiaResponse({})).toBe('');
    expect(parseNvidiaResponse({ choices: [] })).toBe('');
  });
});

describe('nvidiaReadDigits', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const fakeCanvas = () =>
    ({
      toDataURL: () => 'data:image/jpeg;base64,eA==',
    }) as unknown as HTMLCanvasElement;

  it('returns digits and posts to the NIM endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'SN 60597823' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(nvidiaReadDigits(fakeCanvas(), 'nvapi-test')).resolves.toBe('60597823');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer nvapi-test');
    expect(init.body as string).toContain('llama-3.2-11b-vision-instruct');
  });

  it('returns null without key', async () => {
    await expect(nvidiaReadDigits(fakeCanvas(), undefined)).resolves.toBeNull();
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
