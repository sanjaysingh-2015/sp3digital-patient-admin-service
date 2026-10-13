module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'PatientFacilityNumber',
    {
      patientId: { type: DataTypes.BIGINT, primaryKey: true, allowNull: false, field: 'patient_id' },
      facilityId: { type: DataTypes.BIGINT, primaryKey: true, allowNull: false, field: 'facility_id' },
      tenantUuid: { type: DataTypes.UUID, allowNull: false, field: 'tenant_uuid' },
      patientNumber: { type: DataTypes.STRING(40), allowNull: false, field: 'patient_number' },
      issuedBy: { type: DataTypes.BIGINT, allowNull: true, field: 'issued_by' },
      issuedOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'issued_on' },
    },
    {
      tableName: 'patient_facility_numbers',
      freezeTableName: true,
      timestamps: false,
      indexes: [{ unique: true, fields: ['tenant_uuid', 'facility_id', 'patient_number'] }],
    },
  );
