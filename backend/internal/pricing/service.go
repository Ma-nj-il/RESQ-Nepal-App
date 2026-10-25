package pricing

import (
	"context"
	"fmt"
	"math"

	"github.com/bikky-kc013/medi-ambulance/internal/geography"
	"github.com/google/uuid"
)

type Service struct {
	repo       RepositoryInterface
	resolver   *Resolver
	calculator *Calculator
	geoSvc     *geography.Service
}

func NewService(repo RepositoryInterface, geoSvc *geography.Service) *Service {
	resolver := NewResolver(repo)
	calculator := NewCalculator(repo, resolver, geoSvc)

	return &Service{
		repo:       repo,
		resolver:   resolver,
		calculator: calculator,
		geoSvc:     geoSvc,
	}
}

func (s *Service) CalculateFare(ctx context.Context, input CalculateInput) (*FareCalculation, error) {
	return s.calculator.Calculate(ctx, input)
}

func (s *Service) GetEstimate(ctx context.Context, req EstimateRequest) (*EstimateResponse, error) {
	distanceKm := haversineDistance(
		req.PickupLatitude, req.PickupLongitude,
		req.DropoffLatitude, req.DropoffLongitude,
	)

	durationMin := int(math.Ceil((distanceKm / 40.0) * 60))
	if durationMin < 1 {
		durationMin = 1
	}

	currencyCode := "NPR"
	if s.geoSvc != nil {
		if curr, err := s.geoSvc.GetCurrencyForLocation(ctx, req.PickupLatitude, req.PickupLongitude); err == nil {
			currencyCode = curr
		}
	}

	calculation, err := s.calculator.Calculate(ctx, CalculateInput{
		PickupLatitude:   req.PickupLatitude,
		PickupLongitude:  req.PickupLongitude,
		DropoffLatitude:  req.DropoffLatitude,
		DropoffLongitude: req.DropoffLongitude,
		DistanceKm:       distanceKm,
		DurationMin:      durationMin,
		RideTypeID:       req.RideTypeID,
		Currency:         currencyCode,
	})
	if err != nil {
		return nil, err
	}

	pricing, _ := s.calculator.GetPricingForLocation(ctx, req.PickupLatitude, req.PickupLongitude, req.RideTypeID)
	minFare := DefaultPricing.MinimumFare
	if pricing != nil {
		minFare = pricing.MinimumFare
	}

	return &EstimateResponse{
		Currency:         currencyCode,
		EstimatedFare:    calculation.TotalFare,
		MinimumFare:      minFare,
		SurgeMultiplier:  calculation.TotalMultiplier,
		DistanceKm:       distanceKm,
		EstimatedMinutes: durationMin,
		FareBreakdown:    calculation,
	}, nil
}

func (s *Service) GetPricing(ctx context.Context, latitude, longitude float64, rideTypeID *uuid.UUID) (*ResolvedPricing, error) {
	return s.calculator.GetPricingForLocation(ctx, latitude, longitude, rideTypeID)
}

func (s *Service) GetBulkEstimate(ctx context.Context, req BulkEstimateRequest, rideTypes []RideTypeInfo) (*BulkEstimateResponse, error) {
	distanceKm := haversineDistance(
		req.PickupLatitude, req.PickupLongitude,
		req.DropoffLatitude, req.DropoffLongitude,
	)

	durationMin := int(math.Ceil((distanceKm / 40.0) * 60))
	if durationMin < 1 {
		durationMin = 1
	}

	currencyCode := "USD"
	if s.geoSvc != nil {
		if curr, err := s.geoSvc.GetCurrencyForLocation(ctx, req.PickupLatitude, req.PickupLongitude); err == nil {
			currencyCode = curr
		}
	}

	estimates := make([]RideTypeEstimate, 0, len(rideTypes))
	for _, rideType := range rideTypes {
		rideTypeID := rideType.ID
		calculation, err := s.calculator.Calculate(ctx, CalculateInput{
			PickupLatitude:   req.PickupLatitude,
			PickupLongitude:  req.PickupLongitude,
			DropoffLatitude:  req.DropoffLatitude,
			DropoffLongitude: req.DropoffLongitude,
			DistanceKm:       distanceKm,
			DurationMin:      durationMin,
			RideTypeID:       &rideTypeID,
			Currency:         currencyCode,
		})
		if err != nil {
			continue
		}

		pricing, _ := s.calculator.GetPricingForLocation(ctx, req.PickupLatitude, req.PickupLongitude, &rideTypeID)
		minFare := DefaultPricing.MinimumFare
		if pricing != nil {
			minFare = pricing.MinimumFare
		}

		estimates = append(estimates, RideTypeEstimate{
			RideTypeID:      rideType.ID,
			RideTypeName:    rideType.Name,
			Description:     rideType.Description,
			Capacity:        rideType.Capacity,
			IconURL:         rideType.IconURL,
			Currency:        currencyCode,
			EstimatedFare:   calculation.TotalFare,
			MinimumFare:     minFare,
			SurgeMultiplier: calculation.TotalMultiplier,
			FareBreakdown:   calculation,
		})
	}

	return &BulkEstimateResponse{
		DistanceKm:       distanceKm,
		EstimatedMinutes: durationMin,
		RideOptions:      estimates,
	}, nil
}

