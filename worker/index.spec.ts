import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import worker from './index';

const ACCESS_ISSUER = 'https://jolly-flower-d6c7.cloudflareaccess.com';
const ACCESS_AUD = 'a1696166024f9132d7f1b34e2411b371753ddf5e489328d2ce694f586854b1e4';
const KEY_ID = 'test-access-key';
let signingKey: CryptoKey;

function environment(
  aiResponse: unknown,
  localAuth: {
    enabled?: string;
    email?: string;
    subject?: string;
  } = {},
) {
  const statement = {
    bind: vi.fn(),
    first: vi.fn(async () => ({
      id: 'internal-user-id',
      access_subject: localAuth.subject ?? 'access-subject-trainer',
      email: localAuth.email ?? 'trainer@example.com',
    })),
  };
  statement.bind.mockReturnValue(statement);

  const database = {
    prepare: vi.fn(() => statement),
    batch: vi.fn(async (statements: unknown[]) => statements.map(() => ({ results: [] }))),
  };

  return {
    AI: { run: vi.fn(async () => aiResponse) },
    ASSETS: { fetch: vi.fn(async () => new Response('app asset')) },
    DB: database,
    AI_TEXT_MODEL: '@cf/meta/llama-3.1-8b-instruct-fast',
    AI_TRANSCRIPTION_MODEL: '@cf/openai/whisper',
    ACCESS_AUD,
    ACCESS_ISSUER,
    LOCAL_DEV_AUTH_ENABLED: localAuth.enabled ?? 'false',
    LOCAL_DEV_EMAIL: localAuth.email ?? '',
    LOCAL_DEV_SUBJECT: localAuth.subject ?? '',
  };
}

async function accessToken(
  email = 'trainer@example.com',
  subject = 'access-subject-trainer',
  audience = ACCESS_AUD,
): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
    .setIssuer(ACCESS_ISSUER)
    .setAudience(audience)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(signingKey);
}

async function authorizedRequest(url: string, init: RequestInit = {}): Promise<Request> {
  const headers = new Headers(init.headers);
  headers.set('Cf-Access-Jwt-Assertion', await accessToken());
  return new Request(url, { ...init, headers });
}

beforeAll(async () => {
  const keyPair = await generateKeyPair('RS256');
  signingKey = keyPair.privateKey;
  const publicJwk = await exportJWK(keyPair.publicKey);

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === `${ACCESS_ISSUER}/cdn-cgi/access/certs`) {
        return Response.json({
          keys: [{ ...publicJwk, kid: KEY_ID, alg: 'RS256', use: 'sig' }],
        });
      }
      throw new Error(`Unexpected fetch in Worker test: ${url}`);
    }),
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('AI workout Worker', () => {
  it('returns an uncached Access session without consuming the AI rate limit', async () => {
    const env = environment({});

    for (let attempt = 0; attempt < 25; attempt += 1) {
      const response = await worker.fetch(
        await authorizedRequest('https://example.com/api/auth/session', {
          headers: {
            'CF-Connecting-IP': '198.51.100.20',
            'Cf-Access-Authenticated-User-Email': 'spoofed@example.com',
          },
        }),
        env as Env,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toContain('no-store');
      expect(await response.json()).toEqual({
        authenticated: true,
        email: 'trainer@example.com',
      });
    }

    expect(env.AI.run).not.toHaveBeenCalled();
    expect(env.DB.prepare).toHaveBeenCalledTimes(25);
  });

  it('rejects non-GET session checks', async () => {
    const env = environment({});
    const response = await worker.fetch(
      await authorizedRequest('https://example.com/api/auth/session', { method: 'POST' }),
      env as Env,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET');
  });

  it('loads only the authenticated owner data and never accepts an owner from the request', async () => {
    const env = environment({});
    const response = await worker.fetch(
      await authorizedRequest('https://example.com/api/data?ownerUserId=someone-else'),
      env as Env,
    );
    const body = (await response.json()) as { hasData: boolean; snapshot: { clients: unknown[] } };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ hasData: false, snapshot: { clients: [] } });
    const preparedSql = env.DB.prepare.mock.calls.map(([sql]) => String(sql));
    expect(preparedSql.filter((sql) => sql.startsWith('SELECT *')).every((sql) =>
      sql.includes('WHERE owner_user_id = ?1'),
    )).toBe(true);
    expect(env.DB.batch).toHaveBeenCalledOnce();
  });

  it('rejects API calls without an Access JWT', async () => {
    const env = environment({});
    const response = await worker.fetch(
      new Request('https://example.com/api/auth/session'),
      env as Env,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ authenticated: false });
    expect(env.DB.prepare).not.toHaveBeenCalled();
  });

  it('rejects an otherwise valid token issued for another Access application', async () => {
    const env = environment({});
    const response = await worker.fetch(
      new Request('https://example.com/api/auth/session', {
        headers: { 'Cf-Access-Jwt-Assertion': await accessToken(undefined, undefined, 'wrong-aud') },
      }),
      env as Env,
    );

    expect(response.status).toBe(401);
  });

  it('uses the configured development identity only on an exact loopback hostname', async () => {
    const env = environment(
      {},
      {
        enabled: 'true',
        email: 'local.trainer@example.test',
        subject: 'local-trainer',
      },
    );
    const response = await worker.fetch(
      new Request('http://127.0.0.1:8787/api/auth/session'),
      env as Env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      authenticated: true,
      email: 'local.trainer@example.test',
    });
    expect(env.DB.prepare).toHaveBeenCalledOnce();
  });

  it('never enables the development identity on a deployed hostname', async () => {
    const env = environment(
      {},
      {
        enabled: 'true',
        email: 'local.trainer@example.test',
        subject: 'local-trainer',
      },
    );
    const response = await worker.fetch(
      new Request('https://ultimate-fitnezz-app.hushed-candy.workers.dev/api/auth/session'),
      env as Env,
    );

    expect(response.status).toBe(401);
    expect(env.DB.prepare).not.toHaveBeenCalled();
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
    const request = await authorizedRequest('https://example.com/api/ai/workout-recommendation', {
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

    const response = await worker.fetch(request, env as Env);
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
      await authorizedRequest('https://example.com/api/ai/workout-recommendation', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.12' },
        body: JSON.stringify({
          prompt: 'Create a 30-minute beginner strength workout.',
          exerciseCatalog: [],
        }),
      }),
      env as Env,
    );
    const body = (await response.json()) as { error: string; requestId: string };

    expect(response.status).toBe(504);
    expect(body.error).toContain('timed out');
    expect(body.requestId).toBeTruthy();
  });

  it('rejects underspecified requests before invoking AI', async () => {
    const env = environment({});
    const response = await worker.fetch(
      await authorizedRequest('https://example.com/api/ai/workout-recommendation', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.11' },
        body: JSON.stringify({ prompt: 'No', exerciseCatalog: [] }),
      }),
      env as Env,
    );

    expect(response.status).toBe(400);
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it('delegates non-API requests to the static asset binding', async () => {
    const env = environment({});
    const response = await worker.fetch(
      new Request('https://example.com/workouts/recommend'),
      env as Env,
    );

    expect(await response.text()).toBe('app asset');
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
  });
});
