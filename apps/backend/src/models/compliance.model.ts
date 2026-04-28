export interface ComplianceItem {
  id: string;
  regulation_code: string;
  status: 'compliant' | 'non_compliant' | 'under_review';
  last_reviewed_at: Date | null;
  next_review_due_at: Date;
  assigned_to: string | null;
  organization_id: string;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  performed_by: string;
  performed_at: Date;
  metadata: Record<string, unknown>;
}

export interface RegulatoryAlert {
  id: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  regulation_code: string;
  due_date: Date;
  status: 'open' | 'acknowledged' | 'resolved';
  organization_id: string;
}
