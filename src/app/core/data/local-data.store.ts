import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { createDemoFitnessData } from './demo-data';
import { FitnessDataApi } from './fitness-data.api';
import {
  BodyMeasurement,
  Client,
  ClientGoal,
  CreateClientInput,
  CreateExerciseInput,
  CreateGoalInput,
  CreateMeasurementInput,
  CreateWorkoutSessionInput,
  CreateWorkoutTemplateInput,
  EntityId,
  Exercise,
  FitnessDataSnapshot,
  UpdateClientInput,
  UpdateExerciseInput,
  UpdateGoalInput,
  UpdateMeasurementInput,
  UpdateWorkoutSessionInput,
  UpdateWorkoutTemplateInput,
  WorkoutSession,
  WorkoutTemplate,
} from '../models/fitness.models';

export const LOCAL_DATA_STORAGE_KEY = 'ultimate-fitnezz.local-data.v1';
const ACCOUNT_CACHE_PREFIX = 'ultimate-fitnezz.account-cache.v1:';

export const LOCAL_DATA_STORAGE = new InjectionToken<Storage | null>('LOCAL_DATA_STORAGE', {
  providedIn: 'root',
  factory: () => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  },
});

export type PersistenceStatus = 'available' | 'unavailable' | 'error';
export type CloudSyncStatus =
  | 'local'
  | 'loading'
  | 'migration-pending'
  | 'syncing'
  | 'synced'
  | 'error';

@Injectable({ providedIn: 'root' })
export class LocalDataStore {
  private readonly storage = inject(LOCAL_DATA_STORAGE);
  private readonly api = inject(FitnessDataApi);
  private readonly storedSnapshot = this.loadStoredData();
  private readonly dataState = signal<FitnessDataSnapshot>(
    this.storedSnapshot ?? createDemoFitnessData(),
  );
  private readonly persistenceState = signal<PersistenceStatus>(
    this.storage === null ? 'unavailable' : 'available',
  );
  private readonly cloudState = signal<CloudSyncStatus>('local');
  private readonly cloudErrorState = signal<string | null>(null);
  private cloudEnabled = false;
  private deviceStorageKey = LOCAL_DATA_STORAGE_KEY;
  private saveQueue: Promise<void> = Promise.resolve();

  readonly snapshot = this.dataState.asReadonly();
  readonly persistenceStatus = this.persistenceState.asReadonly();
  readonly cloudSyncStatus = this.cloudState.asReadonly();
  readonly cloudSyncError = this.cloudErrorState.asReadonly();
  readonly migrationPending = computed(() => this.cloudState() === 'migration-pending');

  readonly clients = computed(() => this.dataState().clients);
  readonly activeClients = computed(() =>
    this.dataState().clients.filter((client) => client.status === 'active'),
  );
  readonly goals = computed(() => this.dataState().goals);
  readonly measurements = computed(() => this.dataState().measurements);
  readonly exercises = computed(() => this.dataState().exercises);
  readonly workoutTemplates = computed(() => this.dataState().workoutTemplates);
  readonly workoutSessions = computed(() => this.dataState().workoutSessions);

  /** Concise aliases used by feature components. */
  readonly templates = this.workoutTemplates;
  readonly sessions = this.workoutSessions;

  async initializeCloudSync(enabled: boolean, accountEmail?: string | null): Promise<void> {
    if (!enabled) return;

    this.deviceStorageKey = `${ACCOUNT_CACHE_PREFIX}${(accountEmail ?? 'unknown').trim().toLowerCase()}`;
    const accountCache = this.loadStoredData(this.deviceStorageKey);
    this.dataState.set(accountCache ?? this.emptySnapshot());
    this.cloudState.set('loading');
    this.cloudErrorState.set(null);
    try {
      const envelope = await this.api.load();
      if (envelope.hasData) {
        this.cloudEnabled = true;
        this.replaceData(this.normalizeSnapshot(envelope.snapshot), false);
        this.cloudState.set('synced');
        return;
      }

      if (accountCache || this.storedSnapshot) {
        this.dataState.set(accountCache ?? this.storedSnapshot!);
        this.cloudState.set('migration-pending');
        return;
      }

      this.cloudEnabled = true;
      this.replaceData(this.emptySnapshot(), false);
      this.cloudState.set('synced');
    } catch {
      this.cloudState.set('error');
      this.cloudErrorState.set(
        'Cloud data could not be loaded. This device copy is still available; try again when online.',
      );
    }
  }

