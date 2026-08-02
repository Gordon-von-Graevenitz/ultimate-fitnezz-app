import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LocalDataStore } from '../../core/data/local-data.store';
import { CreateWorkoutTemplateInput, Exercise, WorkoutTemplate } from '../../core/models/fitness.models';

@Component({
  selector: 'app-workout-plans',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './workout-plans.html',
  styleUrl: './workout-plans.scss',
})
export class WorkoutPlans {
  private readonly store = inject(LocalDataStore);

  protected readonly templates = this.store.workoutTemplates;
  protected readonly exercises = this.store.exercises;
  protected readonly editorOpen = signal(false);
  protected readonly selectedExerciseIds = signal<ReadonlySet<string>>(new Set());
  protected readonly search = signal('');
  protected readonly visibleTemplates = computed(() => {
    const query = this.search().trim().toLowerCase();
    return query
      ? this.templates().filter((template) => `${template.name} ${template.description ?? ''}`.toLowerCase().includes(query))
      : this.templates();
  });

  protected readonly planForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(60)] }),
    description: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(160)] }),
  });

  protected openEditor(): void {
    this.planForm.reset({ name: '', description: '' });
    this.selectedExerciseIds.set(new Set());
    this.editorOpen.set(true);
  }

  protected closeEditor(): void {
    this.editorOpen.set(false);
  }

  protected toggleExercise(exerciseId: string): void {
    this.selectedExerciseIds.update((current) => {
      const next = new Set(current);
      next.has(exerciseId) ? next.delete(exerciseId) : next.add(exerciseId);
      return next;
    });
  }

  protected savePlan(): void {
    if (this.planForm.invalid || this.selectedExerciseIds().size === 0) {
      this.planForm.markAllAsTouched();
      return;
    }

    const { name, description } = this.planForm.getRawValue();
    const input: CreateWorkoutTemplateInput = {
      name: name.trim(),
      description: description.trim() || undefined,
      exercises: Array.from(this.selectedExerciseIds()).map((exerciseId, order) => ({
        id: this.localId('template-exercise'),
        exerciseId,
        order,
        restSeconds: 90,
        sets: Array.from({ length: 3 }, (_, index) => ({
          id: this.localId('template-set'),
          setNumber: index + 1,
          targetReps: 10,
          targetRpe: 7,
        })),
      })),
    };
    this.store.createWorkoutTemplate(input);
    this.closeEditor();
  }

  protected removePlan(template: WorkoutTemplate): void {
    if (confirm(`Delete “${template.name}”? Existing workout history will stay intact.`)) {
      this.store.deleteWorkoutTemplate(template.id);
    }
  }

  protected exerciseName(exerciseId: string): string {
    return this.store.exerciseById(exerciseId)?.name ?? 'Exercise';
  }

  protected trackExercise(exercise: Exercise): string {
    return exercise.id;
  }

  private localId(prefix: string): string {
    return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
  }
}
