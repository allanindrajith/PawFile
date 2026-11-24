import test from 'node:test';
import assert from 'node:assert/strict';
import { remindersFor } from '../src/lib/reminders.js';
import { vaccStatus, ageOf, digits } from '../src/lib/format.js';

const day = 864e5;
const iso = (n) => new Date(Date.now() + n * day).toISOString().slice(0, 10);

test('expired vaccine produces a warning', () => {
  const r = remindersFor([{ id: 1, name: 'Rabies', valid_until: iso(-3) }]);
  assert.equal(r.length, 1);
  assert.match(r[0].text, /expired 3 days ago/);
});
test('vaccine due within 30 days is flagged, later is not', () => {
  assert.equal(remindersFor([{ id: 1, name: 'DHPP', valid_until: iso(10) }]).length, 1);
  assert.equal(remindersFor([{ id: 1, name: 'DHPP', valid_until: iso(90) }]).length, 0);
});
test('medicine ending within 3 days is flagged, open-ended is not', () => {
  assert.equal(remindersFor([], [{ id: 1, name: 'Meloxicam', end_on: iso(2) }]).length, 1);
  assert.equal(remindersFor([], [{ id: 1, name: 'Meloxicam', end_on: null }]).length, 0);
});
test('cancelled appointments never remind', () => {
  const soon = new Date(Date.now() + 5 * 36e5).toISOString();
  assert.equal(remindersFor([], [], [{ id: 1, status: 'cancelled', starts_at: soon }]).length, 0);
  assert.equal(remindersFor([], [], [{ id: 1, status: 'booked', starts_at: soon }]).length, 1);
});
test('vaccStatus marks overdue as warn', () => {
  assert.equal(vaccStatus({ valid_until: iso(-1) }).tone, 'warn');
});
test('digits strips formatting from a microchip', () => {
  assert.equal(digits('985 141 000 447 102'), '985141000447102');
});
