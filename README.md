# sp3digital-patient-admin-service

Patient registry for the SP3 Digital platform. One record per person per tenant,
visible across that tenant's facilities. **No clinical data is stored** in this
version, and full identity-document numbers are never stored (last 4 characters only).

Same stack and layering as the provider and appointment services: Node + Express 5 +
Sequelize + MySQL, controller → service → model, Joi validation, Swagger at `/docs`,
JWTs minted by `sp3digital-identity-admin-service`, strict tenant isolation.

## What it does

| Rule | Detail |
|---|---|
| Mandatory at registration | name (`firstName`), phone number, `username`, plus the registering facility |
| Patient numbers are per facility | `<facilityCode>-000123`, issued under a row lock; another facility issues its own number on request (`POST /patients/:id/facility-numbers`) |
| Phone is not unique | families share one number. A likely duplicate (same phone + similar name, or same date of birth + similar name) answers `409 DUPLICATE_CANDIDATES` with *masked* candidates; repeat with `allowDuplicate: true` to confirm it is another person |
| Username | unique per tenant, case-insensitive |
| Minors | younger than `MINOR_AGE_YEARS` (18) need `guardianPatientId`: a registered **adult** patient of the same tenant. Unknown age counts as an adult. An estimated age keeps advancing with the calendar |
| Masked lists | search returns `phoneMasked` (`XXXXXX3210`) and a masked email; the full record is returned only by `GET /patients/:id`, which is written to the access log |
| Search is a POST | names and phone numbers stay out of URLs and logs |
| Audit | every create, full view, lookup, edit (the *field names* that changed, never values), status change, number issue, merge and anonymization is logged and readable with the audit permission |
| Merge | a duplicate becomes `MERGED` and points at the survivor; nothing is deleted; guardian links and facility numbers move across |
| Retention | `INACTIVE` / `DELETED` patients are anonymized after the tenant's retention period (default **6 months**, configurable per tenant through `PUT /settings`) by `npm run anonymize` (dry run) / `npm run anonymize -- --apply` — schedule the latter, e.g. nightly |
| Address | the same geography ids as organizations / facilities / doctors; the service validates the chain and fills in the names |
| ABHA number | stored as given, not verified (verification is a later phase) |

## Permissions (identity seed: `database/seeds/identity-admin-patient-rbac.sql`)

| Permission | Tenant admin | Front desk | Tenant user |
|---|---|---|---|
| `patient-admin:patient:create` | ✓ | ✓ | ✓ |
| `patient-admin:patient:read` | ✓ | ✓ | ✓ |
| `patient-admin:patient:update` | ✓ | ✓ | |
| `patient-admin:patient:merge` | ✓ | | |
| `patient-admin:patient:audit` | ✓ | | |
| `patient-admin:settings:update` | ✓ | | |

Ordinary users can find a patient and register a walk-in while booking, but cannot edit existing patients.

## Setup

```bash
cp .env.example .env     # fill in DB credentials and the JWT values; never commit .env
npm install
mysql -u <user> -p < database/complete_db_script/script-sp3digital_patients.sql
mysql -u <user> -p sp3digital_identity < database/seeds/identity-admin-patient-rbac.sql
npm run dev              # http://localhost:3400/docs
npm test                 # in-memory SQLite, no setup
```

MySQL runs locally for now. For a cloud database set `DB_HOST` / credentials and
`DB_SSL=true` (optionally `DB_SSL_CA`). Set `ORGANIZATION_SERVICE_URL` and
`ORGANIZATION_SERVICE_INTERNAL_TOKEN` in every real environment: without them the
facility and geography ids are accepted unchecked.

## How other services use it

The appointment service stores the patient's `patientUuid` as `patient_ref` and
snapshots the name, phone and email at booking time (`GET /patients/by-uuid/:uuid`).
Not built yet: consent capture (email reminders — to be added), the booking-screen
patient picker, patient self-service, ABHA verification, clinical records.
