import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { FitnessDataError, readFitnessData, replaceFitnessData } from './fitness-data';

type JsonRecord = Record<string, unknown>;

const DEFAULT_TEXT_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';
const DEFAULT_TRANSCRIPTION_MODEL = '@cf/openai/whisper';
const MAX_AUDIO_BYTES = 6 * 1024 * 1024;
const MAX_REQUEST_BYTES = 160 * 1024;
const REQUESTS_PER_WINDOW = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const exerciseCategories = ['strength', 'cardio', 'mobility', 'conditioning', 'recovery'] as const;
const exerciseMetrics = ['weight', 'reps', 'duration', 'distance', 'rpe', 'notes'] as const;
const difficulties = ['beginner', 'intermediate', 'advanced'] as const;
const rateWindows = new Map<string, { count: number; resetAt: number }>();
const accessKeySets = new Map<string, JWTVerifyGetKey>();

interface AccessIdentity {
  readonly subject: string;
  readonly email: string;
}

interface AppUserIdentity extends AccessIdentity {
  readonly ownerUserId: string;
}

const workoutDraftSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    planName: { type: 'string' },
    description: { type: 'string' },
    rationale: { type: 'string' },
    estimatedMinutes: { type: 'number' },
    difficulty: { type: 'string', enum: difficulties },
    warnings: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    exercises: {
      type: 'array',
      minItems: 1,
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          libraryExerciseId: { type: ['string', 'null'] },
          name: { type: 'string' },
          category: { type: 'string', enum: exerciseCategories },
          primaryMuscleGroup: { type: 'string' },
          equipment: { type: 'string' },
          metrics: { type: 'array', items: { type: 'string', enum: exerciseMetrics } },
          instructions: { type: 'string' },
          restSeconds: { type: 'number' },
          notes: { type: 'string' },
          sets: {
            type: 'array',
            minItems: 1,
            maxItems: 6,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                targetWeightKg: { type: ['number', 'null'] },
                targetReps: { type: ['number', 'null'] },
                targetDurationSeconds: { type: ['number', 'null'] },
                targetDistanceMeters: { type: ['number', 'null'] },
                targetRpe: { type: ['number', 'null'] },
                notes: { type: 'string' },
              },
              required: [
                'targetWeightKg',
                'targetReps',
                'targetDurationSeconds',
                'targetDistanceMeters',
                'targetRpe',
                'notes',
              ],
            },
          },
        },
        required: [
          'libraryExerciseId',
          'name',
          'category',
          'primaryMuscleGroup',
          'equipment',
          'metrics',
          'instructions',
          'restSeconds',
          'notes',
          'sets',
        ],
      },
    },
  },
  required: [
    'planName',
    'description',
    'rationale',
    'estimatedMinutes',
    'difficulty',
    'warnings',
    'exercises',
  ],
};

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    const requestId = crypto.randomUUID();
    try {
      const identity = await authenticateAccessRequest(request, env);

      if (url.pathname === '/api/auth/session') {
        if (request.method !== 'GET') {
          return json({ error: 'Method not allowed.', requestId }, 405, { Allow: 'GET' });
        }
        const appUser = await resolveAppUser(env.DB, identity);
        return json({
          authenticated: true,
          email: appUser.email,
        });
      }

      if (url.pathname === '/api/data') {
        const appUser = await resolveAppUser(env.DB, identity);
        if (request.method === 'GET') {
          return json(await readFitnessData(env.DB, appUser.ownerUserId));
        }
        if (request.method === 'PUT') {
          return json(await replaceFitnessData(request, env.DB, appUser.ownerUserId, requestId));
        }
        return json({ error: 'Method not allowed.', requestId }, 405, { Allow: 'GET, PUT' });
      }

      if (!allowRequest(identity.subject)) {
        return json(
          { error: 'Too many AI requests. Please wait a few minutes and try again.', requestId },
          429,
        );
      }

      if (url.pathname === '/api/ai/transcribe' && request.method === 'POST') {
        return await transcribe(request, env);
      }
      if (url.pathname === '/api/ai/workout-recommendation' && request.method === 'POST') {
        return await recommend(request, env);
      }
      return json({ error: 'API route not found.', requestId }, 404);
    } catch (error) {
      if (error instanceof AccessAuthenticationError) {
        console.warn(
          JSON.stringify({
            message: 'Cloudflare Access authentication rejected',
            requestId,
            path: url.pathname,
            reason: error.reason,
          }),
        );
        return json(
          { authenticated: false, error: error.message, requestId },
          error.status,
          error.status === 401 ? { 'WWW-Authenticate': 'Bearer' } : undefined,
        );
      }
      const handledError =
        error instanceof RequestError || error instanceof FitnessDataError
          ? error
          : cloudflareAiError(error);
      console.error(
        JSON.stringify({
          message: 'API request failed',
          requestId,
          path: url.pathname,
          error: errorDescription(error),
        }),
      );
      const message = handledError?.message ?? 'The AI service is temporarily unavailable.';
      const status = handledError?.status ?? 502;
      return json({ error: message, requestId }, status);
    }
  },
} satisfies ExportedHandler<Env>;

