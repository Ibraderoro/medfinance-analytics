export type ComplianceStatus = 'compliant' | 'non_compliant' | 'under_review';
export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';
export type AlertStatus = 'open' | 'acknowledged' | 'resolved';

export interface ComplianceItem {
  id: string;
  regulationCode: string;
  status: ComplianceStatus;
  lastReviewedAt: string | null;
  nextReviewDueAt: string;
  assignedTo: string | null;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  performedBy: string;
  performedAt: string;
  metadata: Record<string, unknown>;
}

export interface RegulatoryAlert {
  id: string;
  title: string;
  description: string;
  severity: AlertSeverity;
  regulationCode: string;
  dueDate: string;
  status: AlertStatus;
}
