/**
 * AI Usage Controls
 *
 * Enforces per-user and per-tenant AI usage limits using Redis atomic
 * operations.  Three distinct control planes are provided:
 *
 *   1. Short-term rate limit  — requests per user/tenant per minute
 *      Key: ai:rate:user:<userId>   / ai:rate:tenant:<tenantId>
 *      TTL: AI_USER_RPM_WINDOW_MS  / AI_TENANT_RPM_WINDOW_MS (default 60 s)
 *
 *   2. Daily token budget per tenant — hard pre-call block using a Lua atomic
 *      reservation: reserve a pessimistic estimate pre-call, reconcile post-call.
 *      Key: ai:quota:tokens:daily:<tenantId>:<YYYY-MM-DD>
 *      TTL: 25 hours (covers one full day plus a safety margin)
 *
 *   3. Monthly token / USD budget per tenant
 *      Key: ai:quota:tokens:monthly:<tenantId>:<YYYY-MM>
 *           ai:quota:cost:monthly:<tenantId>:<YYYY-MM>  (stored as integer micro-USD)
 *      TTL: 32 days
 *
 *   4. Per-request caps — max tokens per request and max estimated cost per request,
 *      checked against actual provider usage post-call. Alerts only (response
 *      already completed by this point).
 *
 * All pre-call checks are atomic via Lua scripts to prevent over-commitment under
 * concurrent load.
 *
 * Redis fail behavior is configurable:
 *   AI_USAGE_REDIS_FAIL_OPEN=true  (default) — Redis down → requests proceed
 *   AI_USAGE_REDIS_FAIL_OPEN=false           — Redis down → requests rejected
 */

import { getRedis } from '../config/redis';
import { env } from '../config/env';
import { metricsService } from './metrics.service';
import { logger } from '../utils/logger';

export type UsageCheckOutcome =
  | 'allowed'
  | 'user_rate_limited'
  | 'tenant_rate_limited'
  | 'tenant_token_budget_exceeded'
  | 'tenant_monthly_token_budget_exceeded'
  | 'tenant_monthly_cost_budget_exceeded'
  | 'redis_unavailable';