export default worker;

async function authenticateAccessRequest(request: Request, env: Env): Promise<AccessIdentity> {
  const localIdentity = localDevelopmentIdentity(request, env);
  if (localIdentity) return localIdentity;

  const issuer = env.ACCESS_ISSUER.replace(/\/+$/, '');
  const audience = env.ACCESS_AUD.trim();
  if (!issuer || !audience) {
    throw new AccessAuthenticationError(
      'Authentication is temporarily unavailable.',
      503,
      'missing_access_configuration',
    );
  }

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) {
    throw new AccessAuthenticationError(
      'A valid sign-in session is required.',
      401,
      'missing_access_token',
    );
  }

  try {
    const { payload } = await jwtVerify(token, accessKeySet(issuer), {
      issuer,
      audience,
      algorithms: ['RS256'],
    });
    const subject = cleanString(payload.sub, 512);
    const email = cleanString(payload['email'], 320).toLowerCase();
    if (!subject || !email) {
      throw new AccessAuthenticationError(
        'The sign-in session is missing a verified identity.',
        403,
        'missing_identity_claims',
      );
    }
    return { subject, email };
  } catch (error) {
    if (error instanceof AccessAuthenticationError) throw error;
    throw new AccessAuthenticationError(
      'The sign-in session is invalid or has expired.',
      401,
      'invalid_access_token',
    );
  }
}

function localDevelopmentIdentity(request: Request, env: Env): AccessIdentity | undefined {
  if (env.LOCAL_DEV_AUTH_ENABLED !== 'true') return undefined;

  const hostname = new URL(request.url).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return undefined;

  const email = cleanString(env.LOCAL_DEV_EMAIL, 320).toLowerCase();
  const subject = cleanString(env.LOCAL_DEV_SUBJECT, 512);
  if (!email || !subject) {
    throw new AccessAuthenticationError(
      'Local authentication is not configured.',
      503,
      'missing_local_identity',
    );
  }

  return { email, subject };
}

function accessKeySet(issuer: string): JWTVerifyGetKey {
  const existing = accessKeySets.get(issuer);
  if (existing) return existing;

  const keySet = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  accessKeySets.set(issuer, keySet);
  return keySet;
}

async function resolveAppUser(
  database: D1Database,
  identity: AccessIdentity,
): Promise<AppUserIdentity> {
  const ownerUserId = crypto.randomUUID();
  const row = await database
    .prepare(
      `INSERT INTO app_users (id, access_subject, email)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(access_subject) DO UPDATE SET
         email = excluded.email,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       ON CONFLICT(email) DO UPDATE SET
         access_subject = excluded.access_subject,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       RETURNING id, access_subject, email`,
    )
    .bind(ownerUserId, identity.subject, identity.email)
    .first<{ id: string; access_subject: string; email: string }>();

  if (!row?.id || !row.access_subject || !row.email) {
    throw new RequestError('The signed-in user could not be initialised.', 500);
  }

  return {
    ownerUserId: row.id,
    subject: row.access_subject,
    email: row.email.toLowerCase(),
  };
}

