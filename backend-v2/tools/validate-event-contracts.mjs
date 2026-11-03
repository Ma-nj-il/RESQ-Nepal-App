import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractRoot = path.join(backendRoot, 'contracts', 'events');
const catalogPath = path.join(contractRoot, 'catalog.json');
const eventSourceRoot = path.join(backendRoot, 'src', 'core-dispatch', 'application');
const forbiddenDataKeys = new Set(
  [
    'accessToken',
    'coordinates',
    'credential',
    'details',
    'email',
    'latitude',
    'longitude',
    'narrative',
    'objectKey',
    'otp',
    'password',
    'patient',
    'patientName',
    'patientPhone',
    'phone',
    'presignedUrl',
    'refreshToken',
    'secret',
    'token',
  ].map((key) => key.toLowerCase()),
);

async function filesBelow(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(candidate, predicate)));
    else if (predicate(candidate)) files.push(candidate);
  }
  return files.sort();
}

async function json(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function relative(file) {
  return path.relative(contractRoot, file).split(path.sep).join('/');
}

function fail(message, details) {
  const suffix = details === undefined ? '' : `\n${JSON.stringify(details, null, 2)}`;
  throw new Error(`${message}${suffix}`);
}

function inspectRestrictedKeys(value, location = 'data') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectRestrictedKeys(entry, `${location}[${String(index)}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (forbiddenDataKeys.has(key.toLowerCase())) {
      fail(`Restricted event fixture field found at ${location}.${key}`);
    }
    inspectRestrictedKeys(entry, `${location}.${key}`);
  }
}

async function emittedEventTypes() {
  const sourceFiles = await filesBelow(eventSourceRoot, (file) => file.endsWith('.ts'));
  const eventLike = new Set();
  const jobs = new Set();
  const eventPattern = /['"]((?:booking|dispatch|trip|safety)\.[a-z0-9.-]+\.v[1-9][0-9]*)['"]/g;
  const jobPattern = /jobType:\s*['"]([^'"]+)['"]/g;
  for (const file of sourceFiles) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(eventPattern)) eventLike.add(match[1]);
    for (const match of source.matchAll(jobPattern)) jobs.add(match[1]);
  }
  return [...eventLike].filter((eventType) => !jobs.has(eventType)).sort();
}

const catalog = await json(catalogPath);
if (catalog.catalogVersion !== 1 || !Array.isArray(catalog.events)) {
  fail('Event catalog must declare catalogVersion 1 and an events array');
}

const eventTypes = catalog.events.map((entry) => entry.eventType);
if (new Set(eventTypes).size !== eventTypes.length) fail('Event catalog contains duplicate types');

const schemaFiles = await filesBelow(contractRoot, (file) => file.endsWith('schema.json'));
const schemas = await Promise.all(schemaFiles.map(json));
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
for (const schema of schemas) ajv.addSchema(schema);

const catalogSchemas = new Set(catalog.events.map((entry) => entry.schema));
const contractSchemas = new Set(
  schemaFiles.map(relative).filter((file) => !file.startsWith('_shared/')),
);
if (JSON.stringify([...catalogSchemas].sort()) !== JSON.stringify([...contractSchemas].sort())) {
  fail('Catalog schemas and versioned event schemas differ', {
    catalog: [...catalogSchemas].sort(),
    contracts: [...contractSchemas].sort(),
  });
}

for (const entry of catalog.events) {
  const versionMatch = /\.v([1-9][0-9]*)$/.exec(entry.eventType);
  if (versionMatch === null || Number(versionMatch[1]) !== entry.schemaVersion) {
    fail(`Event type and schema version differ for ${entry.eventType}`);
  }
  const domain = entry.eventType.split('.')[0];
  const eventName = entry.eventType.replace(/\.v[1-9][0-9]*$/, '');
  const expectedBase = `${domain}/${eventName}/v${String(entry.schemaVersion)}`;
  if (entry.domain !== domain || entry.topic !== `resq.${domain}.events.v1`) {
    fail(`Catalog routing metadata is invalid for ${entry.eventType}`);
  }
  if (
    entry.schema !== `${expectedBase}/schema.json` ||
    entry.example !== `${expectedBase}/example.json`
  ) {
    fail(`Catalog paths are invalid for ${entry.eventType}`);
  }
  if (
    !Array.isArray(entry.producers) ||
    entry.producers.length === 0 ||
    !Array.isArray(entry.intendedConsumers) ||
    entry.intendedConsumers.length === 0 ||
    typeof entry.dltOwner !== 'string' ||
    typeof entry.replayOwner !== 'string'
  ) {
    fail(`Catalog ownership metadata is incomplete for ${entry.eventType}`);
  }

  const schema = await json(path.join(contractRoot, entry.schema));
  const example = await json(path.join(contractRoot, entry.example));
  const validate = ajv.getSchema(schema.$id);
  if (validate === undefined) fail(`Schema was not registered for ${entry.eventType}`);
  if (!validate(example))
    fail(`Canonical example is invalid for ${entry.eventType}`, validate.errors);
  if (example.eventType !== entry.eventType || example.schemaVersion !== entry.schemaVersion) {
    fail(`Canonical example identity differs from the catalog for ${entry.eventType}`);
  }
  if (!entry.producers.includes(example.producer)) {
    fail(`Canonical example producer is not cataloged for ${entry.eventType}`);
  }
  inspectRestrictedKeys(example.data);

  const wrongType = { ...example, eventType: `${entry.eventType}.unknown` };
  if (validate(wrongType)) fail(`Schema accepts an incorrect event type for ${entry.eventType}`);
  const extraPayload = { ...example, data: { ...example.data, unexpectedField: true } };
  if (validate(extraPayload))
    fail(`Schema accepts an unknown payload field for ${entry.eventType}`);
}

const emitted = await emittedEventTypes();
const cataloged = [...eventTypes].sort();
if (JSON.stringify(emitted) !== JSON.stringify(cataloged)) {
  fail('Implemented Phase 5 event literals and the contract catalog differ', {
    emitted,
    cataloged,
  });
}

console.log(`Validated ${String(catalog.events.length)} Phase 5 event schemas and examples.`);
