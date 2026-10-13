-- Patient Admin RBAC — run against the sp3digital_identity database
-- (copy into identity-admin-service's database/seeds/).
--
-- Roles after this script:
--   TENANT_ADMIN : create, read, update, merge, audit, settings
--   FRONT_DESK   : create, read, update           (new role)
--   TENANT_USER  : create, read                   (can find a patient and register a walk-in
--                                                   while booking; cannot edit existing patients)
--
-- Permission codes must match src/utils/permissions.js in
-- sp3digital-patient-admin-service exactly.

-- --- Permissions -----------------------------------------------------------

INSERT INTO permissions (permission_uuid, permission_code, permission_name, resource, action, description, status, created_on, modified_on)
SELECT UUID(), 'patient-admin:patient:create', 'Register patient', 'patient-admin', 'create', 'Register a patient', 'ACTIVE', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = 'patient-admin:patient:create');

INSERT INTO permissions (permission_uuid, permission_code, permission_name, resource, action, description, status, created_on, modified_on)
SELECT UUID(), 'patient-admin:patient:read', 'View patients', 'patient-admin', 'read', 'Search and open patients', 'ACTIVE', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = 'patient-admin:patient:read');

INSERT INTO permissions (permission_uuid, permission_code, permission_name, resource, action, description, status, created_on, modified_on)
SELECT UUID(), 'patient-admin:patient:update', 'Edit patients', 'patient-admin', 'update', 'Edit a patient, change status, issue facility numbers', 'ACTIVE', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = 'patient-admin:patient:update');

INSERT INTO permissions (permission_uuid, permission_code, permission_name, resource, action, description, status, created_on, modified_on)
SELECT UUID(), 'patient-admin:patient:merge', 'Merge patients', 'patient-admin', 'merge', 'Merge a duplicate patient into another', 'ACTIVE', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = 'patient-admin:patient:merge');

INSERT INTO permissions (permission_uuid, permission_code, permission_name, resource, action, description, status, created_on, modified_on)
SELECT UUID(), 'patient-admin:patient:audit', 'View patient access log', 'patient-admin', 'audit', 'See who viewed or changed a patient record', 'ACTIVE', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = 'patient-admin:patient:audit');

INSERT INTO permissions (permission_uuid, permission_code, permission_name, resource, action, description, status, created_on, modified_on)
SELECT UUID(), 'patient-admin:settings:update', 'Patient settings', 'patient-admin', 'update', 'Change patient retention settings', 'ACTIVE', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = 'patient-admin:settings:update');

-- --- Role ------------------------------------------------------------------

INSERT INTO roles (role_uuid, role_code, role_name, description, role_type, status, created_on, modified_on)
SELECT UUID(), 'FRONT_DESK', 'Front Desk',
       'Registers and edits patients and books appointments for them', 'APPLICATION', 'ACTIVE', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE role_code = 'FRONT_DESK');

-- --- Grants ----------------------------------------------------------------

-- TENANT_ADMIN: everything
INSERT INTO role_permissions (role_id, permission_id, status, created_on, modified_on)
SELECT roles.role_id, permissions.permission_id, 'ACTIVE', NOW(), NOW()
FROM roles
JOIN permissions ON permissions.permission_code IN (
  'patient-admin:patient:create', 'patient-admin:patient:read', 'patient-admin:patient:update',
  'patient-admin:patient:merge', 'patient-admin:patient:audit', 'patient-admin:settings:update'
)
LEFT JOIN role_permissions
  ON role_permissions.role_id = roles.role_id AND role_permissions.permission_id = permissions.permission_id AND role_permissions.status = 'ACTIVE'
WHERE roles.role_code = 'TENANT_ADMIN' AND role_permissions.role_permission_id IS NULL;

-- FRONT_DESK: create, read, update
INSERT INTO role_permissions (role_id, permission_id, status, created_on, modified_on)
SELECT roles.role_id, permissions.permission_id, 'ACTIVE', NOW(), NOW()
FROM roles
JOIN permissions ON permissions.permission_code IN (
  'patient-admin:patient:create', 'patient-admin:patient:read', 'patient-admin:patient:update'
)
LEFT JOIN role_permissions
  ON role_permissions.role_id = roles.role_id AND role_permissions.permission_id = permissions.permission_id AND role_permissions.status = 'ACTIVE'
WHERE roles.role_code = 'FRONT_DESK' AND role_permissions.role_permission_id IS NULL;

-- TENANT_USER: create, read
INSERT INTO role_permissions (role_id, permission_id, status, created_on, modified_on)
SELECT roles.role_id, permissions.permission_id, 'ACTIVE', NOW(), NOW()
FROM roles
JOIN permissions ON permissions.permission_code IN ('patient-admin:patient:create', 'patient-admin:patient:read')
LEFT JOIN role_permissions
  ON role_permissions.role_id = roles.role_id AND role_permissions.permission_id = permissions.permission_id AND role_permissions.status = 'ACTIVE'
WHERE roles.role_code = 'TENANT_USER' AND role_permissions.role_permission_id IS NULL;
