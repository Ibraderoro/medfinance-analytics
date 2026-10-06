import { Response, NextFunction } from 'express';
import { body } from 'express-validator';
import { AiService } from '../services/ai.service';
import { AuditService } from '../services/audit.service';
import { AuthenticatedRequest, requireAuthenticatedUser } from '../middleware/auth';

const aiService = new AiService();
const auditService = new AuditService();

export const askAiValidators = [
  body('question')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('question is required')
    .isLength({ max: 1000 })
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
    .withMessage('history[].content must be a non-empty string'),
];

export async function askAi(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    const { question, history = [] } = req.body as { question: string; history?: { role: 'user' | 'assistant'; content: string }[] };

    const result = await aiService.ask(user.organization_id, question, history);

    await auditService.log({
      action: 'ai-query',
      entityType: 'ai-session',
      organizationId: user.organization_id,
      performedBy: user.id,
      requestId: req.header('X-Request-Id'),
      metadata: { contextUsed: result.contextUsed },
    });

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
    const result = await aiService.getSummary(user.organization_id);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}