async function transcribe(request: Request, env: Env): Promise<Response> {
  assertContentLength(request, MAX_AUDIO_BYTES + 32_000);
  const formData = await request.formData();
  const audio = formData.get('audio');
  if (!(audio instanceof File) || audio.size === 0) {
    throw new RequestError('Record a voice note before requesting transcription.', 400);
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    throw new RequestError('The voice note is too large. Keep recordings under 60 seconds.', 413);
  }
  if (audio.type && !audio.type.startsWith('audio/')) {
    throw new RequestError('The uploaded file is not a supported audio recording.', 415);
  }

  const bytes = new Uint8Array(await audio.arrayBuffer());
  const result = await env.AI.run(env.AI_TRANSCRIPTION_MODEL || DEFAULT_TRANSCRIPTION_MODEL, {
    audio: Array.from(bytes),
  });
  const text = isRecord(result) ? cleanString(result['text'], 4_000) : '';
  if (!text) {
    throw new RequestError('No speech could be detected. Try again somewhere quieter.', 422);
  }
  return json({ text });
}

async function recommend(request: Request, env: Env): Promise<Response> {
  assertContentLength(request, MAX_REQUEST_BYTES);
  if (!request.headers.get('content-type')?.includes('application/json')) {
    throw new RequestError('The recommendation request must be JSON.', 415);
  }

  const parsed = await request.json().catch(() => null);
  const input = validateRecommendationRequest(parsed);
  const catalog = new Map(input.exerciseCatalog.map((exercise) => [exercise.id, exercise]));
  const result = await env.AI.run(env.AI_TEXT_MODEL || DEFAULT_TEXT_MODEL, {
    messages: [
      {
        role: 'system',
        content: systemPrompt(),
      },
      {
        role: 'user',
        content: JSON.stringify(input),
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: workoutDraftSchema,
    },
    temperature: 0.2,
    max_tokens: 2_400,
  });

  const modelDraft = extractModelDraft(result);
  return json(normalizeDraft(modelDraft, catalog));
}

function systemPrompt(): string {
  return [
    "You are a planning assistant for a qualified personal trainer at BarBelle's Fitness Studio.",
    'Create one practical workout draft from the user request. The trainer will review it before use.',
    'Use the optional anonymous customer goals and recent workout summaries when supplied.',
    'Prefer an exercise from exerciseCatalog when it is a good match. Copy its exact id into libraryExerciseId.',
    'For a genuinely useful movement not present in the catalog, use null for libraryExerciseId and provide complete editable exercise details.',
    'Never invent a library ID. Use sensible progression, volume, rest and RPE. Keep the session within the requested duration and use no more than 8 exercises.',
    'Do not diagnose or treat medical conditions. When pain, injury, pregnancy, medication or medical risk is mentioned, add a clear trainer-review warning and keep the draft conservative.',
    'Return only the requested JSON object.',
  ].join(' ');
}

function validateRecommendationRequest(value: unknown): {
  prompt: string;
  clientContext?: JsonRecord;
  exerciseCatalog: Array<{
    id: string;
    name: string;
    category: string;
    primaryMuscleGroup: string;
    equipment: string;
    metrics: string[];
  }>;
} {
  if (!isRecord(value)) {
    throw new RequestError('The recommendation request is invalid.', 400);
  }
  const prompt = cleanString(value['prompt'], 2_000);
  if (prompt.length < 5) {
    throw new RequestError('Describe the workout you would like to create.', 400);
  }
  const rawCatalog = Array.isArray(value['exerciseCatalog'])
    ? value['exerciseCatalog'].slice(0, 150)
    : [];
  const exerciseCatalog = rawCatalog.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = cleanString(item['id'], 120);
    const name = cleanString(item['name'], 100);
    if (!id || !name) return [];
    const category = enumValue(item['category'], exerciseCategories, 'strength');
    const metrics = Array.isArray(item['metrics'])
      ? item['metrics']
          .filter((metric): metric is string => exerciseMetrics.includes(metric as never))
          .slice(0, 6)
      : [];
    return [
      {
        id,
        name,
        category,
        primaryMuscleGroup: cleanString(item['primaryMuscleGroup'], 100) || 'Full body',
        equipment: cleanString(item['equipment'], 100) || 'Bodyweight',
        metrics,
      },
    ];
  });

  const clientContext = sanitizeClientContext(value['clientContext']);
  return { prompt, exerciseCatalog, ...(clientContext ? { clientContext } : {}) };
}

