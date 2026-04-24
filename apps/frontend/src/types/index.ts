export interface ApiResponse<T> {
  data: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type ComplianceStatus = 'compliant' | 'non_compliant' | 'under_review';
