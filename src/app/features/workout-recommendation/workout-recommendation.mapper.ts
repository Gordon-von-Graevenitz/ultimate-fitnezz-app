import {
  CreateExerciseInput,
  CreateWorkoutTemplateInput,
  EntityId,
  Exercise,
} from '../../core/models/fitness.models';
import {
  RecommendedExerciseDraft,
  WorkoutRecommendationDraft,
} from '../../core/models/workout-recommendation.models';

export interface MaterializedRecommendation {
  readonly template: CreateWorkoutTemplateInput;
  readonly createdExercises: readonly Exercise[];
}

export function materializeRecommendation(
  draft: WorkoutRecommendationDraft,
  exerciseExists: (id: EntityId) => boolean,
  createExercise: (input: CreateExerciseInput) => Exercise,
  createId: (prefix: string) => EntityId,
): MaterializedRecommendation {
  const createdExercises: Exercise[] = [];
  const exercises = draft.exercises.map((exercise, order) => {
    const exerciseId = resolveExerciseId(
      exercise,
      exerciseExists,
      createExercise,
      createdExercises,
    );

    return {
      id: createId('template-exercise'),
      exerciseId,
      order,
      restSeconds: exercise.restSeconds,
      notes: exercise.notes,
      sets: exercise.sets.map((set, index) => ({
        id: createId('template-set'),
        setNumber: index + 1,
        targetWeightKg: set.targetWeightKg,
        targetReps: set.targetReps,
        targetDurationSeconds: set.targetDurationSeconds,
        targetDistanceMeters: set.targetDistanceMeters,
        targetRpe: set.targetRpe,
        notes: set.notes,
      })),
    };
  });

  return {
    template: {
      name: draft.planName.trim(),
      description: draft.description.trim() || undefined,
      exercises,
    },
    createdExercises,
  };
}

function resolveExerciseId(
  exercise: RecommendedExerciseDraft,
  exerciseExists: (id: EntityId) => boolean,
  createExercise: (input: CreateExerciseInput) => Exercise,
  createdExercises: Exercise[],
): EntityId {
  if (exercise.libraryExerciseId && exerciseExists(exercise.libraryExerciseId)) {
    return exercise.libraryExerciseId;
  }

  const created = createExercise({
    name: exercise.name.trim(),
    category: exercise.category,
    primaryMuscleGroup: exercise.primaryMuscleGroup.trim(),
    equipment: exercise.equipment.trim(),
    metrics: exercise.metrics,
    instructions: exercise.instructions?.trim() || undefined,
    isCustom: true,
  });
  createdExercises.push(created);
  return created.id;
}
