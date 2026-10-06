export interface TransactionAddedEvent {
  type: 'transaction-added';
  organization_id: string;
  updatedAt: string;
}

export interface ForecastChangedEvent {
  type: 'forecast-changed';
  organization_id: string;
  updatedAt: string;
}

export interface KpiUpdatedEvent {
  type: 'kpi-updated';
  orgId: string;
  fiscalYear: number;
  updatedAt: string;
}

export interface ComplianceUpdatedEvent {
  type: 'compliance-updated';
  orgId: string;
  updatedAt: string;
}

export interface ForecastUpdatedEvent {
  type: 'forecast-updated';
  orgId: string;
  metric: string;
  months: number;
  updatedAt: string;
}

export type LiveEvent =
  | TransactionAddedEvent
  | ForecastChangedEvent
  | KpiUpdatedEvent
  | ComplianceUpdatedEvent
  | ForecastUpdatedEvent;

export type LiveEventType = LiveEvent['type'];
