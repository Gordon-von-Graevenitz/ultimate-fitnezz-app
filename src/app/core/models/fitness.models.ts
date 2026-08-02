/** A UUID-like identifier generated locally by the application. */
export type EntityId = string;

/** ISO-8601 date (`YYYY-MM-DD`) or date-time string. */
export type IsoDateString = string;

export type ClientStatus = 'active' | 'inactive';
export type GoalStatus = 'active' | 'achieved' | 'paused';
export type GoalCategory =
  'strength' | 'body-composition' | 'endurance' | 'mobility' | 'habit' | 'other';
export type ExerciseCategory = 'strength' | 'cardio' | 'mobility' | 'conditioning' | 'recovery';
export type ExerciseMetric = 'weight' | 'reps' | 'duration' | 'distance' | 'rpe' | 'notes';
export type WorkoutSessionStatus = 'planned' | 'in-progress' | 'completed' | 'cancelled';
export type WorkoutSetStatus = 'planned' | 'completed' | 'skipped';

export interface Client {
  readonly id: EntityId;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone?: string;
  readonly dateOfBirth?: IsoDateString;
  readonly joinedAt: IsoDateString;
  readonly status: ClientStatus;
  readonly avatarColor: string;
  readonly notes?: string;
  readonly createdAt: IsoDateString;
  readonly updatedAt: IsoDateString;
}

export interface ClientGoal {
  readonly id: EntityId;
  readonly clientId: EntityId;
  readonly title: string;
  readonly category: GoalCategory;
  readonly status: GoalStatus;
  readonly targetValue?: number;
  readonly currentValue?: number;
  readonly unit?: string;
  readonly targetDate?: IsoDateString;
  readonly notes?: string;
  readonly createdAt: IsoDateString;
  readonly updatedAt: IsoDateString;
}

export interface BodyMeasurement {
  readonly id: EntityId;
  readonly clientId: EntityId;
  readonly recordedAt: IsoDateString;
  readonly bodyWeightKg?: number;
  readonly bodyFatPercent?: number;
  readonly chestCm?: number;
  readonly waistCm?: number;
  readonly hipsCm?: number;
  readonly leftArmCm?: number;
  readonly rightArmCm?: number;
  readonly leftThighCm?: number;
  readonly rightThighCm?: number;
  readonly restingHeartRateBpm?: number;
  readonly notes?: string;
  readonly createdAt: IsoDateString;
  readonly updatedAt: IsoDateString;
}

/** Metadata plus an optional compressed data URL stored only on this device. */
export interface ProgressPhoto {
  readonly id: EntityId;
  readonly clientId: EntityId;
  readonly recordedAt: IsoDateString;
  readonly angle: 'front' | 'side' | 'back' | 'other';
  readonly fileName: string;
  readonly localPreviewUrl?: string;
  readonly caption?: string;
  readonly createdAt: IsoDateString;
  readonly updatedAt: IsoDateString;
}

export interface Exercise {
  readonly id: EntityId;
  readonly name: string;
  readonly category: ExerciseCategory;
  readonly primaryMuscleGroup: string;
  readonly equipment: string;
  readonly metrics: readonly ExerciseMetric[];
  readonly instructions?: string;
  readonly isCustom: boolean;
  readonly createdAt: IsoDateString;
  readonly updatedAt: IsoDateString;
}

export interface WorkoutSet {
  readonly id: EntityId;
  readonly setNumber: number;
  readonly status: WorkoutSetStatus;
  readonly weightKg?: number;
  readonly reps?: number;
  readonly durationSeconds?: number;
  readonly distanceMeters?: number;
  readonly rpe?: number;
  readonly notes?: string;
}

export interface TemplateSet {
  readonly id: EntityId;
  readonly setNumber: number;
  readonly targetWeightKg?: number;
  readonly targetReps?: number;
  readonly targetDurationSeconds?: number;
  readonly targetDistanceMeters?: number;
  readonly targetRpe?: number;
  readonly notes?: string;
}

export interface TemplateExercise {
  readonly id: EntityId;
  readonly exerciseId: EntityId;
  readonly order: number;
  readonly sets: readonly TemplateSet[];
  readonly restSeconds?: number;
  readonly notes?: string;
}

export interface WorkoutTemplate {
  readonly id: EntityId;
  readonly name: string;
  readonly description?: string;
  readonly exercises: readonly TemplateExercise[];
  readonly createdAt: IsoDateString;
  readonly updatedAt: IsoDateString;
}

export interface WorkoutExercise {
  readonly id: EntityId;
  readonly exerciseId: EntityId;
  readonly order: number;
  readonly sets: readonly WorkoutSet[];
  readonly notes?: string;
}

export interface WorkoutSession {
  readonly id: EntityId;
  readonly clientId: EntityId;
  readonly templateId?: EntityId;
  readonly name: string;
  readonly startedAt: IsoDateString;
  readonly completedAt?: IsoDateString;
  readonly status: WorkoutSessionStatus;
  readonly exercises: readonly WorkoutExercise[];
  readonly notes?: string;
  readonly createdAt: IsoDateString;
  readonly updatedAt: IsoDateString;
}

export interface FitnessDataSnapshot {
  readonly schemaVersion: 1;
  readonly clients: readonly Client[];
  readonly goals: readonly ClientGoal[];
  readonly measurements: readonly BodyMeasurement[];
  readonly progressPhotos: readonly ProgressPhoto[];
  readonly exercises: readonly Exercise[];
  readonly workoutTemplates: readonly WorkoutTemplate[];
  readonly workoutSessions: readonly WorkoutSession[];
}

export type CreateClientInput = Omit<Client, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateClientInput = Partial<Omit<Client, 'id' | 'createdAt' | 'updatedAt'>>;
export type CreateGoalInput = Omit<ClientGoal, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateGoalInput = Partial<
  Omit<ClientGoal, 'id' | 'clientId' | 'createdAt' | 'updatedAt'>
>;
export type CreateMeasurementInput = Omit<BodyMeasurement, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateMeasurementInput = Partial<
  Omit<BodyMeasurement, 'id' | 'clientId' | 'createdAt' | 'updatedAt'>
>;
export type CreateProgressPhotoInput = Omit<ProgressPhoto, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateProgressPhotoInput = Partial<
  Omit<ProgressPhoto, 'id' | 'clientId' | 'createdAt' | 'updatedAt'>
>;
export type CreateExerciseInput = Omit<Exercise, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateExerciseInput = Partial<Omit<Exercise, 'id' | 'createdAt' | 'updatedAt'>>;
export type CreateWorkoutTemplateInput = Omit<WorkoutTemplate, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateWorkoutTemplateInput = Partial<
  Omit<WorkoutTemplate, 'id' | 'createdAt' | 'updatedAt'>
>;
export type CreateWorkoutSessionInput = Omit<WorkoutSession, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateWorkoutSessionInput = Partial<
  Omit<WorkoutSession, 'id' | 'clientId' | 'createdAt' | 'updatedAt'>
>;