function sanitizeClientContext(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  const goals = (Array.isArray(value['goals']) ? value['goals'] : [])
    .slice(0, 10)
    .flatMap((goal) => {
      if (!isRecord(goal)) return [];
      const title = cleanString(goal['title'], 120);
      return title ? [{ title, category: cleanString(goal['category'], 40) }] : [];
    });
  const recentWorkouts = (Array.isArray(value['recentWorkouts']) ? value['recentWorkouts'] : [])
    .slice(0, 5)
    .flatMap((workout) => {
      if (!isRecord(workout)) return [];
      const name = cleanString(workout['name'], 120);
      if (!name) return [];
      return [
        {
          name,
          completedAt: cleanString(workout['completedAt'], 40),
          exercises: (Array.isArray(workout['exercises']) ? workout['exercises'] : [])
            .map((exercise) => cleanString(exercise, 100))
            .filter(Boolean)
            .slice(0, 20),
        },
      ];
    });
  return { goals, recentWorkouts };
}

function extractModelDraft(result: unknown): JsonRecord {
  const response = isRecord(result) ? result['response'] : result;
  if (isRecord(response)) return response;
  if (typeof response === 'string') {
    const candidate = response.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(candidate) as unknown;
    if (isRecord(parsed)) return parsed;
  }
  throw new RequestError(
    'The AI returned a draft that could not be reviewed safely. Please try again.',
    502,
  );
}

function normalizeDraft(model: JsonRecord, catalog: Map<string, JsonRecord>): JsonRecord {
  const rawExercises = Array.isArray(model['exercises']) ? model['exercises'].slice(0, 12) : [];
  const exercises = rawExercises.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const requestedId = cleanString(raw['libraryExerciseId'], 120);
    const known = requestedId ? catalog.get(requestedId) : undefined;
    const sets = normalizeSets(raw['sets']);
    if (sets.length === 0) return [];
    const metrics = known
      ? stringArray(known['metrics'], exerciseMetrics, 6)
      : stringArray(raw['metrics'], exerciseMetrics, 6);
    return [
      {
        ...(known ? { libraryExerciseId: requestedId } : {}),
        name: cleanString(known?.['name'] ?? raw['name'], 100) || 'New exercise',
        category: enumValue(known?.['category'] ?? raw['category'], exerciseCategories, 'strength'),
        primaryMuscleGroup:
          cleanString(known?.['primaryMuscleGroup'] ?? raw['primaryMuscleGroup'], 100) ||
          'Full body',
        equipment: cleanString(known?.['equipment'] ?? raw['equipment'], 100) || 'Bodyweight',
        metrics: metrics.length ? metrics : inferMetrics(sets),
        instructions: cleanString(raw['instructions'], 500) || undefined,
        restSeconds: numeric(raw['restSeconds'], 0, 600, 90),
        sets,
        notes: cleanString(raw['notes'], 300) || undefined,
      },
    ];
  });
  if (exercises.length === 0) {
    throw new RequestError(
      'The AI did not return a usable exercise. Add more detail and try again.',
      502,
    );
  }
  return {
    planName: cleanString(model['planName'], 60) || 'AI workout draft',
    description: cleanString(model['description'], 240),
    rationale: cleanString(model['rationale'], 500),
    estimatedMinutes: numeric(model['estimatedMinutes'], 5, 240, 45),
    difficulty: enumValue(model['difficulty'], difficulties, 'intermediate'),
    exercises,
    warnings: Array.isArray(model['warnings'])
      ? model['warnings']
          .map((warning) => cleanString(warning, 240))
          .filter(Boolean)
          .slice(0, 6)
      : [],
  };
}

