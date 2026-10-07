/**
 * AI Observability, Usage Controls, and Telemetry Tests
 *
 * Verifies:
 *  - Every AI operation (ask + summary) generates safe audit metadata
 *  - No raw prompt/response content written to structured logs
 *  - Summary generation is independently audited with operation='summary'
 *  - Per-user and per-tenant rate limits enforced via Lua-atomic Redis ops before provider call
 *  - Daily token budget enforced as a hard pre-call block via Lua reservation
 *  - Monthly token and USD budgets enforced before provider call
 *  - Tenant A cannot consume Tenant B's quota (key isolation)
 *  - Requests rejected by rate/budget do NOT call OpenAI
 *  - Token usage and estimated cost recorded when available
 *  - Metrics counters incremented on success, failure, rate-limit, and budget rejection
 *  - Concurrency guard still works after usage-control integration
 *  - Redis fail-closed mode rejects requests when Redis is unavailable
 *  - AI_PRICING_OVERRIDES env var overrides the pricing table
 *  - Monthly budget (token + USD) blocks requests pre-call
 */

// ---------------------------------------------------------------------------
// Environment — must happen before any module that imports `env`
// ---------------------------------------------------------------------------
process.env.OPENAI_API_KEY = 'sk-test-key-observability';
process.env.AI_TIMEOUT_MS = '5000';
process.env.AI_MAX_CONTEXT_BYTES = '8000';
process.env.AI_MAX_CONCURRENT_PER_USER = '3';
process.env.AI_MAX_HISTORY_MSG_CHARS = '2000';
process.env.AI_MODEL_CONTEXT_TOKENS = '128000';
process.env.AI_USER_RPM_MAX = '5';
process.env.AI_USER_RPM_WINDOW_MS = '60000';
process.env.AI_TENANT_RPM_MAX = '10';
process.env.AI_TENANT_RPM_WINDOW_MS = '60000';
process.env.AI_TENANT_DAILY_TOKEN_BUDGET = '1000';
process.env.AI_TENANT_MONTHLY_TOKEN_BUDGET = '0';
process.env.AI_TENANT_MONTHLY_BUDGET_USD = '0';
process.env.AI_MAX_TOKENS_PER_REQUEST = '0';
process.env.AI_MAX_COST_PER_REQUEST_USD = '0';
process.env.AI_USAGE_REDIS_FAIL_OPEN = 'true';
process.env.OPENAI_MODEL = 'gpt-4o-mini';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreate = jest.fn();

jest.mock('openai', () =>
  jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
);

jest.mock('../services/financials.service', () => ({
  FinancialsService: jest.fn().mockImplementation(() => ({
    getKpis: jest.fn().mockResolvedValue([{ period: '2024-01', revenue: 100_000 }]),
  })),
}));
jest.mock('../services/insights.service', () => ({
  InsightsService: jest.fn().mockImplementation(() => ({
    getInsights: jest.fn().mockResolvedValue({ health_score: 80, risk_level: 'low', insights: [] }),
  })),
}));
jest.mock('../services/compliance.service', () => ({
  ComplianceService: jest.fn().mockImplementation(() => ({
    getComplianceStatus: jest.fn().mockResolvedValue([{ status: 'compliant' }]),
  })),
}));
jest.mock('../services/forecasting.service', () => ({
  ForecastingService: jest.fn().mockImplementation(() => ({
    getForecast: jest.fn().mockResolvedValue({
      metric: 'revenue',
      trend: 'up',
      confidenceLevel: 0.9,
      dataPoints: [{ projected_total: 110_000, actual_total: null }],
    }),
  })),
}));

// Capture structured log calls for assertion.
const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();
jest.mock('../utils/logger', () => ({
  logger: {
    info: mockLogInfo,
    warn: mockLogWarn,
    error: mockLogError,
    debug: jest.fn(),
  },
}));

// Capture audit service calls.
const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../services/audit.service', () => ({
  AuditService: jest.fn().mockImplementation(() => ({
    log: mockAuditLog,
  })),
}));

// Controllable Redis mock — shared between ai.service (concurrency) and
// ai.usageControl (rate limits / token quotas).
const mockRedisCall = jest.fn();

jest.mock('../config/redis', () => ({
  getRedis: () => ({ call: mockRedisCall }),
  timedRedis: jest.fn(),
  CACHE_TTL: { financialDataSeconds: 300, latestMetricsSeconds: 120 },
}));

// Capture metrics service calls.
const mockRecordAiRequest = jest.fn();
const mockRecordAiTokenUsage = jest.fn();
const mockRecordAiRateLimitRejection = jest.fn();
const mockRecordAiBudgetRejection = jest.fn();

jest.mock('../services/metrics.service', () => ({
  metricsService: {
    recordAiRequest: mockRecordAiRequest,
    recordAiTokenUsage: mockRecordAiTokenUsage,
    recordAiRateLimitRejection: mockRecordAiRateLimitRejection,
    recordAiBudgetRejection: mockRecordAiBudgetRejection,
    recordRedisOperation: jest.fn(),
    recordRequest: jest.fn(),
    recordDbQuery: jest.fn(),
  },
}));

