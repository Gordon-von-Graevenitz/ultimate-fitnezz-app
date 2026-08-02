import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { LOCAL_DATA_STORAGE, LOCAL_DATA_STORAGE_KEY, LocalDataStore } from './local-data.store';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function createStore(storage: Storage | null = new MemoryStorage()): LocalDataStore {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [LocalDataStore, { provide: LOCAL_DATA_STORAGE, useValue: storage }],
  });
  return TestBed.inject(LocalDataStore);
}

describe('LocalDataStore', () => {
  it('starts with independent demo data when storage is empty', () => {
    const firstStore = createStore();
    const initialCount = firstStore.clients().length;

    firstStore.createClient({
      firstName: 'Ari',
      lastName: 'Nguyen',
      email: 'ari@example.com',
      joinedAt: '2026-08-02',
      status: 'active',
      avatarColor: '#335C67',
    });

    const secondStore = createStore();
    expect(secondStore.clients()).toHaveLength(initialCount);
    expect(secondStore.clients().some((client) => client.email === 'ari@example.com')).toBe(false);
  });

  it('persists CRUD changes to the injected storage', () => {
    const storage = new MemoryStorage();
    const store = createStore(storage);
    const client = store.createClient({
      firstName: 'Ari',
      lastName: 'Nguyen',
      email: 'ari@example.com',
      joinedAt: '2026-08-02',
      status: 'active',
      avatarColor: '#335C67',
    });

    store.updateClient(client.id, { notes: 'Two weekly strength sessions.' });

    const persisted = JSON.parse(storage.getItem(LOCAL_DATA_STORAGE_KEY) ?? '{}') as {
      clients?: { id: string; notes?: string }[];
    };
    expect(persisted.clients?.find((item) => item.id === client.id)?.notes).toBe(
      'Two weekly strength sessions.',
    );
    expect(store.persistenceStatus()).toBe('available');
  });

  it('cascades client deletion through client-owned progress and sessions', () => {
    const store = createStore();
    const clientId = 'client-maya';

    expect(store.goalsForClient(clientId).length).toBeGreaterThan(0);
    expect(store.measurementsForClient(clientId).length).toBeGreaterThan(0);
    expect(store.sessionsForClient(clientId).length).toBeGreaterThan(0);

    expect(store.deleteClient(clientId)).toBe(true);
    expect(store.clientById(clientId)).toBeUndefined();
    expect(store.goalsForClient(clientId)).toHaveLength(0);
    expect(store.measurementsForClient(clientId)).toHaveLength(0);
    expect(store.photosForClient(clientId)).toHaveLength(0);
    expect(store.sessionsForClient(clientId)).toHaveLength(0);
  });

  it('falls back to demo data for corrupt persisted JSON', () => {
    const storage = new MemoryStorage();
    storage.setItem(LOCAL_DATA_STORAGE_KEY, '{not-json');

    const store = createStore(storage);

    expect(store.clients().length).toBeGreaterThan(0);
    expect(store.persistenceStatus()).toBe('available');
  });

  it('resets local changes back to demo data', () => {
    const store = createStore();
    store.deleteClient('client-maya');

    store.resetToDemoData();

    expect(store.clientById('client-maya')).toBeDefined();
  });
});
