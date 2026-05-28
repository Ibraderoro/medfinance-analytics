DROP POLICY IF EXISTS tenant_isolation_policy ON organization_domains;
DROP POLICY IF EXISTS tenant_isolation_policy ON organization_invitations;
DROP TABLE IF EXISTS organization_invitations;
DROP TABLE IF EXISTS organization_domains;
