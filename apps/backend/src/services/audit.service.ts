import crypto from 'crypto';
import { getPool, query } from '../config/database';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { getCurrentTenantContext, runWithTenantContext } from '../middleware/tenantContext';

interface AuditEvent {
  action: string;
  entityType: string;
  organizationId: string;
  performedBy?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  requestId?: string;
  tenantId?: string;
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
  private static readonly ACTION_MAP: Record<string, 'CREATE' | 'READ' | 'UPDATE' | 'DELETE'> = {
    CREATE: 'CREATE',
    READ: 'READ',
    UPDATE: 'UPDATE',
    DELETE: 'DELETE',
    financial_data_access: 'READ',
    admin_endpoint_access: 'READ',
    oidc_login_success: 'READ',
    admin_mfa_required: 'READ',
    login_success: 'READ',
    admin_mfa_verified: 'READ',
    refresh_success: 'READ',
    logout_success: 'READ',
  };

  private normalizeAuditAction(action: string): 'CREATE' | 'READ' | 'UPDATE' | 'DELETE' {
    const normalized = AuditService.ACTION_MAP[action];
    if (!normalized) {
      throw criticalAuditError(`Critical: unmapped audit action=${action}`);
    }
    return normalized;
  }

  private async runWithAuditTenant<T>(organizationId: string, operation: () => Promise<T>): Promise<T> {
    const current = getCurrentTenantContext();
    if (current?.organizationId === organizationId) return operation();
    return runWithTenantContext({ organizationId, userId: current?.userId ?? 'system' }, operation);
  }

  async log(event: AuditEvent): Promise<void> {
    try {
      await this.runWithAuditTenant(event.organizationId, async () => {
        const normalizedAction = this.normalizeAuditAction(event.action);
        const tenantId = event.tenantId ?? event.organizationId;
        const shouldWriteImmutable = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId);
        const poolLike = typeof getPool === 'function' ? getPool() : null;
        const client = poolLike ? await poolLike.connect() : null;
        const hasClientTx = Boolean(client && typeof (client as { query?: unknown }).query === 'function');

        try {
          if (hasClientTx) {
            await client!.query('BEGIN');
            await client!.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [event.organizationId]);
          }

          const exec = hasClientTx
            ? (text: string, params?: unknown[]) => client!.query(text, params)
            : (text: string, params?: unknown[]) => query(text, params);

          await exec(
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
          if (shouldWriteImmutable) {
            await exec(
              `INSERT INTO audit_logs (user_id, tenant_id, action, target_resource, request_id)
               VALUES ($1, $2::uuid, $3, $4, $5)`,
              [
                event.performedBy ?? null,
                tenantId,
                normalizedAction,
                `${event.entityType}:${event.action}`,
                event.requestId ?? null,
              ],
            );
          }
          if (hasClientTx) {
            await client!.query('COMMIT');
          }
        } catch (txError) {
          if (hasClientTx) {
            await client!.query('ROLLBACK').catch(() => undefined);
          }
          throw txError;
        } finally {
          client?.release();
        }
      });
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
    const rows = await this.runWithAuditTenant(organizationId, () => query<AuditExportRow>(
      `SELECT id, action, entity_type, entity_id, performed_by, organization_id, metadata, created_at
       FROM audit_log
       WHERE organization_id = $1
         AND created_at >= $2
         AND created_at <= $3
       ORDER BY created_at ASC`,
      [organizationId, startDate.toISOString(), endDate.toISOString()],
    ));

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

    const jsonl = rows
      .map((row) =>
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
      )
      .join('\n');

    const signature = crypto.createHmac('sha256', env.AUDIT_EXPORT_SIGNING_SECRET).update(jsonl).digest('hex');
    return `${jsonl}\n${JSON.stringify({ signature, algorithm: 'hmac-sha256' })}`;
  }
}
