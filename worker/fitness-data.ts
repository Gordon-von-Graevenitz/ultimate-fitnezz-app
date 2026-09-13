type Row = Record<string, unknown>;

export interface FitnessDataSnapshot {
  schemaVersion: 1;
  clients: Row[];
  goals: Row[];
  measurements: Row[];
  exercises: Row[];
  workoutTemplates: Row[];
  workoutSessions: Row[];
}

export interface FitnessDataEnvelope {
  snapshot: FitnessDataSnapshot;
  hasData: boolean;
  updatedAt: string | null;
}

const MAX_SNAPSHOT_BYTES = 1_500_000;
const MAX_TOTAL_RECORDS = 800;

export class FitnessDataError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function readFitnessData(
  database: D1Database,
  ownerUserId: string,
): Promise<FitnessDataEnvelope> {
  const statements = [
    database.prepare('SELECT data_updated_at FROM app_users WHERE id = ?1').bind(ownerUserId),
    database.prepare('SELECT * FROM clients WHERE owner_user_id = ?1 ORDER BY created_at').bind(ownerUserId),
    database.prepare('SELECT * FROM client_goals WHERE owner_user_id = ?1 ORDER BY created_at').bind(ownerUserId),
    database.prepare('SELECT * FROM body_measurements WHERE owner_user_id = ?1 ORDER BY recorded_at').bind(ownerUserId),
    database.prepare('SELECT * FROM exercises WHERE owner_user_id = ?1 ORDER BY created_at').bind(ownerUserId),
    database.prepare('SELECT * FROM exercise_metrics WHERE owner_user_id = ?1 ORDER BY exercise_id, metric').bind(ownerUserId),
    database.prepare('SELECT * FROM workout_templates WHERE owner_user_id = ?1 ORDER BY created_at').bind(ownerUserId),
    database.prepare('SELECT * FROM template_exercises WHERE owner_user_id = ?1 ORDER BY template_id, position').bind(ownerUserId),
    database.prepare('SELECT * FROM template_sets WHERE owner_user_id = ?1 ORDER BY template_exercise_id, set_number').bind(ownerUserId),
    database.prepare('SELECT * FROM workout_sessions WHERE owner_user_id = ?1 ORDER BY started_at').bind(ownerUserId),
    database.prepare('SELECT * FROM workout_exercises WHERE owner_user_id = ?1 ORDER BY session_id, position').bind(ownerUserId),
    database.prepare('SELECT * FROM workout_sets WHERE owner_user_id = ?1 ORDER BY workout_exercise_id, set_number').bind(ownerUserId),
  ];
  const result = await database.batch<Row>(statements);
  const updatedAt = nullableString(rows(result[0])[0]?.['data_updated_at']);
  const metricsByExercise = groupStrings(rows(result[5]), 'exercise_id', 'metric');
  const templateSets = group(rows(result[8]), 'template_exercise_id');
  const templateExercises = group(rows(result[7]), 'template_id');
  const workoutSets = group(rows(result[11]), 'workout_exercise_id');
  const workoutExercises = group(rows(result[10]), 'session_id');

  return {
    hasData: updatedAt !== null,
    updatedAt,
    snapshot: {
      schemaVersion: 1,
      clients: rows(result[1]).map(mapClient),
      goals: rows(result[2]).map(mapGoal),
      measurements: rows(result[3]).map(mapMeasurement),
      exercises: rows(result[4]).map((row) => mapExercise(row, metricsByExercise)),
      workoutTemplates: rows(result[6]).map((row) =>
        mapTemplate(row, templateExercises, templateSets),
      ),
      workoutSessions: rows(result[9]).map((row) =>
        mapSession(row, workoutExercises, workoutSets),
      ),
    },
  };
}

