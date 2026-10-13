const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');

process.env.DB_DIALECT = 'sqlite';
process.env.ADMIN_JWT_SECRET = 'test-only-shared-secret';
process.env.ADMIN_JWT_AUDIENCE = 'sp3-patient-admin-test';
delete process.env.ORGANIZATION_SERVICE_URL;
delete process.env.ORGANIZATION_SERVICE_INTERNAL_TOKEN;

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

const tokenFor = (tenantUuid, permissions, userId = 5) =>
  jwt.sign({ tenant_uuid: tenantUuid, user_id: userId, permissions }, process.env.ADMIN_JWT_SECRET, {
    audience: process.env.ADMIN_JWT_AUDIENCE,
    expiresIn: '5m',
  });

const ALL = [
  'patient-admin:patient:create', 'patient-admin:patient:read', 'patient-admin:patient:update',
  'patient-admin:patient:merge', 'patient-admin:patient:audit', 'patient-admin:settings:update',
];
const admin = tokenFor(TENANT_A, ALL);
const adminB = tokenFor(TENANT_B, ALL);
const frontDesk = tokenFor(TENANT_A, ALL.slice(0, 3), 6);
const basicUser = tokenFor(TENANT_A, ALL.slice(0, 2), 7); // create + read only

let server;
let baseUrl;
let db;

test.before(async () => {
  const app = require('../src/app');
  db = require('../src/models');
  await db.sequelize.sync({ force: true });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await new Promise((resolve) => server.close(resolve)); });

