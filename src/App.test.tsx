import { describe, it, expect } from 'vitest';
import { reducer, AppState, Action, Building, Apartment, createApartments } from './App';

describe('App Reducer', () => {
  it('should handle add-building action', () => {
    const initialState: AppState = { buildings: [] };
    const action: Action = {
      type: 'add-building',
      payload: { name: 'Test Building', apartmentCount: 10, infoNote: 'Test note' }
    };

    const nextState = reducer(initialState, action);

    expect(nextState.buildings.length).toBe(1);
    expect(nextState.buildings[0].name).toBe('Test Building');
    expect(nextState.buildings[0].apartmentCount).toBe(10);
    expect(nextState.buildings[0].infoNote).toBe('Test note');
    expect(nextState.buildings[0].apartments.length).toBe(10);
    expect(nextState.buildings[0].directionStatus).toBe('Yön bilgisi bekliyor');
    // Verify ID generation pattern (starts with slugified name)
    expect(nextState.buildings[0].id).toMatch(/^test-building-\d+$/);
  });

  it('should handle add-building action when buildings already exist', () => {
    const existingBuilding: Building = {
      id: 'existing-1',
      name: 'Existing Building',
      apartmentCount: 5,
      directionStatus: 'Test',
      apartments: []
    };
    const initialState: AppState = { buildings: [existingBuilding] };
    const action: Action = {
      type: 'add-building',
      payload: { name: 'Test Building', apartmentCount: 10, infoNote: 'Test note' }
    };

    const nextState = reducer(initialState, action);

    expect(nextState.buildings.length).toBe(2);
    expect(nextState.buildings[0].name).toBe('Test Building'); // Prepended
    expect(nextState.buildings[1]).toEqual(existingBuilding);
  });

  it('should handle delete-building action', () => {
    const existingBuilding1: Building = {
      id: 'existing-1',
      name: 'Existing Building 1',
      apartmentCount: 5,
      directionStatus: 'Test',
      apartments: []
    };
    const existingBuilding2: Building = {
      id: 'existing-2',
      name: 'Existing Building 2',
      apartmentCount: 5,
      directionStatus: 'Test',
      apartments: []
    };
    const initialState: AppState = { buildings: [existingBuilding1, existingBuilding2] };
    const action: Action = {
      type: 'delete-building',
      payload: { buildingId: 'existing-1' }
    };

    const nextState = reducer(initialState, action);

    expect(nextState.buildings.length).toBe(1);
    expect(nextState.buildings[0].id).toBe('existing-2');
  });

  it('should handle delete-building action when building not found', () => {
    const existingBuilding: Building = {
      id: 'existing-1',
      name: 'Existing Building 1',
      apartmentCount: 5,
      directionStatus: 'Test',
      apartments: []
    };
    const initialState: AppState = { buildings: [existingBuilding] };
    const action: Action = {
      type: 'delete-building',
      payload: { buildingId: 'non-existent' }
    };

    const nextState = reducer(initialState, action);

    expect(nextState.buildings.length).toBe(1);
    expect(nextState.buildings).toEqual(initialState.buildings);
  });

  it('should handle update-apartment action', () => {
    const existingApartments = createApartments(2);
    const existingBuilding: Building = {
      id: 'building-1',
      name: 'Building 1',
      apartmentCount: 2,
      directionStatus: 'Test',
      apartments: existingApartments
    };
    const initialState: AppState = { buildings: [existingBuilding] };

    const updatedApartment: Apartment = {
      ...existingApartments[0],
      status: 'degisen',
      serial: '12345'
    };

    const action: Action = {
      type: 'update-apartment',
      payload: { buildingId: 'building-1', apartment: updatedApartment }
    };

    const nextState = reducer(initialState, action);

    expect(nextState.buildings[0].apartments[0].status).toBe('degisen');
    expect(nextState.buildings[0].apartments[0].serial).toBe('12345');
    // Ensure the other apartment is unchanged
    expect(nextState.buildings[0].apartments[1]).toEqual(existingApartments[1]);
  });

  it('should handle update-apartment action when building not found', () => {
    const existingApartments = createApartments(2);
    const existingBuilding: Building = {
      id: 'building-1',
      name: 'Building 1',
      apartmentCount: 2,
      directionStatus: 'Test',
      apartments: existingApartments
    };
    const initialState: AppState = { buildings: [existingBuilding] };

    const updatedApartment: Apartment = {
      ...existingApartments[0],
      status: 'degisen',
      serial: '12345'
    };

    const action: Action = {
      type: 'update-apartment',
      payload: { buildingId: 'non-existent', apartment: updatedApartment }
    };

    const nextState = reducer(initialState, action);

    expect(nextState.buildings).toEqual(initialState.buildings);
  });

  it('should handle delete-apartment-record action', () => {
    const existingApartments = createApartments(2);
    existingApartments[0] = {
      ...existingApartments[0],
      status: 'degisen',
      serial: '12345',
      oldIndex: '10',
      note: 'test note',
      inspection: true,
      updatedAt: '2023-01-01'
    };

    const existingBuilding: Building = {
      id: 'building-1',
      name: 'Building 1',
      apartmentCount: 2,
      directionStatus: 'Test',
      apartments: existingApartments
    };
    const initialState: AppState = { buildings: [existingBuilding] };

    const action: Action = {
      type: 'delete-apartment-record',
      payload: { buildingId: 'building-1', apartmentNo: 1 }
    };

    const nextState = reducer(initialState, action);

    const apartment = nextState.buildings[0].apartments[0];
    expect(apartment.status).toBe('bekliyor');
    expect(apartment.serial).toBe('');
    expect(apartment.oldIndex).toBe('');
    expect(apartment.note).toBe('');
    expect(apartment.inspection).toBe(false);
    expect(apartment.updatedAt).toBeUndefined();

    // Ensure the other apartment is unchanged
    expect(nextState.buildings[0].apartments[1]).toEqual(existingApartments[1]);
  });

  it('should handle unknown action', () => {
    const initialState: AppState = { buildings: [] };
    const action = { type: 'unknown' } as any;

    const nextState = reducer(initialState, action);

    expect(nextState).toBe(initialState);
  });
});
<<<<<<< HEAD
=======

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

  it('should clamp unchanged to completed (no stray notes on waiting apartments)', () => {
    const apartments = createApartments(5, 2, 5);
    expect(apartments[2].status).toBe('bekliyor');
    expect(apartments[2].note).toBe('');
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
>>>>>>> 3b398a0 (Tum denetim bulgulari duzeltildi: exportler, cn util, PWA yollari, SW hardening, exceljs, test birlestirme)
