import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  addFactState,
  calculateStateHash,
} from '../src/tcis/project-state.mjs';
import {
  compareCodeUnits,
  stableStringify,
} from '../src/tcis/utils.mjs';

const COLLATION_OPTIONS = { sensitivity: 'variant', usage: 'sort' };

function withIntlCollation(locale, operation) {
  const descriptor = Object.getOwnPropertyDescriptor(String.prototype, 'localeCompare');
  const compare = new Intl.Collator(locale, COLLATION_OPTIONS).compare;
  Object.defineProperty(String.prototype, 'localeCompare', {
    ...descriptor,
    value(other) {
      return compare(String(this), String(other));
    },
  });
  try {
    return operation();
  } finally {
    Object.defineProperty(String.prototype, 'localeCompare', descriptor);
  }
}

function canonicalRecord(field, id, reverseKeys) {
  const metadata = reverseKeys
    ? { '\u00e4ccent': 'umlaut', zebra: 'ascii' }
    : { zebra: 'ascii', '\u00e4ccent': 'umlaut' };
  return reverseKeys
    ? { metadata, [field]: id }
    : { [field]: id, metadata };
}

function canonicalRecords(field, reverseOrder) {
  const ids = reverseOrder ? ['\u00e4-record', 'z-record'] : ['z-record', '\u00e4-record'];
  return ids.map((id) => canonicalRecord(field, id, reverseOrder));
}

function semanticSnapshot(reverseOrder) {
  const project = reverseOrder
    ? { metadata: { '\u00e4ccent': true, zebra: true }, title: 'Collation fixture', project_id: 'PRJ-COLLATION' }
    : { project_id: 'PRJ-COLLATION', title: 'Collation fixture', metadata: { zebra: true, '\u00e4ccent': true } };
  const dependencies = [
    canonicalRecord('upstream_id', 'z-record', reverseOrder),
    canonicalRecord('upstream_id', '\u00e4-record', reverseOrder),
  ].map((record) => ({ ...record, downstream_id: 'target-record' }));

  return {
    project,
    artifacts: canonicalRecords('artifact_id', reverseOrder),
    dependencies: reverseOrder ? dependencies.reverse() : dependencies,
    facts: canonicalRecords('fact_id', reverseOrder),
    claims: canonicalRecords('claim_id', reverseOrder),
    rights: canonicalRecords('right_id', reverseOrder),
    attempts: canonicalRecords('attempt_id', reverseOrder),
    shots: canonicalRecords('shot_id', reverseOrder),
    takes: canonicalRecords('take_id', reverseOrder),
    timelines: canonicalRecords('timeline_id', reverseOrder),
    interactions: [],
    decisions: [],
  };
}

test('canonical serialization uses explicit UTF-16 code-unit ordering', () => {
  assert.deepEqual(
    ['\u00e4', 'z', 'A', '\u03a9'].sort(compareCodeUnits),
    ['A', 'z', '\u00e4', '\u03a9'],
  );
  assert.equal(
    stableStringify({ '\u00e4': 'umlaut', z: 'ascii', A: 'upper', '\u03a9': 'omega' }),
    '{"A":"upper","z":"ascii","\u00e4":"umlaut","\u03a9":"omega"}',
  );
});

test('canonical record order is unchanged when Intl collation changes', () => {
  const english = new Intl.Collator('en', COLLATION_OPTIONS);
  const swedish = new Intl.Collator('sv', COLLATION_OPTIONS);
  assert.notEqual(Math.sign(english.compare('z', '\u00e4')), Math.sign(swedish.compare('z', '\u00e4')));

  const orderUnder = (locale) => withIntlCollation(locale, () => {
    const snapshot = { project: { project_id: 'PRJ-COLLATION' }, facts: [] };
    addFactState(snapshot, { fact_id: '\u00e4-fact', text: 'umlaut' }, '2026-07-13T00:00:00.000Z');
    addFactState(snapshot, { fact_id: 'z-fact', text: 'ascii' }, '2026-07-13T00:00:00.000Z');
    return snapshot.facts.map(({ fact_id: factId }) => factId);
  });

  assert.deepEqual(orderUnder('en'), ['z-fact', '\u00e4-fact']);
  assert.deepEqual(orderUnder('sv'), ['z-fact', '\u00e4-fact']);
});

test('equivalent semantic state hashes identically across Intl collations', () => {
  const englishHash = withIntlCollation('en', () => calculateStateHash(semanticSnapshot(false)));
  const swedishHash = withIntlCollation('sv', () => calculateStateHash(semanticSnapshot(true)));

  assert.match(englishHash, /^[0-9a-f]{64}$/);
  assert.equal(swedishHash, englishHash);
});

test('owned canonical state modules do not call localeCompare', async () => {
  const sources = await Promise.all([
    readFile(new URL('../src/tcis/utils.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/tcis/project-state.mjs', import.meta.url), 'utf8'),
  ]);
  for (const source of sources) assert.doesNotMatch(source, /\.localeCompare\s*\(/u);
});
