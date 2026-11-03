import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  LocationPointBatchDto,
  TripCompletionDto,
} from '../../src/core-dispatch/presentation/http/core-dispatch.dto.js';

describe('core dispatch HTTP contracts', () => {
  it('accepts NPR completion evidence and rejects any other currency', async () => {
    const input = {
      reasonCode: 'TRIP_COMPLETED',
      distanceMeters: '12500',
      finalFareMinor: '45000',
      finalFareCurrency: 'NPR',
      finalFareProvenance: 'FARE_NPR_V1',
    };
    await expect(validate(plainToInstance(TripCompletionDto, input))).resolves.toHaveLength(0);
    const invalid = await validate(
      plainToInstance(TripCompletionDto, { ...input, finalFareCurrency: 'USD' }),
    );
    expect(invalid.map((error) => error.property)).toContain('finalFareCurrency');
  });

  it('enforces bounded tracking batches and nested point validation', async () => {
    const validPoint = {
      pointId: '018f0000-0000-7000-8000-000000000001',
      sequence: 1,
      latitude: 27.7172,
      longitude: 85.324,
      accuracyMeters: 8,
      quality: 'GOOD',
      capturedAt: '2026-11-03T12:00:00.000Z',
    };
    const valid = plainToInstance(LocationPointBatchDto, {
      sourceDeviceId: '018f0000-0000-7000-8000-000000000002',
      points: [validPoint],
    });
    await expect(validate(valid)).resolves.toHaveLength(0);

    const invalid = plainToInstance(LocationPointBatchDto, {
      sourceDeviceId: '018f0000-0000-7000-8000-000000000002',
      points: [{ ...validPoint, latitude: 91 }],
    });
    expect(await validate(invalid)).not.toHaveLength(0);
  });
});
