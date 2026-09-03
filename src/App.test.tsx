import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadInitialState, STORAGE_KEY, seedBuildings } from './App';

describe('loadInitialState', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    // Clear all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore mocks after each test
    vi.restoreAllMocks();
  });

  it('should return initial state with seedBuildings when localStorage is empty', () => {
    const state = loadInitialState();
    expect(state).toEqual({ buildings: seedBuildings });
  });

  it('should return saved buildings from localStorage when available and valid', () => {
    const mockBuildings = [{ id: 'test', name: 'Test', apartmentCount: 1, directionStatus: '', apartments: [] }];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mockBuildings));

    const state = loadInitialState();
    expect(state).toEqual({ buildings: mockBuildings });
  });

  it('should remove corrupted key and return seedBuildings when localStorage has invalid JSON', () => {
    // Set invalid JSON in localStorage
    localStorage.setItem(STORAGE_KEY, 'invalid json {[');

    // Spy on localStorage.removeItem
    const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem');

    // Call loadInitialState
    const state = loadInitialState();

    // Expect removeItem to have been called with STORAGE_KEY
    expect(removeItemSpy).toHaveBeenCalledWith(STORAGE_KEY);

    // Expect fallback to seedBuildings
    expect(state).toEqual({ buildings: seedBuildings });

    // Also verify that the item was actually removed from localStorage
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
