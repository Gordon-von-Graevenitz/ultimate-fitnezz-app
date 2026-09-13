import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { LocalDataStore } from '../../../core/data/local-data.store';
import { ClientGoal, GoalCategory } from '../../../core/models/fitness.models';

type DetailTab = 'overview' | 'workouts' | 'progress';

@Component({
  selector: 'app-client-detail',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './client-detail.html',
  styleUrl: './client-detail.scss',
})
export class ClientDetail {
  readonly store = inject(LocalDataStore);
  private readonly route = inject(ActivatedRoute);
  readonly clientId = toSignal(this.route.paramMap.pipe(map((params) => params.get('clientId') ?? '')), {
    initialValue: '',
  });

  readonly activeTab = signal<DetailTab>('overview');
  readonly isMeasurementOpen = signal(false);
  readonly isGoalOpen = signal(false);

  readonly client = computed(() => this.store.clients().find((item) => item.id === this.clientId()));
  readonly goals = computed(() =>
    this.store
      .goals()
      .filter((goal) => goal.clientId === this.clientId())
      .sort((a, b) => a.status.localeCompare(b.status) || b.createdAt.localeCompare(a.createdAt)),
  );
  readonly activeGoals = computed(() => this.goals().filter((goal) => goal.status === 'active'));
  readonly measurements = computed(() =>
    this.store
      .measurements()
      .filter((item) => item.clientId === this.clientId())
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)),
  );
  readonly sessions = computed(() =>
    this.store
      .workoutSessions()
      .filter((item) => item.clientId === this.clientId())
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
  );
  readonly completedSessions = computed(
    () => this.sessions().filter((session) => session.status === 'completed').length,
  );
  readonly latestMeasurement = computed(() => this.measurements()[0]);
  readonly weightChange = computed(() => {
    const values = this.measurements().filter((item) => item.bodyWeightKg !== undefined);
    if (values.length < 2) return undefined;
    return (values[0].bodyWeightKg ?? 0) - (values.at(-1)?.bodyWeightKg ?? 0);
  });

  readonly measurementForm = new FormGroup({
    recordedAt: new FormControl(this.today(), { nonNullable: true, validators: [Validators.required] }),
    bodyWeightKg: new FormControl<number | null>(null),
    bodyFatPercent: new FormControl<number | null>(null),
    chestCm: new FormControl<number | null>(null),
    waistCm: new FormControl<number | null>(null),
    hipsCm: new FormControl<number | null>(null),
    leftArmCm: new FormControl<number | null>(null),
    rightArmCm: new FormControl<number | null>(null),
    leftThighCm: new FormControl<number | null>(null),
    rightThighCm: new FormControl<number | null>(null),
    restingHeartRateBpm: new FormControl<number | null>(null),
    notes: new FormControl('', { nonNullable: true }),
  });

  readonly goalForm = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    category: new FormControl<GoalCategory>('strength', { nonNullable: true }),
    targetValue: new FormControl<number | null>(null),
    currentValue: new FormControl<number | null>(null),
    unit: new FormControl('', { nonNullable: true }),
    targetDate: new FormControl('', { nonNullable: true }),
    notes: new FormControl('', { nonNullable: true }),
  });

  setTab(tab: DetailTab): void {
    this.activeTab.set(tab);
  }

  openMeasurement(): void {
    this.measurementForm.reset({ recordedAt: this.today(), notes: '' });
    this.isMeasurementOpen.set(true);
  }

  saveMeasurement(): void {
    if (this.measurementForm.invalid || !this.clientId()) return;
    const value = this.measurementForm.getRawValue();
    this.store.createMeasurement({
      clientId: this.clientId(),
      recordedAt: value.recordedAt,
      bodyWeightKg: value.bodyWeightKg ?? undefined,
      bodyFatPercent: value.bodyFatPercent ?? undefined,
      chestCm: value.chestCm ?? undefined,
      waistCm: value.waistCm ?? undefined,
      hipsCm: value.hipsCm ?? undefined,
      leftArmCm: value.leftArmCm ?? undefined,
      rightArmCm: value.rightArmCm ?? undefined,
      leftThighCm: value.leftThighCm ?? undefined,
      rightThighCm: value.rightThighCm ?? undefined,
      restingHeartRateBpm: value.restingHeartRateBpm ?? undefined,
      notes: value.notes.trim() || undefined,
    });
    this.isMeasurementOpen.set(false);
    this.activeTab.set('progress');
  }

  openGoal(): void {
    this.goalForm.reset({ category: 'strength', title: '', unit: '', targetDate: '', notes: '' });
    this.isGoalOpen.set(true);
  }

  saveGoal(): void {
    if (this.goalForm.invalid || !this.clientId()) {
      this.goalForm.markAllAsTouched();
      return;
    }
    const value = this.goalForm.getRawValue();
    this.store.createGoal({
      clientId: this.clientId(),
      title: value.title.trim(),
      category: value.category,
      status: 'active',
      targetValue: value.targetValue ?? undefined,
      currentValue: value.currentValue ?? undefined,
      unit: value.unit.trim() || undefined,
      targetDate: value.targetDate || undefined,
      notes: value.notes.trim() || undefined,
    });
    this.isGoalOpen.set(false);
  }

  toggleGoal(goal: ClientGoal): void {
    this.store.updateGoal(goal.id, { status: goal.status === 'achieved' ? 'active' : 'achieved' });
  }

  goalProgress(goal: ClientGoal): number {
    if (goal.status === 'achieved') return 100;
    if (!goal.targetValue || goal.currentValue === undefined) return 0;
    return Math.max(0, Math.min(100, Math.round((goal.currentValue / goal.targetValue) * 100)));
  }

  completedSets(sessionId: string): number {
    const session = this.sessions().find((item) => item.id === sessionId);
    return session?.exercises.reduce(
      (count, exercise) => count + exercise.sets.filter((set) => set.status === 'completed').length,
      0,
    ) ?? 0;
  }

  initials(firstName: string, lastName: string): string {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  }

  formatDate(value: string): string {
    return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(
      new Date(value),
    );
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

}
