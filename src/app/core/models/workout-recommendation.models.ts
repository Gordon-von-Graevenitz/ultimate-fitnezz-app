import { EntityId, ExerciseCategory, ExerciseMetric, GoalCategory } from './fitness.models';

export type RecommendationDifficulty = 'beginner' | 'intermediate' | 'advanced';

export interface RecommendationExerciseCatalogItem {
  readonly id: EntityId;
  readonly name: string;
  readonly category: ExerciseCategory;
  readonly primaryMuscleGroup: string;
  readonly equipment: string;
  readonly metrics: readonly ExerciseMetric[];
}

export interface RecommendationClientContext {
  readonly goals: readonly {
    readonly title: string;
    readonly category: GoalCategory;
  }[];
  readonly recentWorkouts: readonly {
    readonly name: string;
    readonly completedAt?: string;
    readonly exercises: readonly string[];
  }[];
}

export interface WorkoutRecommendationRequest {
  readonly prompt: string;
  readonly clientContext?: RecommendationClientContext;
  readonly exerciseCatalog: readonly RecommendationExerciseCatalogItem[];
}

export interface RecommendedSetDraft {
  readonly targetWeightKg?: number;
  readonly targetReps?: number;
  readonly targetDurationSeconds?: number;
  readonly targetDistanceMeters?: number;
  readonly targetRpe?: number;
  readonly notes?: string;
}

export interface RecommendedExerciseDraft {
  readonly libraryExerciseId?: EntityId;
  readonly name: string;
  readonly category: ExerciseCategory;
  readonly primaryMuscleGroup: string;
  readonly equipment: string;
  readonly metrics: readonly ExerciseMetric[];
  readonly instructions?: string;
  readonly restSeconds: number;
  readonly sets: readonly RecommendedSetDraft[];
  readonly notes?: string;
}

export interface WorkoutRecommendationDraft {
  readonly planName: string;
  readonly description: string;
  readonly rationale: string;
  readonly estimatedMinutes: number;
  readonly difficulty: RecommendationDifficulty;
  readonly exercises: readonly RecommendedExerciseDraft[];
  readonly warnings: readonly string[];
}

export interface TranscriptionResponse {
  readonly text: string;
}

export interface RecommendationErrorResponse {
  readonly error: string;
  readonly requestId?: string;
}