export async function replaceFitnessData(
  request: Request,
  database: D1Database,
  ownerUserId: string,
  requestId: string,
): Promise<FitnessDataEnvelope> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new FitnessDataError('The data request must be JSON.', 415);
  }
  const declaredSize = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_SNAPSHOT_BYTES) {
    throw new FitnessDataError('The saved data is too large.', 413);
  }
  const rawText = await request.text();
  if (new TextEncoder().encode(rawText).byteLength > MAX_SNAPSHOT_BYTES) {
    throw new FitnessDataError('The saved data is too large.', 413);
  }
  const parsed = parseJson(rawText);
  const snapshot = validateSnapshot(parsed);
  const statements: D1PreparedStatement[] = [];

  // Child-first deletion keeps every replacement valid with foreign keys enabled.
  for (const table of [
    'workout_sets',
    'workout_exercises',
    'workout_sessions',
    'template_sets',
    'template_exercises',
    'workout_templates',
    'exercise_metrics',
    'exercises',
    'body_measurements',
    'client_goals',
    'clients',
  ]) {
    statements.push(database.prepare(`DELETE FROM ${table} WHERE owner_user_id = ?1`).bind(ownerUserId));
  }

  for (const client of snapshot.clients) {
    statements.push(
      database.prepare(`INSERT INTO clients
        (id, owner_user_id, first_name, last_name, email, phone, date_of_birth, joined_at, status, avatar_color, notes, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`)
        .bind(client['id'], ownerUserId, client['firstName'], client['lastName'], client['email'], nullable(client['phone']), nullable(client['dateOfBirth']), client['joinedAt'], client['status'], client['avatarColor'], nullable(client['notes']), client['createdAt'], client['updatedAt']),
    );
  }
  for (const goal of snapshot.goals) {
    statements.push(
      database.prepare(`INSERT INTO client_goals
        (id, owner_user_id, client_id, title, category, status, target_value, current_value, unit, target_date, notes, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`)
        .bind(goal['id'], ownerUserId, goal['clientId'], goal['title'], goal['category'], goal['status'], nullable(goal['targetValue']), nullable(goal['currentValue']), nullable(goal['unit']), nullable(goal['targetDate']), nullable(goal['notes']), goal['createdAt'], goal['updatedAt']),
    );
  }
  for (const measurement of snapshot.measurements) {
    statements.push(
      database.prepare(`INSERT INTO body_measurements
        (id, owner_user_id, client_id, recorded_at, body_weight_kg, body_fat_percent, chest_cm, waist_cm, hips_cm, left_arm_cm, right_arm_cm, left_thigh_cm, right_thigh_cm, resting_heart_rate_bpm, notes, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)`)
        .bind(measurement['id'], ownerUserId, measurement['clientId'], measurement['recordedAt'], nullable(measurement['bodyWeightKg']), nullable(measurement['bodyFatPercent']), nullable(measurement['chestCm']), nullable(measurement['waistCm']), nullable(measurement['hipsCm']), nullable(measurement['leftArmCm']), nullable(measurement['rightArmCm']), nullable(measurement['leftThighCm']), nullable(measurement['rightThighCm']), nullable(measurement['restingHeartRateBpm']), nullable(measurement['notes']), measurement['createdAt'], measurement['updatedAt']),
    );
  }
  for (const exercise of snapshot.exercises) {
    statements.push(
      database.prepare(`INSERT INTO exercises
        (id, owner_user_id, name, category, primary_muscle_group, equipment, instructions, is_custom, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`)
        .bind(exercise['id'], ownerUserId, exercise['name'], exercise['category'], exercise['primaryMuscleGroup'], exercise['equipment'], nullable(exercise['instructions']), exercise['isCustom'] ? 1 : 0, exercise['createdAt'], exercise['updatedAt']),
    );
    for (const metric of exercise['metrics'] as string[]) {
      statements.push(
        database.prepare('INSERT INTO exercise_metrics (owner_user_id, exercise_id, metric) VALUES (?1, ?2, ?3)')
          .bind(ownerUserId, exercise['id'], metric),
      );
    }
  }
  for (const template of snapshot.workoutTemplates) {
    statements.push(
      database.prepare(`INSERT INTO workout_templates
        (id, owner_user_id, name, description, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
        .bind(template['id'], ownerUserId, template['name'], nullable(template['description']), template['createdAt'], template['updatedAt']),
    );
    for (const item of template['exercises'] as Row[]) {
      statements.push(
        database.prepare(`INSERT INTO template_exercises
          (id, owner_user_id, template_id, exercise_id, position, rest_seconds, notes)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
          .bind(item['id'], ownerUserId, template['id'], item['exerciseId'], item['order'], nullable(item['restSeconds']), nullable(item['notes'])),
      );
      for (const set of item['sets'] as Row[]) {
        statements.push(
          database.prepare(`INSERT INTO template_sets
            (id, owner_user_id, template_exercise_id, set_number, target_weight_kg, target_reps, target_duration_seconds, target_distance_meters, target_rpe, notes)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`)
            .bind(set['id'], ownerUserId, item['id'], set['setNumber'], nullable(set['targetWeightKg']), nullable(set['targetReps']), nullable(set['targetDurationSeconds']), nullable(set['targetDistanceMeters']), nullable(set['targetRpe']), nullable(set['notes'])),
        );
      }
    }
  }
  for (const session of snapshot.workoutSessions) {
    statements.push(
      database.prepare(`INSERT INTO workout_sessions
        (id, owner_user_id, client_id, template_id, name, started_at, completed_at, status, notes, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`)
        .bind(session['id'], ownerUserId, session['clientId'], nullable(session['templateId']), session['name'], session['startedAt'], nullable(session['completedAt']), session['status'], nullable(session['notes']), session['createdAt'], session['updatedAt']),
    );
    for (const item of session['exercises'] as Row[]) {
      statements.push(
        database.prepare(`INSERT INTO workout_exercises
          (id, owner_user_id, session_id, exercise_id, position, notes)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
          .bind(item['id'], ownerUserId, session['id'], item['exerciseId'], item['order'], nullable(item['notes'])),
      );
      for (const set of item['sets'] as Row[]) {
        statements.push(
          database.prepare(`INSERT INTO workout_sets
            (id, owner_user_id, workout_exercise_id, set_number, status, weight_kg, reps, duration_seconds, distance_meters, rpe, notes)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`)
            .bind(set['id'], ownerUserId, item['id'], set['setNumber'], set['status'], nullable(set['weightKg']), nullable(set['reps']), nullable(set['durationSeconds']), nullable(set['distanceMeters']), nullable(set['rpe']), nullable(set['notes'])),
        );
      }
    }
  }

  statements.push(
    database.prepare("UPDATE app_users SET data_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1").bind(ownerUserId),
    database.prepare(`INSERT INTO audit_events
      (id, owner_user_id, actor_user_id, action, entity_type, request_id)
      VALUES (?1, ?2, ?2, 'fitness_data.replaced', 'fitness_snapshot', ?3)`)
      .bind(crypto.randomUUID(), ownerUserId, requestId),
  );

  await database.batch(statements);
  return readFitnessData(database, ownerUserId);
}

function validateSnapshot(value: unknown): FitnessDataSnapshot {
  if (!isRow(value) || value['schemaVersion'] !== 1) {
    throw new FitnessDataError('The saved data format is not supported.', 400);
  }
  const keys = ['clients', 'goals', 'measurements', 'exercises', 'workoutTemplates', 'workoutSessions'] as const;
  for (const key of keys) {
    if (!Array.isArray(value[key])) {
      throw new FitnessDataError(`The ${key} collection is invalid.`, 400);
    }
  }
  const snapshot = value as unknown as FitnessDataSnapshot;
  const flatRecords = [
    ...snapshot.clients,
    ...snapshot.goals,
    ...snapshot.measurements,
    ...snapshot.exercises,
    ...snapshot.workoutTemplates,
    ...snapshot.workoutSessions,
    ...snapshot.workoutTemplates.flatMap((item) => arrayOfRows(item['exercises']).flatMap((exercise) => [exercise, ...arrayOfRows(exercise['sets'])])),
    ...snapshot.workoutSessions.flatMap((item) => arrayOfRows(item['exercises']).flatMap((exercise) => [exercise, ...arrayOfRows(exercise['sets'])])),
  ];
  if (flatRecords.length > MAX_TOTAL_RECORDS || flatRecords.some((item) => !isRow(item))) {
    throw new FitnessDataError('The saved data contains too many or invalid records.', 400);
  }
  for (const record of flatRecords) requireString(record, 'id', 160);
  for (const client of snapshot.clients) {
    requireStrings(client, ['firstName', 'lastName', 'email', 'joinedAt', 'status', 'avatarColor']);
  }
  for (const goal of snapshot.goals) requireStrings(goal, ['clientId', 'title', 'category', 'status']);
  for (const measurement of snapshot.measurements) requireStrings(measurement, ['clientId', 'recordedAt']);
  for (const exercise of snapshot.exercises) {
    requireStrings(exercise, ['name', 'category', 'primaryMuscleGroup', 'equipment']);
    if (!Array.isArray(exercise['metrics'])) throw new FitnessDataError('An exercise has invalid metrics.', 400);
  }
  for (const template of snapshot.workoutTemplates) {
    requireString(template, 'name');
    assertNestedExercises(template);
  }
  for (const session of snapshot.workoutSessions) {
    requireStrings(session, ['clientId', 'name', 'startedAt', 'status']);
    assertNestedExercises(session);
  }
  return snapshot;
}

function assertNestedExercises(parent: Row): void {
  for (const exercise of arrayOfRows(parent['exercises'])) {
    requireString(exercise, 'exerciseId');
    if (!Number.isInteger(exercise['order'])) throw new FitnessDataError('An exercise order is invalid.', 400);
    for (const set of arrayOfRows(exercise['sets'])) {
      if (!Number.isInteger(set['setNumber'])) throw new FitnessDataError('A set number is invalid.', 400);
    }
  }
}

function mapClient(row: Row): Row {
  return compact({ id: row['id'], firstName: row['first_name'], lastName: row['last_name'], email: row['email'], phone: row['phone'], dateOfBirth: row['date_of_birth'], joinedAt: row['joined_at'], status: row['status'], avatarColor: row['avatar_color'], notes: row['notes'], createdAt: row['created_at'], updatedAt: row['updated_at'] });
}

function mapGoal(row: Row): Row {
  return compact({ id: row['id'], clientId: row['client_id'], title: row['title'], category: row['category'], status: row['status'], targetValue: row['target_value'], currentValue: row['current_value'], unit: row['unit'], targetDate: row['target_date'], notes: row['notes'], createdAt: row['created_at'], updatedAt: row['updated_at'] });
}

function mapMeasurement(row: Row): Row {
  return compact({ id: row['id'], clientId: row['client_id'], recordedAt: row['recorded_at'], bodyWeightKg: row['body_weight_kg'], bodyFatPercent: row['body_fat_percent'], chestCm: row['chest_cm'], waistCm: row['waist_cm'], hipsCm: row['hips_cm'], leftArmCm: row['left_arm_cm'], rightArmCm: row['right_arm_cm'], leftThighCm: row['left_thigh_cm'], rightThighCm: row['right_thigh_cm'], restingHeartRateBpm: row['resting_heart_rate_bpm'], notes: row['notes'], createdAt: row['created_at'], updatedAt: row['updated_at'] });
}

function mapExercise(row: Row, metrics: Map<string, string[]>): Row {
  return compact({ id: row['id'], name: row['name'], category: row['category'], primaryMuscleGroup: row['primary_muscle_group'], equipment: row['equipment'], metrics: metrics.get(String(row['id'])) ?? [], instructions: row['instructions'], isCustom: row['is_custom'] === 1, createdAt: row['created_at'], updatedAt: row['updated_at'] });
}

function mapTemplate(row: Row, exercises: Map<string, Row[]>, sets: Map<string, Row[]>): Row {
  return compact({ id: row['id'], name: row['name'], description: row['description'], exercises: (exercises.get(String(row['id'])) ?? []).map((item) => compact({ id: item['id'], exerciseId: item['exercise_id'], order: item['position'], sets: (sets.get(String(item['id'])) ?? []).map(mapTemplateSet), restSeconds: item['rest_seconds'], notes: item['notes'] })), createdAt: row['created_at'], updatedAt: row['updated_at'] });
}

function mapTemplateSet(row: Row): Row {
  return compact({ id: row['id'], setNumber: row['set_number'], targetWeightKg: row['target_weight_kg'], targetReps: row['target_reps'], targetDurationSeconds: row['target_duration_seconds'], targetDistanceMeters: row['target_distance_meters'], targetRpe: row['target_rpe'], notes: row['notes'] });
}

function mapSession(row: Row, exercises: Map<string, Row[]>, sets: Map<string, Row[]>): Row {
  return compact({ id: row['id'], clientId: row['client_id'], templateId: row['template_id'], name: row['name'], startedAt: row['started_at'], completedAt: row['completed_at'], status: row['status'], exercises: (exercises.get(String(row['id'])) ?? []).map((item) => compact({ id: item['id'], exerciseId: item['exercise_id'], order: item['position'], sets: (sets.get(String(item['id'])) ?? []).map(mapWorkoutSet), notes: item['notes'] })), notes: row['notes'], createdAt: row['created_at'], updatedAt: row['updated_at'] });
}

function mapWorkoutSet(row: Row): Row {
  return compact({ id: row['id'], setNumber: row['set_number'], status: row['status'], weightKg: row['weight_kg'], reps: row['reps'], durationSeconds: row['duration_seconds'], distanceMeters: row['distance_meters'], rpe: row['rpe'], notes: row['notes'] });
}

function rows(result: D1Result<Row> | undefined): Row[] {
  return (result?.results ?? []) as Row[];
}

function group(input: Row[], key: string): Map<string, Row[]> {
  const output = new Map<string, Row[]>();
  for (const row of input) {
    const groupKey = String(row[key]);
    output.set(groupKey, [...(output.get(groupKey) ?? []), row]);
  }
  return output;
}

function groupStrings(input: Row[], key: string, valueKey: string): Map<string, string[]> {
  const output = new Map<string, string[]>();
  for (const row of input) {
    const groupKey = String(row[key]);
    output.set(groupKey, [...(output.get(groupKey) ?? []), String(row[valueKey])]);
  }
  return output;
}

function compact(value: Row): Row {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined));
}

function nullable(value: unknown): string | number | null {
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new FitnessDataError('The saved data is not valid JSON.', 400);
  }
}

function isRow(value: unknown): value is Row {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function arrayOfRows(value: unknown): Row[] {
  if (!Array.isArray(value) || value.some((item) => !isRow(item))) {
    throw new FitnessDataError('A nested data collection is invalid.', 400);
  }
  return value as Row[];
}

function requireStrings(row: Row, keys: string[]): void {
  for (const key of keys) requireString(row, key);
}

function requireString(row: Row, key: string, maxLength = 500): void {
  if (typeof row[key] !== 'string' || row[key].length === 0 || row[key].length > maxLength) {
    throw new FitnessDataError(`A required ${key} value is invalid.`, 400);
  }
}
