import { describe, it, expect } from 'vitest';
import { reducer, AppState, Action, Building, Apartment, createApartments, toReportFileName } from './App';

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
    // Verify ID generation pattern (starts with slugified name)
    expect(nextState.buildings[0].id).toMatch(/^test-building-\d+$/);
  });

  it('should handle add-building action when buildings already exist', () => {
    const existingBuilding: Building = {
      id: 'existing-1',
      name: 'Existing Building',
      apartmentCount: 5,
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
      apartments: []
    };
    const existingBuilding2: Building = {
      id: 'existing-2',
      name: 'Existing Building 2',
      apartmentCount: 5,
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
      waterSerial: 'W999',
      oldIndex: '10',
      note: 'test note',
      inspection: true,
      updatedAt: '2023-01-01'
    };

    const existingBuilding: Building = {
      id: 'building-1',
      name: 'Building 1',
      apartmentCount: 2,
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
    expect(apartment.waterSerial).toBe('');
    expect(apartment.oldIndex).toBe('');
    expect(apartment.note).toBe('');
    expect(apartment.inspection).toBe(false);
    expect(apartment.updatedAt).toBeUndefined();

    // Ensure the other apartment is unchanged
    expect(nextState.buildings[0].apartments[1]).toEqual(existingApartments[1]);
  });

  it('should handle replace-all action', () => {
    const initialState: AppState = { buildings: [] };
    const buildings: Building[] = [
      { id: 'existing-1', name: 'Bina 1', apartmentCount: 2, apartments: createApartments(2) },
    ];
    const nextState = reducer(initialState, { type: 'replace-all', payload: { buildings } });
    expect(nextState.buildings).toEqual(buildings);
  });

  it('should handle unknown action', () => {
    const initialState: AppState = { buildings: [] };
    const action = { type: 'unknown' } as any;

    const nextState = reducer(initialState, action);

    expect(nextState).toBe(initialState);
  });
});

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

  it('should create empty bekliyor apartments with sequential numbers', () => {
    const apartments = createApartments(3);
    apartments.forEach((apartment, index) => {
      expect(apartment.no).toBe(index + 1);
      expect(apartment.status).toBe('bekliyor');
      expect(apartment.serial).toBe('');
      expect(apartment.waterSerial).toBe('');
      expect(apartment.oldIndex).toBe('');
      expect(apartment.note).toBe('');
      expect(apartment.inspection).toBe(false);
      expect(apartment.updatedAt).toBeUndefined();
    });
  });

  it('should clamp invalid counts', () => {
    expect(createApartments(-5)).toEqual([]);
    expect(createApartments(2.7)).toHaveLength(2);
    expect(createApartments(10000)).toHaveLength(500);
  });
});

describe('toReportFileName', () => {
  it('should format site_rapor_YYYY-MM-DD', () => {
    const name = toReportFileName('Aliveli Sitesi');
    expect(name).toMatch(/^Aliveli_Sitesi_rapor_\d{4}-\d{2}-\d{2}$/);
  });

  it('should strip forbidden characters and fall back', () => {
    expect(toReportFileName('A/B:C*?')).toMatch(/^ABC_rapor_\d{4}-\d{2}-\d{2}$/);
    expect(toReportFileName('   ')).toMatch(/^Bina_rapor_\d{4}-\d{2}-\d{2}$/);
  });
});
