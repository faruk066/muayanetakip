import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  extractSerialDigits,
  describeErr,
  parseOcrSpaceResponse,
  parseNvidiaResponse,
  parseEvrenResponse,
  cloudReadDigits,
  nvidiaReadDigits,
  evrenReadDigits,
  formatEngineName,
  getSavedOcrModel,
  setSavedOcrModel,
  getStoredEvrenKey,
  setStoredEvrenKey,
  readSerialDigits,
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

  it('returns digits via the same-origin proxy', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'SN 60597823' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(nvidiaReadDigits(fakeCanvas())).resolves.toBe('60597823');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('api/ocr-nvidia');
    expect(init.method).toBe('POST');
    expect(init.headers).not.toHaveProperty('Authorization');
    expect(init.body as string).toContain('data:image/jpeg');
  });

  it('throws the server error message on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 501,
      json: () => Promise.resolve({ error: 'NVIDIA anahtarı sunucuda tanımlı değil' }),
    }));
    await expect(nvidiaReadDigits(fakeCanvas())).rejects.toThrow('NVIDIA anahtarı sunucuda tanımlı değil');
  });

  it('returns null offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(nvidiaReadDigits(fakeCanvas())).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
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


describe('parseEvrenResponse', () => {
  it('extracts text property', () => {
    expect(parseEvrenResponse({ text: 'SN 60597823' })).toBe('SN 60597823');
  });

  it('extracts output property as fallback', () => {
    expect(parseEvrenResponse({ output: '60597823' })).toBe('60597823');
  });

  it('returns empty string for null or non-object', () => {
    expect(parseEvrenResponse(null)).toBe('');
    expect(parseEvrenResponse({})).toBe('');
  });
});

describe('evrenReadDigits', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  const fakeCanvas = () =>
    ({
      toDataURL: () => 'data:image/jpeg;base64,eA==',
    }) as unknown as HTMLCanvasElement;

  it('calls proxy with dots-ocr and returns digits', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'Sayac No: 12345678' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await evrenReadDigits(fakeCanvas(), 'dots-ocr', 'my-key');
    expect(result).toBe('12345678');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('api/ocr-evren');
    expect(init.method).toBe('POST');
    const parsedBody = JSON.parse(init.body as string);
    expect(parsedBody.model).toBe('dots-ocr');
    expect(parsedBody.apiKey).toBe('my-key');
  });

  it('calls proxy with deepseek-ocr-2', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'SN: 87654321' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await evrenReadDigits(fakeCanvas(), 'deepseek-ocr-2', 'my-key');
    expect(result).toBe('87654321');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsedBody = JSON.parse(init.body as string);
    expect(parsedBody.model).toBe('deepseek-ocr-2');
  });

  it('throws error when server responds with failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 501,
      json: () => Promise.resolve({ error: 'Evren API anahtarı eksik' }),
    }));
    await expect(evrenReadDigits(fakeCanvas(), 'dots-ocr')).rejects.toThrow('Evren API anahtarı eksik');
  });

  it('returns null when offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(evrenReadDigits(fakeCanvas(), 'dots-ocr')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('formatEngineName and storage helpers', () => {
  it('formats engine names properly', () => {
    expect(formatEngineName('dots-ocr')).toBe('dots-ocr (Evren)');
    expect(formatEngineName('deepseek-ocr-2')).toBe('deepseek-ocr-2 (Evren)');
    expect(formatEngineName('nvidia')).toBe('NVIDIA Vision');
    expect(formatEngineName('local')).toBe('Cihaz (Yerel)');
  });

  it('saves and reads OCR model from localStorage', () => {
    localStorage.clear();
    expect(getSavedOcrModel()).toBe('auto');
    setSavedOcrModel('dots-ocr');
    expect(getSavedOcrModel()).toBe('dots-ocr');
    setSavedOcrModel('deepseek-ocr-2');
    expect(getSavedOcrModel()).toBe('deepseek-ocr-2');
  });

  it('saves and reads Evren API key from localStorage', () => {
    localStorage.clear();
    expect(getStoredEvrenKey()).toBe('');
    setStoredEvrenKey('evren-test-123');
    expect(getStoredEvrenKey()).toBe('evren-test-123');
    setStoredEvrenKey('');
    expect(getStoredEvrenKey()).toBe('');
  });
});

describe('readSerialDigits', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const setupCanvasMock = () => {
    const fakeCtx = {
      set filter(_: string) {},
      drawImage: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,eA==');
  };

  const fakeVideo = () => {
    const v = document.createElement('video');
    Object.defineProperty(v, 'videoWidth', { value: 640 });
    Object.defineProperty(v, 'videoHeight', { value: 480 });
    return v;
  };

  it('runs dots-ocr when model is explicitly dots-ocr', async () => {
    setupCanvasMock();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'SN 99887766' }),
    }));
    const result = await readSerialDigits(fakeVideo(), undefined, 'dots-ocr');
    expect(result.digits).toBe('99887766');
    expect(result.engine).toBe('dots-ocr');
  });

  it('runs deepseek-ocr-2 when model is explicitly deepseek-ocr-2', async () => {
    setupCanvasMock();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'SN 11223344' }),
    }));
    const result = await readSerialDigits(fakeVideo(), undefined, 'deepseek-ocr-2');
    expect(result.digits).toBe('11223344');
    expect(result.engine).toBe('deepseek-ocr-2');
  });

  it('in auto mode tries dots-ocr first and succeeds', async () => {
    setupCanvasMock();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: '66554433' }),
    }));
    const result = await readSerialDigits(fakeVideo(), undefined, 'auto');
    expect(result.digits).toBe('66554433');
    expect(result.engine).toBe('dots-ocr');
  });
});