export interface UsageCheckResult {
  outcome: UsageCheckOutcome;
  userCount?: number;
  tenantCount?: number;
  tenantDailyTokens?: number;
  tenantMonthlyTokens?: number;
  tenantMonthlyCostMicroUsd?: number;
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

function dateKeySegment(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function monthKeySegment(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function userRateKey(userId: string): string {
  return `ai:rate:user:${userId}`;
}

function tenantRateKey(tenantId: string): string {
  return `ai:rate:tenant:${tenantId}`;
}

export function tenantDailyTokenKey(tenantId: string): string {
  return `ai:quota:tokens:daily:${tenantId}:${dateKeySegment()}`;
}

export function tenantMonthlyTokenKey(tenantId: string): string {
  return `ai:quota:tokens:monthly:${tenantId}:${monthKeySegment()}`;
}

export function tenantMonthlyCostKey(tenantId: string): string {
  return `ai:quota:cost:monthly:${tenantId}:${monthKeySegment()}`;
}

// ---------------------------------------------------------------------------
// Lua scripts
// ---------------------------------------------------------------------------

/**
 * Atomic rate-limit increment with TTL:
 *   KEYS[1] = key
 *   ARGV[1] = window TTL in ms
 *   Returns new counter value.
 *
 * Using SET + INCR in one script removes the race between INCR and PEXPIRE.
 */
const INCR_WITH_TTL_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return count
`;

/**
 * Atomic budget reservation:
 *   KEYS[1] = quota key
 *   ARGV[1] = amount to reserve
 *   ARGV[2] = max budget
 *   ARGV[3] = TTL in ms (set on first use)
 *
 * Returns:
 *   -1 if reservation would exceed the budget (not applied)
 *   new total if reservation was applied
 *
 * The reservation is a pessimistic pre-call estimate. Post-call reconciliation
 * via INCRBY adjusts to the actual token count.
 */
const RESERVE_BUDGET_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1])) or 0
local reserve  = tonumber(ARGV[1])
local limit    = tonumber(ARGV[2])
if current + reserve > limit then
  return -1
end
local new_val = redis.call('INCRBY', KEYS[1], reserve)
if redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[3])
end
return new_val
`;

/**
 * Run a Lua script using EVAL. Falls back to a non-atomic sequence if EVAL
 * is not available (e.g. some Redis-compatible stores).
 */
async function evalScript(
  script: string,
  keys: string[],
  args: string[],
): Promise<number> {
  const redis = getRedis();
  const result = await redis.call(
    'EVAL',
    script,
    String(keys.length),
    ...keys,
    ...args,
  ) as number;
  return result;
}

// ---------------------------------------------------------------------------
// Pre-call check
// ---------------------------------------------------------------------------

/**
 * Pessimistic token reservation used pre-call.
 * We reserve `AI_MAX_TOKENS_PER_REQUEST` tokens (or a fallback of 1200 =
 * roughly max_tokens=600 output + ~600 for a typical context) to block calls
 * that would exceed the budget even before we know actual usage.
 *
 * Post-call we reconcile to actual token count via reconcileBudget().
 */
export function getReservationTokens(): number {
  if (env.AI_MAX_TOKENS_PER_REQUEST > 0) return env.AI_MAX_TOKENS_PER_REQUEST;
  // Conservative default: output cap (600) + generous context estimate (600)
  return 1_200;
}

/**
 * Shared calculation: micro-USD pessimistic reservation for the monthly cost
 * budget.  Used both in checkUsageLimits (to reserve) and rollbackReservations
 * (to release).  Returns 0 when the monthly USD budget is not enabled.
 */
export function getReservationMicroUsd(): number {
  const monthlyUsdBudget = env.AI_TENANT_MONTHLY_BUDGET_USD;
  if (monthlyUsdBudget <= 0) return 0;
  const maxRequestCost = env.AI_MAX_COST_PER_REQUEST_USD > 0
    ? env.AI_MAX_COST_PER_REQUEST_USD
    : monthlyUsdBudget * 0.05;
  return Math.ceil(maxRequestCost * 1_000_000);
}

export async function checkUsageLimits(
  userId: string,
  tenantId: string,
): Promise<UsageCheckResult> {
  const failOpen = env.AI_USAGE_REDIS_FAIL_OPEN;
  try {
    // --- 1. Per-user rate limit (Lua atomic) ---------------------------------
    const userWindowMs = env.AI_USER_RPM_WINDOW_MS;
    const userMax = env.AI_USER_RPM_MAX;
    const uKey = userRateKey(userId);
    const userCount = await evalScript(INCR_WITH_TTL_SCRIPT, [uKey], [String(userWindowMs)]);
    if (userCount > userMax) {
      // Undo increment — best-effort, stale counter decays via TTL anyway.
      await getRedis().call('DECR', uKey).catch(() => undefined);
      metricsService.recordAiRateLimitRejection({ scope: 'user', reason: 'rate' });
      return { outcome: 'user_rate_limited', userCount: userMax };
    }

    // --- 2. Per-tenant rate limit (Lua atomic) --------------------------------
    const tenantWindowMs = env.AI_TENANT_RPM_WINDOW_MS;
    const tenantMax = env.AI_TENANT_RPM_MAX;
    const tKey = tenantRateKey(tenantId);
    const tenantCount = await evalScript(INCR_WITH_TTL_SCRIPT, [tKey], [String(tenantWindowMs)]);
    if (tenantCount > tenantMax) {
      await getRedis().call('DECR', tKey).catch(() => undefined);
      await getRedis().call('DECR', uKey).catch(() => undefined);
      metricsService.recordAiRateLimitRejection({ scope: 'tenant', reason: 'rate' });
      return { outcome: 'tenant_rate_limited', tenantCount: tenantMax };
    }

    // --- 3. Daily token budget (Lua atomic reservation) ----------------------
    const dailyBudget = env.AI_TENANT_DAILY_TOKEN_BUDGET;
    if (dailyBudget > 0) {
      const dKey = tenantDailyTokenKey(tenantId);
      const reservation = getReservationTokens();
      const dailyTtlMs = 25 * 60 * 60 * 1_000; // 25 hours
      const reserved = await evalScript(RESERVE_BUDGET_SCRIPT, [dKey], [
        String(reservation),
        String(dailyBudget),
        String(dailyTtlMs),
      ]);
      if (reserved === -1) {
        // Reservation refused — budget would be exceeded.
        await getRedis().call('DECR', tKey).catch(() => undefined);
        await getRedis().call('DECR', uKey).catch(() => undefined);
        metricsService.recordAiBudgetRejection({ scope: 'tenant', reason: 'daily_tokens' });
        return { outcome: 'tenant_token_budget_exceeded' };
      }
    }

    // --- 4. Monthly token budget (Lua atomic reservation) --------------------
    const monthlyTokenBudget = env.AI_TENANT_MONTHLY_TOKEN_BUDGET;
    if (monthlyTokenBudget > 0) {
      const mKey = tenantMonthlyTokenKey(tenantId);
      const reservation = getReservationTokens();
      const monthlyTtlMs = 32 * 24 * 60 * 60 * 1_000; // 32 days
      const reserved = await evalScript(RESERVE_BUDGET_SCRIPT, [mKey], [
        String(reservation),
        String(monthlyTokenBudget),
        String(monthlyTtlMs),
      ]);
      if (reserved === -1) {
        // Roll back daily reservation and rate increments.
        if (dailyBudget > 0) {
          const reservation2 = getReservationTokens();
          await getRedis().call('DECRBY', tenantDailyTokenKey(tenantId), String(reservation2)).catch(() => undefined);
        }
        await getRedis().call('DECR', tKey).catch(() => undefined);
        await getRedis().call('DECR', uKey).catch(() => undefined);
        metricsService.recordAiBudgetRejection({ scope: 'tenant', reason: 'monthly_tokens' });
        return { outcome: 'tenant_monthly_token_budget_exceeded' };
      }
    }

    // --- 5. Monthly USD budget (Lua atomic reservation) ----------------------
    const monthlyUsdBudget = env.AI_TENANT_MONTHLY_BUDGET_USD;
    if (monthlyUsdBudget > 0) {
      // Stored as integer micro-USD (1 USD = 1,000,000 micro-USD) for lossless
      // integer arithmetic in Redis.
      const cKey = tenantMonthlyCostKey(tenantId);
      const monthlyTtlMs = 32 * 24 * 60 * 60 * 1_000;
      const reserveMicroUsd = getReservationMicroUsd();
      const budgetMicroUsd = Math.floor(monthlyUsdBudget * 1_000_000);
      const reserved = await evalScript(RESERVE_BUDGET_SCRIPT, [cKey], [
        String(reserveMicroUsd),
        String(budgetMicroUsd),
        String(monthlyTtlMs),
      ]);
      if (reserved === -1) {
        // Roll back all previous reservations.
        if (monthlyTokenBudget > 0) {
          await getRedis().call('DECRBY', tenantMonthlyTokenKey(tenantId), String(getReservationTokens())).catch(() => undefined);
        }
        if (dailyBudget > 0) {
          await getRedis().call('DECRBY', tenantDailyTokenKey(tenantId), String(getReservationTokens())).catch(() => undefined);
        }
        await getRedis().call('DECR', tKey).catch(() => undefined);
        await getRedis().call('DECR', uKey).catch(() => undefined);
        metricsService.recordAiBudgetRejection({ scope: 'tenant', reason: 'monthly_cost' });
        return { outcome: 'tenant_monthly_cost_budget_exceeded' };
      }
    }

    return { outcome: 'allowed', userCount, tenantCount };
  } catch (err) {
    logger.warn('AiUsageControl: Redis check failed', {
      userId,
      tenantId,
      failOpen,
      error: err instanceof Error ? err.message : String(err),
    });
    if (failOpen) {
      return { outcome: 'redis_unavailable' };
    }
    // Fail-closed: treat Redis error as a rejected request.
    metricsService.recordAiRateLimitRejection({ scope: 'system', reason: 'redis_unavailable' });
    return { outcome: 'user_rate_limited' };
  }
}

// ---------------------------------------------------------------------------
// Post-call reconciliation
// Adjusts pre-call reservations to actual token/cost usage.
// ---------------------------------------------------------------------------

export interface PostCallCheckResult {
  tokenCapExceeded: boolean;
  costCapExceeded: boolean;
  dailyTokensAfter?: number;
  monthlyTokensAfter?: number;
  monthlyCostAfterMicroUsd?: number;
}

export async function reconcileBudget(
  tenantId: string,
  actualTokens: number,
  estimatedCostUsd: number | undefined,
): Promise<PostCallCheckResult> {
  let tokenCapExceeded = false;
  let costCapExceeded = false;
  let dailyTokensAfter: number | undefined;
  let monthlyTokensAfter: number | undefined;
  let monthlyCostAfterMicroUsd: number | undefined;

  // Per-request token cap (post-call observation).
  if (env.AI_MAX_TOKENS_PER_REQUEST > 0 && actualTokens > env.AI_MAX_TOKENS_PER_REQUEST) {
    tokenCapExceeded = true;
    metricsService.recordAiBudgetRejection({ scope: 'request', reason: 'token_cap' });
  }

  // Per-request cost cap (post-call observation).
  if (
    env.AI_MAX_COST_PER_REQUEST_USD > 0 &&
    estimatedCostUsd !== undefined &&
    estimatedCostUsd > env.AI_MAX_COST_PER_REQUEST_USD
  ) {
    costCapExceeded = true;
    metricsService.recordAiBudgetRejection({ scope: 'request', reason: 'cost_cap' });
  }

  const reservation = getReservationTokens();
  const delta = actualTokens - reservation; // may be negative (actual < reservation)

  // Reconcile daily token reservation → actual usage.
  if (env.AI_TENANT_DAILY_TOKEN_BUDGET > 0) {
    try {
      const dKey = tenantDailyTokenKey(tenantId);
      const after = delta !== 0
        ? Number(await getRedis().call(delta > 0 ? 'INCRBY' : 'DECRBY', dKey, String(Math.abs(delta))))
        : Number(await getRedis().call('GET', dKey)) || actualTokens;
      dailyTokensAfter = after;
    } catch (err) {
      logger.warn('AiUsageControl: daily token reconciliation failed', {
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Reconcile monthly token reservation → actual usage.
  if (env.AI_TENANT_MONTHLY_TOKEN_BUDGET > 0) {
    try {
      const mKey = tenantMonthlyTokenKey(tenantId);
      const after = delta !== 0
        ? Number(await getRedis().call(delta > 0 ? 'INCRBY' : 'DECRBY', mKey, String(Math.abs(delta))))
        : Number(await getRedis().call('GET', mKey)) || actualTokens;
      monthlyTokensAfter = after;
    } catch (err) {
      logger.warn('AiUsageControl: monthly token reconciliation failed', {
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Reconcile monthly cost reservation → actual cost.
  // Always run when the budget is enabled, even if cost is unknown.
  // When cost is unknown we treat actual cost as zero (i.e. release the full
  // reservation) to prevent a permanent counter leak.
  if (env.AI_TENANT_MONTHLY_BUDGET_USD > 0) {
    try {
      const cKey = tenantMonthlyCostKey(tenantId);
      const reservedMicroUsd = getReservationMicroUsd();
      // Use actual cost when available; treat unknown as zero (release reservation).
      const actualMicroUsd = estimatedCostUsd !== undefined
        ? Math.round(estimatedCostUsd * 1_000_000)
        : 0;
      const costDelta = actualMicroUsd - reservedMicroUsd;
      const after = costDelta !== 0
        ? Number(await getRedis().call(costDelta > 0 ? 'INCRBY' : 'DECRBY', cKey, String(Math.abs(costDelta))))
        // costDelta === 0: actual exactly matched reservation — read true counter.
        : Number(await getRedis().call('GET', cKey)) || actualMicroUsd;
      monthlyCostAfterMicroUsd = after;
    } catch (err) {
      logger.warn('AiUsageControl: monthly cost reconciliation failed', {
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { tokenCapExceeded, costCapExceeded, dailyTokensAfter, monthlyTokensAfter, monthlyCostAfterMicroUsd };
}

// Keep the old name as an alias so existing call-sites in ai.service.ts don't break.
export const recordUsageAndCheck = reconcileBudget;

/**
 * Exposed for testing: roll back reservations made by checkUsageLimits when
 * the provider call is abandoned (e.g. cancellation after controls passed).
 */
export async function rollbackReservations(
  userId: string,
  tenantId: string,
): Promise<void> {
  const redis = getRedis();
  const reservation = getReservationTokens();
  const reserveMicroUsd = getReservationMicroUsd();
  await Promise.allSettled([
    redis.call('DECR', userRateKey(userId)),
    redis.call('DECR', tenantRateKey(tenantId)),
    ...(env.AI_TENANT_DAILY_TOKEN_BUDGET > 0
      ? [redis.call('DECRBY', tenantDailyTokenKey(tenantId), String(reservation))]
      : []),
    ...(env.AI_TENANT_MONTHLY_TOKEN_BUDGET > 0
      ? [redis.call('DECRBY', tenantMonthlyTokenKey(tenantId), String(reservation))]
      : []),
    ...(reserveMicroUsd > 0
      ? [redis.call('DECRBY', tenantMonthlyCostKey(tenantId), String(reserveMicroUsd))]
      : []),
  ]);
}
