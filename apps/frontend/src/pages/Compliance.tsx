import { Card } from '../components/common/Card';
import { ComplianceChart } from '../components/Charts/ComplianceChart';
import styles from './Page.module.css';

const complianceItems = [
  { id: '1', code: 'HIPAA-164.312', status: 'compliant', nextReview: '2024-12-01' },
  { id: '2', code: 'SOX-302', status: 'under_review', nextReview: '2024-09-15' },
  { id: '3', code: 'HITECH-13402', status: 'compliant', nextReview: '2025-01-20' },
  { id: '4', code: 'CMS-1500', status: 'non_compliant', nextReview: '2024-08-01' },
];

const chartData = [
  { label: 'Compliant', value: 2, color: '#057a55' },
  { label: 'Review', value: 1, color: '#c27803' },
  { label: 'Non-compliant', value: 1, color: '#c81e1e' },
];

export function CompliancePage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Compliance</h1>
      <div className={styles.twoCol}>
        <Card title="Compliance Overview">
          <ComplianceChart data={chartData} width={280} height={260} />
        </Card>
        <Card title="Regulatory Items" className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Regulation</th>
                <th>Status</th>
                <th>Next Review</th>
              </tr>
            </thead>
            <tbody>
              {complianceItems.map((item) => (
                <tr key={item.id}>
                  <td>{item.code}</td>
                  <td>
                    <StatusBadge status={item.status} />
                  </td>
                  <td>{item.nextReview}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    compliant: '#057a55',
    under_review: '#c27803',
    non_compliant: '#c81e1e',
  };
  return (
    <span style={{
      background: colors[status] ?? '#6b7280',
      color: '#fff',
      padding: '2px 8px',
      borderRadius: 9999,
      fontSize: '0.75rem',
      fontWeight: 600,
    }}>
      {status.replace('_', ' ')}
    </span>
  );
}