  async importDeviceData(): Promise<void> {
    if (!this.migrationPending()) return;
    this.cloudState.set('syncing');
    this.cloudErrorState.set(null);
    try {
      const envelope = await this.api.save(this.dataState());
      this.cloudEnabled = true;
      this.replaceData(this.normalizeSnapshot(envelope.snapshot), false);
      this.removeLegacyDeviceCopy();
      this.cloudState.set('synced');
    } catch {
      this.cloudState.set('migration-pending');
      this.cloudErrorState.set('The import did not complete. No device data was removed; try again.');
    }
  }

  retryCloudSync(): void {
    if (!this.cloudEnabled) return;
    this.queueCloudSave(this.dataState());
  }

  clientById(id: EntityId): Client | undefined {
    return this.clients().find((client) => client.id === id);
  }

  exerciseById(id: EntityId): Exercise | undefined {
    return this.exercises().find((exercise) => exercise.id === id);
  }

  templateById(id: EntityId): WorkoutTemplate | undefined {
    return this.workoutTemplates().find((template) => template.id === id);
  }

  sessionById(id: EntityId): WorkoutSession | undefined {
    return this.workoutSessions().find((session) => session.id === id);
  }

  goalsForClient(clientId: EntityId): readonly ClientGoal[] {
    return this.goals().filter((goal) => goal.clientId === clientId);
  }

  measurementsForClient(clientId: EntityId): readonly BodyMeasurement[] {
    return [...this.measurements().filter((measurement) => measurement.clientId === clientId)].sort(
      (a, b) => a.recordedAt.localeCompare(b.recordedAt),
    );
  }

  sessionsForClient(clientId: EntityId): readonly WorkoutSession[] {
    return [...this.workoutSessions().filter((session) => session.clientId === clientId)].sort(
      (a, b) => b.startedAt.localeCompare(a.startedAt),
    );
  }

  createClient(input: CreateClientInput): Client {
    const now = this.now();
    const client: Client = { ...input, id: this.createId(), createdAt: now, updatedAt: now };
    this.commit((data) => ({ ...data, clients: [...data.clients, client] }));
    return client;
  }

  updateClient(id: EntityId, changes: UpdateClientInput): Client | undefined {
    return this.updateEntity('clients', id, changes);
  }

  deleteClient(id: EntityId): boolean {
    if (!this.clientById(id)) {
      return false;
    }

    this.commit((data) => ({
      ...data,
      clients: data.clients.filter((client) => client.id !== id),
      goals: data.goals.filter((goal) => goal.clientId !== id),
      measurements: data.measurements.filter((measurement) => measurement.clientId !== id),
      workoutSessions: data.workoutSessions.filter((session) => session.clientId !== id),
    }));
    return true;
  }

  createGoal(input: CreateGoalInput): ClientGoal {
    this.assertClientExists(input.clientId);
    const now = this.now();
    const goal: ClientGoal = { ...input, id: this.createId(), createdAt: now, updatedAt: now };
    this.commit((data) => ({ ...data, goals: [...data.goals, goal] }));
    return goal;
  }

  updateGoal(id: EntityId, changes: UpdateGoalInput): ClientGoal | undefined {
    return this.updateEntity('goals', id, changes);
  }

  deleteGoal(id: EntityId): boolean {
    return this.deleteEntity('goals', id);
  }

  createMeasurement(input: CreateMeasurementInput): BodyMeasurement {
    this.assertClientExists(input.clientId);
    const now = this.now();
    const measurement: BodyMeasurement = {
      ...input,
      id: this.createId(),
      createdAt: now,
      updatedAt: now,
    };
    this.commit((data) => ({ ...data, measurements: [...data.measurements, measurement] }));
    return measurement;
  }

  updateMeasurement(id: EntityId, changes: UpdateMeasurementInput): BodyMeasurement | undefined {
    return this.updateEntity('measurements', id, changes);
  }

