import crypto from 'node:crypto';

export const E2E_PASSWORD = 'E2E-password-123!';

type TenantFixture = {
  workerIndex: number;
  organizationId: string;
  organizationName: string;
  viewerUserId: string;
  viewerEmail: string;
  analystUserId: string;
  analystEmail: string;
  adminUserId: string;
  adminEmail: string;
  departmentId: string;
  departmentCode: string;
  seededRevenueAmount: number;
};

function deterministicUuid(label: string): string {
  const hex = crypto.createHash('sha256').update(label).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function fixtureForWorker(workerIndex: number): TenantFixture {
  const id = workerIndex + 1;
  const prefix = `fullstack-worker-${id}`;

  return {
    workerIndex,
    organizationId: deterministicUuid(`${prefix}:org`),
    organizationName: `E2E Worker Org ${id}`,
    viewerUserId: deterministicUuid(`${prefix}:viewer`),
    viewerEmail: `viewer+${id}@e2e.medfinance.test`,
    analystUserId: deterministicUuid(`${prefix}:analyst`),
    analystEmail: `analyst+${id}@e2e.medfinance.test`,
    adminUserId: deterministicUuid(`${prefix}:admin`),
    adminEmail: `admin+${id}@e2e.medfinance.test`,
    departmentId: deterministicUuid(`${prefix}:department`),
    departmentCode: `E2E-${id.toString().padStart(3, '0')}`,
    seededRevenueAmount: 1000 + id * 100,
  };
}

export function allFixtures(workerCount: number): TenantFixture[] {
  return Array.from({ length: workerCount }, (_, index) => fixtureForWorker(index));
}

export type { TenantFixture };
