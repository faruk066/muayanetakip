import { describe, it, expect } from 'vitest';
import { cn } from './cn';

describe('cn utility', () => {
  it('should merge basic strings', () => {
    expect(cn('class1', 'class2')).toBe('class1 class2');
  });

  it('should handle conditionally active classes', () => {
    expect(cn('class1', { class2: true, class3: false })).toBe('class1 class2');
    expect(cn({ 'bg-red-500': true, 'bg-blue-500': false })).toBe('bg-red-500');
  });

  it('should handle arrays and mixed inputs', () => {
    expect(cn(['class1', 'class2'], 'class3', { class4: true })).toBe('class1 class2 class3 class4');
  });

  it('should resolve tailwind class conflicts correctly', () => {
    // tailwind-merge should resolve conflicts by keeping the later class
    expect(cn('p-4', 'p-2')).toBe('p-2');
    expect(cn('px-2 py-1', 'p-4')).toBe('p-4');
    expect(cn('bg-red-500', 'bg-blue-500')).toBe('bg-blue-500');
    expect(cn('text-sm', 'text-lg')).toBe('text-lg');
  });

  it('should handle undefined, null, and empty inputs gracefully', () => {
    expect(cn('class1', undefined, null, false, '')).toBe('class1');
    expect(cn()).toBe('');
  });
});
