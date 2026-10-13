/**
 * Fine-grained permission codes for the patient registry. They must match
 * what identity-admin-service seeds — see database/seeds/identity-admin-patient-rbac.sql:
 *
 *   TENANT_ADMIN: all six
 *   FRONT_DESK:   CREATE, READ, UPDATE
 *   TENANT_USER:  CREATE, READ     (find a patient / register a walk-in while booking)
 *
 * Patient data is more sensitive than the master data of the other services,
 * so nothing here is implied by another permission: each action is granted on
 * its own. A token carrying ALL_PERMISSIONS (SUPERADMIN) or 'patient-admin:*'
 * bypasses these — see authorize() in middleware/authentication.js.
 */
const PATIENT_PERMISSIONS = {
  CREATE: 'patient-admin:patient:create',
  READ: 'patient-admin:patient:read',
  UPDATE: 'patient-admin:patient:update',
  MERGE: 'patient-admin:patient:merge',
  AUDIT: 'patient-admin:patient:audit',
  SETTINGS: 'patient-admin:settings:update',
};

module.exports = { PATIENT_PERMISSIONS };
