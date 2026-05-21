const fs = require('fs');
const path = require('path');

const RELEASE_BLOCKING_STATUS = /(blocked|pending|not executed|not completed|not run|incomplete|required|missing)/i;
const PASSED_STATUS = /(passed|complete|completed|satisfied)/i;

function checkEvidence({ envVar, defaultPath, summaryPhraseRegex, requiredRows, missingSummaryMessage, failureHeader, failureHint, successMessage }) {
  const root = path.resolve(__dirname, '..', '..');
  const evidencePath = process.env[envVar] || defaultPath;
  const absoluteEvidencePath = path.resolve(root, evidencePath);

  if (!fs.existsSync(absoluteEvidencePath)) {
    console.error(`Evidence file not found: ${evidencePath}`);
    process.exit(1);
  }

  const evidence = fs.readFileSync(absoluteEvidencePath, 'utf8');
  const failures = [];

  if (!summaryPhraseRegex.test(evidence)) {
    failures.push(missingSummaryMessage);
  }

  for (const item of requiredRows) {
    const escapedItem = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rowMatch = evidence.match(new RegExp(`\\|\\s*${escapedItem}\\s*\\|([^|]+)\\|`, 'i'));
    if (!rowMatch) {
      failures.push(`${item}: missing evidence row`);
      continue;
    }

    const status = rowMatch[1].replace(/\*/g, '').trim().toLowerCase();
    if (RELEASE_BLOCKING_STATUS.test(status)) {
      failures.push(`${item}: status is still release-blocking (${rowMatch[1].trim()})`);
      continue;
    }

    if (!PASSED_STATUS.test(status)) {
      failures.push(`${item}: status must explicitly be passed/completed/satisfied (${rowMatch[1].trim()})`);
    }
  }

  if (failures.length > 0) {
    console.error(`${failureHeader} ${evidencePath}:`);
    for (const failure of failures) console.error(`- ${failure}`);
    console.error(failureHint);
    process.exit(1);
  }

  console.log(successMessage(evidencePath));
}

module.exports = { checkEvidence };