async function call(method, path, { token, body } = {}) {
  const response = await fetch(`${baseUrl}/api/v1/patient-admin${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

const person = (over = {}) => ({
  username: 'asha.verma', firstName: 'Asha', lastName: 'Verma', phoneNumber: '98765 43210',
  registrationFacilityId: 1, dateOfBirth: '1990-04-12', gender: 'FEMALE', ...over,
});
const register = (over, token = admin) => call('POST', '/patients', { token, body: person(over) });
const search = (body, token = admin) => call('POST', '/patients/search', { token, body });

let asha;

test('rejects requests with no bearer token', async () => {
  assert.equal((await call('POST', '/patients/search', { body: {} })).status, 401);
});

test('only name, phone and username (plus the facility) are mandatory; the number is per facility', async () => {
  const minimal = await call('POST', '/patients', { token: admin, body: { username: 'walk.in', firstName: 'Ravi', phoneNumber: '9000000001', registrationFacilityId: 1 } });
  assert.equal(minimal.status, 201, JSON.stringify(minimal.json));
  assert.equal(minimal.json.patientNumber, 'F1-000001');
  assert.equal(minimal.json.displayName, 'Ravi');
  assert.equal(minimal.json.age, null);

  assert.equal((await call('POST', '/patients', { token: admin, body: { firstName: 'X', phoneNumber: '9000000002', registrationFacilityId: 1 } })).status, 400); // no username
  assert.equal((await call('POST', '/patients', { token: admin, body: { username: 'no.phone', firstName: 'X', registrationFacilityId: 1 } })).status, 400);
  assert.equal((await call('POST', '/patients', { token: admin, body: { username: 'no.name', phoneNumber: '9000000003', registrationFacilityId: 1 } })).status, 400);

  asha = (await register()).json;
  assert.equal(asha.patientNumber, 'F1-000002'); // same facility: next number
  assert.equal(asha.displayName, 'Asha Verma');
  assert.equal(asha.phoneNumber, '9876543210'); // digits only
  assert.ok(asha.age >= 35);
  const otherFacility = await register({ username: 'other.fac', firstName: 'Zoya', phoneNumber: '9111111111', registrationFacilityId: 2 });
  assert.equal(otherFacility.json.patientNumber, 'F2-000001'); // each facility counts on its own
});

test('username is unique per tenant (case-insensitive), phone is not', async () => {
  const clash = await register({ username: 'Asha.Verma', firstName: 'Other', phoneNumber: '9222222222' });
  assert.equal(clash.status, 409);
  assert.equal(clash.json.error.code, 'USERNAME_TAKEN');

  assert.deepEqual((await call('POST', '/patients/username-check', { token: admin, body: { username: 'asha.verma' } })).json, { username: 'asha.verma', available: false });
  assert.equal((await call('POST', '/patients/username-check', { token: admin, body: { username: 'brand.new' } })).json.available, true);

  // the same phone for a different person (a family) is fine: confirm after the duplicate warning
  const sameName = await register({ username: 'asha.v2', phoneNumber: '9876543210' });
  assert.equal(sameName.status, 409);
  assert.equal(sameName.json.error.code, 'DUPLICATE_CANDIDATES');
  const sibling = await register({ username: 'meera.verma', firstName: 'Meera', phoneNumber: '9876543210', dateOfBirth: '1995-01-01' });
  assert.equal(sibling.status, 201, JSON.stringify(sibling.json)); // different first name: no warning
});

test('duplicate warning lists masked candidates and can be confirmed', async () => {
  const warn = await register({ username: 'asha.again', firstName: 'Ashaa', phoneNumber: '98765-43210' });
  assert.equal(warn.status, 409);
  assert.equal(warn.json.error.candidates.length, 1);
  const c = warn.json.error.candidates[0];
  assert.equal(c.displayName, 'Asha Verma');
  assert.equal(c.phoneMasked, 'XXXXXX3210'); // never the full number
  assert.equal(JSON.stringify(warn.json).includes('9876543210'), false);

  const confirmed = await call('POST', '/patients', { token: admin, body: { ...person({ username: 'asha.again', firstName: 'Ashaa' }), allowDuplicate: true } });
  assert.equal(confirmed.status, 201);
});

test('search is a POST, results are masked, hidden statuses are excluded', async () => {
  const byName = await search({ q: 'verma' });
  assert.ok(byName.json.data.length >= 2);
  assert.ok(byName.json.data.every((p) => p.phoneMasked.startsWith('X') && p.phoneNumber === undefined));

  assert.equal((await search({ q: '43210' })).json.data.some((p) => p.username === 'asha.verma'), true); // partial phone
  assert.equal((await search({ q: 'F1-000002' })).json.data[0].username, 'asha.verma');            // patient number
  assert.equal((await search({ q: 'asha.verma' })).json.data.length >= 1, true);                  // username
  assert.equal((await search({ q: '', facilityId: 2 })).json.data.length, 1);                      // per facility
});

test('permissions: basic user can register and look up, only front desk edits, only admin merges / audits', async () => {
  assert.equal((await register({ username: 'basic.made', firstName: 'Basu', phoneNumber: '9333333333' }, basicUser)).status, 201);
  assert.equal((await search({ q: 'basu' }, basicUser)).json.data.length, 1);
  assert.equal((await call('PATCH', `/patients/${asha.patientId}`, { token: basicUser, body: { notes: 'x' } })).status, 403);
  assert.equal((await call('PATCH', `/patients/${asha.patientId}`, { token: frontDesk, body: { notes: 'x' } })).status, 200);
  assert.equal((await call('GET', `/patients/${asha.patientId}/audit`, { token: frontDesk })).status, 403);
  assert.equal((await call('POST', `/patients/${asha.patientId}/merge`, { token: frontDesk, body: { sourcePatientId: 1 } })).status, 403);
  assert.equal((await call('PUT', '/settings', { token: frontDesk, body: { retentionMonths: 3 } })).status, 403);
});

test('a minor needs a registered adult guardian; unknown age counts as an adult', async () => {
  const child = (over = {}) => register({ username: 'kid.one', firstName: 'Kiran', phoneNumber: '9444444444', dateOfBirth: '2020-06-01', ...over });

  const noGuardian = await child();
  assert.equal(noGuardian.status, 400);
  assert.equal(noGuardian.json.error.code, 'GUARDIAN_REQUIRED');

  assert.equal((await child({ guardianPatientId: 99999 })).json.error.code, 'INVALID_GUARDIAN'); // not a patient
  assert.equal((await child({ guardianPatientId: asha.patientId })).status, 201);                // an adult patient

  const ok = await register({ username: 'kid.est', firstName: 'Tara', phoneNumber: '9444444455', dateOfBirth: undefined, estimatedAgeYears: 7, guardianPatientId: asha.patientId });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.isMinor, true);
  assert.equal(ok.json.ageIsEstimated, true);
  assert.equal(ok.json.guardian.displayName, 'Asha Verma');

  // a minor cannot be a guardian
  const kid = (await search({ q: 'kid.est' })).json.data[0];
  const bad = await register({ username: 'kid.two', firstName: 'Nina', phoneNumber: '9444444466', dateOfBirth: '2021-01-01', guardianPatientId: kid.patientId });
  assert.equal(bad.json.error.code, 'INVALID_GUARDIAN');

  // no age at all: treated as an adult, no guardian demanded
  assert.equal((await register({ username: 'no.age', firstName: 'Gita', phoneNumber: '9444444477', dateOfBirth: undefined })).status, 201);

  // making an existing adult a minor-aged record without a guardian is refused on edit too
  const edit = await call('PATCH', `/patients/${asha.patientId}`, { token: admin, body: { dateOfBirth: '2018-01-01' } });
  assert.equal(edit.status, 400);
  assert.equal(edit.json.error.code, 'GUARDIAN_REQUIRED');
});

test('patients are invisible across tenants', async () => {
  assert.equal((await call('GET', `/patients/${asha.patientId}`, { token: adminB })).status, 404);
  assert.equal((await search({ q: 'verma' }, adminB)).json.data.length, 0);
  // and the same username is free in another tenant, with its own numbering
  const mine = await register({ username: 'asha.verma' }, adminB);
  assert.equal(mine.status, 201);
  assert.equal(mine.json.patientNumber, 'F1-000001');
});

test('edit: display name re-derived, username clash refused, audit names fields but never values', async () => {
  const edited = await call('PATCH', `/patients/${asha.patientId}`, { token: admin, body: { middleName: 'Kumari', phoneNumber: '+91 98765 11111', email: 'asha@example.com' } });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  assert.equal(edited.json.displayName, 'Asha Kumari Verma');
  assert.equal(edited.json.phoneNumber, '9876511111');

  assert.equal((await call('PATCH', `/patients/${asha.patientId}`, { token: admin, body: { username: 'walk.in' } })).json.error.code, 'USERNAME_TAKEN');

  const audit = await call('GET', `/patients/${asha.patientId}/audit`, { token: admin });
  const update = audit.json.data.find((e) => e.action === 'UPDATE' && /phoneNumber/.test(e.details));
  assert.ok(update, JSON.stringify(audit.json));
  assert.match(update.details, /middleName/);
  assert.equal(JSON.stringify(audit.json).includes('9876511111'), false);
  assert.equal(JSON.stringify(audit.json).includes('asha@example.com'), false);
  assert.ok(audit.json.data.some((e) => e.action === 'CREATE'));
});

test('opening the full record and looking up by uuid are both audited', async () => {
  const before = (await call('GET', `/patients/${asha.patientId}/audit?limit=100`, { token: admin })).json.data.length;
  const full = await call('GET', `/patients/${asha.patientId}`, { token: admin });
  assert.equal(full.json.email, 'asha@example.com'); // the full record is unmasked
  const lookup = await call('GET', `/patients/by-uuid/${asha.patientUuid}`, { token: admin });
  assert.equal(lookup.json.phoneNumber, '9876511111');
  const after = (await call('GET', `/patients/${asha.patientId}/audit?limit=100`, { token: admin })).json.data;
  assert.equal(after.length, before + 2);
  assert.deepEqual(after.slice(0, 2).map((e) => e.action).sort(), ['LOOKUP', 'VIEW']);
});

test('a second facility issues its own number, once', async () => {
  const first = await call('POST', `/patients/${asha.patientId}/facility-numbers`, { token: admin, body: { facilityId: 2 } });
  assert.equal(first.status, 200);
  const second = first.json.facilityNumbers.find((n) => n.facilityId === 2);
  assert.equal(second.patientNumber, 'F2-000002');
  const again = await call('POST', `/patients/${asha.patientId}/facility-numbers`, { token: admin, body: { facilityId: 2 } });
  assert.equal(again.json.facilityNumbers.length, first.json.facilityNumbers.length); // idempotent
  assert.equal((await search({ q: 'F2-000002' })).json.data[0].patientId, asha.patientId);
});

test('status: inactive starts the retention clock, active stops it, deleted is hidden', async () => {
  const p = (await register({ username: 'status.test', firstName: 'Stan', phoneNumber: '9555555555' })).json;
  const inactive = await call('PATCH', `/patients/${p.patientId}/status`, { token: admin, body: { status: 'INACTIVE' } });
  assert.equal(inactive.json.status, 'INACTIVE');
  assert.ok(inactive.json.inactiveSince);
  assert.equal((await call('PATCH', `/patients/${p.patientId}/status`, { token: admin, body: { status: 'ACTIVE' } })).json.inactiveSince, null);

  await call('PATCH', `/patients/${p.patientId}/status`, { token: admin, body: { status: 'DELETED' } });
  assert.equal((await search({ q: 'status.test' })).json.data.length, 0);
  assert.equal((await search({ q: 'status.test', status: 'DELETED' })).json.data.length, 1);
  assert.equal((await call('PATCH', `/patients/${p.patientId}`, { token: admin, body: { notes: 'x' } })).status, 409);
  assert.equal((await call('PATCH', `/patients/${p.patientId}/status`, { token: admin, body: { status: 'MERGED' } })).status, 400); // system-only
});

test('merge folds a duplicate into the survivor without deleting anything', async () => {
  const keep = (await register({ username: 'keep.me', firstName: 'Kavya', phoneNumber: '9666666666', registrationFacilityId: 1 })).json;
  const dup = (await register({ username: 'dup.me', firstName: 'Kavyaa', phoneNumber: '9666666666', registrationFacilityId: 3, allowDuplicate: true })).json;
  const dependent = (await register({ username: 'dep.child', firstName: 'Dev', phoneNumber: '9666666677', dateOfBirth: '2022-02-02', guardianPatientId: dup.patientId })).json;

  const merged = await call('POST', `/patients/${keep.patientId}/merge`, { token: admin, body: { sourcePatientId: dup.patientId, reason: 'same person' } });
  assert.equal(merged.status, 200, JSON.stringify(merged.json));
  assert.equal(merged.json.facilityNumbers.some((n) => n.facilityId === 3), true); // facility 3's number moved across

  const source = (await call('GET', `/patients/${dup.patientId}`, { token: admin })).json;
  assert.equal(source.status, 'MERGED');
  assert.equal(source.mergedIntoPatientId, keep.patientId);
  assert.equal((await call('GET', `/patients/${dependent.patientId}`, { token: admin })).json.guardian.patientId, keep.patientId);

  assert.equal((await call('POST', `/patients/${keep.patientId}/merge`, { token: admin, body: { sourcePatientId: dup.patientId } })).status, 409);
  assert.equal((await call('POST', `/patients/${keep.patientId}/merge`, { token: admin, body: { sourcePatientId: keep.patientId } })).status, 400);
});

test('retention: default 6 months, configurable per tenant; the job is a dry run unless told otherwise', async () => {
  assert.deepEqual((await call('GET', '/settings', { token: admin })).json, { retentionMonths: 6, isDefault: true });
  assert.equal((await call('PUT', '/settings', { token: admin, body: { retentionMonths: 0 } })).status, 400);

  const old = (await register({ username: 'old.record', firstName: 'Olga', phoneNumber: '9777777777', email: 'olga@example.com' })).json;
  await call('PATCH', `/patients/${old.patientId}/status`, { token: admin, body: { status: 'INACTIVE' } });
  const eightMonthsAgo = new Date(); eightMonthsAgo.setUTCMonth(eightMonthsAgo.getUTCMonth() - 8);
  await db.Patient.update({ inactiveSince: eightMonthsAgo }, { where: { patient_id: old.patientId } });

  const { runAnonymization } = require('../src/jobs/anonymizeExpired');
  const dry = await runAnonymization();
  assert.equal(dry.candidates, 1);
  assert.equal(dry.anonymized, 0);
  assert.equal((await db.Patient.findByPk(old.patientId)).status, 'INACTIVE'); // untouched

  // a tenant that keeps records longer is not affected
  await call('PUT', '/settings', { token: admin, body: { retentionMonths: 12 } });
  assert.equal((await runAnonymization({ apply: true })).anonymized, 0);
  assert.equal((await call('GET', '/settings', { token: admin })).json.retentionMonths, 12);

  await call('PUT', '/settings', { token: admin, body: { retentionMonths: 6 } });
  const applied = await runAnonymization({ apply: true });
  assert.equal(applied.anonymized, 1);
  const row = await db.Patient.findByPk(old.patientId);
  assert.equal(row.status, 'ANONYMIZED');
  assert.equal(row.displayName, 'Anonymized patient');
  assert.equal(row.email, null);
  assert.equal(row.phoneNumber, '');
  assert.equal(row.patientUuid, old.patientUuid); // references from appointments still resolve
  assert.equal((await call('GET', `/patients/${old.patientId}/audit`, { token: admin })).json.data[0].action, 'ANONYMIZE');
});

test('the registering facility is verified, and its code prefixes the number', async () => {
  const orgService = http.createServer((req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url === '/facilities/50') return send(200, { facilityId: 50, facilityCode: 'SPH', organizationId: 1 });
    return send(404, {});
  });
  await new Promise((resolve) => orgService.listen(0, resolve));
  process.env.ORGANIZATION_SERVICE_URL = `http://127.0.0.1:${orgService.address().port}`;
  try {
    const ok = await register({ username: 'with.code', firstName: 'Cody', phoneNumber: '9888888881', registrationFacilityId: 50 });
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    assert.equal(ok.json.patientNumber, 'SPH-000001');
    const bad = await register({ username: 'bad.fac', firstName: 'Bad', phoneNumber: '9888888882', registrationFacilityId: 51 });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, 'INVALID_FACILITY');
  } finally {
    delete process.env.ORGANIZATION_SERVICE_URL;
    await new Promise((resolve) => orgService.close(resolve));
  }
});

