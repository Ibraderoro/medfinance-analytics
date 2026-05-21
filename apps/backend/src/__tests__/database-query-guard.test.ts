process.env.JWT_SECRET = process.env.JWT_SECRET ?? '12345678901234567890123456789012';
process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET ?? '12345678901234567890123456789012';
process.env.AUDIT_EXPORT_SIGNING_SECRET = process.env.AUDIT_EXPORT_SIGNING_SECRET ?? 'abcdefghijklmnopqrstuvwxyz123456';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://user:pass@localhost:5432/test';

const mockConnect = jest.fn();
const mockPoolOn = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    connect: (...args: unknown[]) => mockConnect(...args),
    on: (...args: unknown[]) => mockPoolOn(...args),
  })),
}));

jest.mock('../middleware/tenantContext', () => ({
  getCurrentTenantContext: jest.fn(),
}));

import { query } from '../config/database';
import { getCurrentTenantContext } from '../middleware/tenantContext';

describe('database query guardrails', () => {
  beforeEach(() => {
    mockConnect.mockReset();
    (getCurrentTenantContext as jest.Mock).mockReset();
  });

  it('rolls back tenant transaction and rethrows when query execution fails', async () => {
    const calls: string[] = [];
    const client = {
      query: jest.fn(async (sql: string) => {
        calls.push(sql);
        if (sql.includes('SELECT set_config')) return { rowCount: 1, rows: [] };
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
        throw new Error('db write failed');
      }),
      release: jest.fn(),
    };

    mockConnect.mockResolvedValue(client);
    (getCurrentTenantContext as jest.Mock).mockReturnValue({ organizationId: 'org-1' });

    await expect(query('SELECT * FROM transactions WHERE organization_id = $1', ['org-1']))
      .rejects.toThrow('db write failed');

    expect(calls).toEqual([
      'BEGIN',
      "SELECT set_config('app.current_tenant_id', $1, true)",
      'SELECT * FROM transactions WHERE organization_id = $1',
      'ROLLBACK',
    ]);
    expect(client.release).toHaveBeenCalled();
  });

  it('fails fast when tenant-scoped table is queried without tenant context (audit_logs included)', async () => {
    (getCurrentTenantContext as jest.Mock).mockReturnValue(undefined);

    await expect(query('SELECT id FROM audit_logs WHERE action = $1', ['READ']))
      .rejects.toMatchObject({ code: 'TENANT_CONTEXT_REQUIRED' });

    expect(mockConnect).not.toHaveBeenCalled();
  });
});
