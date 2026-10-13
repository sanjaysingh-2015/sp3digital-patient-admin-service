-- =====================================================================
-- sp3digital_patients — Patient registry
--
-- Bounded context: the PATIENT domain. Owns who a patient is (identity,
-- contact, address, guardian, ABHA number as given), the per-facility
-- patient numbers, duplicate merges, the access audit trail and the
-- per-tenant retention setting.
--
-- A patient belongs to exactly one tenant and can be seen across that
-- tenant's facilities. Patient numbers are issued PER FACILITY.
--
-- Cross-database references (facility_id, user ids, geography ids) are plain
-- bigint unsigned columns with NO foreign keys, same rule as the other
-- services. References inside this database are real foreign keys.
--
-- No clinical data is stored here (version 1). Full identity-document
-- numbers are never stored — only the last four characters.
-- MySQL 8.0 required.
-- =====================================================================

CREATE DATABASE IF NOT EXISTS `sp3digital_patients`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE `sp3digital_patients`;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `patient_access_log`;
DROP TABLE IF EXISTS `patient_merges`;
DROP TABLE IF EXISTS `patient_facility_numbers`;
DROP TABLE IF EXISTS `patient_number_sequences`;
DROP TABLE IF EXISTS `tenant_patient_settings`;
DROP TABLE IF EXISTS `patients`;
SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================
-- 1. patients — one row per person per tenant
-- =============================================================
CREATE TABLE `patients` (
  `patient_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `patient_uuid` char(36) NOT NULL,                      -- stable, non-guessable; this is what appointments store as patient_ref
  `tenant_uuid` char(36) NOT NULL,
  `username` varchar(50) NOT NULL,                       -- mandatory; unique within the tenant (also the future patient login handle)

  `registration_facility_id` bigint unsigned NOT NULL,   -- facility that registered the patient (organization-admin-service)
  `registration_number` varchar(40) DEFAULT NULL,        -- the patient number issued by that facility (copy of the row in patient_facility_numbers)

  -- identity
  `title` varchar(20) DEFAULT NULL,
  `first_name` varchar(100) NOT NULL,
  `middle_name` varchar(100) DEFAULT NULL,
  `last_name` varchar(100) DEFAULT NULL,
  `display_name` varchar(255) NOT NULL,
  `gender` varchar(20) DEFAULT NULL,                     -- MALE / FEMALE / OTHER / UNDISCLOSED
  `date_of_birth` date DEFAULT NULL,
  `estimated_age_years` smallint unsigned DEFAULT NULL,  -- when the date of birth is unknown
  `estimated_age_on` date DEFAULT NULL,                  -- the day that estimate was recorded, so age keeps advancing
  `preferred_language` varchar(40) DEFAULT NULL,

  -- contact (a phone number is NOT unique: families share one)
  `phone_country_code` varchar(8) NOT NULL DEFAULT '+91',
  `phone_number` varchar(20) NOT NULL,                   -- digits only
  `alternate_phone_number` varchar(20) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,

  -- address; geography ids resolve through organization-admin-service, names are filled in by the service
  `address_line1` varchar(255) DEFAULT NULL,
  `address_line2` varchar(255) DEFAULT NULL,
  `country_id` bigint unsigned DEFAULT NULL,
  `state_id` bigint unsigned DEFAULT NULL,
  `district_id` bigint unsigned DEFAULT NULL,
  `sub_district_id` bigint unsigned DEFAULT NULL,
  `city_id` bigint unsigned DEFAULT NULL,
  `postal_code_id` bigint unsigned DEFAULT NULL,
  `city` varchar(100) DEFAULT NULL,
  `sub_district_name` varchar(100) DEFAULT NULL,
  `district_name` varchar(100) DEFAULT NULL,
  `state_name` varchar(100) DEFAULT NULL,
  `country_name` varchar(100) DEFAULT NULL,
  `postal_code` varchar(20) DEFAULT NULL,

  -- emergency contact
  `emergency_contact_name` varchar(150) DEFAULT NULL,
  `emergency_contact_relationship` varchar(50) DEFAULT NULL,
  `emergency_contact_phone` varchar(20) DEFAULT NULL,

  -- guardian: another registered patient (required while the patient is a minor)
  `guardian_patient_id` bigint unsigned DEFAULT NULL,
  `guardian_relationship` varchar(50) DEFAULT NULL,

  -- identifiers — stored as given, not verified in version 1
  `abha_number` varchar(20) DEFAULT NULL,
  `abha_address` varchar(100) DEFAULT NULL,
  `id_proof_type` varchar(30) DEFAULT NULL,
  `id_proof_last4` char(4) DEFAULT NULL,                 -- ONLY the last 4 characters; never the full number

  `notes` varchar(500) DEFAULT NULL,                     -- administrative notes only: NO diagnoses or symptoms

  `status` varchar(20) NOT NULL DEFAULT 'ACTIVE',        -- ACTIVE / INACTIVE / MERGED / DELETED / ANONYMIZED
  `inactive_since` datetime(6) DEFAULT NULL,             -- starts the retention clock
  `merged_into_patient_id` bigint unsigned DEFAULT NULL,
  `anonymized_on` datetime(6) DEFAULT NULL,
  `created_by` bigint unsigned DEFAULT NULL,
  `created_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `modified_by` bigint unsigned DEFAULT NULL,
  `modified_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`patient_id`),
  UNIQUE KEY `uk_patients_uuid` (`patient_uuid`),
  UNIQUE KEY `uk_patients_tenant_username` (`tenant_uuid`,`username`),
  UNIQUE KEY `uk_patients_facility_number` (`tenant_uuid`,`registration_facility_id`,`registration_number`),
  KEY `idx_patients_tenant_name` (`tenant_uuid`,`display_name`),
  KEY `idx_patients_tenant_phone` (`tenant_uuid`,`phone_number`),
  KEY `idx_patients_tenant_status` (`tenant_uuid`,`status`),
  KEY `idx_patients_retention` (`status`,`inactive_since`),
  KEY `idx_patients_guardian` (`guardian_patient_id`),
  CONSTRAINT `fk_patients_guardian` FOREIGN KEY (`guardian_patient_id`) REFERENCES `patients` (`patient_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 2. patient_facility_numbers — each facility issues its own number
-- =============================================================
CREATE TABLE `patient_facility_numbers` (
  `patient_id` bigint unsigned NOT NULL,
  `facility_id` bigint unsigned NOT NULL,
  `tenant_uuid` char(36) NOT NULL,
  `patient_number` varchar(40) NOT NULL,                 -- e.g. FAC-000123, unique within the facility
  `issued_by` bigint unsigned DEFAULT NULL,
  `issued_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`patient_id`,`facility_id`),
  UNIQUE KEY `uk_facility_numbers_number` (`tenant_uuid`,`facility_id`,`patient_number`),
  KEY `idx_facility_numbers_facility` (`facility_id`),
  CONSTRAINT `fk_facility_numbers_patient` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`patient_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 3. patient_number_sequences — the counter behind each facility's numbers
-- Incremented under a row lock inside the registering transaction.
-- =============================================================
CREATE TABLE `patient_number_sequences` (
  `tenant_uuid` char(36) NOT NULL,
  `facility_id` bigint unsigned NOT NULL,
  `last_number` int unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`tenant_uuid`,`facility_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 4. patient_merges — a duplicate folded into the surviving record
-- =============================================================
CREATE TABLE `patient_merges` (
  `merge_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_uuid` char(36) NOT NULL,
  `source_patient_id` bigint unsigned NOT NULL,          -- becomes status MERGED
  `target_patient_id` bigint unsigned NOT NULL,          -- survives
  `reason` varchar(300) DEFAULT NULL,
  `merged_by` bigint unsigned DEFAULT NULL,
  `merged_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`merge_id`),
  KEY `idx_merges_tenant` (`tenant_uuid`),
  KEY `idx_merges_target` (`target_patient_id`),
  CONSTRAINT `fk_merges_source` FOREIGN KEY (`source_patient_id`) REFERENCES `patients` (`patient_id`),
  CONSTRAINT `fk_merges_target` FOREIGN KEY (`target_patient_id`) REFERENCES `patients` (`patient_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 5. patient_access_log — append-only audit trail
-- Records WHO did WHAT to WHICH patient, and which fields changed —
-- never the values themselves.
-- =============================================================
CREATE TABLE `patient_access_log` (
  `log_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_uuid` char(36) NOT NULL,
  `patient_id` bigint unsigned NOT NULL,
  `action` varchar(20) NOT NULL,                         -- CREATE / VIEW / LOOKUP / UPDATE / STATUS / NUMBER / MERGE / ANONYMIZE
  `user_id` bigint unsigned DEFAULT NULL,
  `details` varchar(500) DEFAULT NULL,                   -- e.g. "phoneNumber, email"
  `created_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`log_id`),
  KEY `idx_access_log_patient` (`tenant_uuid`,`patient_id`,`created_on`),
  KEY `idx_access_log_user` (`tenant_uuid`,`user_id`,`created_on`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 6. tenant_patient_settings — per-tenant, configurable
-- =============================================================
CREATE TABLE `tenant_patient_settings` (
  `tenant_uuid` char(36) NOT NULL,
  `retention_months` smallint unsigned NOT NULL DEFAULT 6, -- inactive / deleted records are anonymized after this long
  `modified_by` bigint unsigned DEFAULT NULL,
  `modified_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`tenant_uuid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
