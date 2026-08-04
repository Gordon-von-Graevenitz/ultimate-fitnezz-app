import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LocalDataStore } from '../../core/data/local-data.store';
import { ExerciseCategory } from '../../core/models/fitness.models';
import {
  RecommendedExerciseDraft,
  RecommendedSetDraft,
  WorkoutRecommendationDraft,
  WorkoutRecommendationRequest,
} from '../../core/models/workout-recommendation.models';
import { WorkoutRecommendationApi } from './data-access/workout-recommendation.api';
import { materializeRecommendation } from './workout-recommendation.mapper';

type ExerciseTextField = 'name' | 'primaryMuscleGroup' | 'equipment' | 'instructions' | 'notes';
type SetNumberField =
  | 'targetWeightKg'
  | 'targetReps'
  | 'targetDurationSeconds'
  | 'targetDistanceMeters'
  | 'targetRpe';

@Component({
  selector: 'app-workout-recommendation',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './workout-recommendation.html',
  styleUrl: './workout-recommendation.scss',
})
export class WorkoutRecommendation implements OnDestroy {
  private readonly store = inject(LocalDataStore);
  private readonly api = inject(WorkoutRecommendationApi);
  private readonly router = inject(Router);

  protected readonly clients = this.store.activeClients;
  protected readonly draft = signal<WorkoutRecommendationDraft | null>(null);
  protected readonly generating = signal(false);
  protected readonly transcribing = signal(false);
  protected readonly recording = signal(false);
  protected readonly recordingSeconds = signal(0);
  protected readonly errorMessage = signal('');
  protected readonly saving = signal(false);
  protected readonly newExerciseCount = computed(
    () => this.draft()?.exercises.filter((exercise) => !exercise.libraryExerciseId).length ?? 0,
  );

