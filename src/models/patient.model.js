module.exports = (sequelize, DataTypes) => {
  const str = (field, length) => ({ type: DataTypes.STRING(length), allowNull: true, field });
  const id = (field) => ({ type: DataTypes.BIGINT, allowNull: true, field });

  const Patient = sequelize.define(
    'Patient',
    {
      patientId: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, field: 'patient_id' },
      patientUuid: { type: DataTypes.UUID, allowNull: false, unique: true, defaultValue: DataTypes.UUIDV4, field: 'patient_uuid' },
      tenantUuid: { type: DataTypes.UUID, allowNull: false, field: 'tenant_uuid' },
      username: { type: DataTypes.STRING(50), allowNull: false, field: 'username' },

      // organization-admin-service facility — cross-database, no FK
      registrationFacilityId: { type: DataTypes.BIGINT, allowNull: false, field: 'registration_facility_id' },
      registrationNumber: str('registration_number', 40),

      title: str('title', 20),
      firstName: { type: DataTypes.STRING(100), allowNull: false, field: 'first_name' },
      middleName: str('middle_name', 100),
      lastName: str('last_name', 100),
      displayName: { type: DataTypes.STRING(255), allowNull: false, field: 'display_name' },
      gender: str('gender', 20),
      dateOfBirth: { type: DataTypes.DATEONLY, allowNull: true, field: 'date_of_birth' },
      estimatedAgeYears: { type: DataTypes.SMALLINT, allowNull: true, field: 'estimated_age_years' },
      estimatedAgeOn: { type: DataTypes.DATEONLY, allowNull: true, field: 'estimated_age_on' },
      preferredLanguage: str('preferred_language', 40),

      phoneCountryCode: { type: DataTypes.STRING(8), allowNull: false, defaultValue: '+91', field: 'phone_country_code' },
      phoneNumber: { type: DataTypes.STRING(20), allowNull: false, field: 'phone_number' },
      alternatePhoneNumber: str('alternate_phone_number', 20),
      email: str('email', 255),

      addressLine1: str('address_line1', 255),
      addressLine2: str('address_line2', 255),
      countryId: id('country_id'),
      stateId: id('state_id'),
      districtId: id('district_id'),
      subDistrictId: id('sub_district_id'),
      cityId: id('city_id'),
      postalCodeId: id('postal_code_id'),
      city: str('city', 100),
      subDistrictName: str('sub_district_name', 100),
      districtName: str('district_name', 100),
      stateName: str('state_name', 100),
      countryName: str('country_name', 100),
      postalCode: str('postal_code', 20),

      emergencyContactName: str('emergency_contact_name', 150),
      emergencyContactRelationship: str('emergency_contact_relationship', 50),
      emergencyContactPhone: str('emergency_contact_phone', 20),

      // in-database reference: the guardian is another patient (same tenant)
      guardianPatientId: id('guardian_patient_id'),
      guardianRelationship: str('guardian_relationship', 50),

      abhaNumber: str('abha_number', 20),
      abhaAddress: str('abha_address', 100),
      idProofType: str('id_proof_type', 30),
      idProofLast4: str('id_proof_last4', 4),

      notes: str('notes', 500),

      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'ACTIVE', field: 'status' },
      inactiveSince: { type: DataTypes.DATE, allowNull: true, field: 'inactive_since' },
      mergedIntoPatientId: id('merged_into_patient_id'),
      anonymizedOn: { type: DataTypes.DATE, allowNull: true, field: 'anonymized_on' },
      createdBy: id('created_by'),
      createdOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_on' },
      modifiedBy: id('modified_by'),
      modifiedOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'modified_on' },
    },
    {
      tableName: 'patients',
      freezeTableName: true,
      timestamps: false,
      indexes: [
        { unique: true, fields: ['tenant_uuid', 'username'] },
        { unique: true, fields: ['tenant_uuid', 'registration_facility_id', 'registration_number'] },
        { fields: ['tenant_uuid', 'display_name'] },
        { fields: ['tenant_uuid', 'phone_number'] },
        { fields: ['tenant_uuid', 'status'] },
        { fields: ['status', 'inactive_since'] },
      ],
    },
  );

  return Patient;
};
