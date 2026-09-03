import { describe, it, expect } from 'vitest';
import { extractSerialDigits, MAX_SERIAL_LEN } from './ocr';

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