  protected readonly requestForm = new FormGroup({
    clientId: new FormControl('', { nonNullable: true }),
    prompt: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(5), Validators.maxLength(2000)],
    }),
  });

  protected readonly examplePrompts = [
    'Create a 45-minute full-body strength session using dumbbells and bodyweight.',
    'Plan a gentle mobility and core session for a beginner returning to training.',
    'Build a lower-body strength workout with an RPE of 7 and no jumping.',
  ];

  private mediaRecorder?: MediaRecorder;
  private mediaStream?: MediaStream;
  private recordingTimer?: ReturnType<typeof setInterval>;
  private audioChunks: Blob[] = [];

  ngOnDestroy(): void {
    this.clearRecordingResources();
  }

  protected useExample(prompt: string): void {
    this.requestForm.controls.prompt.setValue(prompt);
    this.requestForm.controls.prompt.markAsDirty();
  }

  protected async generateRecommendation(): Promise<void> {
    if (this.requestForm.invalid || this.generating() || this.transcribing()) {
      this.requestForm.markAllAsTouched();
      return;
    }

    this.errorMessage.set('');
    this.generating.set(true);
    try {
      this.draft.set(await this.api.recommend(this.buildRequest()));
    } catch (error) {
      this.errorMessage.set(this.messageFor(error, 'The plan could not be generated. Please try again.'));
    } finally {
      this.generating.set(false);
    }
  }

  protected async toggleRecording(): Promise<void> {
    if (this.recording()) {
      this.mediaRecorder?.stop();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      this.errorMessage.set('Voice recording is not supported by this browser. You can still type your request.');
      return;
    }

    this.errorMessage.set('');
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioChunks = [];
      this.mediaRecorder = new MediaRecorder(this.mediaStream);
      this.mediaRecorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      });
      this.mediaRecorder.addEventListener('stop', () => void this.finishRecording(), { once: true });
      this.mediaRecorder.start();
      this.recording.set(true);
      this.recordingSeconds.set(0);
      this.recordingTimer = setInterval(() => {
        const seconds = this.recordingSeconds() + 1;
        this.recordingSeconds.set(seconds);
        if (seconds >= 60 && this.mediaRecorder?.state === 'recording') {
          this.mediaRecorder.stop();
        }
      }, 1000);
    } catch {
      this.clearRecordingResources();
      this.errorMessage.set('Microphone access was not granted. Allow access or type your request instead.');
    }
  }

  protected startOver(): void {
    this.draft.set(null);
    this.errorMessage.set('');
  }

  protected updatePlanName(value: string): void {
    this.updateDraft((draft) => ({ ...draft, planName: value.slice(0, 60) }));
  }

  protected updateDescription(value: string): void {
    this.updateDraft((draft) => ({ ...draft, description: value.slice(0, 240) }));
  }

  protected updateExerciseText(index: number, field: ExerciseTextField, value: string): void {
    this.updateExercise(index, (exercise) => ({ ...exercise, [field]: value }));
  }

  protected updateExerciseCategory(index: number, value: string): void {
    const allowed: ExerciseCategory[] = ['strength', 'cardio', 'mobility', 'conditioning', 'recovery'];
    if (allowed.includes(value as ExerciseCategory)) {
      this.updateExercise(index, (exercise) => ({ ...exercise, category: value as ExerciseCategory }));
    }
  }

  protected updateRest(index: number, value: string): void {
    this.updateExercise(index, (exercise) => ({
      ...exercise,
      restSeconds: this.clampNumber(value, 0, 600, exercise.restSeconds),
    }));
  }

  protected updateSet(
    exerciseIndex: number,
    setIndex: number,
    field: SetNumberField,
    value: string,
  ): void {
    this.updateExercise(exerciseIndex, (exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set, index) =>
        index === setIndex ? { ...set, [field]: this.optionalNumber(value) } : set,
      ),
    }));
  }

  protected addSet(exerciseIndex: number): void {
    this.updateExercise(exerciseIndex, (exercise) => ({
      ...exercise,
      sets: [...exercise.sets, { ...(exercise.sets.at(-1) ?? { targetReps: 10, targetRpe: 7 }) }],
    }));
  }

  protected removeSet(exerciseIndex: number, setIndex: number): void {
    this.updateExercise(exerciseIndex, (exercise) => ({
      ...exercise,
      sets: exercise.sets.filter((_, index) => index !== setIndex),
    }));
  }

  protected removeExercise(exerciseIndex: number): void {
    this.updateDraft((draft) => ({
      ...draft,
      exercises: draft.exercises.filter((_, index) => index !== exerciseIndex),
    }));
  }

  protected async savePlan(): Promise<void> {
    const draft = this.draft();
    if (!draft || this.saving()) {
      return;
    }
    if (!draft.planName.trim() || draft.exercises.length === 0) {
      this.errorMessage.set('Give the plan a name and keep at least one exercise before saving.');
      return;
    }
    if (draft.exercises.some((exercise) => !exercise.name.trim() || exercise.sets.length === 0)) {
      this.errorMessage.set('Every exercise needs a name and at least one set.');
      return;
    }

    this.saving.set(true);
    this.errorMessage.set('');
    try {
      const materialized = materializeRecommendation(
        draft,
        (id) => Boolean(this.store.exerciseById(id)),
        (input) => this.store.createExercise(input),
        (prefix) => this.localId(prefix),
      );
      const template = this.store.createWorkoutTemplate(materialized.template);
      await this.router.navigate(['/workouts'], {
        queryParams: { created: template.id, source: 'ai' },
      });
    } catch {
      this.errorMessage.set('The draft was valid, but it could not be saved on this device.');
      this.saving.set(false);
    }
  }

  protected isNewExercise(exercise: RecommendedExerciseDraft): boolean {
    return !exercise.libraryExerciseId;
  }

  private buildRequest(): WorkoutRecommendationRequest {
    const { clientId, prompt } = this.requestForm.getRawValue();
    const clientContext = clientId
      ? {
          goals: this.store.goalsForClient(clientId).slice(0, 10).map((goal) => ({
            title: goal.title,
            category: goal.category,
          })),
          recentWorkouts: this.store.sessionsForClient(clientId).slice(0, 5).map((session) => ({
            name: session.name,
            completedAt: session.completedAt,
            exercises: session.exercises.map(
              (item) => this.store.exerciseById(item.exerciseId)?.name ?? 'Exercise',
            ),
          })),
        }
      : undefined;

    return {
      prompt: prompt.trim(),
      clientContext,
      exerciseCatalog: this.store.exercises().slice(0, 150).map((exercise) => ({
        id: exercise.id,
        name: exercise.name,
        category: exercise.category,
        primaryMuscleGroup: exercise.primaryMuscleGroup,
        equipment: exercise.equipment,
        metrics: exercise.metrics,
      })),
    };
  }

  private async finishRecording(): Promise<void> {
    const mimeType = this.mediaRecorder?.mimeType || this.audioChunks[0]?.type || 'audio/webm';
    const audio = new Blob(this.audioChunks, { type: mimeType });
    this.clearRecordingResources();
    if (audio.size === 0) {
      this.errorMessage.set('No audio was captured. Please try again or type your request.');
      return;
    }

    this.transcribing.set(true);
    try {
      const { text } = await this.api.transcribe(audio);
      const current = this.requestForm.controls.prompt.value.trim();
      this.requestForm.controls.prompt.setValue([current, text.trim()].filter(Boolean).join(' '));
      this.requestForm.controls.prompt.markAsDirty();
    } catch (error) {
      this.errorMessage.set(this.messageFor(error, 'The recording could not be transcribed.'));
    } finally {
      this.transcribing.set(false);
    }
  }

  private clearRecordingResources(): void {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = undefined;
    }
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = undefined;
    this.mediaRecorder = undefined;
    this.recording.set(false);
  }

  private updateDraft(
    updater: (draft: WorkoutRecommendationDraft) => WorkoutRecommendationDraft,
  ): void {
    this.draft.update((draft) => (draft ? updater(draft) : draft));
  }

  private updateExercise(
    index: number,
    updater: (exercise: RecommendedExerciseDraft) => RecommendedExerciseDraft,
  ): void {
    this.updateDraft((draft) => ({
      ...draft,
      exercises: draft.exercises.map((exercise, current) =>
        current === index ? updater(exercise) : exercise,
      ),
    }));
  }

  private optionalNumber(value: string): number | undefined {
    if (!value.trim()) {
      return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }

  private clampNumber(value: string, minimum: number, maximum: number, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
  }

  private messageFor(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.error === 'string') {
      return error.error.error;
    }
    return error instanceof Error && error.message ? error.message : fallback;
  }

  private localId(prefix: string): string {
    return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
  }
}
