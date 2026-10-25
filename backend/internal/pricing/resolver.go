package pricing

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

type Resolver struct {
	repo RepositoryInterface
}

func NewResolver(repo RepositoryInterface) *Resolver {
	return &Resolver{repo: repo}
}

type ResolveOptions struct {
	CountryID  *uuid.UUID
	RegionID   *uuid.UUID
	CityID     *uuid.UUID
	ZoneID     *uuid.UUID
	RideTypeID *uuid.UUID
}

func (r *Resolver) Resolve(ctx context.Context, opts ResolveOptions) (*ResolvedPricing, error) {
	versionID, err := r.repo.GetActiveVersionID(ctx)
	if err != nil {
		resolved := DefaultPricing
		return &resolved, nil
	}

	configs, err := r.repo.GetPricingConfigsForResolution(
		ctx, versionID,
		opts.CountryID, opts.RegionID, opts.CityID, opts.ZoneID, opts.RideTypeID,
	)
	if err != nil {
		return nil, err
	}

	resolved := DefaultPricing
	resolved.VersionID = versionID
	resolved.CountryID = opts.CountryID
	resolved.RegionID = opts.RegionID
	resolved.CityID = opts.CityID
	resolved.ZoneID = opts.ZoneID
	resolved.RideTypeID = opts.RideTypeID
	resolved.InheritanceChain = []string{"defaults"}

	for i := len(configs) - 1; i >= 0; i-- {
		config := configs[i]
		r.applyConfig(&resolved, config)
	}

	return &resolved, nil
}

func (r *Resolver) applyConfig(resolved *ResolvedPricing, config *PricingConfig) {
	level := r.getConfigLevel(config)
	resolved.InheritanceChain = append(resolved.InheritanceChain, level)

	if config.BaseFare != nil {
		resolved.BaseFare = *config.BaseFare
	}
	if config.PerKmRate != nil {
		resolved.PerKmRate = *config.PerKmRate
	}
	if config.PerMinuteRate != nil {
		resolved.PerMinuteRate = *config.PerMinuteRate
	}
	if config.MinimumFare != nil {
		resolved.MinimumFare = *config.MinimumFare
	}
	if config.BookingFee != nil {
		resolved.BookingFee = *config.BookingFee
	}
	if config.PlatformCommissionPct != nil {
		resolved.PlatformCommissionPct = *config.PlatformCommissionPct
	}
	if config.DriverIncentivePct != nil {
		resolved.DriverIncentivePct = *config.DriverIncentivePct
	}
	if config.SurgeMinMultiplier != nil {
		resolved.SurgeMinMultiplier = *config.SurgeMinMultiplier
	}
	if config.SurgeMaxMultiplier != nil {
		resolved.SurgeMaxMultiplier = *config.SurgeMaxMultiplier
	}
	if config.TaxRatePct != nil {
		resolved.TaxRatePct = *config.TaxRatePct
	}
	if config.TaxInclusive != nil {
		resolved.TaxInclusive = *config.TaxInclusive
	}
	if len(config.CancellationFees) > 0 {
		resolved.CancellationFees = config.CancellationFees
	}
}

func (r *Resolver) getConfigLevel(config *PricingConfig) string {
	if config.ZoneID != nil {
		return fmt.Sprintf("zone:%s", config.ZoneID)
	}
	if config.CityID != nil {
		return fmt.Sprintf("city:%s", config.CityID)
	}
	if config.RegionID != nil {
		return fmt.Sprintf("region:%s", config.RegionID)
	}
	if config.CountryID != nil {
		return fmt.Sprintf("country:%s", config.CountryID)
	}
	return "global"
}

func (r *Resolver) ResolvePricingForLocation(ctx context.Context, latitude, longitude float64, rideTypeID *uuid.UUID) (*ResolvedPricing, error) {
	return r.Resolve(ctx, ResolveOptions{
		RideTypeID: rideTypeID,
	})
}

func GetCancellationFee(pricing *ResolvedPricing, minutesSinceRequest float64, baseFare float64) float64 {
	if len(pricing.CancellationFees) == 0 {
		return 0
	}

	var fee float64
	for _, cf := range pricing.CancellationFees {
		if minutesSinceRequest >= float64(cf.AfterMinutes) {
			if cf.FeeType == "percentage" {
				fee = baseFare * (cf.Fee / 100)
			} else {
				fee = cf.Fee
			}
		}
	}

	return fee
}

func ClampSurge(surge float64, pricing *ResolvedPricing) float64 {
	if surge < pricing.SurgeMinMultiplier {
		return pricing.SurgeMinMultiplier
	}
	if surge > pricing.SurgeMaxMultiplier {
		return pricing.SurgeMaxMultiplier
	}
	return surge
}
