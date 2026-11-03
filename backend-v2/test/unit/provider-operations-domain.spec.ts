import {
  ambulanceReadinessReasons,
  documentIsCurrent,
  driverEligibilityReasons,
  transitionProviderApplication,
} from '../../src/provider-operations/domain/provider-operations.js';

describe('provider operations domain invariants', () => {
  it('allows only the explicit provider application lifecycle', () => {
    expect(transitionProviderApplication('DRAFT', 'SUBMIT')).toBe('SUBMITTED');
    expect(transitionProviderApplication('SUBMITTED', 'RECOMMEND')).toBe('PROVINCE_RECOMMENDED');
    expect(transitionProviderApplication('PROVINCE_RECOMMENDED', 'BEGIN_PLATFORM_REVIEW')).toBe(
      'PLATFORM_REVIEW',
    );
    expect(transitionProviderApplication('PLATFORM_REVIEW', 'APPROVE')).toBe('APPROVED');
    expect(transitionProviderApplication('DRAFT', 'APPROVE')).toBeUndefined();
    expect(transitionProviderApplication('APPROVED', 'WITHDRAW')).toBeUndefined();
  });

  it('keeps driver eligibility dimensions independent and fail-closed', () => {
    expect(
      driverEligibilityReasons({
        verificationStatus: 'VERIFIED',
        accountStatus: 'ACTIVE',
        dutyStatus: 'AVAILABLE',
        affiliationActive: true,
        documentsCurrent: false,
        activeTrip: true,
      }),
    ).toEqual(['DOCUMENTS_NOT_CURRENT', 'ACTIVE_TRIP_CONFLICT']);
  });

  it('blocks ambulance readiness for every unresolved compliance dimension', () => {
    expect(
      ambulanceReadinessReasons({
        complianceStatus: 'APPROVED',
        operationalStatus: 'AVAILABLE',
        documentsCurrent: true,
        equipmentReady: false,
        maintenanceBlocking: true,
        activeTrip: false,
      }),
    ).toEqual(['REQUIRED_EQUIPMENT_NOT_READY', 'MAINTENANCE_BLOCK']);
  });

  it('treats expiry as inclusive through the stated date and rejects unscanned evidence', () => {
    expect(
      documentIsCurrent({
        uploadStatus: 'READY',
        reviewStatus: 'APPROVED',
        expiresOn: '2026-11-03',
        today: '2026-11-03',
      }),
    ).toBe(true);
    expect(
      documentIsCurrent({
        uploadStatus: 'SCANNING',
        reviewStatus: 'APPROVED',
        expiresOn: '2026-11-04',
        today: '2026-11-03',
      }),
    ).toBe(false);
    expect(
      documentIsCurrent({
        uploadStatus: 'READY',
        reviewStatus: 'APPROVED',
        expiresOn: '2026-11-02',
        today: '2026-11-03',
      }),
    ).toBe(false);
  });
});
