import { query } from '../config/database';

interface PaginationOptions {
  page: number;
  limit: number;
  organizationId: string;
}

interface AlertOptions {
  severity?: string;
  organizationId: string;
}

export class ComplianceService {
  async getComplianceStatus(organizationId: string) {
    return query<Record<string, unknown>>(
      `SELECT
         regulation_code,
         status,
         last_reviewed_at,
         next_review_due_at,
         assigned_to
       FROM compliance_items
       WHERE organization_id = $1
       ORDER BY next_review_due_at ASC`,
      [organizationId],
    );
  }

  async getAuditLog(opts: PaginationOptions) {
    const offset = (opts.page - 1) * opts.limit;

    const [rows, countResult] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT
           al.id,
           al.action,
           al.entity_type,
           al.entity_id,
           al.performed_by,
           al.performed_at,
           al.metadata
         FROM audit_log al
         WHERE al.organization_id = $1
         ORDER BY al.performed_at DESC
         LIMIT $2 OFFSET $3`,
        [opts.organizationId, opts.limit, offset],
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) AS count
         FROM audit_log al
         WHERE al.organization_id = $1`,
        [opts.organizationId],
      ),
    ]);

    return {
      items: rows,
      total: parseInt(countResult[0]?.count ?? '0', 10),
      page: opts.page,
      limit: opts.limit,
    };
  }

  async getRegulatoryAlerts(opts: AlertOptions) {
    return query<Record<string, unknown>>(
      `SELECT
         id,
         title,
         description,
         severity,
         regulation_code,
         due_date,
         status
       FROM regulatory_alerts
       WHERE organization_id = $1
         AND ($2::text IS NULL OR severity = $2)
       ORDER BY
         CASE severity
           WHEN 'critical' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           ELSE 4
         END,
         due_date ASC`,
      [opts.organizationId, opts.severity ?? null],
    );
  }
}
