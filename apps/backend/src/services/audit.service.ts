import { query } from '../config/database';
import { logger } from '../utils/logger';

interface AuditEvent {
  action: string;
  entityType: string;
  organizationId: string;
  performedBy?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

export class AuditService {
  async log(event: AuditEvent): Promise<void> {
    try {
      await query(
        `INSERT INTO audit_log (action, entity_type, entity_id, performed_by, organization_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [
          event.action,
          event.entityType,
          event.entityId ?? null,
          event.performedBy ?? null,
          event.organizationId,
          JSON.stringify(event.metadata ?? {}),
        ],
      );
    } catch (error) {
      logger.warn('Failed to persist audit event', {
        action: event.action,
        entityType: event.entityType,
        organizationId: event.organizationId,
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }
}
