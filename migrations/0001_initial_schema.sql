-- Migration number: 0001
-- BarBelle's Fitness Studio
-- Initial tenant-isolated D1 database schema

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY NOT NULL,
  access_subject TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  data_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  first_name TEXT NOT NULL CHECK (length(trim(first_name)) > 0),
  last_name TEXT NOT NULL CHECK (length(trim(last_name)) > 0),
  email TEXT NOT NULL COLLATE NOCASE,
  phone TEXT,
  date_of_birth TEXT,
  joined_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  avatar_color TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (owner_user_id, id),
  UNIQUE (owner_user_id, email)
);

CREATE TABLE IF NOT EXISTS client_goals (
  id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  client_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  category TEXT NOT NULL CHECK (
    category IN ('strength', 'body-composition', 'endurance', 'mobility', 'habit', 'other')
  ),
  status TEXT NOT NULL CHECK (status IN ('active', 'achieved', 'paused')),
  target_value REAL,
  current_value REAL,
  unit TEXT,
  target_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (owner_user_id, id),
  FOREIGN KEY (owner_user_id, client_id)
    REFERENCES clients(owner_user_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS body_measurements (
  id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  client_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  body_weight_kg REAL CHECK (body_weight_kg IS NULL OR body_weight_kg >= 0),
  body_fat_percent REAL CHECK (
    body_fat_percent IS NULL OR body_fat_percent BETWEEN 0 AND 100
  ),
  chest_cm REAL CHECK (chest_cm IS NULL OR chest_cm >= 0),
  waist_cm REAL CHECK (waist_cm IS NULL OR waist_cm >= 0),
  hips_cm REAL CHECK (hips_cm IS NULL OR hips_cm >= 0),
  left_arm_cm REAL CHECK (left_arm_cm IS NULL OR left_arm_cm >= 0),
  right_arm_cm REAL CHECK (right_arm_cm IS NULL OR right_arm_cm >= 0),
  left_thigh_cm REAL CHECK (left_thigh_cm IS NULL OR left_thigh_cm >= 0),
  right_thigh_cm REAL CHECK (right_thigh_cm IS NULL OR right_thigh_cm >= 0),
  resting_heart_rate_bpm INTEGER CHECK (
    resting_heart_rate_bpm IS NULL OR resting_heart_rate_bpm > 0
  ),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (owner_user_id, id),
  FOREIGN KEY (owner_user_id, client_id)
    REFERENCES clients(owner_user_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS exercises (
  id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  category TEXT NOT NULL CHECK (
    category IN ('strength', 'cardio', 'mobility', 'conditioning', 'recovery')
  ),
  primary_muscle_group TEXT NOT NULL,
  equipment TEXT NOT NULL,
  instructions TEXT,
  is_custom INTEGER NOT NULL DEFAULT 0 CHECK (is_custom IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (owner_user_id, id),
  UNIQUE (owner_user_id, name)
);

CREATE TABLE IF NOT EXISTS exercise_metrics (
  owner_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  exercise_id TEXT NOT NULL,
  metric TEXT NOT NULL CHECK (
    metric IN ('weight', 'reps', 'duration', 'distance', 'rpe', 'notes')
  ),
  PRIMARY KEY (owner_user_id, exercise_id, metric),
  FOREIGN KEY (owner_user_id, exercise_id)
    REFERENCES exercises(owner_user_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workout_templates (
  id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (owner_user_id, id)
);

CREATE TABLE IF NOT EXISTS template_exercises (
  id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  template_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  rest_seconds INTEGER CHECK (rest_seconds IS NULL OR rest_seconds >= 0),
  notes TEXT,
  PRIMARY KEY (owner_user_id, id),
  UNIQUE (owner_user_id, template_id, position),
  FOREIGN KEY (owner_user_id, template_id)
    REFERENCES workout_templates(owner_user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id, exercise_id)
    REFERENCES exercises(owner_user_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS template_sets (
  id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  template_exercise_id TEXT NOT NULL,
  set_number INTEGER NOT NULL CHECK (set_number > 0),
  target_weight_kg REAL CHECK (target_weight_kg IS NULL OR target_weight_kg >= 0),
  target_reps INTEGER CHECK (target_reps IS NULL OR target_reps >= 0),
  target_duration_seconds INTEGER CHECK (
    target_duration_seconds IS NULL OR target_duration_seconds >= 0
  ),
  target_distance_meters REAL CHECK (
    target_distance_meters IS NULL OR target_distance_meters >= 0
  ),
  target_rpe REAL CHECK (target_rpe IS NULL OR target_rpe BETWEEN 1 AND 10),
  notes TEXT,
  PRIMARY KEY (owner_user_id, id),
  UNIQUE (owner_user_id, template_exercise_id, set_number),
  FOREIGN KEY (owner_user_id, template_exercise_id)
    REFERENCES template_exercises(owner_user_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workout_sessions (
  id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  client_id TEXT NOT NULL,
  template_id TEXT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('planned', 'in-progress', 'completed', 'cancelled')
  ),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (owner_user_id, id),
  FOREIGN KEY (owner_user_id, client_id)
    REFERENCES clients(owner_user_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workout_exercises (
  id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  session_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  notes TEXT,
  PRIMARY KEY (owner_user_id, id),
  UNIQUE (owner_user_id, session_id, position),
  FOREIGN KEY (owner_user_id, session_id)
    REFERENCES workout_sessions(owner_user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id, exercise_id)
    REFERENCES exercises(owner_user_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS workout_sets (
  id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  workout_exercise_id TEXT NOT NULL,
  set_number INTEGER NOT NULL CHECK (set_number > 0),
  status TEXT NOT NULL CHECK (status IN ('planned', 'completed', 'skipped')),
  weight_kg REAL CHECK (weight_kg IS NULL OR weight_kg >= 0),
  reps INTEGER CHECK (reps IS NULL OR reps >= 0),
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  distance_meters REAL CHECK (distance_meters IS NULL OR distance_meters >= 0),
  rpe REAL CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10),
  notes TEXT,
  PRIMARY KEY (owner_user_id, id),
  UNIQUE (owner_user_id, workout_exercise_id, set_number),
  FOREIGN KEY (owner_user_id, workout_exercise_id)
    REFERENCES workout_exercises(owner_user_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  request_id TEXT,
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (owner_user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_clients_owner_status
  ON clients(owner_user_id, status);

CREATE INDEX IF NOT EXISTS idx_goals_owner_client
  ON client_goals(owner_user_id, client_id, status);

CREATE INDEX IF NOT EXISTS idx_measurements_owner_client_date
  ON body_measurements(owner_user_id, client_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_exercises_owner_category
  ON exercises(owner_user_id, category);

CREATE INDEX IF NOT EXISTS idx_templates_owner
  ON workout_templates(owner_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_template_exercises_owner_template
  ON template_exercises(owner_user_id, template_id, position);

CREATE INDEX IF NOT EXISTS idx_sessions_owner_client_date
  ON workout_sessions(owner_user_id, client_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_workout_exercises_owner_session
  ON workout_exercises(owner_user_id, session_id, position);

CREATE INDEX IF NOT EXISTS idx_audit_events_owner_date
  ON audit_events(owner_user_id, occurred_at DESC);
