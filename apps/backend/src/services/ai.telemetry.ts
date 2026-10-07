/**
 * AI Telemetry Service
 *
 * Centralises audit metadata logging and metrics recording for every AI
 * model invocation.  Deliberately does NOT store raw prompts, raw model
 * responses, or any other content that might contain sensitive financial or
 * healthcare information.
 *
 * Safe metadata recorded per-invocation:
 *   requestId, organizationId, userId, timestamp, operation, provider, model,
 *   success/failure, latency, promptLength, historyLength, answerLength,
 *   tokenUsage (if returned), estimatedCost (if calculable), errorCategory.
 */

import { AuditService } from './audit.service';
import { metricsService } from './metrics.service';
import { logger } from '../utils/logger';
import { env } from '../config/env';

export type AiOperation = 'ask' | 'summary';
export type AiOutcome = 'success' | 'failure' | 'rate_limited' | 'budget_rejected' | 'concurrency_limited' | 'not_configured';

export interface AiTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AiInvocationRecord {
  requestId?: string;
  organizationId: string;
  userId?: string;
  timestamp: string;
  operation: AiOperation;
  provider: string;
  model: string;
  outcome: AiOutcome;
  latencyMs: number;
  /** Length of the sanitised prompt (chars) — no content stored. */
  promptLength?: number;
  /** Number of history messages passed in. */
  historyLength?: number;
  /** Length of the response answer (chars) — no content stored. */
  answerLength?: number;
  tokenUsage?: AiTokenUsage;
  estimatedCostUsd?: number;
  errorCategory?: string;
}

// ---------------------------------------------------------------------------
// Cost estimation
// Prices sourced from public OpenAI pricing (per-1M tokens as of 2024).
// Keys are model identifiers; add entries as needed.
// Falls back to undefined rather than failing if the model is unknown.
//
// Override at runtime via AI_PRICING_OVERRIDES env var (JSON):
//   '{"gpt-4o":{"input":5.0,"output":15.0},"my-custom-model":{"input":1.0,"output":2.0}}'
// ---------------------------------------------------------------------------

const BUILTIN_COST_PER_1M_INPUT: Record<string, number> = {
  'gpt-4o': 5.0,
  'gpt-4o-mini': 0.15,
  'gpt-4-turbo': 10.0,
  'gpt-4': 30.0,
  'gpt-3.5-turbo': 0.5,
};
const BUILTIN_COST_PER_1M_OUTPUT: Record<string, number> = {
  'gpt-4o': 15.0,
  'gpt-4o-mini': 0.6,
  'gpt-4-turbo': 30.0,
  'gpt-4': 60.0,
  'gpt-3.5-turbo': 1.5,
};

/**
 * Parse AI_PRICING_OVERRIDES JSON and merge with builtins.
 * Invalid JSON is logged and ignored — builtins remain in effect.
 */