import { AiService, inFlightByUser } from '../services/ai.service';
import {
  checkUsageLimits,
  reconcileBudget,
} from '../services/ai.usageControl';
import { estimateCost, resetPricingCache } from '../services/ai.telemetry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeValidResponse(answer = 'Revenue is healthy.', recs = ['Monitor costs']): string {
  return JSON.stringify({ answer, recommendations: recs });
}

function makeOpenAiResponse(content: string, usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }) {
  return {
    choices: [{ message: { content } }],
    usage: usage ?? null,
  };
}

/**
 * Configure Redis mock to allow all pre-call controls.
 * Handles EVAL (Lua scripts), INCR, PTTL, PEXPIRE, DECR, DEL, GET, INCRBY, DECRBY.
 */
function allowAllRedis(): void {
  mockRedisCall.mockImplementation(async (cmd: string) => {
    if (cmd === 'EVAL') return 1;       // Lua script: INCR_WITH_TTL → 1, RESERVE_BUDGET → 1
    if (cmd === 'INCR') return 1;       // concurrency guard
    if (cmd === 'PTTL') return -1;
    if (cmd === 'PEXPIRE') return 1;
    if (cmd === 'DECR') return 0;
    if (cmd === 'DECRBY') return 0;
    if (cmd === 'DEL') return 1;
    if (cmd === 'GET') return null;
    if (cmd === 'INCRBY') return 100;
    return 1;
  });
}

/**
 * Build a Redis mock that handles EVAL as follows:
 *   - First 2 EVAL calls (user/tenant rate limit scripts) → return 1 (allowed)
 *   - 3rd EVAL call (daily budget reservation script) → return reservationResult
 *   - Subsequent calls → return 1
 */
function evalWithDailyBudget(reservationResult: number): void {
  let evalIdx = 0;
  mockRedisCall.mockImplementation(async (cmd: string) => {
    if (cmd === 'EVAL') {
      evalIdx++;
      if (evalIdx <= 2) return 1;      // user + tenant rate limit → allowed
      return reservationResult;         // daily budget check
    }
    if (cmd === 'INCR') return 1;      // concurrency
    if (cmd === 'PTTL') return -1;
    if (cmd === 'PEXPIRE') return 1;
    if (cmd === 'DECR') return 0;
    if (cmd === 'DECRBY') return 0;
    if (cmd === 'DEL') return 1;
    if (cmd === 'GET') return null;
    if (cmd === 'INCRBY') return 100;
    return 1;
  });
}

// ---------------------------------------------------------------------------
// 1. Telemetry — every AI invocation records safe audit metadata
// ---------------------------------------------------------------------------

