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