  deleteMeasurement(id: EntityId): boolean {
    return this.deleteEntity('measurements', id);
  }

  createExercise(input: CreateExerciseInput): Exercise {
    const now = this.now();
    const exercise: Exercise = { ...input, id: this.createId(), createdAt: now, updatedAt: now };
    this.commit((data) => ({ ...data, exercises: [...data.exercises, exercise] }));
    return exercise;
  }

  updateExercise(id: EntityId, changes: UpdateExerciseInput): Exercise | undefined {
    return this.updateEntity('exercises', id, changes);
  }

  deleteExercise(id: EntityId): boolean {
    const isInUse =
      this.workoutTemplates().some((template) =>
        template.exercises.some((item) => item.exerciseId === id),
      ) ||
      this.workoutSessions().some((session) =>
        session.exercises.some((item) => item.exerciseId === id),
      );

    return isInUse ? false : this.deleteEntity('exercises', id);
  }

  createWorkoutTemplate(input: CreateWorkoutTemplateInput): WorkoutTemplate {
    this.assertExercisesExist(input.exercises.map((item) => item.exerciseId));
    const now = this.now();
    const template: WorkoutTemplate = {
      ...input,
      id: this.createId(),
      createdAt: now,
      updatedAt: now,
    };
    this.commit((data) => ({
      ...data,
      workoutTemplates: [...data.workoutTemplates, template],
    }));
    return template;
  }

  updateWorkoutTemplate(
    id: EntityId,
    changes: UpdateWorkoutTemplateInput,
  ): WorkoutTemplate | undefined {
    if (changes.exercises) {
      this.assertExercisesExist(changes.exercises.map((item) => item.exerciseId));
    }
    return this.updateEntity('workoutTemplates', id, changes);
  }

  deleteWorkoutTemplate(id: EntityId): boolean {
    return this.deleteEntity('workoutTemplates', id);
  }

  createWorkoutSession(input: CreateWorkoutSessionInput): WorkoutSession {
    this.assertClientExists(input.clientId);
    this.assertExercisesExist(input.exercises.map((item) => item.exerciseId));
    const now = this.now();
    const session: WorkoutSession = {
      ...input,
      id: this.createId(),
      createdAt: now,
      updatedAt: now,
    };
    this.commit((data) => ({
      ...data,
      workoutSessions: [...data.workoutSessions, session],
    }));
    return session;
  }

  updateWorkoutSession(
    id: EntityId,
    changes: UpdateWorkoutSessionInput,
  ): WorkoutSession | undefined {
    if (changes.exercises) {
      this.assertExercisesExist(changes.exercises.map((item) => item.exerciseId));
    }
    return this.updateEntity('workoutSessions', id, changes);
  }

  deleteWorkoutSession(id: EntityId): boolean {
    return this.deleteEntity('workoutSessions', id);
  }

  /** Replaces all local changes with a fresh copy of the bundled demo data. */
  resetToDemoData(): void {
    this.replaceData(createDemoFitnessData());
  }

  private loadStoredData(key = LOCAL_DATA_STORAGE_KEY): FitnessDataSnapshot | undefined {
    if (!this.storage) {
      return undefined;
    }

    try {
      const storedValue = this.storage.getItem(key);
      if (!storedValue) {
        return undefined;
      }

      const parsed: unknown = JSON.parse(storedValue);
      return this.isFitnessDataSnapshot(parsed) ? this.normalizeSnapshot(parsed) : undefined;
    } catch {
      return undefined;
    }
  }

  private commit(mutator: (current: FitnessDataSnapshot) => FitnessDataSnapshot): void {
    this.replaceData(mutator(this.dataState()));
  }

  private replaceData(data: FitnessDataSnapshot, syncToCloud = true): void {
    this.dataState.set(data);
    this.persistDeviceCopy(data);
    if (syncToCloud && this.cloudEnabled) {
      this.queueCloudSave(data);
    }
  }

  private persistDeviceCopy(data: FitnessDataSnapshot): void {
    if (!this.storage) {
      this.persistenceState.set('unavailable');
      return;
    }

    try {
      this.storage.setItem(this.deviceStorageKey, JSON.stringify(data));
      this.persistenceState.set('available');
    } catch {
      // Keep the in-memory update usable even when privacy mode or quota blocks persistence.
      this.persistenceState.set('error');
    }
  }