describe('AI telemetry: safe metadata audit on every invocation', () => {
  let service: AiService;

  beforeEach(() => {
    jest.clearAllMocks();
    allowAllRedis();
    inFlightByUser.clear();
    service = new AiService();
  });

  it('records ai_invocation log with safe fields (no prompt/response content) on success', async () => {
    mockCreate.mockResolvedValueOnce(
      makeOpenAiResponse(makeValidResponse(), { prompt_tokens: 200, completion_tokens: 50, total_tokens: 250 }),
    );

    await service.ask('org-1', 'What is our revenue?', [], 'user-1');

    const infoCalls: [string, Record<string, unknown>][] = mockLogInfo.mock.calls;
    const telemetryLog = infoCalls.find(([event]) => event === 'ai_invocation');
    expect(telemetryLog).toBeDefined();
    const meta = telemetryLog![1];

    expect(meta.organizationId).toBe('org-1');
    expect(meta.userId).toBe('user-1');
    expect(meta.operation).toBe('ask');
    expect(meta.provider).toBe('openai');
    expect(meta.model).toBe('gpt-4o-mini');
    expect(meta.outcome).toBe('success');
    expect(meta.latencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof meta.promptLength).toBe('number');
    expect(typeof meta.answerLength).toBe('number');
    expect(meta.promptTokens).toBe(200);
    expect(meta.completionTokens).toBe(50);
    expect(meta.totalTokens).toBe(250);
    // Raw question and answer MUST NOT appear in the log.
    expect(JSON.stringify(meta)).not.toContain('What is our revenue?');
    expect(JSON.stringify(meta)).not.toContain('Revenue is healthy.');
  });

  it('does not log raw question text in any log call (info, warn, error)', async () => {
    const SENSITIVE_QUESTION = 'What is the exact patient revenue breakdown for Q3?';
    mockCreate.mockResolvedValueOnce(makeOpenAiResponse(makeValidResponse()));

    await service.ask('org-1', SENSITIVE_QUESTION, [], 'user-1');

    const allLogArgs = [
      ...mockLogInfo.mock.calls,
      ...mockLogWarn.mock.calls,
      ...mockLogError.mock.calls,
    ].map((call) => JSON.stringify(call));

    for (const logEntry of allLogArgs) {
      expect(logEntry).not.toContain(SENSITIVE_QUESTION);
      expect(logEntry).not.toContain('patient revenue breakdown');
    }
  });

  it('does not log raw model response content in any log call', async () => {
    const SENSITIVE_ANSWER = 'Patient count is exactly 4321 and drug costs are $98765.';
    mockCreate.mockResolvedValueOnce(
      makeOpenAiResponse(JSON.stringify({ answer: SENSITIVE_ANSWER, recommendations: ['Act now'] })),
    );

    await service.ask('org-1', 'Summarise finances.', [], 'user-1');

    const allLogArgs = [
      ...mockLogInfo.mock.calls,
      ...mockLogWarn.mock.calls,
      ...mockLogError.mock.calls,
    ].map((call) => JSON.stringify(call));

    for (const logEntry of allLogArgs) {
      expect(logEntry).not.toContain(SENSITIVE_ANSWER);
      expect(logEntry).not.toContain('4321');
      expect(logEntry).not.toContain('98765');
    }
  });

  it('records audit log entry with operation=ask and safe metadata', async () => {
    mockCreate.mockResolvedValueOnce(makeOpenAiResponse(makeValidResponse()));

    await service.ask('org-1', 'Revenue status?', [], 'user-1', { requestId: 'req-abc' });

    await new Promise((r) => setTimeout(r, 10));

    expect(mockAuditLog).toHaveBeenCalled();
    const auditCall = mockAuditLog.mock.calls[0][0] as Record<string, unknown>;
    expect(auditCall.action).toBe('ai-query');
    expect(auditCall.entityType).toBe('ai-session');
    expect(auditCall.organizationId).toBe('org-1');
    expect(auditCall.performedBy).toBe('user-1');
    expect(auditCall.requestId).toBe('req-abc');
    const metaStr = JSON.stringify(auditCall.metadata);
    expect(metaStr).not.toContain('Revenue status?');
    expect(metaStr).toContain('ask');
    expect(metaStr).toContain('openai');
  });

  it('records latency > 0 in the telemetry log', async () => {
    mockCreate.mockImplementation(
      () => new Promise((r) => setTimeout(() => r(makeOpenAiResponse(makeValidResponse())), 10)),
    );

    await service.ask('org-1', 'Forecast?', [], 'user-1');

    const telemetryLog = mockLogInfo.mock.calls.find(([event]: [string]) => event === 'ai_invocation');
    expect(telemetryLog).toBeDefined();
    expect((telemetryLog![1] as { latencyMs: number }).latencyMs).toBeGreaterThan(0);
  });

  it('records failure outcome with errorCategory on provider timeout', async () => {
    const abort = new Error('Aborted');
    abort.name = 'AbortError';
    mockCreate.mockRejectedValueOnce(abort);

    await service.ask('org-1', 'What?', [], 'user-1');

    const telemetryLog = mockLogInfo.mock.calls.find(([event]: [string]) => event === 'ai_invocation');
    expect(telemetryLog).toBeDefined();
    const meta = telemetryLog![1] as Record<string, unknown>;
    expect(meta.outcome).toBe('failure');
    expect(meta.errorCategory).toBe('provider_timeout');
  });
});

// ---------------------------------------------------------------------------
// 2. Summary telemetry — getSummary audited with operation='summary'
// ---------------------------------------------------------------------------

