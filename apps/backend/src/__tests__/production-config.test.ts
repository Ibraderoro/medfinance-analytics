process.env.JWT_SECRET = process.env.JWT_SECRET ?? '12345678901234567890123456789012';
process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET ?? '12345678901234567890123456789012';
process.env.AUDIT_EXPORT_SIGNING_SECRET = process.env.AUDIT_EXPORT_SIGNING_SECRET ?? 'abcdefghijklmnopqrstuvwxyz123456';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://user:pass@localhost:5432/test';

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../../..');
const requiredBackendSecrets = [
  'JWT_SECRET',
  'REFRESH_TOKEN_SECRET',
  'AUDIT_EXPORT_SIGNING_SECRET',
] as const;

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('production configuration manifests', () => {
  it.each(['.env.example', 'apps/backend/.env.example', 'docker-compose.yml', 'render.yaml'])(
    '%s documents every required backend secret',
    (relativePath) => {
      const contents = readRepoFile(relativePath);
      for (const secretName of requiredBackendSecrets) {
        expect(contents).toContain(secretName);
      }
    },
  );

  it('documents a distinct audit export signing secret in env examples', () => {
    const envExamples = [readRepoFile('.env.example'), readRepoFile('apps/backend/.env.example')];

    for (const contents of envExamples) {
      const refreshSecret = contents.match(/^REFRESH_TOKEN_SECRET=(.+)$/m)?.[1];
      const auditSigningSecret = contents.match(/^AUDIT_EXPORT_SIGNING_SECRET=(.+)$/m)?.[1];

      expect(auditSigningSecret).toBeDefined();
      expect(auditSigningSecret).not.toEqual(refreshSecret);
    }
  });
});