test('address: geography ids are validated and names filled in server-side', async () => {
  const geo = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const q = (n) => Number(url.searchParams.get(n));
    const send = (rows) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data: rows })); };
    switch (url.pathname) {
      case '/geography/countries': return send([{ countryId: 104, name: 'India' }]);
      case '/geography/states': return send(q('countryId') === 104 ? [{ stateId: 7, name: 'Uttar Pradesh' }, { stateId: 8, name: 'Punjab' }] : []);
      case '/geography/districts': return send(q('stateId') === 7 ? [{ districtId: 70, name: 'Saharanpur' }] : []);
      default: res.writeHead(404); return res.end();
    }
  });
  await new Promise((resolve) => geo.listen(0, resolve));
  process.env.ORGANIZATION_SERVICE_URL = `http://127.0.0.1:${geo.address().port}`;
  process.env.ORGANIZATION_SERVICE_INTERNAL_TOKEN = 'internal-geo-token';
  try {
    // edit an existing patient's address (no facility lookup is involved on edit)
    const p = (await db.Patient.findOne({ where: { username: 'asha.verma', tenant_uuid: TENANT_A } }));
    const ok = await call('PATCH', `/patients/${p.patientId}`, { token: admin, body: { countryId: 104, stateId: 7, districtId: 70 } });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.deepEqual([ok.json.countryName, ok.json.stateName, ok.json.districtName], ['India', 'Uttar Pradesh', 'Saharanpur']);

    const bad = await call('PATCH', `/patients/${p.patientId}`, { token: admin, body: { stateId: 8 } }); // district 70 is not in Punjab
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, 'INVALID_ADDRESS');
  } finally {
    delete process.env.ORGANIZATION_SERVICE_URL;
    delete process.env.ORGANIZATION_SERVICE_INTERNAL_TOKEN;
    await new Promise((resolve) => geo.close(resolve));
  }
});
