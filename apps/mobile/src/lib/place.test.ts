import test from 'node:test';
import assert from 'node:assert/strict';
import { pickedPlaceName, roughPlace, tidyLabel } from './place.ts';

const OSM = 'Madhapur,  Ward 104 Kondapur,  Greater Hyderabad Municipal Corporation West Zone';

test('B176: a label has one space after each comma and none doubled', () => {
  assert.equal(tidyLabel(OSM), 'Madhapur, Ward 104 Kondapur, Greater Hyderabad Municipal Corporation West Zone');
  assert.equal(tidyLabel('Sirur,  Raikode   mandal, '), 'Sirur, Raikode mandal');
  assert.equal(tidyLabel('Kondapur'), 'Kondapur');
});

test('B176: the header names the place that was picked', () => {
  assert.equal(pickedPlaceName(OSM), 'Madhapur');
  assert.equal(pickedPlaceName('Flat 402, Sai Residency, Madhapur, Hyderabad'), 'Madhapur');
  assert.equal(pickedPlaceName('2222, Ward 104 Kondapur'), 'Kondapur');
  assert.equal(pickedPlaceName('Remote'), 'Remote');
  assert.equal(pickedPlaceName('402, 560038'), null);
  assert.equal(pickedPlaceName(null), null);
  // The public area rule is unchanged.
  assert.equal(roughPlace(OSM), 'Kondapur, Greater Hyderabad Municipal Corporation West Zone');
});