function buildPricingTable(): {
  input: Record<string, number>;
  output: Record<string, number>;
} {
  const input = { ...BUILTIN_COST_PER_1M_INPUT };
  const output = { ...BUILTIN_COST_PER_1M_OUTPUT };

  const raw = env.AI_PRICING_OVERRIDES;
  if (!raw) return { input, output };

  try {
    const parsed = JSON.parse(raw) as Record<string, { input?: number; output?: number }>;
    for (const [model, prices] of Object.entries(parsed)) {
      if (typeof prices?.input === 'number') input[model] = prices.input;
      if (typeof prices?.output === 'number') output[model] = prices.output;
    }
  } catch (e) {
    logger.warn('AI_PRICING_OVERRIDES is not valid JSON — using builtin pricing', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return { input, output };
}

// Pricing table is built once at module load and cached.
// If the process is long-lived and pricing changes, a restart picks up the new value.
let _pricingTable: ReturnType<typeof buildPricingTable> | null = null;
function getPricingTable(): ReturnType<typeof buildPricingTable> {
  if (!_pricingTable) _pricingTable = buildPricingTable();
  return _pricingTable;
}

/** Reset the pricing cache — used in tests to pick up env changes. */
export function resetPricingCache(): void {
  _pricingTable = null;
}

/**
 * Estimate cost in USD from token usage for a given model.
 * Returns undefined if the model pricing is not known, to avoid false
 * budget calculations for unknown models.
 */
export function estimateCost(model: string, usage: AiTokenUsage): number | undefined {
  const { input: inputTable, output: outputTable } = getPricingTable();
  // Match on longest prefix so "gpt-4o-mini-2024-07-18" resolves to "gpt-4o-mini"
  // and not "gpt-4o".  Sort keys by descending length before searching.
  const matchingKey = Object.keys(inputTable)
    .sort((a, b) => b.length - a.length)
    .find((k) => model.startsWith(k));
  if (!matchingKey) return undefined;
  const inputCost = (usage.promptTokens / 1_000_000) * inputTable[matchingKey];
  const outputCost = (usage.completionTokens / 1_000_000) * outputTable[matchingKey];
  // Round to 8 decimal places to avoid floating-point noise in logs.
  return Math.round((inputCost + outputCost) * 1e8) / 1e8;
}

const auditService = new AuditService();

export class AiTelemetryService {
  /**
   * Record audit metadata (safe, no prompt/response content) and update
   * Prometheus metrics for a completed AI invocation.
   *
   * Audit persistence failures are logged but do NOT propagate — telemetry
   * must never disrupt the user-facing response path.
   */
  async record(record: AiInvocationRecord): Promise<void> {
    // --- 1. Structured log (safe metadata only) ----------------------------
    logger.info('ai_invocation', {
      requestId: record.requestId,
      organizationId: record.organizationId,
      userId: record.userId,
      timestamp: record.timestamp,
      operation: record.operation,
      provider: record.provider,
      model: record.model,
      outcome: record.outcome,
      latencyMs: record.latencyMs,
      promptLength: record.promptLength,
      historyLength: record.historyLength,
      answerLength: record.answerLength,
      promptTokens: record.tokenUsage?.promptTokens,
      completionTokens: record.tokenUsage?.completionTokens,
      totalTokens: record.tokenUsage?.totalTokens,
      estimatedCostUsd: record.estimatedCostUsd,
      errorCategory: record.errorCategory,
    });

    // --- 2. Prometheus metrics ---------------------------------------------
    metricsService.recordAiRequest(record.latencyMs, {
      operation: record.operation,
      provider: record.provider,
      model: record.model,
      outcome: record.outcome,
    });

    if (record.tokenUsage) {
      metricsService.recordAiTokenUsage(record.tokenUsage.totalTokens, {
        operation: record.operation,
        provider: record.provider,
        model: record.model,
      });
    }

    // --- 3. Audit log (immutable, safe metadata only) ----------------------
    // Only persist to the audit trail for operations that completed (success
    // or identifiable failure) — skip for not_configured (no user intent).
    if (record.outcome === 'not_configured') return;

    const action = record.operation === 'summary' ? 'ai-summary' : 'ai-query';
    const auditMeta: Record<string, unknown> = {
      operation: record.operation,
      provider: record.provider,
      model: record.model,
      outcome: record.outcome,
      latencyMs: record.latencyMs,
      promptLength: record.promptLength,
      historyLength: record.historyLength,
      answerLength: record.answerLength,
      // Raw content is never stored here — only lengths and counts.
    };
    if (record.tokenUsage) {
      auditMeta.promptTokens = record.tokenUsage.promptTokens;
      auditMeta.completionTokens = record.tokenUsage.completionTokens;
      auditMeta.totalTokens = record.tokenUsage.totalTokens;
    }
    if (record.estimatedCostUsd !== undefined) {
      auditMeta.estimatedCostUsd = record.estimatedCostUsd;
    }
    if (record.errorCategory) {
      auditMeta.errorCategory = record.errorCategory;
    }

    try {
      await auditService.log({
        action,
        entityType: 'ai-session',
        organizationId: record.organizationId,
        performedBy: record.userId,
        requestId: record.requestId,
        metadata: auditMeta,
      });
    } catch (err) {
      // Audit failure must never propagate to the caller.
      logger.error('AiTelemetry: audit persistence failed', {
        action,
        organizationId: record.organizationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export const aiTelemetryService = new AiTelemetryService();
