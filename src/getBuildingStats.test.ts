import { describe, it, expect } from 'vitest';
import { getBuildingStats, type Building, type Apartment, type ApartmentStatus } from './App';

describe('getBuildingStats', () => {
  const createMockApartments = (changed: number, unchanged: number, waiting: number): Apartment[] => {
    const apartments: Apartment[] = [];
    let currentNo = 1;

    for (let i = 0; i < changed; i++) {
      apartments.push({
        no: currentNo++,
        status: 'degisen',
        serial: `HH-100${currentNo}`,
        oldIndex: '100',
        note: '',
        inspection: true,
      });
    }

    for (let i = 0; i < unchanged; i++) {
      apartments.push({
        no: currentNo++,
        status: 'degismeyen',
        serial: `HH-100${currentNo}`,
        oldIndex: '100',
        note: '',
        inspection: true,
      });
    }

    for (let i = 0; i < waiting; i++) {
      apartments.push({
        no: currentNo++,
        status: 'bekliyor',
        serial: '',
        oldIndex: '',
        note: '',
        inspection: false,
      });
    }

    return apartments;
  };

  const createMockBuilding = (changed: number, unchanged: number, waiting: number): Building => {
    const totalCount = changed + unchanged + waiting;
    return {
      id: 'test-building',
      name: 'Test Building',
      apartmentCount: totalCount,
      directionStatus: 'Tek yönlü',
      apartments: createMockApartments(changed, unchanged, waiting),
    };
  };

  it('calculates stats correctly for a building with all apartments waiting (0% completed)', () => {
    const building = createMockBuilding(0, 0, 10);
    const stats = getBuildingStats(building);

    expect(stats).toEqual({
      changed: 0,
      unchanged: 0,
      completed: 0,
      waiting: 10,
      percent: 0,
    });
  });

  it('calculates stats correctly for a building with all apartments completed (100% completed)', () => {
    const building = createMockBuilding(6, 4, 0);
    const stats = getBuildingStats(building);

    expect(stats).toEqual({
      changed: 6,
      unchanged: 4,
      completed: 10,
      waiting: 0,
      percent: 100,
    });
  });

  it('calculates stats correctly for a building with a mix of changed, unchanged, and waiting apartments', () => {
    const building = createMockBuilding(3, 2, 5); // 50% completed
    const stats = getBuildingStats(building);

    expect(stats).toEqual({
      changed: 3,
      unchanged: 2,
      completed: 5,
      waiting: 5,
      percent: 50,
    });
  });

  it('calculates stats correctly for a building with partial completion rounding to nearest whole percent', () => {
    // 1 completed out of 3 total = 33.333% -> 33%
    const building = createMockBuilding(1, 0, 2);
    const stats = getBuildingStats(building);

    expect(stats).toEqual({
      changed: 1,
      unchanged: 0,
      completed: 1,
      waiting: 2,
      percent: 33,
    });

    // 2 completed out of 3 total = 66.666% -> 67%
    const building2 = createMockBuilding(1, 1, 1);
    const stats2 = getBuildingStats(building2);

    expect(stats2).toEqual({
      changed: 1,
      unchanged: 1,
      completed: 2,
      waiting: 1,
      percent: 67,
    });
  });

  it('handles edge case of building with 0 apartments', () => {
    const building = createMockBuilding(0, 0, 0);
    const stats = getBuildingStats(building);

    expect(stats).toEqual({
      changed: 0,
      unchanged: 0,
      completed: 0,
      waiting: 0,
      percent: 0,
    });
  });
});
