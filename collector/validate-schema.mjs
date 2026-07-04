#!/usr/bin/env node
// Minimal JSON-Schema subset validator for workspace-scan sidecars — zero deps.
// Supports: type (incl. union arrays), const, enum, required, properties,
// additionalProperties (false | schema), items, $ref (#/$defs/*), minimum/maximum.
// "format" is ignored on purpose (dates are trusted from the engine).
//
//   node collector/validate-schema.mjs [data/latest.json] [schema/workspace-scan.schema.json]
//
// Exit 0 = valid. Exit 1 = violations (printed one per line with a JSON path).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = path.resolve(process.argv[2] ?? path.join(ROOT, 'data', 'latest.json'));
const schemaPath = path.resolve(process.argv[3] ?? path.join(ROOT, 'schema', 'workspace-scan.schema.json'));

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const errors = [];
const err = (p, msg) => errors.push(`${p || '$'}: ${msg}`);

function resolveRef(ref) {
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref: ${ref}`);
  let node = schema;
  for (const seg of ref.slice(2).split('/')) node = node?.[seg];
  if (!node) throw new Error(`unresolvable $ref: ${ref}`);
  return node;
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(actual, expected) {
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  return actual === expected;
}

function validate(value, sch, p) {
  if (!sch || typeof sch !== 'object') return;
  if (sch.$ref) return validate(value, resolveRef(sch.$ref), p);

  if ('const' in sch && value !== sch.const) {
    err(p, `expected const ${JSON.stringify(sch.const)}, got ${JSON.stringify(value)}`);
    return;
  }
  if (sch.enum && !sch.enum.includes(value)) {
    err(p, `value ${JSON.stringify(value)} not in enum [${sch.enum.join(', ')}]`);
    return;
  }

  if (sch.type) {
    const allowed = Array.isArray(sch.type) ? sch.type : [sch.type];
    const actual = typeOf(value);
    if (!allowed.some((t) => typeMatches(actual, t))) {
      err(p, `expected type ${allowed.join('|')}, got ${actual}`);
      return; // structural checks below would be nonsense
    }
  }

  if (typeOf(value) === 'integer' || typeOf(value) === 'number') {
    if (typeof sch.minimum === 'number' && value < sch.minimum) err(p, `value ${value} < minimum ${sch.minimum}`);
    if (typeof sch.maximum === 'number' && value > sch.maximum) err(p, `value ${value} > maximum ${sch.maximum}`);
  }

  if (Array.isArray(value) && sch.items) {
    value.forEach((item, i) => validate(item, sch.items, `${p}[${i}]`));
  }

  if (value && typeOf(value) === 'object') {
    for (const req of sch.required ?? []) {
      if (!(req in value)) err(p, `missing required key "${req}"`);
    }
    const props = sch.properties ?? {};
    for (const [k, v] of Object.entries(value)) {
      if (k in props) {
        validate(v, props[k], p ? `${p}.${k}` : k);
      } else if (sch.additionalProperties === false) {
        err(p, `unexpected key "${k}" (additionalProperties: false)`);
      } else if (sch.additionalProperties && typeof sch.additionalProperties === 'object') {
        validate(v, sch.additionalProperties, p ? `${p}.${k}` : k);
      }
    }
  }
}

validate(data, schema, '');

if (errors.length) {
  console.error(`INVALID: ${path.basename(dataPath)} has ${errors.length} schema violation(s):`);
  for (const e of errors.slice(0, 50)) console.error('  ' + e);
  if (errors.length > 50) console.error(`  ... and ${errors.length - 50} more`);
  process.exit(1);
}
console.log(`VALID: ${path.basename(dataPath)} conforms to ${path.basename(schemaPath)}`);
