# SLSA-Oriented Supply-Chain Security Controls

This repository now includes supply-chain controls across CI and CD workflows to improve build integrity, artifact traceability, and release trust.

## Workflow additions

### `.github/workflows/supply-chain-security.yml`

Runs on pushes to `main`/`develop`, pull requests, and weekly schedule.

Controls:

1. **CodeQL** (`github/codeql-action`)
   - Initializes, autobuilds, and analyzes JavaScript/TypeScript code.
   - Publishes code scanning results to GitHub Security.

2. **Semgrep** (`returntocorp/semgrep-action`)
   - Runs OWASP/security/secrets rule packs.
   - Configured to fail when `ERROR` severity findings are detected.

3. **Secret scanning** (`gitleaks/gitleaks-action`)
   - Scans git history/working tree for leaked credentials and tokens.
   - Fails the job when leaks are found.

4. **IaC scanning** (`aquasecurity/trivy-action` config mode)
   - Scans repository configuration and IaC assets.
   - Configured with `severity: CRITICAL` and `exit-code: 1` to fail on critical misconfigurations.

## CD hardening updates

Updated workflows:

- `.github/workflows/cd-staging.yml`
- `.github/workflows/cd-production.yml`

### 1) SBOM generation

For both backend and frontend images:

- Build steps now request BuildKit attestations with:
  - `sbom: true`
  - `provenance: true`
- Additional CycloneDX SBOM files are generated using Trivy and uploaded as workflow artifacts:
  - `backend.sbom.cdx.json`
  - `frontend.sbom.cdx.json`

### 2) Trivy container scanning

For each built image digest:

- Trivy image scan runs with:
  - `severity: CRITICAL`
  - `ignore-unfixed: true`
  - `exit-code: 1`
- Any critical vulnerability fails the workflow before deployment.

### 3) Cosign image signing (keyless)

- Installs Cosign in build jobs.
- Signs backend and frontend digest references with `cosign sign --yes`.
- Uses GitHub OIDC (`id-token: write`) for keyless signing.

### 4) Provenance attestations

- Uses `actions/attest-build-provenance@v1` per image digest.
- Pushes provenance attestations to the container registry.
- Enables downstream verification of build origin and integrity.

## Permission model updates

Build jobs now include least-privilege permissions needed for signing and attestations:

- `contents: read`
- `packages: write`
- `id-token: write`
- `attestations: write`

## CI failure behavior (critical findings)

Critical findings now block pipelines in these paths:

- **Trivy container scan** in CD (`severity: CRITICAL`, `exit-code: 1`)
- **Trivy IaC scan** in security workflow (`severity: CRITICAL`, `exit-code: 1`)
- **Semgrep ERROR severity** findings
- **Gitleaks secret detections**

CodeQL remains enabled for code scanning and security visibility, with findings published to GitHub Security.
