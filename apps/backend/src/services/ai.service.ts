import OpenAI from 'openai';
import { env } from '../config/env';
import { FinancialsService } from './financials.service';
import { InsightsService } from './insights.service';
import { ComplianceService } from './compliance.service';
import { ForecastingService } from './forecasting.service';
import { logger } from '../utils/logger';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiContext {
  kpis: Record<string, unknown>[];
  insights: {
    health_score: number;
    risk_level: string;
    insights: string[];
  };
  complianceSummary: {
    total: number;
    compliant: number;
    nonCompliant: number;
    pendingReview: number;
  };
  forecast: {
    metric: string;
    trend: string;
    confidenceLevel: number;
    nextMonthsProjected: number[];
  };
}

export interface AiResponse {
  answer: string;
  recommendations: string[];
  contextUsed: boolean;
}

const SYSTEM_PROMPT_TEMPLATE = (context: AiContext): string =>
  `You are a financial analyst assistant for MedFinance Analytics, a healthcare finance SaaS platform.
You have access to the following real-time financial context for the organization. Use ONLY this data when forming your response — do not invent figures.

FINANCIAL CONTEXT:
${JSON.stringify(context, null, 2)}

Instructions:
- Respond ONLY with valid JSON matching this schema: { "answer": string, "recommendations": string[] }
- "answer" should be a concise, professional narrative (2–4 sentences)
- "recommendations" should be 2–5 actionable bullet items, each under 20 words
- Do not include PII, user names, emails, or any data not in the context above
- Do not wrap your response in markdown code fences`;

const EXECUTIVE_SUMMARY_QUESTION =
  'Provide a concise executive summary of the current financial health, top risks, and the 3 most important recommendations.';

const financialsService = new FinancialsService();
const insightsService = new InsightsService();
const complianceService = new ComplianceService();
const forecastingService = new ForecastingService();

export class AiService {
  private openai: OpenAI | null;

  constructor() {
    this.openai = env.OPENAI_API_KEY
      ? new OpenAI({ apiKey: env.OPENAI_API_KEY })
      : null;
  }

  async buildContext(orgId: string): Promise<AiContext> {
    const currentYear = new Date().getFullYear();

    const [kpis, insights, complianceRows, forecast] = await Promise.all([
      financialsService.getKpis({ organizationId: orgId, year: currentYear }),
      insightsService.getInsights(orgId),
      complianceService.getComplianceStatus(orgId),
      forecastingService.getForecast({ organizationId: orgId, months: 6, metric: 'revenue' }),
    ]);

    // Aggregate compliance counts — strip any PII fields (assigned_to)
    let compliant = 0;
    let nonCompliant = 0;
    let pendingReview = 0;

    for (const row of complianceRows) {
      const status = String(row['status'] ?? '').toLowerCase();
      if (status === 'compliant') compliant++;
      else if (status === 'non_compliant' || status === 'non-compliant') nonCompliant++;
      else pendingReview++;
    }

    // Extract only aggregate forecast figures (no PII)
    const projectedTotals = (forecast.dataPoints ?? [])
      .filter((dp) => dp.actual_total === null || dp.actual_total === undefined)
      .map((dp) => Number(dp.projected_total));

    // Strip PII from KPI rows — keep only numeric/date fields
    const safeKpis = (kpis as Record<string, unknown>[]).map((row) => {
      const { organization_id: _orgId, ...rest } = row as Record<string, unknown>;
      void _orgId;
      return rest;
    });

    return {
      kpis: safeKpis,
      insights,
      complianceSummary: {
        total: complianceRows.length,
        compliant,
        nonCompliant,
        pendingReview,
      },
      forecast: {
        metric: forecast.metric,
        trend: forecast.trend,
        confidenceLevel: forecast.confidenceLevel,
        nextMonthsProjected: projectedTotals,
      },
    };
  }

  async ask(orgId: string, question: string, history: ConversationMessage[] = []): Promise<AiResponse> {
    if (!this.openai) {
      return {
        answer: 'AI assistant is not configured. Please set OPENAI_API_KEY to enable this feature.',
        recommendations: [],
        contextUsed: false,
      };
    }

    let context: AiContext;
    try {
      context = await this.buildContext(orgId);
    } catch (err) {
      logger.error('AiService: failed to build context', { orgId, error: err instanceof Error ? err.message : String(err) });
      return {
        answer: 'Unable to retrieve financial context at this time. Please try again shortly.',
        recommendations: [],
        contextUsed: false,
      };
    }

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT_TEMPLATE(context) },
      ...history.slice(-10).map((m) => ({ role: m.role, content: m.content } as OpenAI.Chat.ChatCompletionMessageParam)),
      { role: 'user', content: question },
    ];

    try {
      const completion = await this.openai.chat.completions.create({
        model: env.OPENAI_MODEL,
        messages,
        temperature: 0.3,
        max_tokens: 600,
        response_format: { type: 'json_object' },
      });

      const raw = completion.choices[0]?.message?.content ?? '{}';
      let parsed: { answer?: string; recommendations?: string[] };
      try {
        parsed = JSON.parse(raw) as { answer?: string; recommendations?: string[] };
      } catch {
        logger.warn('AiService: failed to parse OpenAI JSON response', { orgId });
        parsed = {};
      }

      return {
        answer: typeof parsed.answer === 'string' ? parsed.answer : raw,
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
        contextUsed: true,
      };
    } catch (err) {
      // Do not log the API key or full error object; only log a safe message
      const message = err instanceof Error ? err.message : 'unknown error';
      logger.error('AiService: OpenAI request failed', { orgId, error: message });
      return {
        answer: 'The AI assistant encountered an error. Please try again in a moment.',
        recommendations: [],
        contextUsed: false,
      };
    }
  }

  async getSummary(orgId: string): Promise<AiResponse> {
    return this.ask(orgId, EXECUTIVE_SUMMARY_QUESTION, []);
  }
}