  private removeLegacyDeviceCopy(): void {
    if (!this.storage || this.deviceStorageKey === LOCAL_DATA_STORAGE_KEY) return;
    try {
      this.storage.removeItem(LOCAL_DATA_STORAGE_KEY);
    } catch {
      // The confirmed account-scoped copy remains available even if legacy cleanup is blocked.
    }
  }

  private queueCloudSave(data: FitnessDataSnapshot): void {
    const snapshot = this.normalizeSnapshot(data);
    const expected = JSON.stringify(snapshot);
    this.cloudState.set('syncing');
    this.cloudErrorState.set(null);
    this.saveQueue = this.saveQueue
      .catch(() => undefined)
      .then(async () => {
        await this.api.save(snapshot);
        if (JSON.stringify(this.dataState()) === expected) {
          this.cloudState.set('synced');
        }
      })
      .catch(() => {
        this.cloudState.set('error');
        this.cloudErrorState.set(
          'This change is saved on this device but has not reached the cloud. Try again when online.',
        );
      });
  }

  private updateEntity<K extends MutableCollectionKey>(
    key: K,
    id: EntityId,
    changes: Partial<FitnessDataSnapshot[K][number]>,
  ): FitnessDataSnapshot[K][number] | undefined {
    const current = this.dataState()[key];
    const existing = current.find((entity) => entity.id === id);
    if (!existing) {
      return undefined;
    }

    const updated = {
      ...existing,
      ...changes,
      id,
      updatedAt: this.now(),
    } as FitnessDataSnapshot[K][number];
    this.commit((data) => ({
      ...data,
      [key]: data[key].map((entity) => (entity.id === id ? updated : entity)),
    }));
    return updated;
  }

  private deleteEntity(key: MutableCollectionKey, id: EntityId): boolean {
    const current = this.dataState()[key];
    if (!current.some((entity) => entity.id === id)) {
      return false;
    }

    this.commit((data) => ({
      ...data,
      [key]: data[key].filter((entity) => entity.id !== id),
    }));
    return true;
  }

  private assertClientExists(clientId: EntityId): void {
    if (!this.clientById(clientId)) {
      throw new Error(`Client not found: ${clientId}`);
    }
  }

  private assertExercisesExist(exerciseIds: readonly EntityId[]): void {
    const knownIds = new Set(this.exercises().map((exercise) => exercise.id));
    const missingId = exerciseIds.find((id) => !knownIds.has(id));
    if (missingId) {
      throw new Error(`Exercise not found: ${missingId}`);
    }
  }

  private isFitnessDataSnapshot(value: unknown): value is FitnessDataSnapshot {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const candidate = value as Record<string, unknown>;
    return (
      candidate['schemaVersion'] === 1 &&
      Array.isArray(candidate['clients']) &&
      Array.isArray(candidate['goals']) &&
      Array.isArray(candidate['measurements']) &&
      Array.isArray(candidate['exercises']) &&
      Array.isArray(candidate['workoutTemplates']) &&
      Array.isArray(candidate['workoutSessions'])
    );
  }

  private normalizeSnapshot(value: FitnessDataSnapshot): FitnessDataSnapshot {
    return {
      schemaVersion: 1,
      clients: value.clients,
      goals: value.goals,
      measurements: value.measurements,
      exercises: value.exercises,
      workoutTemplates: value.workoutTemplates,
      workoutSessions: value.workoutSessions,
    };
  }

  private emptySnapshot(): FitnessDataSnapshot {
    return {
      schemaVersion: 1,
      clients: [],
      goals: [],
      measurements: [],
      exercises: [],
      workoutTemplates: [],
      workoutSessions: [],
    };
  }

  private createId(): EntityId {
    try {
      return globalThis.crypto.randomUUID();
    } catch {
      return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  private now(): string {
    return new Date().toISOString();
  }
}

type MutableCollectionKey =
  | 'clients'
  | 'goals'
  | 'measurements'
  | 'exercises'
  | 'workoutTemplates'
  | 'workoutSessions';
