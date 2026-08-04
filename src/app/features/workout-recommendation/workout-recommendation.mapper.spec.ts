import { describe, expect, it, vi } from 'vitest';
import { Exercise } from '../../core/models/fitness.models';
import { WorkoutRecommendationDraft } from '../../core/models/workout-recommendation.models';
import { materializeRecommendation } from './workout-recommendation.mapper';

const draft: WorkoutRecommendationDraft = {
  planName: 'Balanced strength',
  description: 'A full-body session.',
  rationale: 'Builds confidence with repeatable movement patterns.',
  estimatedMinutes: 45,
  difficulty: 'beginner',
  warnings: [],
  exercises: [
    {
      libraryExerciseId: 'exercise-squat',
      name: 'Goblet squat',
      category: 'strength',
      primaryMuscleGroup: 'Legs',
      equipment: 'Dumbbell',
      metrics: ['weight', 'reps', 'rpe'],
      restSeconds: 90,
      sets: [{ targetReps: 10, targetRpe: 7 }],
    },
    {
      name: 'Wall-supported calf raise',
      category: 'strength',
      primaryMuscleGroup: 'Calves',
      equipment: 'Bodyweight',
      metrics: ['reps', 'rpe'],
      restSeconds: 60,
      sets: [{ targetReps: 12, targetRpe: 7 }],
    },
  ],
};

describe('materializeRecommendation', () => {
  it('reuses known exercises and creates approved new exercises before the template', () => {
    const createdExercise: Exercise = {
      id: 'exercise-new',
      name: 'Wall-supported calf raise',
      category: 'strength',
      primaryMuscleGroup: 'Calves',
      equipment: 'Bodyweight',
      metrics: ['reps', 'rpe'],
      isCustom: true,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    };
    const createExercise = vi.fn(() => createdExercise);
    let sequence = 0;

    const result = materializeRecommendation(
      draft,
      (id) => id === 'exercise-squat',
      createExercise,
      (prefix) => `${prefix}-${++sequence}`,
    );

    expect(createExercise).toHaveBeenCalledOnce();
    expect(result.createdExercises).toEqual([createdExercise]);
    expect(result.template.exercises.map((item) => item.exerciseId)).toEqual([
      'exercise-squat',
      'exercise-new',
    ]);
    expect(result.template.exercises[0]?.sets[0]?.targetReps).toBe(10);
  });
});
