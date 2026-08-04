import { describe, expect, it, vi } from 'vitest';
import worker from './index';

function environment(aiResponse: unknown) {
  return {
    AI: { run: vi.fn(async () => aiResponse) },
    ASSETS: { fetch: vi.fn(async () => new Response('app asset')) },
  };
}

describe('AI workout Worker', () => {
  it('returns an uncached Access session without consuming the AI rate limit', async () => {
    const env = environment({});

    for (let attempt = 0; attempt < 25; attempt += 1) {
      const response = await worker.fetch(
        new Request('https://example.com/api/auth/session', {
          headers: {
            'CF-Connecting-IP': '198.51.100.20',
            'Cf-Access-Authenticated-User-Email': 'trainer@example.com',
          },
        }),
        env,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toContain('no-store');
      expect(await response.json()).toEqual({
        authenticated: true,
        email: 'trainer@example.com',
      });
    }

    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it('rejects non-GET session checks', async () => {
    const env = environment({});
    const response = await worker.fetch(
      new Request('https://example.com/api/auth/session', { method: 'POST' }),
      env,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET');
  });

  it('normalizes known exercise IDs and turns unknown IDs into reviewable new exercises', async () => {
    const env = environment({
      response: {
        planName: 'Strength foundations',
        description: 'A steady full-body workout.',
        rationale: 'Uses repeatable patterns and moderate effort.',
        estimatedMinutes: 45,
        difficulty: 'beginner',
        warnings: [],
        exercises: [
          {
            libraryExerciseId: 'squat-1',
            name: 'Wrong model name',
            category: 'cardio',
            primaryMuscleGroup: 'Wrong model group',
            equipment: 'Wrong model equipment',
            metrics: ['duration'],
            instructions: '',
            restSeconds: 90,
            notes: 'Control the lowering phase.',
            sets: [
              {
                targetWeightKg: 10,
                targetReps: 10,
                targetDurationSeconds: null,
                targetDistanceMeters: null,
                targetRpe: 7,
                notes: '',
              },
            ],
          },
          {
            libraryExerciseId: 'invented-id',
            name: 'Wall-supported calf raise',
            category: 'strength',
            primaryMuscleGroup: 'Calves',
            equipment: 'Bodyweight',
            metrics: ['reps', 'rpe'],
            instructions: 'Use the wall for balance.',
            restSeconds: 60,
            notes: '',
            sets: [
              {
                targetWeightKg: null,
                targetReps: 12,
                targetDurationSeconds: null,
                targetDistanceMeters: null,
                targetRpe: 7,
                notes: '',
              },
            ],
          },
        ],
      },
    });
    const request = new Request('https://example.com/api/ai/workout-recommendation', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.10' },
      body: JSON.stringify({
        prompt: 'Create a simple full-body strength workout.',
        exerciseCatalog: [
          {
            id: 'squat-1',
            name: 'Goblet squat',
            category: 'strength',
            primaryMuscleGroup: 'Legs',
            equipment: 'Dumbbell',
            metrics: ['weight', 'reps', 'rpe'],
          },
        ],
      }),
    });

    const response = await worker.fetch(request, env);
    const body = (await response.json()) as { exercises: Array<Record<string, unknown>> };

    expect(response.status).toBe(200);
    expect(body.exercises[0]).toMatchObject({
      libraryExerciseId: 'squat-1',
      name: 'Goblet squat',
      category: 'strength',
      equipment: 'Dumbbell',
    });
    expect(body.exercises[1]?.['libraryExerciseId']).toBeUndefined();
    expect(env.AI.run).toHaveBeenCalledWith(
      '@cf/meta/llama-3.1-8b-instruct-fast',
      expect.objectContaining({ max_tokens: 2_400 }),
    );
  });

  it('returns a useful gateway timeout when Workers AI times out', async () => {
    const env = environment({});
    env.AI.run.mockRejectedValueOnce(new Error('Workers AI error 3007: Request timeout'));
    const response = await worker.fetch(
      new Request('https://example.com/api/ai/workout-recommendation', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.12' },
        body: JSON.stringify({
          prompt: 'Create a 30-minute beginner strength workout.',
          exerciseCatalog: [],
        }),
      }),
      env,
    );
    const body = (await response.json()) as { error: string; requestId: string };

    expect(response.status).toBe(504);
    expect(body.error).toContain('timed out');
    expect(body.requestId).toBeTruthy();
  });

  it('rejects underspecified requests before invoking AI', async () => {
    const env = environment({});
    const response = await worker.fetch(
      new Request('https://example.com/api/ai/workout-recommendation', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.11' },
        body: JSON.stringify({ prompt: 'No', exerciseCatalog: [] }),
      }),
      env,
    );

    expect(response.status).toBe(400);
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it('delegates non-API requests to the static asset binding', async () => {
    const env = environment({});
    const response = await worker.fetch(new Request('https://example.com/workouts/recommend'), env);

    expect(await response.text()).toBe('app asset');
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
  });
});
