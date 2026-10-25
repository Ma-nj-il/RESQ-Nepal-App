package pricing

import (
	"context"
	"math"
	"time"

	"github.com/bikky-kc013/medi-ambulance/internal/geography"
	"github.com/google/uuid"
)

type Calculator struct {
	repo     RepositoryInterface
	resolver *Resolver
	geoSvc   *geography.Service
}

func NewCalculator(repo RepositoryInterface, resolver *Resolver, geoSvc *geography.Service) *Calculator {
	return &Calculator{
		repo:     repo,
		resolver: resolver,
		geoSvc:   geoSvc,
	}
}

type CalculateInput struct {
	PickupLatitude    float64
	PickupLongitude   float64
	DropoffLatitude   float64
	DropoffLongitude  float64
	DistanceKm        float64
	DurationMin       int
	RideTypeID        *uuid.UUID
	WeatherCondition  string
	DemandSupplyRatio float64
	NegotiatedFare    *float64
	Currency          string
}

func (c *Calculator) Calculate(ctx context.Context, input CalculateInput) (*FareCalculation, error) {
	pickupResolved, err := c.geoSvc.ResolveLocation(ctx, input.PickupLatitude, input.PickupLongitude)
	if err != nil {
		pickupResolved = &geography.ResolvedLocation{}
	}

	dropoffResolved, err := c.geoSvc.ResolveLocation(ctx, input.DropoffLatitude, input.DropoffLongitude)
	if err != nil {
		dropoffResolved = &geography.ResolvedLocation{}
	}

	var countryID, regionID, cityID, pickupZoneID, dropoffZoneID *uuid.UUID
	if pickupResolved.Country != nil {
		countryID = &pickupResolved.Country.ID
	}
	if pickupResolved.Region != nil {
		regionID = &pickupResolved.Region.ID
	}
	if pickupResolved.City != nil {
		cityID = &pickupResolved.City.ID
	}
	if pickupResolved.PricingZone != nil {
		pickupZoneID = &pickupResolved.PricingZone.ID
	}
	if dropoffResolved.PricingZone != nil {
		dropoffZoneID = &dropoffResolved.PricingZone.ID
	}

	pricing, err := c.resolver.Resolve(ctx, ResolveOptions{
		CountryID:  countryID,
		RegionID:   regionID,
		CityID:     cityID,
		ZoneID:     pickupZoneID,
		RideTypeID: input.RideTypeID,
	})
	if err != nil {
		return nil, err
	}

	versionID, err := c.repo.GetActiveVersionID(ctx)
	if err != nil {
		versionID = uuid.Nil
	}

	result := &FareCalculation{
		DistanceKm:       input.DistanceKm,
		DurationMin:      input.DurationMin,
		Currency:         input.Currency,
		BaseFare:         pricing.BaseFare,
		DistanceCharge:   input.DistanceKm * pricing.PerKmRate,
		TimeCharge:       float64(input.DurationMin) * pricing.PerMinuteRate,
		BookingFee:       pricing.BookingFee,
		PricingVersionID: versionID,
	}

	result.ZoneFeesTotal, result.ZoneFeesBreakdown = c.calculateZoneFees(
		ctx, versionID, pickupZoneID, dropoffZoneID, input.RideTypeID,
	)

	now := time.Now()
	result.TimeMultiplier = c.getTimeMultiplier(ctx, versionID, countryID, regionID, cityID, now)
	result.WeatherMultiplier = c.getWeatherMultiplier(ctx, versionID, countryID, regionID, cityID, input.WeatherCondition)
	result.EventMultiplier = c.getEventMultiplier(ctx, versionID, cityID, pickupZoneID, now)
	result.SurgeMultiplier = c.getSurgeMultiplier(ctx, versionID, countryID, regionID, cityID, input.DemandSupplyRatio, pricing)

	result.TotalMultiplier = result.TimeMultiplier * result.WeatherMultiplier * result.EventMultiplier * result.SurgeMultiplier

	baseAmount := result.BaseFare + result.DistanceCharge + result.TimeCharge + result.BookingFee
	result.Subtotal = (baseAmount * result.TotalMultiplier) + result.ZoneFeesTotal

	if result.Subtotal < pricing.MinimumFare {
		result.Subtotal = pricing.MinimumFare
	}

	result.TaxRatePct = pricing.TaxRatePct
	if pricing.TaxInclusive {
		result.TaxAmount = result.Subtotal - (result.Subtotal / (1 + pricing.TaxRatePct/100))
		result.TotalFare = result.Subtotal
	} else {
		result.TaxAmount = result.Subtotal * (pricing.TaxRatePct / 100)
		result.TotalFare = result.Subtotal + result.TaxAmount
	}

	if input.NegotiatedFare != nil {
		result.WasNegotiated = true
		result.NegotiatedFare = input.NegotiatedFare
		result.TotalFare = *input.NegotiatedFare
	}

	result.PlatformCommissionPct = pricing.PlatformCommissionPct
	result.PlatformCommission = result.TotalFare * (pricing.PlatformCommissionPct / 100)
	result.DriverEarnings = result.TotalFare - result.PlatformCommission

	result.roundValues()

	return result, nil
}

