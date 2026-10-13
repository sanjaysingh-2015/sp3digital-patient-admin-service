module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'TenantPatientSetting',
    {
      tenantUuid: { type: DataTypes.UUID, primaryKey: true, allowNull: false, field: 'tenant_uuid' },
      retentionMonths: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 6, field: 'retention_months' },
      modifiedBy: { type: DataTypes.BIGINT, allowNull: true, field: 'modified_by' },
      modifiedOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'modified_on' },
    },
    { tableName: 'tenant_patient_settings', freezeTableName: true, timestamps: false },
  );
