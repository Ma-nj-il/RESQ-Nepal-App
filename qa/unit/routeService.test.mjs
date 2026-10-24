import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRoadRoute, parseOsrmRoute } from '../../src/services/location/routeService.ts';

const osrmResponse = {
  code: 'Ok',
  routes: [
    {
      distance: 2450,
      duration: 367,
      geometry: {
        coordinates: [
          [85.324, 27.7172],
          [85.331, 27.72],
        ],
      },
    },
  ],
};

test('parseOsrmRoute returns validated road geometry and route estimates', () => {
  assert.deepEqual(parseOsrmRoute(osrmResponse), {
    coordinates: [
      { lat: 27.7172, lng: 85.324 },
      { lat: 27.72, lng: 85.331 },
    ],
    distanceKm: 2.45,
    durationMinutes: 7,
  });
});

test('parseOsrmRoute rejects missing, incomplete, or invalid route geometry', () => {
  assert.equal(parseOsrmRoute({ code: 'NoRoute', routes: [] }), null);
  assert.equal(parseOsrmRoute({ ...osrmResponse, routes: [] }), null);
  assert.equal(
    parseOsrmRoute({
      ...osrmResponse,
      routes: [{ ...osrmResponse.routes[0], geometry: { coordinates: [[181, 0], [0, 0]] } }],
    }),
    null,
  );
});

test('getRoadRoute requests OSRM coordinate order and caches successful routes', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => osrmResponse };
  };
  try {
    const start = { lat: 27.7172, lng: 85.324 };
    const end = { lat: 27.72, lng: 85.331 };
    const first = await getRoadRoute(start, end);
    const second = await getRoadRoute(start, end);
    assert.deepEqual(first, parseOsrmRoute(osrmResponse));
    assert.deepEqual(second, first);
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/route\/v1\/driving\/85\.324,27\.7172;85\.331,27\.72\?/);
    assert.equal(requests[0].options.headers.Accept, 'application/json');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getRoadRoute reports HTTP failures instead of returning a fake route', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  try {
    await assert.rejects(
      getRoadRoute({ lat: 27.731, lng: 85.344 }, { lat: 27.735, lng: 85.35 }),
      /Routing service request failed \(503\)/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
