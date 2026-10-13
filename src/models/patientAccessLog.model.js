module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'PatientAccessLog',
    {
      logId: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, field: 'log_id' },
      tenantUuid: { type: DataTypes.UUID, allowNull: false, field: 'tenant_uuid' },
      patientId: { type: DataTypes.BIGINT, allowNull: false, field: 'patient_id' },
      action: { type: DataTypes.STRING(20), allowNull: false, field: 'action' },
      userId: { type: DataTypes.BIGINT, allowNull: true, field: 'user_id' },
      details: { type: DataTypes.STRING(500), allowNull: true, field: 'details' },
      createdOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_on' },
    },
    {
      tableName: 'patient_access_log',
      freezeTableName: true,
      timestamps: false,
      indexes: [{ fields: ['tenant_uuid', 'patient_id', 'created_on'] }],
    },
  );
