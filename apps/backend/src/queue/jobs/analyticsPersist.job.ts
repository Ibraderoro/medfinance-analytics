export const ANALYTICS_PERSIST_JOB_NAME = 'persist-batch' as const;
export const ANALYTICS_PERSIST_REPEATABLE_JOB_ID = 'analytics-persist-tick' as const;

export type AnalyticsPersistPayload = Record<string, never>;
