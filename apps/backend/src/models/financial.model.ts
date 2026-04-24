export interface FinancialTransaction {
  id: string;
  type: 'revenue' | 'expense';
  amount: number;
  category: string;
  description: string;
  transaction_date: Date;
  organisation_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface Budget {
  id: string;
  category: string;
  budgeted_amount: number;
  fiscal_year: number;
  organisation_id: string;
  created_at: Date;
}
