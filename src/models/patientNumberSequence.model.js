module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'PatientNumberSequence',
    {
      tenantUuid: { type: DataTypes.UUID, primaryKey: true, allowNull: false, field: 'tenant_uuid' },
      facilityId: { type: DataTypes.BIGINT, primaryKey: true, allowNull: false, field: 'facility_id' },
      lastNumber: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'last_number' },
    },
    { tableName: 'patient_number_sequences', freezeTableName: true, timestamps: false },
  );
