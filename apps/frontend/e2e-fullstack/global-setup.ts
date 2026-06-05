import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { allFixtures, E2E_PASSWORD } from './support/tenantFixtures';

const workerCount = Number(process.env.PW_FULLSTACK_WORKERS ?? 2);
const databaseUrl = process.env.FULLSTACK_DATABASE_URL;

if (!databaseUrl) {
  throw new Error('FULLSTACK_DATABASE_URL is required for full-stack E2E global setup');
}

async function run(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false });
  const passwordHash = await bcrypt.hash(E2E_PASSWORD, 12);

  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

    for (const fixture of allFixtures(workerCount)) {
      await pool.query(
        `INSERT INTO organizations (id, name)
         VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [fixture.organizationId, fixture.organizationName],
      );

      await pool.query(
        `INSERT INTO departments (id, department_code, name, cost_center, organization_id, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         ON CONFLICT (organization_id, department_code)
         DO UPDATE SET name = EXCLUDED.name, cost_center = EXCLUDED.cost_center`,
        [
          fixture.departmentId,
          fixture.departmentCode,
          `E2E Department ${fixture.workerIndex + 1}`,
          `E2E-CC-${fixture.workerIndex + 1}`,
          fixture.organizationId,
        ],
      );

      await pool.query(
        `INSERT INTO transactions (id, department_id, transaction_type, category, amount, occurred_on, organization_id)
         VALUES (uuid_generate_v4(), $1, 'revenue', 'e2e_parallel', $2, CURRENT_DATE, $3)
         ON CONFLICT DO NOTHING`,
        [fixture.departmentId, fixture.seededRevenueAmount, fixture.organizationId],
      );

      await pool.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, organization_id, is_active)
         VALUES
           ($1, $2, $3, 'E2E', 'Viewer', 'viewer', $4, true),
           ($5, $6, $3, 'E2E', 'Analyst', 'analyst', $4, true),
           ($7, $8, $3, 'E2E', 'Admin', 'admin', $4, true)
         ON CONFLICT (email)
         DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, organization_id = EXCLUDED.organization_id, is_active = true`,
        [
          fixture.viewerUserId,
          fixture.viewerEmail,
          passwordHash,
          fixture.organizationId,
          fixture.analystUserId,
          fixture.analystEmail,
          fixture.adminUserId,
          fixture.adminEmail,
        ],
      );
    }
  } finally {
    await pool.end();
  }
}

export default run;
