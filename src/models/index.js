const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Patient = require('./patient.model')(sequelize, DataTypes);
const PatientFacilityNumber = require('./patientFacilityNumber.model')(sequelize, DataTypes);
const PatientNumberSequence = require('./patientNumberSequence.model')(sequelize, DataTypes);
const PatientMerge = require('./patientMerge.model')(sequelize, DataTypes);
const PatientAccessLog = require('./patientAccessLog.model')(sequelize, DataTypes);
const TenantPatientSetting = require('./tenantPatientSetting.model')(sequelize, DataTypes);

// References inside this database are real, enforced FKs (matching the schema
// script); only cross-database ids (facility, user, geography) are plain columns.
Patient.hasMany(PatientFacilityNumber, { as: 'facilityNumbers', foreignKey: 'patientId' });
PatientFacilityNumber.belongsTo(Patient, { as: 'patient', foreignKey: 'patientId' });
Patient.belongsTo(Patient, { as: 'guardian', foreignKey: 'guardianPatientId' });

module.exports = {
  sequelize,
  Patient,
  PatientFacilityNumber,
  PatientNumberSequence,
  PatientMerge,
  PatientAccessLog,
  TenantPatientSetting,
};
