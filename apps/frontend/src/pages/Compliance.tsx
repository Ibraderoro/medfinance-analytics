import { Card } from '../components/common/Card';
import { ComplianceChart } from '../components/Charts/ComplianceChart';
import { Loading } from '../components/common/Loading';
import { useCompliance } from '../hooks/useCompliance';
import type { ComplianceDataPoint } from '../components/Charts/ComplianceChart';
import styles from './Page.module.css';

const STATUS_COLORS: Record<string, string> = {
  compliant: '#057a55',
  under_review: '#c27803',
  non_compliant: '#c81e1e',
};

export function CompliancePage() {
  const { items, isLoading, error } = useCompliance();

  const chartData: ComplianceDataPoint[] = [
    { label: 'Compliant',     value: items.filter((i) => i.status === 'compliant').length,     color: STATUS_COLORS.compliant },
    { label: 'Review',        value: items.filter((i) => i.status === 'under_review').length,  color: STATUS_COLORS.under_review },
    { label: 'Non-compliant', value: items.filter((i) => i.status === 'non_compliant').length, color: STATUS_COLORS.non_compliant },
  ].filter((d) => d.value > 0);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Compliance</h1>

      {isLoading && <Loading />}
      {error && <p className={styles.error}>Failed to load compliance data.</p>}

      {!isLoading && !error && (
        <div className={styles.twoCol}>
          <Card title="Compliance Overview">
            {chartData.length > 0 ? (
              <ComplianceChart data={chartData} width={280} height={260} />
            ) : (
              <p>No compliance items found.</p>
            )}
          </Card>

          <Card title="Regulatory Items" className={styles.tableCard}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Regulation</th>
                  <th>Status</th>
                  <th>Next Review</th>
                  <th>Assigned To</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.regulation_code}>
                    <td>{item.regulation_code}</td>
                    <td>
                      <StatusBadge status={item.status} />
                    </td>
                    <td>
                      {item.next_review_due_at
                        ? new Date(item.next_review_due_at).toLocaleDateString()
                        : '—'}
                    </td>
                    <td>{item.assigned_to ?? '—'}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', color: '#6b7280' }}>
                      No items
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      style={{
        background: STATUS_COLORS[status] ?? '#6b7280',
        color: '#fff',
        padding: '2px 8px',
        borderRadius: 9999,
        fontSize: '0.75rem',
        fontWeight: 600,
      }}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}
