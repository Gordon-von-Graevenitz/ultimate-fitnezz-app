import { Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { LocalDataStore } from '../../core/data/local-data.store';
import type { WorkoutSession, WorkoutSet } from '../../core/models/fitness.models';

type SetField =
  | 'weightKg'
  | 'reps'
  | 'durationSeconds'
  | 'distanceMeters'
  | 'rpe'
  | 'notes';

interface SessionSetDraft {
  id: string;
  completed: boolean;
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  rpe: number | null;
  notes: string;
}

interface SessionExerciseDraft {
  id: string;
  exerciseId: string;
  name: string;
  target: string;
  notes: string;
  sets: SessionSetDraft[];
}

interface SessionDraft {
  clientId: string;
  clientName: string;
  name: string;
  startedAt: string;
  notes: string;
  exercises: SessionExerciseDraft[];
}

@Component({
  selector: 'app-workout-session',
  imports: [FormsModule],
  templateUrl: './workout-session.component.html',
  styleUrl: './workout-session.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'workout-session-host' },
})
export class WorkoutSessionComponent {
  private readonly store = inject(LocalDataStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);

  private readonly startedAtMs = Date.now();
  private readonly nowMs = signal(this.startedAtMs);
  private nextId = 100;

  readonly clients = this.store.activeClients;
  readonly selectedClientId = signal(
    this.route.snapshot.queryParamMap.get('clientId') ?? this.store.activeClients()[0]?.id ?? '',
  );
  readonly clientName = computed(() => {
    const client = this.store.clientById(this.selectedClientId());
    return client ? `${client.firstName} ${client.lastName}` : 'Select a customer';
  });
  readonly sessionName = signal(
    this.route.snapshot.queryParamMap.get('sessionName') ?? 'Lower body strength',
  );
  readonly sessionNotes = signal('');
  readonly statusMessage = signal('Workout in progress');
  readonly isSaving = signal(false);
  readonly restSecondsRemaining = signal(0);
  readonly restSecondsTotal = signal(90);
  readonly isAddingExercise = signal(false);
  readonly exerciseToAdd = signal('');
  readonly exerciseOptions = this.store.exercises;

  readonly exercises = signal<SessionExerciseDraft[]>(this.createInitialExercises());

  readonly elapsedLabel = computed(() => this.formatDuration((this.nowMs() - this.startedAtMs) / 1000));
  readonly restLabel = computed(() => this.formatDuration(this.restSecondsRemaining()));
  readonly completedSetCount = computed(() =>
    this.exercises().reduce(
      (total, exercise) => total + exercise.sets.filter((set) => set.completed).length,
      0,
    ),
  );
  readonly totalSetCount = computed(() =>
    this.exercises().reduce((total, exercise) => total + exercise.sets.length, 0),
  );
  readonly progressPercent = computed(() => {
    const total = this.totalSetCount();
    return total === 0 ? 0 : Math.round((this.completedSetCount() / total) * 100);
  });

  constructor() {
    const timer = window.setInterval(() => {
      this.nowMs.set(Date.now());
      this.restSecondsRemaining.update((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    this.destroyRef.onDestroy(() => window.clearInterval(timer));
  }

  updateSessionName(value: string): void {
    this.sessionName.set(value);
  }

  updateClient(clientId: string): void {
    this.selectedClientId.set(clientId);
  }

  updateSessionNotes(value: string): void {
    this.sessionNotes.set(value);
  }

  updateExerciseNotes(exerciseId: string, value: string): void {
    this.updateExercise(exerciseId, (exercise) => ({ ...exercise, notes: value }));
  }

  updateSet(
    exerciseId: string,
    setId: string,
    field: SetField,
    value: number | string | null,
  ): void {
    this.updateExercise(exerciseId, (exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => (set.id === setId ? { ...set, [field]: value } : set)),
    }));
  }

  toggleSet(exerciseId: string, setId: string, completed: boolean): void {
    this.updateExercise(exerciseId, (exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => (set.id === setId ? { ...set, completed } : set)),
    }));

    if (completed) {
      this.startRestTimer();
      this.statusMessage.set('Set complete · rest timer started');
    }
  }

  addSet(exerciseId: string): void {
    this.updateExercise(exerciseId, (exercise) => {
      const previous = exercise.sets.at(-1);
      return {
        ...exercise,
        sets: [
          ...exercise.sets,
          {
            ...this.createSet(),
            weightKg: previous?.weightKg ?? null,
            reps: previous?.reps ?? null,
            durationSeconds: previous?.durationSeconds ?? null,
            distanceMeters: previous?.distanceMeters ?? null,
          },
        ],
      };
    });
  }

  removeSet(exerciseId: string, setId: string): void {
    this.updateExercise(exerciseId, (exercise) => ({
      ...exercise,
      sets: exercise.sets.filter((set) => set.id !== setId),
    }));
  }

  openExercisePicker(): void {
    this.exerciseToAdd.set(this.exerciseOptions()[0]?.id ?? '');
    this.isAddingExercise.set(true);
  }

  closeExercisePicker(): void {
    this.isAddingExercise.set(false);
  }

  updateExerciseToAdd(exerciseId: string): void {
    this.exerciseToAdd.set(exerciseId);
  }

  addExercise(): void {
    const exercise = this.store.exerciseById(this.exerciseToAdd());
    if (!exercise) {
      this.statusMessage.set('Choose an exercise to add');
      return;
    }

    this.exercises.update((exercises) => [
      ...exercises,
      this.createExercise(exercise.id, exercise.name, exercise.primaryMuscleGroup, 1),
    ]);
    this.isAddingExercise.set(false);
    this.statusMessage.set(`${exercise.name} added`);
  }

  removeExercise(exerciseId: string): void {
    const exercise = this.exercises().find((item) => item.id === exerciseId);
    if (!exercise || !window.confirm(`Remove ${exercise.name} from this workout?`)) {
      return;
    }

    this.exercises.update((exercises) => exercises.filter((item) => item.id !== exerciseId));
  }

  startRestTimer(seconds = this.restSecondsTotal()): void {
    this.restSecondsTotal.set(seconds);
    this.restSecondsRemaining.set(seconds);
  }

  stopRestTimer(): void {
    this.restSecondsRemaining.set(0);
    this.statusMessage.set('Rest timer dismissed');
  }

  async finishWorkout(): Promise<void> {
    if (this.isSaving()) {
      return;
    }

    if (this.completedSetCount() === 0) {
      this.statusMessage.set('Complete at least one set before finishing');
      return;
    }

    if (!this.store.clientById(this.selectedClientId())) {
      this.statusMessage.set('Select a customer before finishing');
      return;
    }

    this.isSaving.set(true);
    try {
      const completedAt = new Date().toISOString();
      const session = this.saveCompletedSession(this.createDraft(), completedAt);
      this.statusMessage.set('Workout saved');
      await this.router.navigate(['/clients', session.clientId], {
        queryParams: { workoutSaved: session.id },
      });
    } catch {
      this.statusMessage.set('The workout could not be saved. Check the session and try again.');
      this.isSaving.set(false);
    }
  }

  cancelWorkout(): void {
    const hasEntries = this.completedSetCount() > 0 || this.hasSetValues();
    if (hasEntries && !window.confirm('Discard this workout and all recorded sets?')) {
      return;
    }

    this.location.back();
  }

  controlId(exerciseId: string, setId: string, field: SetField | 'completed'): string {
    return `${exerciseId}-${setId}-${field}`;
  }

  setNumber(exerciseId: string, setId: string): number {
    const exercise = this.exercises().find((item) => item.id === exerciseId);
    return (exercise?.sets.findIndex((set) => set.id === setId) ?? 0) + 1;
  }

  private saveCompletedSession(draft: SessionDraft, completedAt: string): WorkoutSession {
    return this.store.createWorkoutSession({
      clientId: draft.clientId,
      name: draft.name.trim() || 'Recorded workout',
      startedAt: draft.startedAt,
      completedAt,
      status: 'completed',
      notes: draft.notes.trim() || undefined,
      exercises: draft.exercises.map((exercise, exerciseIndex) => ({
        id: exercise.id,
        exerciseId: exercise.exerciseId,
        order: exerciseIndex,
        notes: exercise.notes.trim() || undefined,
        sets: exercise.sets.map(
          (set, setIndex): WorkoutSet => ({
            id: set.id,
            setNumber: setIndex + 1,
            status: set.completed ? 'completed' : 'skipped',
            weightKg: set.weightKg ?? undefined,
            reps: set.reps ?? undefined,
            durationSeconds: set.durationSeconds ?? undefined,
            distanceMeters: set.distanceMeters ?? undefined,
            rpe: set.rpe ?? undefined,
            notes: set.notes.trim() || undefined,
          }),
        ),
      })),
    });
  }

  private createDraft(): SessionDraft {
    return {
      clientId: this.selectedClientId(),
      clientName: this.clientName(),
      name: this.sessionName(),
      startedAt: new Date(this.startedAtMs).toISOString(),
      notes: this.sessionNotes(),
      exercises: this.exercises(),
    };
  }

  private updateExercise(
    exerciseId: string,
    updater: (exercise: SessionExerciseDraft) => SessionExerciseDraft,
  ): void {
    this.exercises.update((exercises) =>
      exercises.map((exercise) => (exercise.id === exerciseId ? updater(exercise) : exercise)),
    );
  }

  private createExercise(
    exerciseId: string,
    name: string,
    target: string,
    setCount: number,
  ): SessionExerciseDraft {
    return {
      id: this.createId('workout-exercise'),
      exerciseId,
      name,
      target,
      notes: '',
      sets: Array.from({ length: setCount }, () => this.createSet()),
    };
  }

  private createInitialExercises(): SessionExerciseDraft[] {
    const templateId = this.route.snapshot.queryParamMap.get('template');
    const template = templateId ? this.store.templateById(templateId) : undefined;

    if (template) {
      this.sessionName.set(template.name);
      return template.exercises.map((templateExercise) => {
        const exercise = this.store.exerciseById(templateExercise.exerciseId);
        const firstSet = templateExercise.sets[0];
        const targetParts = [
          `${templateExercise.sets.length} sets`,
          firstSet?.targetReps ? `${firstSet.targetReps} reps` : '',
          firstSet?.targetDurationSeconds ? `${firstSet.targetDurationSeconds} sec` : '',
          firstSet?.targetDistanceMeters ? `${firstSet.targetDistanceMeters} m` : '',
        ].filter(Boolean);
        return this.createExercise(
          templateExercise.exerciseId,
          exercise?.name ?? 'Exercise',
          targetParts.join(' · '),
          Math.max(1, templateExercise.sets.length),
        );
      });
    }

    const defaults = [
      ['exercise-back-squat', '4 sets · 6–8 reps', 4],
      ['exercise-lunge', '3 sets · 10/side', 3],
      ['exercise-plank', '3 sets · 40 seconds', 3],
    ] as const;

    return defaults.map(([exerciseId, target, sets]) => {
      const exercise = this.store.exerciseById(exerciseId);
      return this.createExercise(exerciseId, exercise?.name ?? 'Exercise', target, sets);
    });
  }

  private createSet(): SessionSetDraft {
    return {
      id: this.createId('set'),
      completed: false,
      weightKg: null,
      reps: null,
      durationSeconds: null,
      distanceMeters: null,
      rpe: null,
      notes: '',
    };
  }

  private createId(prefix: string): string {
    this.nextId += 1;
    return `${prefix}-${Date.now()}-${this.nextId}`;
  }

  private formatDuration(seconds: number): string {
    const wholeSeconds = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    const remainder = wholeSeconds % 60;
    return hours > 0
      ? `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`
      : `${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
  }

  private hasSetValues(): boolean {
    return this.exercises().some((exercise) =>
      exercise.sets.some(
        (set) =>
          set.weightKg !== null ||
          set.reps !== null ||
          set.durationSeconds !== null ||
          set.distanceMeters !== null ||
          set.rpe !== null ||
          set.notes.trim().length > 0,
      ),
    );
  }
}
