import { describe, it, expect } from 'vitest';
import { createApartments, ApartmentStatus, Apartment } from '../App';

describe('createApartments', () => {
  it('should generate an array of the specified length', () => {
    const count = 5;
    const apartments = createApartments(count);
    expect(apartments).toHaveLength(count);
  });

  it('should handle count = 0 properly', () => {
    const apartments = createApartments(0);
    expect(apartments).toEqual([]);
    expect(apartments).toHaveLength(0);
  });

  it('should default all statuses to "bekliyor" when completed is 0', () => {
    const apartments = createApartments(3);
    apartments.forEach((apartment, index) => {
      expect(apartment.no).toBe(index + 1);
      expect(apartment.status).toBe('bekliyor');
      expect(apartment.serial).toBe('');
      expect(apartment.oldIndex).toBe('');
      expect(apartment.note).toBe('');
      expect(apartment.inspection).toBe(false);
      expect(apartment.updatedAt).toBeUndefined();
    });
  });

  it('should correctly set "degisen" and "degismeyen" statuses', () => {
    // 5 total apartments, 3 completed, 2 unchanged
    // Unchanged means they are both completed and unchanged
    // Completed means they are completed (and the rest of completed are changed)
    const apartments = createApartments(5, 3, 2);

    // Apartment 1: completed, unchanged -> 'degismeyen'
    expect(apartments[0].status).toBe('degismeyen');
    expect(apartments[0].inspection).toBe(true);
    expect(apartments[0].note).toBe('Sayaç değişmedi, mevcut sayaç izleniyor.');

    // Apartment 2: completed, unchanged -> 'degismeyen'
    expect(apartments[1].status).toBe('degismeyen');
    expect(apartments[1].inspection).toBe(true);

    // Apartment 3: completed, changed -> 'degisen'
    expect(apartments[2].status).toBe('degisen');
    expect(apartments[2].inspection).toBe(true);
    expect(apartments[2].note).toBe('');

    // Apartment 4: not completed -> 'bekliyor'
    expect(apartments[3].status).toBe('bekliyor');
    expect(apartments[3].inspection).toBe(false);

    // Apartment 5: not completed -> 'bekliyor'
    expect(apartments[4].status).toBe('bekliyor');
    expect(apartments[4].inspection).toBe(false);
  });

  it('should correctly generate serial and oldIndex for completed apartments', () => {
    const apartments = createApartments(2, 2, 0); // 2 total, 2 completed, 0 unchanged

    // index 0 -> no 1
    expect(apartments[0].serial).toBe('HH-240001');
    expect(apartments[0].oldIndex).toBe(String(1200 + 1 * 7)); // 1207

    // index 1 -> no 2
    expect(apartments[1].serial).toBe('HH-240002');
    expect(apartments[1].oldIndex).toBe(String(1200 + 2 * 7)); // 1214
  });

  it('should format updatedAt correctly for completed apartments', () => {
    const apartments = createApartments(1, 1, 0);
    const dateStr = apartments[0].updatedAt;

    expect(dateStr).toBeDefined();

    // no = 1
    const expectedDate = new Date(2026, 0, 1, 10, 1);
    expect(dateStr).toBe(expectedDate.toISOString());
  });

  it('should cap the day at 28 for updatedAt', () => {
    const apartments = createApartments(30, 30, 0);
    const dateStr = apartments[29].updatedAt; // no = 30

    expect(dateStr).toBeDefined();

    // no = 30, Math.min(30, 28) = 28, 30 % 60 = 30
    const expectedDate = new Date(2026, 0, 28, 10, 30);
    expect(dateStr).toBe(expectedDate.toISOString());
  });
});
