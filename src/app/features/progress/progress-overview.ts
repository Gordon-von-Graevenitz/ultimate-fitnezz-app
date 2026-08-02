import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LocalDataStore } from '../../core/data/local-data.store';
import { WorkoutSet } from '../../core/models/fitness.models';

interface ProgressView {
  id: string;
  name: string;
  goal: string;
  adherence: number;
  sessions: number;
  personalRecords: number;
  weightChange: string;
  weight: Array<{ label: string; value: number }>;
  records: Array<{ exercise: string; result: string; date: string }>;
}

const EMPTY_PROGRESS: ProgressView = {
  id: '',
  name: 'No customer selected',
  goal: 'Add a customer to begin tracking progress',
  adherence: 0,
  sessions: 0,
  personalRecords: 0,
  weightChange: 'No baseline',
  weight: [],
  records: [],
};

@Component({
  selector: 'app-progress-overview',
  imports: [FormsModule, RouterLink],
  templateUrl: './progress-overview.html',
  styleUrl: './progress-overview.scss',
})
export class ProgressOverview {
  private readonly store = inject(LocalDataStore);

  protected readonly customers = computed<ProgressView[]>(() =>
    this.store.clients().map((client) => {
      const sessions = this.store.sessionsForClient(client.id);
      const completed = sessions.filter((session) => session.status === 'completed');
      const decided = sessions.filter(
        (session) => session.status === 'completed' || session.status === 'cancelled',
      );
      const weights = this.store
        .measurementsForClient(client.id)
        .filter((measurement) => measurement.bodyWeightKg !== undefined)
        .map((measurement) => ({
          label: new Intl.DateTimeFormat('en', { month: 'short' }).format(
            new Date(`${measurement.recordedAt}T12:00:00`),
          ),
          value: measurement.bodyWeightKg!,
        }));
      const records = this.personalRecords(client.id);
      const firstWeight = weights.at(0)?.value;
      const latestWeight = weights.at(-1)?.value;
      const delta = firstWeight !== undefined && latestWeight !== undefined ? latestWeight - firstWeight : undefined;
      const activeGoal = this.store
        .goalsForClient(client.id)
        .find((goal) => goal.status === 'active');

      return {
        id: client.id,
        name: `${client.firstName} ${client.lastName}`,
        goal: activeGoal?.title ?? 'Build consistent training habits',
        adherence: decided.length
          ? Math.round((completed.length / decided.length) * 100)
          : 0,
        sessions: completed.length,
        personalRecords: records.length,
        weightChange:
          delta === undefined
            ? 'No baseline'
            : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta).toFixed(1)} kg`,
        weight: weights,
        records,
      };
    }),
  );

  protected readonly selectedId = signal(this.store.clients()[0]?.id ?? '');
  protected readonly selected = computed(
    () => this.customers().find((item) => item.id === this.selectedId()) ?? this.customers()[0] ?? EMPTY_PROGRESS,
  );
  protected readonly weightRange = computed(() => {
    const points = this.selected().weight.map((point) => point.value);
    return points.length
      ? { min: Math.min(...points) - 0.5, max: Math.max(...points) + 0.5 }
      : { min: 0, max: 1 };
  });

  protected barHeight(value: number): number {
    const { min, max } = this.weightRange();
    return 24 + ((value - min) / Math.max(max - min, 1)) * 68;
  }

  private personalRecords(clientId: string): ProgressView['records'] {
    const bestByExercise = new Map<
      string,
      { set: WorkoutSet; score: number; startedAt: string }
    >();

    for (const session of this.store.sessionsForClient(clientId)) {
      if (session.status !== 'completed') continue;
      for (const workoutExercise of session.exercises) {
        for (const set of workoutExercise.sets) {
          if (set.status !== 'completed') continue;
          const score = this.setScore(set);
          const existing = bestByExercise.get(workoutExercise.exerciseId);
          if (!existing || score > existing.score) {
            bestByExercise.set(workoutExercise.exerciseId, {
              set,
              score,
              startedAt: session.startedAt,
            });
          }
        }
      }
    }

    return Array.from(bestByExercise.entries())
      .map(([exerciseId, record]) => ({
        exercise: this.store.exerciseById(exerciseId)?.name ?? 'Exercise',
        result: this.setResult(record.set),
        date: new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(
          new Date(record.startedAt),
        ),
      }))
      .slice(0, 3);
  }

  private setScore(set: WorkoutSet): number {
    if (set.weightKg !== undefined) return set.weightKg * 1000 + (set.reps ?? 0);
    if (set.distanceMeters !== undefined) return set.distanceMeters;
    if (set.durationSeconds !== undefined) return set.durationSeconds;
    return set.reps ?? 0;
  }

  private setResult(set: WorkoutSet): string {
    if (set.weightKg !== undefined) {
      return `${set.weightKg} kg${set.reps !== undefined ? ` × ${set.reps}` : ''}`;
    }
    if (set.distanceMeters !== undefined) {
      return set.distanceMeters >= 1000
        ? `${(set.distanceMeters / 1000).toFixed(1)} km`
        : `${set.distanceMeters} m`;
    }
    if (set.durationSeconds !== undefined) {
      const minutes = Math.floor(set.durationSeconds / 60);
      const seconds = set.durationSeconds % 60;
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${set.reps ?? 0} reps`;
  }
}