describe('AI telemetry: summary operation audited separately', () => {
  let service: AiService;

  beforeEach(() => {
    jest.clearAllMocks();
    allowAllRedis();
    inFlightByUser.clear();
    service = new AiService();
  });

  it('records operation=summary in telemetry log when getSummary is called', async () => {
    mockCreate.mockResolvedValueOnce(makeOpenAiResponse(makeValidResponse('Summary here.', ['Key rec'])));

    await service.getSummary('org-summary');

    const telemetryLog = mockLogInfo.mock.calls.find(([event]: [string]) => event === 'ai_invocation');
    expect(telemetryLog).toBeDefined();
    const meta = telemetryLog![1] as Record<string, unknown>;
    expect(meta.operation).toBe('summary');
    expect(meta.organizationId).toBe('org-summary');
  });

  it('writes audit log entry with action=ai-summary for getSummary', async () => {
    mockCreate.mockResolvedValueOnce(makeOpenAiResponse(makeValidResponse()));

    await service.getSummary('org-summary', { requestId: 'req-sum', userId: 'user-s' });
    await new Promise((r) => setTimeout(r, 10));

    expect(mockAuditLog).toHaveBeenCalled();
    const auditCall = mockAuditLog.mock.calls[0][0] as Record<string, unknown>;
    expect(auditCall.action).toBe('ai-summary');
    expect(auditCall.performedBy).toBe('user-s');
    expect(auditCall.requestId).toBe('req-sum');
  });

  it('does not write raw EXECUTIVE_SUMMARY_QUESTION to any log', async () => {
    mockCreate.mockResolvedValueOnce(makeOpenAiResponse(makeValidResponse()));

    await service.getSummary('org-summary');

    const allLogArgs = [
      ...mockLogInfo.mock.calls,
      ...mockLogWarn.mock.calls,
    ].map((call) => JSON.stringify(call));

    for (const entry of allLogArgs) {
      expect(entry).not.toContain('executive summary');
      expect(entry).not.toContain('most important recommendations');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Per-user rate limiting (Lua-atomic via EVAL)
// ---------------------------------------------------------------------------

describe('AI usage controls: per-user rate limiting', () => {
  let service: AiService;

  beforeEach(() => {
    jest.clearAllMocks();
    inFlightByUser.clear();
    service = new AiService();
  });

  it('allows a request when user counter is within the limit', async () => {
    allowAllRedis();
    mockCreate.mockResolvedValueOnce(makeOpenAiResponse(makeValidResponse()));

    const result = await service.ask('org-1', 'Revenue?', [], 'user-limit-ok');
    expect(result.contextUsed).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('returns rate-limit fallback when user EVAL returns count > limit (no provider call)', async () => {
    // First EVAL (user rate) returns 6 (over limit of 5) → rejected immediately.
    let evalIdx = 0;
    mockRedisCall.mockImplementation(async (cmd: string) => {
      if (cmd === 'EVAL') {
        evalIdx++;
        if (evalIdx === 1) return 6; // user rate over limit
        return 1;
      }
      return 0; // DECR for undo
    });

    const result = await service.ask('org-1', 'Revenue?', [], 'user-over-limit');

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.contextUsed).toBe(false);
    expect(result.answer).toContain('limit');
  });

  it('records ai_rate_limit_rejections_total metric when user is rate limited', async () => {
    let evalIdx = 0;
    mockRedisCall.mockImplementation(async (cmd: string) => {
      if (cmd === 'EVAL') { evalIdx++; return evalIdx === 1 ? 6 : 1; }
      return 0;
    });

    await service.ask('org-1', 'Rev?', [], 'user-rl');

    expect(mockRecordAiRateLimitRejection).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'user', reason: 'rate' }),
    );
  });

  it('records rate_limited outcome in telemetry when user is rate-limited', async () => {
    let evalIdx = 0;
    mockRedisCall.mockImplementation(async (cmd: string) => {
      if (cmd === 'EVAL') { evalIdx++; return evalIdx === 1 ? 6 : 1; }
      return 0;
    });

    await service.ask('org-1', 'Rev?', [], 'user-rl-telemetry');
    await new Promise((r) => setTimeout(r, 10));

    const telemetryLog = mockLogInfo.mock.calls.find(([event]: [string]) => event === 'ai_invocation');
    expect(telemetryLog).toBeDefined();
    const meta = telemetryLog![1] as Record<string, unknown>;
    expect(meta.outcome).toBe('rate_limited');
    expect(meta.errorCategory).toBe('user_rate_limited');
  });
});

// ---------------------------------------------------------------------------
// 4. Per-tenant rate limiting
// ---------------------------------------------------------------------------

describe('AI usage controls: per-tenant rate limiting', () => {
  let service: AiService;

  beforeEach(() => {
    jest.clearAllMocks();
    inFlightByUser.clear();
    service = new AiService();
  });

  it('returns rate-limit fallback when tenant EVAL returns count > limit', async () => {
    let evalIdx = 0;
    mockRedisCall.mockImplementation(async (cmd: string) => {
      if (cmd === 'EVAL') {
        evalIdx++;
        if (evalIdx === 1) return 1;  // user ok
        if (evalIdx === 2) return 11; // tenant over limit of 10
        return 1;
      }
      return 0; // DECR
    });

    const result = await service.ask('org-rl', 'Revenue?', [], 'user-tenant-rl');

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.contextUsed).toBe(false);
    expect(result.answer).toContain('limit');
    expect(mockRecordAiRateLimitRejection).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'tenant', reason: 'rate' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Tenant isolation — Tenant A cannot consume Tenant B's quota
// ---------------------------------------------------------------------------

describe('AI usage controls: tenant quota isolation', () => {
  it('uses separate Redis keys for different tenants', async () => {
    const calledKeys: string[] = [];
    mockRedisCall.mockImplementation(async (cmd: string, _script: string, _numKeys: string, key: string) => {
      // EVAL args: script, numKeys, key1, [key2], ...argv
      if (cmd === 'EVAL' && key) calledKeys.push(key);
      return 1;
    });

    await checkUsageLimits('user-a', 'tenant-A');
    await checkUsageLimits('user-b', 'tenant-B');

    const tenantAKeys = calledKeys.filter((k) => k.includes('tenant-A'));
    const tenantBKeys = calledKeys.filter((k) => k.includes('tenant-B'));

    expect(tenantAKeys.length).toBeGreaterThan(0);
    expect(tenantBKeys.length).toBeGreaterThan(0);
    for (const k of tenantAKeys) expect(k).not.toContain('tenant-B');
    for (const k of tenantBKeys) expect(k).not.toContain('tenant-A');
  });

  it('tenant B budget exhaustion does not affect tenant A', async () => {
    // Track which tenant key is being accessed in the daily budget EVAL.
    let evalIdx = 0;
    mockRedisCall.mockImplementation(async (cmd: string, _script: string, _numKeys: string, key: string) => {
      if (cmd === 'EVAL') {
        evalIdx++;
        // Calls 1,2: user/tenant rate limits for each checkUsageLimits call → allow
        // Call 3 (budget check for tenant-A): allow
        // Call 4,5 (rate limits for tenant-B): allow
        // Call 6 (budget check for tenant-B): exhaust (-1)
        if (evalIdx <= 3) return 1;   // tenant-A rate + budget: all ok
        if (evalIdx <= 5) return 1;   // tenant-B rate limits: ok
        // key contains tenant-B budget key → return -1 (exhausted)
        if (key && key.includes('tenant-B')) return -1;
        return 1;
      }
      return 0;
    });

    // Reset evalIdx for each call.
    evalIdx = 0;
    const resultA = await checkUsageLimits('user-a', 'tenant-A');
    const resultB = await checkUsageLimits('user-b', 'tenant-B');

    expect(resultA.outcome).toBe('allowed');
    expect(resultB.outcome).toBe('tenant_token_budget_exceeded');
  });
});

// ---------------------------------------------------------------------------
// 6. Daily token budget — hard pre-call block via Lua atomic reservation
// ---------------------------------------------------------------------------

describe('AI usage controls: daily token budget (pre-call Lua reservation)', () => {
  let service: AiService;

  beforeEach(() => {
    jest.clearAllMocks();
    inFlightByUser.clear();
    service = new AiService();
  });

  it('rejects request when daily budget reservation returns -1 (no provider call)', async () => {
    evalWithDailyBudget(-1); // 3rd EVAL (budget) → -1 = would exceed budget

    const result = await service.ask('org-budget', 'Revenue?', [], 'user-budget');

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.contextUsed).toBe(false);
    expect(result.answer).toContain('budget');
  });

  it('records budget_rejected outcome in telemetry when daily budget exhausted', async () => {
    evalWithDailyBudget(-1);

    await service.ask('org-budget', 'Revenue?', [], 'user-budget-telemetry');
    await new Promise((r) => setTimeout(r, 10));

    const telemetryLog = mockLogInfo.mock.calls.find(([event]: [string]) => event === 'ai_invocation');
    expect(telemetryLog).toBeDefined();
    const meta = telemetryLog![1] as Record<string, unknown>;
    expect(meta.outcome).toBe('budget_rejected');
    expect(meta.errorCategory).toBe('tenant_token_budget_exceeded');
  });

  it('records ai_budget_rejections_total metric on daily token budget exhaustion', async () => {
    evalWithDailyBudget(-1);

    await service.ask('org-budget', 'Rev?', [], 'user-b-metric');

    expect(mockRecordAiBudgetRejection).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'tenant', reason: 'daily_tokens' }),
    );
  });

  it('allows request when daily budget reservation succeeds (EVAL returns positive)', async () => {
    evalWithDailyBudget(800); // reservation applied, 800 tokens used so far

    mockCreate.mockResolvedValueOnce(makeOpenAiResponse(makeValidResponse()));
    const result = await service.ask('org-budget-ok', 'Revenue?', [], 'user-budget-ok');

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.contextUsed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Monthly token budget
// ---------------------------------------------------------------------------

describe('AI usage controls: monthly token budget', () => {
  it('blocks request when monthly token budget EVAL returns -1', async () => {
    // Test checkUsageLimits directly to avoid module cache issues with env patching.
    const { env: envObj } = await import('../config/env');
    const savedDaily = envObj.AI_TENANT_DAILY_TOKEN_BUDGET;
    const savedMonthly = envObj.AI_TENANT_MONTHLY_TOKEN_BUDGET;
    envObj.AI_TENANT_DAILY_TOKEN_BUDGET = 5000;
    envObj.AI_TENANT_MONTHLY_TOKEN_BUDGET = 5000;

    let evalIdx = 0;
    mockRedisCall.mockImplementation(async (cmd: string) => {
      if (cmd === 'EVAL') {
        evalIdx++;
        if (evalIdx <= 2) return 1;    // user + tenant rate: ok
        if (evalIdx === 3) return 800; // daily budget reservation: ok
        return -1;                     // monthly budget reservation: exhausted
      }
      return 0; // DECR rollbacks
    });

    const result = await checkUsageLimits('user-monthly', 'org-monthly');

    envObj.AI_TENANT_DAILY_TOKEN_BUDGET = savedDaily;
    envObj.AI_TENANT_MONTHLY_TOKEN_BUDGET = savedMonthly;

    expect(result.outcome).toBe('tenant_monthly_token_budget_exceeded');
    expect(mockRecordAiBudgetRejection).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'monthly_tokens' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 8. Monthly USD budget
// ---------------------------------------------------------------------------

describe('AI usage controls: monthly USD budget', () => {
  it('blocks request when monthly USD EVAL returns -1', async () => {
    // Test checkUsageLimits directly — env flags set before call so the
    // module reads them at runtime without needing a module cache reset.
    const { env: envObj } = await import('../config/env');
    const savedDaily = envObj.AI_TENANT_DAILY_TOKEN_BUDGET;
    const savedMonthlyToken = envObj.AI_TENANT_MONTHLY_TOKEN_BUDGET;
    const savedMonthlyUsd = envObj.AI_TENANT_MONTHLY_BUDGET_USD;
    envObj.AI_TENANT_DAILY_TOKEN_BUDGET = 5000;
    envObj.AI_TENANT_MONTHLY_TOKEN_BUDGET = 100_000;
    envObj.AI_TENANT_MONTHLY_BUDGET_USD = 1.0;

    let evalIdx = 0;
    mockRedisCall.mockImplementation(async (cmd: string) => {
      if (cmd === 'EVAL') {
        evalIdx++;
        if (evalIdx <= 2) return 1;    // user + tenant rate: ok
        if (evalIdx === 3) return 800; // daily budget reservation: ok
        if (evalIdx === 4) return 100; // monthly token budget reservation: ok
        return -1;                     // monthly USD budget reservation: exhausted
      }
      return 0; // DECR rollbacks
    });

    const result = await checkUsageLimits('user-usd', 'org-usd');

    envObj.AI_TENANT_DAILY_TOKEN_BUDGET = savedDaily;
    envObj.AI_TENANT_MONTHLY_TOKEN_BUDGET = savedMonthlyToken;
    envObj.AI_TENANT_MONTHLY_BUDGET_USD = savedMonthlyUsd;

    expect(result.outcome).toBe('tenant_monthly_cost_budget_exceeded');
    expect(mockRecordAiBudgetRejection).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'monthly_cost' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 9. Redis fail-closed mode
// ---------------------------------------------------------------------------

describe('AI usage controls: Redis fail-closed mode', () => {
  it('allows requests when Redis is unavailable and AI_USAGE_REDIS_FAIL_OPEN=true', async () => {
    mockRedisCall.mockRejectedValue(new Error('connection refused'));

    const result = await checkUsageLimits('u1', 't1');
    expect(result.outcome).toBe('redis_unavailable');
  });

  it('rejects requests when Redis is unavailable and AI_USAGE_REDIS_FAIL_OPEN=false', async () => {
    const { env: envObj } = await import('../config/env');
    const saved = envObj.AI_USAGE_REDIS_FAIL_OPEN;
    envObj.AI_USAGE_REDIS_FAIL_OPEN = false;

    mockRedisCall.mockRejectedValue(new Error('connection refused'));

    const result = await checkUsageLimits('u1', 't1');

    envObj.AI_USAGE_REDIS_FAIL_OPEN = saved;

    expect(result.outcome).toBe('user_rate_limited');
    expect(mockRecordAiRateLimitRejection).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'system', reason: 'redis_unavailable' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 10. Token usage and cost estimation recorded when provider returns usage
// ---------------------------------------------------------------------------

describe('AI telemetry: token usage and cost estimation', () => {
  let service: AiService;

  beforeEach(() => {
    jest.clearAllMocks();
    allowAllRedis();
    inFlightByUser.clear();
    service = new AiService();
  });

  it('records promptTokens, completionTokens, totalTokens when provider returns usage', async () => {
    mockCreate.mockResolvedValueOnce(
      makeOpenAiResponse(makeValidResponse(), {
        prompt_tokens: 300,
        completion_tokens: 75,
        total_tokens: 375,
      }),
    );

    await service.ask('org-token', 'Revenue?', [], 'user-t');

    const telemetryLog = mockLogInfo.mock.calls.find(([event]: [string]) => event === 'ai_invocation');
    expect(telemetryLog).toBeDefined();
    const meta = telemetryLog![1] as Record<string, unknown>;
    expect(meta.promptTokens).toBe(300);
    expect(meta.completionTokens).toBe(75);
    expect(meta.totalTokens).toBe(375);
  });

  it('records estimated cost when provider returns usage and model is known', async () => {
    mockCreate.mockResolvedValueOnce(
      makeOpenAiResponse(makeValidResponse(), {
        prompt_tokens: 1000,
        completion_tokens: 100,
        total_tokens: 1100,
      }),
    );

    await service.ask('org-cost', 'Revenue?', [], 'user-cost');

    const telemetryLog = mockLogInfo.mock.calls.find(([event]: [string]) => event === 'ai_invocation');
    expect(telemetryLog).toBeDefined();
    const meta = telemetryLog![1] as Record<string, unknown>;
    expect(typeof meta.estimatedCostUsd).toBe('number');
    expect((meta.estimatedCostUsd as number)).toBeGreaterThan(0);
  });

  it('does not record estimatedCostUsd when provider does not return usage', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: makeValidResponse() } }],
      usage: null,
    });

    await service.ask('org-no-usage', 'Revenue?', [], 'user-nu');

    const telemetryLog = mockLogInfo.mock.calls.find(([event]: [string]) => event === 'ai_invocation');
    const meta = telemetryLog![1] as Record<string, unknown>;
    expect(meta.estimatedCostUsd).toBeUndefined();
    expect(meta.promptTokens).toBeUndefined();
  });

  it('increments ai_token_usage_total metric when provider returns token usage', async () => {
    mockCreate.mockResolvedValueOnce(
      makeOpenAiResponse(makeValidResponse(), {
        prompt_tokens: 200,
        completion_tokens: 50,
        total_tokens: 250,
      }),
    );

    await service.ask('org-metrics-token', 'Revenue?', [], 'user-mt');
    await new Promise((r) => setTimeout(r, 10));

    expect(mockRecordAiTokenUsage).toHaveBeenCalledWith(250, expect.objectContaining({
      operation: 'ask',
      provider: 'openai',
      model: 'gpt-4o-mini',
    }));
  });
});

// ---------------------------------------------------------------------------
// 11. Metrics: ai_requests_total incremented on success and failure
// ---------------------------------------------------------------------------

describe('AI metrics: request counters', () => {
  let service: AiService;

  beforeEach(() => {
    jest.clearAllMocks();
    allowAllRedis();
    inFlightByUser.clear();
    service = new AiService();
  });

  it('records ai_requests_total with outcome=success on a successful call', async () => {
    mockCreate.mockResolvedValueOnce(makeOpenAiResponse(makeValidResponse()));

    await service.ask('org-m', 'Revenue?', [], 'user-m');
    await new Promise((r) => setTimeout(r, 10));

    expect(mockRecordAiRequest).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ outcome: 'success', operation: 'ask' }),
    );
  });

  it('records ai_requests_total with outcome=failure when provider errors', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Provider down'));

    await service.ask('org-m', 'Revenue?', [], 'user-m2');
    await new Promise((r) => setTimeout(r, 10));

    expect(mockRecordAiRequest).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ outcome: 'failure' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 12. Cost estimation unit tests
// ---------------------------------------------------------------------------

describe('estimateCost', () => {
  beforeEach(() => {
    resetPricingCache();
  });

  it('calculates cost for gpt-4o-mini correctly', () => {
    const cost = estimateCost('gpt-4o-mini', { promptTokens: 1_000_000, completionTokens: 1_000_000, totalTokens: 2_000_000 });
    // input: $0.15, output: $0.60 → total $0.75
    expect(cost).toBeCloseTo(0.75, 5);
  });

  it('calculates cost for gpt-4o correctly', () => {
    const cost = estimateCost('gpt-4o', { promptTokens: 1_000_000, completionTokens: 1_000_000, totalTokens: 2_000_000 });
    // input: $2.50/1M, output: $10.00/1M → total $12.50
    expect(cost).toBeCloseTo(12.5, 5);
  });

  it('applies 50% cache discount to cached prompt tokens', () => {
    // 500k non-cached input + 500k cached input + 1M output
    // non-cached: 500k * $2.50/1M = $1.25
    // cached:     500k * $2.50/1M * 0.50 = $0.625
    // output:     1M   * $10.00/1M = $10.00
    // total: $11.875
    const cost = estimateCost('gpt-4o', {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      totalTokens: 2_000_000,
      cachedTokens: 500_000,
    });
    expect(cost).toBeCloseTo(11.875, 5);
  });

  it('treats all prompt tokens as cached when cachedTokens equals promptTokens', () => {
    // 1M fully cached input + 0 output → 1M * $2.50/1M * 0.50 = $1.25
    const cost = estimateCost('gpt-4o', {
      promptTokens: 1_000_000,
      completionTokens: 0,
      totalTokens: 1_000_000,
      cachedTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(1.25, 5);
  });

  it('matches on longest prefix — model with version suffix resolves correctly', () => {
    const cost = estimateCost('gpt-4o-mini-2024-07-18', { promptTokens: 1_000_000, completionTokens: 0, totalTokens: 1_000_000 });
    expect(cost).toBeCloseTo(0.15, 5);
  });

  it('returns undefined for unknown model', () => {
    const cost = estimateCost('claude-3-opus', { promptTokens: 1000, completionTokens: 100, totalTokens: 1100 });
    expect(cost).toBeUndefined();
  });

  it('uses AI_PRICING_OVERRIDES to override builtin pricing', async () => {
    const { env: envObj } = await import('../config/env');
    const saved = (envObj as unknown as Record<string, unknown>).AI_PRICING_OVERRIDES;
    (envObj as unknown as Record<string, unknown>).AI_PRICING_OVERRIDES = JSON.stringify({
      'gpt-4o-mini': { input: 99.0, output: 199.0 },
    });
    resetPricingCache();

    const cost = estimateCost('gpt-4o-mini', { promptTokens: 1_000_000, completionTokens: 1_000_000, totalTokens: 2_000_000 });
    // Overridden: input $99 + output $199 = $298
    expect(cost).toBeCloseTo(298.0, 3);

    (envObj as unknown as Record<string, unknown>).AI_PRICING_OVERRIDES = saved;
    resetPricingCache();
  });

  it('adds a custom model via AI_PRICING_OVERRIDES', async () => {
    const { env: envObj } = await import('../config/env');
    const saved = (envObj as unknown as Record<string, unknown>).AI_PRICING_OVERRIDES;
    (envObj as unknown as Record<string, unknown>).AI_PRICING_OVERRIDES = JSON.stringify({
      'my-custom-model': { input: 10.0, output: 20.0 },
    });
    resetPricingCache();

    const cost = estimateCost('my-custom-model', { promptTokens: 1_000_000, completionTokens: 0, totalTokens: 1_000_000 });
    expect(cost).toBeCloseTo(10.0, 5);

    (envObj as unknown as Record<string, unknown>).AI_PRICING_OVERRIDES = saved;
    resetPricingCache();
  });

  it('falls back to builtins when AI_PRICING_OVERRIDES contains invalid JSON', async () => {
    const { env: envObj } = await import('../config/env');
    const saved = (envObj as unknown as Record<string, unknown>).AI_PRICING_OVERRIDES;
    (envObj as unknown as Record<string, unknown>).AI_PRICING_OVERRIDES = '{ invalid json }';
    resetPricingCache();

    const cost = estimateCost('gpt-4o-mini', { promptTokens: 1_000_000, completionTokens: 0, totalTokens: 1_000_000 });
    // Should use builtin $0.15 / 1M input
    expect(cost).toBeCloseTo(0.15, 5);

    (envObj as unknown as Record<string, unknown>).AI_PRICING_OVERRIDES = saved;
    resetPricingCache();
  });
});

// ---------------------------------------------------------------------------
// 13. checkUsageLimits unit tests
// ---------------------------------------------------------------------------

describe('checkUsageLimits', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns allowed when all EVAL calls return within limits', async () => {
    mockRedisCall.mockResolvedValue(1); // all EVALs → 1 (within limit + reservation ok)
    const result = await checkUsageLimits('u1', 't1');
    expect(result.outcome).toBe('allowed');
  });

  it('returns redis_unavailable and does not throw when Redis is down (fail-open)', async () => {
    mockRedisCall.mockRejectedValue(new Error('connection refused'));
    const result = await checkUsageLimits('u1', 't1');
    expect(result.outcome).toBe('redis_unavailable');
  });
});

// ---------------------------------------------------------------------------
// 14. reconcileBudget unit tests
// ---------------------------------------------------------------------------

describe('reconcileBudget', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns no cap violations by default (AI_MAX_TOKENS_PER_REQUEST=0)', async () => {
    mockRedisCall.mockResolvedValue(1);
    const result = await reconcileBudget('t1', 500, 0.001);
    expect(result.tokenCapExceeded).toBe(false);
    expect(result.costCapExceeded).toBe(false);
  });

  it('sets tokenCapExceeded=true when AI_MAX_TOKENS_PER_REQUEST exceeded', async () => {
    const { env: envObj } = await import('../config/env');
    const saved = envObj.AI_MAX_TOKENS_PER_REQUEST;
    envObj.AI_MAX_TOKENS_PER_REQUEST = 100;

    mockRedisCall.mockResolvedValue(1);
    const result = await reconcileBudget('t1', 200, undefined);

    envObj.AI_MAX_TOKENS_PER_REQUEST = saved;
    expect(result.tokenCapExceeded).toBe(true);
    expect(mockRecordAiBudgetRejection).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'request', reason: 'token_cap' }),
    );
  });

  it('sets costCapExceeded=true when AI_MAX_COST_PER_REQUEST_USD exceeded', async () => {
    const { env: envObj } = await import('../config/env');
    const saved = envObj.AI_MAX_COST_PER_REQUEST_USD;
    envObj.AI_MAX_COST_PER_REQUEST_USD = 0.001;

    mockRedisCall.mockResolvedValue(1);
    const result = await reconcileBudget('t1', 10, 0.005);

    envObj.AI_MAX_COST_PER_REQUEST_USD = saved;
    expect(result.costCapExceeded).toBe(true);
    expect(mockRecordAiBudgetRejection).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'request', reason: 'cost_cap' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 15. Concurrency guard still works after usage-control integration
// ---------------------------------------------------------------------------

describe('Concurrency guard integration', () => {
  let service: AiService;

  beforeEach(() => {
    jest.clearAllMocks();
    inFlightByUser.clear();
    service = new AiService();
  });

  it('returns concurrency fallback when concurrency slot is denied', async () => {
    // Usage controls: all EVAL → 1 (allowed)
    // Concurrency INCR → 4 (over limit of 3), PTTL → 5000, DECR → 3
    mockRedisCall.mockImplementation(async (cmd: string) => {
      if (cmd === 'EVAL') { return 1; } // all usage checks pass
      if (cmd === 'INCR') return 4;   // concurrency over limit
      if (cmd === 'PTTL') return 5000;
      if (cmd === 'DECR') return 3;
      return 1;
    });

    const result = await service.ask('org-conc', 'Revenue?', [], 'user-conc');

    expect(result.contextUsed).toBe(false);
    expect(result.answer).toContain('Too many simultaneous');
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