func (c *Calculator) calculateZoneFees(ctx context.Context, versionID uuid.UUID, pickupZoneID, dropoffZoneID *uuid.UUID, rideTypeID *uuid.UUID) (float64, []ZoneFeeBreakdown) {
	if versionID == uuid.Nil {
		return 0, nil
	}

	fees, err := c.repo.GetZoneFees(ctx, versionID, pickupZoneID, dropoffZoneID, rideTypeID)
	if err != nil {
		return 0, nil
	}

	var total float64
	var breakdown []ZoneFeeBreakdown

	for _, fee := range fees {
		isPickup := pickupZoneID != nil && fee.ZoneID == *pickupZoneID && fee.AppliesPickup
		isDropoff := dropoffZoneID != nil && fee.ZoneID == *dropoffZoneID && fee.AppliesDropoff

		if !isPickup && !isDropoff {
			continue
		}

		if fee.Schedule != nil && !c.isWithinSchedule(fee.Schedule) {
			continue
		}

		amount := fee.Amount
		total += amount

		zoneName := ""
		if isPickup && pickupZoneID != nil {
			zoneName, _ = c.repo.GetZoneName(ctx, *pickupZoneID)
		} else if isDropoff && dropoffZoneID != nil {
			zoneName, _ = c.repo.GetZoneName(ctx, *dropoffZoneID)
		}

		breakdown = append(breakdown, ZoneFeeBreakdown{
			ZoneID:   fee.ZoneID,
			ZoneName: zoneName,
			FeeType:  fee.FeeType,
			Amount:   amount,
		})
	}

	return total, breakdown
}

func (c *Calculator) getTimeMultiplier(ctx context.Context, versionID uuid.UUID, countryID, regionID, cityID *uuid.UUID, t time.Time) float64 {
	if versionID == uuid.Nil {
		return 1.0
	}

	multipliers, err := c.repo.GetTimeMultipliers(ctx, versionID, countryID, regionID, cityID, t)
	if err != nil || len(multipliers) == 0 {
		return 1.0
	}

	return multipliers[0].Multiplier
}

func (c *Calculator) getWeatherMultiplier(ctx context.Context, versionID uuid.UUID, countryID, regionID, cityID *uuid.UUID, condition string) float64 {
	if versionID == uuid.Nil || condition == "" || condition == WeatherClear {
		return 1.0
	}

	multiplier, err := c.repo.GetWeatherMultiplier(ctx, versionID, countryID, regionID, cityID, condition)
	if err != nil {
		return 1.0
	}

	return multiplier.Multiplier
}

func (c *Calculator) getEventMultiplier(ctx context.Context, versionID uuid.UUID, cityID, zoneID *uuid.UUID, t time.Time) float64 {
	if versionID == uuid.Nil {
		return 1.0
	}

	multipliers, err := c.repo.GetActiveEventMultipliers(ctx, versionID, cityID, zoneID, t)
	if err != nil || len(multipliers) == 0 {
		return 1.0
	}

	return multipliers[0].Multiplier
}

