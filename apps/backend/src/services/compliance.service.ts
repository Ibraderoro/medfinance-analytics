import { query } from '../config/database';

interface PaginationOptions {
  page: number;
  limit: number;
  organisationId: string;
}

interface AlertOptions {
  severity?: string;
  organisationId: string;
}

export class ComplianceService {
  async getComplianceStatus(organisationId: string) {
    const rows = await query<Record<string, unknown>>(
      `SELECT
         regulation_code,
         status,
         last_reviewed_at,
         next_review_due_at,
         assigned_to
       FROM compliance_items
       WHERE organisation_id = $1
       ORDER BY next_review_due_at ASC`,
      [organisationId],
    );
    return rows;
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
         INNER JOIN users u ON u.id = al.performed_by
         WHERE u.organisation_id = $1
         ORDER BY al.performed_at DESC
         LIMIT $2 OFFSET $3`,
        [opts.organisationId, opts.limit, offset],
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) AS count
         FROM audit_log al
         INNER JOIN users u ON u.id = al.performed_by
         WHERE u.organisation_id = $1`,
        [opts.organisationId],
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
    const rows = await query<Record<string, unknown>>(
      `SELECT
         id,
         title,
         description,
         severity,
         regulation_code,
         due_date,
         status
       FROM regulatory_alerts
       WHERE organisation_id = $1
         AND ($2::text IS NULL OR severity = $2)
       ORDER BY
         CASE severity
           WHEN 'critical' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           ELSE 4
         END,
         due_date ASC`,
      [opts.organisationId, opts.severity ?? null],
    );
    return rows;
  }
}