func (s *Service) ValidateNegotiatedPrice(ctx context.Context, req EstimateRequest, negotiatedPrice float64) error {
	estimate, err := s.GetEstimate(ctx, req)
	if err != nil {
		return err
	}

	minAllowed := estimate.EstimatedFare * 0.70
	maxAllowed := estimate.EstimatedFare * 1.50

	if negotiatedPrice < minAllowed {
		return fmt.Errorf("negotiated price %.2f is below minimum allowed %.2f", negotiatedPrice, minAllowed)
	}

	if negotiatedPrice > maxAllowed {
		return fmt.Errorf("negotiated price %.2f exceeds maximum allowed %.2f", negotiatedPrice, maxAllowed)
	}

	return nil
}

func (s *Service) GetSurgeInfo(ctx context.Context, latitude, longitude float64) (map[string]interface{}, error) {
	resolved, _ := s.geoSvc.ResolveLocation(ctx, latitude, longitude)

	pricing, err := s.calculator.GetPricingForLocation(ctx, latitude, longitude, nil)
	if err != nil {
		pricing = &DefaultPricing
	}

	info := map[string]interface{}{
		"current_surge":     1.0,
		"surge_min":         pricing.SurgeMinMultiplier,
		"surge_max":         pricing.SurgeMaxMultiplier,
		"surge_active":      false,
		"surge_reason":      nil,
		"expected_duration": nil,
	}

	if resolved != nil {
		if resolved.City != nil {
			info["city"] = resolved.City.Name
		}
		if resolved.PricingZone != nil {
			info["zone"] = resolved.PricingZone.Name
		}
	}

	return info, nil
}

func (s *Service) GetCancellationFee(ctx context.Context, latitude, longitude float64, minutesSinceRequest float64, estimatedFare float64) (float64, error) {
	pricing, err := s.calculator.GetPricingForLocation(ctx, latitude, longitude, nil)
	if err != nil {
		pricing = &DefaultPricing
	}

	return GetCancellationFee(pricing, minutesSinceRequest, estimatedFare), nil
}

func (s *Service) GetCommissionRate(ctx context.Context, latitude, longitude float64) (float64, error) {
	pricing, err := s.calculator.GetPricingForLocation(ctx, latitude, longitude, nil)
	if err != nil {
		return DefaultPricing.PlatformCommissionPct / 100, nil
	}
	return pricing.PlatformCommissionPct / 100, nil
}

func (s *Service) CalculateDriverEarnings(ctx context.Context, latitude, longitude float64, fare float64) (float64, error) {
	pricing, err := s.calculator.GetPricingForLocation(ctx, latitude, longitude, nil)
	if err != nil {
		pricing = &DefaultPricing
	}

	commission := fare * (pricing.PlatformCommissionPct / 100)
	return fare - commission, nil
}

func haversineDistance(latitude1, longitude1, latitude2, longitude2 float64) float64 {
	const R = 6371

	latitude1Rad := latitude1 * math.Pi / 180
	latitude2Rad := latitude2 * math.Pi / 180
	deltaLatitude := (latitude2 - latitude1) * math.Pi / 180
	deltaLongitude := (longitude2 - longitude1) * math.Pi / 180

	a := math.Sin(deltaLatitude/2)*math.Sin(deltaLatitude/2) +
		math.Cos(latitude1Rad)*math.Cos(latitude2Rad)*
			math.Sin(deltaLongitude/2)*math.Sin(deltaLongitude/2)

	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return R * c
}