func (c *Calculator) getSurgeMultiplier(ctx context.Context, versionID uuid.UUID, countryID, regionID, cityID *uuid.UUID, ratio float64, pricing *ResolvedPricing) float64 {
	if versionID == uuid.Nil || ratio <= 0 {
		return 1.0
	}

	thresholds, err := c.repo.GetSurgeThresholds(ctx, versionID, countryID, regionID, cityID)
	if err != nil || len(thresholds) == 0 {
		return 1.0
	}

	for _, t := range thresholds {
		if ratio >= t.DemandSupplyRatioMin {
			if t.DemandSupplyRatioMax == nil || ratio < *t.DemandSupplyRatioMax {
				return ClampSurge(t.Multiplier, pricing)
			}
		}
	}

	return 1.0
}

func (c *Calculator) isWithinSchedule(schedule *FeeSchedule) bool {
	if schedule == nil {
		return true
	}

	now := time.Now()
	dayOfWeek := int(now.Weekday())

	dayMatch := false
	for _, d := range schedule.Days {
		if d == dayOfWeek {
			dayMatch = true
			break
		}
	}
	if !dayMatch {
		return false
	}

	currentTime := now.Format("15:04")
	startTime := schedule.StartTime
	endTime := schedule.EndTime

	if startTime > endTime {
		return currentTime >= startTime || currentTime <= endTime
	}

	return currentTime >= startTime && currentTime <= endTime
}

func (f *FareCalculation) roundValues() {
	f.BaseFare = math.Round(f.BaseFare*100) / 100
	f.DistanceCharge = math.Round(f.DistanceCharge*100) / 100
	f.TimeCharge = math.Round(f.TimeCharge*100) / 100
	f.BookingFee = math.Round(f.BookingFee*100) / 100
	f.ZoneFeesTotal = math.Round(f.ZoneFeesTotal*100) / 100
	f.Subtotal = math.Round(f.Subtotal*100) / 100
	f.TaxAmount = math.Round(f.TaxAmount*100) / 100
	f.TotalFare = math.Round(f.TotalFare*100) / 100
	f.PlatformCommission = math.Round(f.PlatformCommission*100) / 100
	f.DriverEarnings = math.Round(f.DriverEarnings*100) / 100

	for i := range f.ZoneFeesBreakdown {
		f.ZoneFeesBreakdown[i].Amount = math.Round(f.ZoneFeesBreakdown[i].Amount*100) / 100
	}
}

func (c *Calculator) QuickEstimate(ctx context.Context, distanceKm float64, durationMin int, pickupLatitude, pickupLongitude float64, rideTypeID *uuid.UUID) (float64, error) {
	resolved, _ := c.geoSvc.ResolveLocation(ctx, pickupLatitude, pickupLongitude)

	var countryID, regionID, cityID *uuid.UUID
	if resolved != nil {
		if resolved.Country != nil {
			countryID = &resolved.Country.ID
		}
		if resolved.Region != nil {
			regionID = &resolved.Region.ID
		}
		if resolved.City != nil {
			cityID = &resolved.City.ID
		}
	}

	pricing, err := c.resolver.Resolve(ctx, ResolveOptions{
		CountryID:  countryID,
		RegionID:   regionID,
		CityID:     cityID,
		RideTypeID: rideTypeID,
	})
	if err != nil {
		return 0, err
	}

	fare := pricing.BaseFare + (distanceKm * pricing.PerKmRate) + (float64(durationMin) * pricing.PerMinuteRate)

	if fare < pricing.MinimumFare {
		fare = pricing.MinimumFare
	}

	return math.Round(fare*100) / 100, nil
}

func (c *Calculator) GetPricingForLocation(ctx context.Context, latitude, longitude float64, rideTypeID *uuid.UUID) (*ResolvedPricing, error) {
	resolved, _ := c.geoSvc.ResolveLocation(ctx, latitude, longitude)

	var countryID, regionID, cityID, zoneID *uuid.UUID
	if resolved != nil {
		if resolved.Country != nil {
			countryID = &resolved.Country.ID
		}
		if resolved.Region != nil {
			regionID = &resolved.Region.ID
		}
		if resolved.City != nil {
			cityID = &resolved.City.ID
		}
		if resolved.PricingZone != nil {
			zoneID = &resolved.PricingZone.ID
		}
	}

	return c.resolver.Resolve(ctx, ResolveOptions{
		CountryID:  countryID,
		RegionID:   regionID,
		CityID:     cityID,
		ZoneID:     zoneID,
		RideTypeID: rideTypeID,
	})
}
