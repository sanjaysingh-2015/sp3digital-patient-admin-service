const { TenantPatientSetting } = require('../models');

const DEFAULT_RETENTION_MONTHS = 6;

class SettingsService {
  async get(tenantUuid) {
    const row = await TenantPatientSetting.findByPk(tenantUuid);
    return { retentionMonths: row?.retentionMonths ?? DEFAULT_RETENTION_MONTHS, isDefault: !row };
  }

  async update(tenantUuid, { retentionMonths }, { userId }) {
    const [row] = await TenantPatientSetting.findOrCreate({ where: { tenant_uuid: tenantUuid }, defaults: { tenantUuid, retentionMonths } });
    await row.update({ retentionMonths, modifiedBy: userId || null, modifiedOn: new Date() });
    return { retentionMonths: row.retentionMonths, isDefault: false };
  }
}

module.exports = new SettingsService();
module.exports.DEFAULT_RETENTION_MONTHS = DEFAULT_RETENTION_MONTHS;
