// Usage:  npm run anonymize            (dry run: only reports what would change)
//         npm run anonymize -- --apply (anonymizes patients past their retention period)
// Schedule the --apply form (e.g. nightly cron) once you are happy with the dry-run output.
require('dotenv').config();
const { sequelize } = require('../src/models');
const { runAnonymization } = require('../src/jobs/anonymizeExpired');

(async () => {
  const apply = process.argv.includes('--apply');
  try {
    const summary = await runAnonymization({ apply });
    console.log(JSON.stringify(summary));
    if (!apply && summary.candidates) console.log('Dry run — nothing changed. Re-run with --apply to anonymize.');
  } catch (error) {
    console.error('Anonymization failed:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
