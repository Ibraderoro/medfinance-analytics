import crypto from 'crypto';
import { query } from '../config/database';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';

interface AuditEvent {
  action: string;
  entityType: string;
  organizationId: string;
  performedBy?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

interface AuditExportRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  performed_by: string | null;
  organization_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

function criticalAuditError(message: string): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = 500;
  err.isOperational = true;
  return err;
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
      // Fail-closed: if audit persistence fails, the caller should abort the protected action.
      throw criticalAuditError(
        `Critical: failed to persist audit event for action=${event.action}. ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  exportSiemLogs(organizationId: string, startDate: Date, endDate: Date, format: 'jsonl'): Promise<string>;
  exportSiemLogs(organizationId: string, startDate: Date, endDate: Date, format: 'csv'): Promise<{ payload: string; signature: string; algorithm: 'hmac-sha256' }>;
  async exportSiemLogs(
    organizationId: string,
    startDate: Date,
    endDate: Date,
    format: 'jsonl' | 'csv' = 'jsonl',
  ): Promise<string | { payload: string; signature: string; algorithm: 'hmac-sha256' }> {
    const rows = await query<AuditExportRow>(
      `SELECT id, action, entity_type, entity_id, performed_by, organization_id, metadata, created_at
       FROM audit_log
       WHERE organization_id = $1
         AND created_at >= $2
         AND created_at <= $3
       ORDER BY created_at ASC`,
      [organizationId, startDate.toISOString(), endDate.toISOString()],
    );

    if (format === 'csv') {
      const header = 'id,action,entity_type,entity_id,performed_by,organization_id,metadata,created_at';
      const body = rows
        .map((row) => [
          row.id,
          row.action,
          row.entity_type,
          row.entity_id ?? '',
          row.performed_by ?? '',
          row.organization_id,
          JSON.stringify(row.metadata ?? {}).replaceAll('"', '""'),
          row.created_at,
        ])
        .map((fields) => fields.map((field) => `"${String(field)}"`).join(','))
        .join('\n');
      const payload = `${header}\n${body}`;
      const signature = crypto.createHmac('sha256', env.AUDIT_EXPORT_SIGNING_SECRET).update(payload).digest('hex');
      return { payload, signature, algorithm: 'hmac-sha256' };
    }

    const rowsLines = rows.map((row) =>
      JSON.stringify({
        id: row.id,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        performedBy: row.performed_by,
        organizationId: row.organization_id,
        metadata: row.metadata ?? {},
        createdAt: row.created_at,
      }),
    );
    const jsonl = rowsLines.join('\n');

    const signature = crypto.createHmac('sha256', env.AUDIT_EXPORT_SIGNING_SECRET).update(jsonl).digest('hex');
    void signature;
    return jsonl;
  }
}
