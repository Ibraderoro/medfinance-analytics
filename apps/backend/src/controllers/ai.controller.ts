import { Response, NextFunction } from 'express';
import { body } from 'express-validator';
import { env } from '../config/env';
import { AiService } from '../services/ai.service';
import { AuthenticatedRequest, requireAuthenticatedUser } from '../middleware/auth';

const aiService = new AiService();

export const askAiValidators = [
  body('question')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('question is required')
    .isLength({ max: 1_000 })
    .withMessage('question must not exceed 1000 characters'),
  body('history')
    .optional()
    .isArray({ max: 10 })
    .withMessage('history must be an array of at most 10 messages'),
  body('history.*.role')
    .optional()
    .isIn(['user', 'assistant'])
    .withMessage('history[].role must be "user" or "assistant"'),
  body('history.*.content')
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage('history[].content must be a non-empty string')
    // Per-message length cap mirrors env.AI_MAX_HISTORY_MSG_CHARS (2000 default).
    // Validated early at the HTTP layer before any service logic runs.
    .isLength({ max: env.AI_MAX_HISTORY_MSG_CHARS })
    .withMessage(`history[].content must not exceed ${env.AI_MAX_HISTORY_MSG_CHARS} characters`),
];

export async function askAi(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    const { question, history = [] } = req.body as {
      question: string;
      history?: { role: 'user' | 'assistant'; content: string }[];
    };

    // Pass userId and requestId so the telemetry/audit trail is fully populated.
    // The AiService now handles all audit logging internally with safe metadata
    // (no raw prompt or response content). The audit log entry, Prometheus
    // metrics, and structured log are all written by AiTelemetryService.
    const result = await aiService.ask(
      user.organization_id,
      question,
      history,
      user.id,
      { requestId: req.header('X-Request-Id') },
    );

    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function getSummary(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    // getSummary is now audited through the centralized telemetry path with
    // operation='summary', ensuring parity with the 'ask' operation audit trail.
    const result = await aiService.getSummary(user.organization_id, {
      requestId: req.header('X-Request-Id'),
      userId: user.id,
    });
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}
