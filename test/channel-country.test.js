import test from 'node:test';
import assert from 'node:assert/strict';
import { displayChannelName, enrichChannelCountry, inferChannelCountryCode } from '../src/channel-country.js';

test('classifies Canadian feeds', () => {
  for (const name of ['DAZN Canada', 'TSN5', 'RDS 2', 'Sportsnet+', 'beIN SPORTS Xtra CA']) {
    assert.equal(inferChannelCountryCode(name), 'CA', name);
  }
});

test('defaults non-Canadian source channels to US market', () => {
  for (const name of ['ESPN', 'Peacock', 'FOX Sports 2', 'Paramount+']) {
    assert.equal(inferChannelCountryCode(name), 'US', name);
  }
});

test('preserves raw name and creates idempotent display name', () => {
  assert.deepEqual(enrichChannelCountry({ name: '[CA] TSN5' }), {
    name: 'TSN5', countryCode: 'CA', displayName: '[CA] TSN5'
  });
  assert.equal(displayChannelName({ name: 'ESPN' }), '[US] ESPN');
});
