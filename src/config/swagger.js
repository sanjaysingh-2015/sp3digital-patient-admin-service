const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');
const { GENDERS, ALL_STATUSES } = require('../validations/patient.validation');

const basePath = '/api/v1/patient-admin';

module.exports = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'SP3 Digital — Patient Admin Service API',
      version: '1.0.0',
      description:
        'Patient registry: one record per person per tenant, patient numbers issued per facility, guardians (a minor ' +
        'needs a registered adult guardian), duplicate detection, merge, an access audit trail and a configurable ' +
        'retention period after which inactive records are anonymized. No clinical data is stored.\n\n' +
        'Every route below `' + basePath + '` (other than `/health`) needs a bearer token from identity-admin-service. ' +
        'Permissions: `patient-admin:patient:create|read|update|merge|audit` and `patient-admin:settings:update`.',
    },
    servers: [{ url: basePath }],
    tags: [
      { name: 'Health', description: 'Liveness check (no auth)' },
      { name: 'Patients', description: 'Register, search, view, edit, status, facility numbers, merge, audit' },
      { name: 'Settings', description: 'Per-tenant retention period' },
    ],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      parameters: {
        PageParam: { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
        LimitParam: { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
      },
      responses: { ValidationError: { description: 'Request validation failed' } },
      schemas: {
        PatientCreateRequest: {
          type: 'object',
          required: ['username', 'firstName', 'phoneNumber', 'registrationFacilityId'],
          properties: {
            username: { type: 'string', example: 'mansi.sharma' },
            registrationFacilityId: { type: 'integer' },
            title: { type: 'string' },
            firstName: { type: 'string' },
            middleName: { type: 'string' },
            lastName: { type: 'string' },
            gender: { type: 'string', enum: GENDERS },
            dateOfBirth: { type: 'string', format: 'date' },
            estimatedAgeYears: { type: 'integer', description: 'Used when the date of birth is unknown' },
            phoneCountryCode: { type: 'string', example: '+91' },
            phoneNumber: { type: 'string' },
            email: { type: 'string', format: 'email' },
            countryId: { type: 'integer' },
            stateId: { type: 'integer' },
            districtId: { type: 'integer' },
            subDistrictId: { type: 'integer' },
            cityId: { type: 'integer' },
            postalCodeId: { type: 'integer' },
            guardianPatientId: { type: 'integer', description: 'Required for a minor; must be a registered adult patient' },
            guardianRelationship: { type: 'string' },
            abhaNumber: { type: 'string', description: 'Stored as given; not verified in version 1' },
            allowDuplicate: { type: 'boolean', default: false },
            status: { type: 'string', enum: ALL_STATUSES, readOnly: true },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: [path.join(__dirname, '../routes/*.js'), path.join(__dirname, '../app.js')],
});
