export type TransactionType = 'revenue' | 'expense';

export interface FinancialTransaction {
  id: string;
  type: TransactionType;
  amount: number;
  category: string;
  description: string;
  transactionDate: string;
  organisationId: string;
}

export interface FinancialSummary {
  totalRevenue: number;
  totalExpenses: number;
  netIncome: number;
  period: string;
  year: number;
}

export interface RevenueDataPoint {
  month: string;
  total: number;
}

export interface BudgetVariance {
  category: string;
  budgetedAmount: number;
  actualAmount: number;
  variance: number;
}