function normalizeSets(value: unknown): JsonRecord[] {
  return (Array.isArray(value) ? value : []).slice(0, 6).flatMap((set) => {
    if (!isRecord(set)) return [];
    const normalized: JsonRecord = {};
    copyOptionalNumber(normalized, 'targetWeightKg', set['targetWeightKg'], 0, 1_000);
    copyOptionalNumber(normalized, 'targetReps', set['targetReps'], 0, 1_000);
    copyOptionalNumber(
      normalized,
      'targetDurationSeconds',
      set['targetDurationSeconds'],
      0,
      14_400,
    );
    copyOptionalNumber(normalized, 'targetDistanceMeters', set['targetDistanceMeters'], 0, 100_000);
    copyOptionalNumber(normalized, 'targetRpe', set['targetRpe'], 1, 10);
    const notes = cleanString(set['notes'], 200);
    if (notes) normalized['notes'] = notes;
    return [normalized];
  });
}

function inferMetrics(sets: JsonRecord[]): string[] {
  const fields: Array<[string, string]> = [
    ['targetWeightKg', 'weight'],
    ['targetReps', 'reps'],
    ['targetDurationSeconds', 'duration'],
    ['targetDistanceMeters', 'distance'],
    ['targetRpe', 'rpe'],
  ];
  return fields
    .filter(([field]) => sets.some((set) => set[field] !== undefined))
    .map(([, metric]) => metric);
}

function allowRequest(authenticatedSubject: string): boolean {
  const key = authenticatedSubject;
  const now = Date.now();
  const current = rateWindows.get(key);
  if (!current || current.resetAt <= now) {
    rateWindows.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (current.count >= REQUESTS_PER_WINDOW) return false;
  current.count += 1;
  return true;
}

function assertContentLength(request: Request, maximum: number): void {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maximum) {
    throw new RequestError('The request is too large.', 413);
  }
}

function copyOptionalNumber(
  target: JsonRecord,
  key: string,
  value: unknown,
  minimum: number,
  maximum: number,
): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    target[key] = Math.min(maximum, Math.max(minimum, value));
  }
}

function numeric(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function cleanString(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function stringArray(value: unknown, allowed: readonly string[], maximum: number): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && allowed.includes(item))
        .slice(0, maximum)
    : [];
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloudflareAiError(error: unknown): RequestError | undefined {
  const detail = errorDescription(error).toLowerCase();
  if (detail.includes('3007') || detail.includes('timeout') || detail.includes('timed out')) {
    return new RequestError(
      'Workout generation timed out. Please try again; a shorter request may complete faster.',
      504,
    );
  }
  if (detail.includes('3036') || detail.includes('daily free allocation')) {
    return new RequestError(
      'The daily free AI allowance has been used. Please try again tomorrow.',
      429,
    );
  }
  if (detail.includes('3040') || detail.includes('out of capacity')) {
    return new RequestError('Cloudflare AI is currently busy. Please try again in a moment.', 503);
  }
  return undefined;
}

function errorDescription(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown AI error';
  }
}

function json(value: unknown, status = 200, additionalHeaders?: HeadersInit): Response {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Content-Security-Policy': "default-src 'none'",
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      ...additionalHeaders,
    },
  });
}

class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

class AccessAuthenticationError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 | 503,
    readonly reason: string,
  ) {
    super(message);
  }
}
