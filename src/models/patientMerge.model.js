module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'PatientMerge',
    {
      mergeId: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, field: 'merge_id' },
      tenantUuid: { type: DataTypes.UUID, allowNull: false, field: 'tenant_uuid' },
      sourcePatientId: { type: DataTypes.BIGINT, allowNull: false, field: 'source_patient_id' },
      targetPatientId: { type: DataTypes.BIGINT, allowNull: false, field: 'target_patient_id' },
      reason: { type: DataTypes.STRING(300), allowNull: true, field: 'reason' },
      mergedBy: { type: DataTypes.BIGINT, allowNull: true, field: 'merged_by' },
      mergedOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'merged_on' },
    },
    { tableName: 'patient_merges', freezeTableName: true, timestamps: false },
  );
