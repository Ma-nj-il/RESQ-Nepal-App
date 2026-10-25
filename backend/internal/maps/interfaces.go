package maps

import (
	"context"
)

type ETAProvider interface {
	GetETA(ctx context.Context, originLatitude, originLongitude, destLatitude, destLongitude float64) (*ETAResult, error)

	GetTrafficLevel(ctx context.Context, latitude, longitude float64) (TrafficLevel, error)
}

type ETAResult struct {
	DistanceKm      float64      `json:"distance_km"`
	DistanceMeters  int          `json:"distance_meters"`
	DurationMinutes float64      `json:"duration_minutes"`
	DurationSeconds int          `json:"duration_seconds"`
	TrafficLevel    TrafficLevel `json:"traffic_level"`
	Confidence      float64      `json:"confidence"`
	RoutePolyline   string       `json:"route_polyline,omitempty"`
}

type ServiceETAProvider struct {
	service *Service
}

func NewServiceETAProvider(service *Service) *ServiceETAProvider {
	return &ServiceETAProvider{service: service}
}

func (p *ServiceETAProvider) GetETA(ctx context.Context, originLatitude, originLongitude, destLatitude, destLongitude float64) (*ETAResult, error) {
	req := &ETARequest{
		Origin:      Coordinate{Latitude: originLatitude, Longitude: originLongitude},
		Destination: Coordinate{Latitude: destLatitude, Longitude: destLongitude},
	}

	resp, err := p.service.GetTrafficAwareETA(ctx, req.Origin, req.Destination)
	if err != nil {
		return nil, err
	}

	return &ETAResult{
		DistanceKm:      resp.DistanceKm,
		DistanceMeters:  resp.DistanceMeters,
		DurationMinutes: resp.DurationInTraffic,
		DurationSeconds: int(resp.DurationInTraffic * 60),
		TrafficLevel:    resp.TrafficLevel,
		Confidence:      resp.Confidence,
	}, nil
}

func (p *ServiceETAProvider) GetTrafficLevel(ctx context.Context, latitude, longitude float64) (TrafficLevel, error) {
	req := &TrafficFlowRequest{
		Location:     Coordinate{Latitude: latitude, Longitude: longitude},
		RadiusMeters: 5000,
	}

	resp, err := p.service.GetTrafficFlow(ctx, req)
	if err != nil {
		return TrafficModerate, err
	}

	return resp.OverallLevel, nil
}

type HaversineETAProvider struct {
	avgSpeedKmh float64
}

func NewHaversineETAProvider(avgSpeedKmh float64) *HaversineETAProvider {
	if avgSpeedKmh <= 0 {
		avgSpeedKmh = 35.0
	}
	return &HaversineETAProvider{avgSpeedKmh: avgSpeedKmh}
}

func (p *HaversineETAProvider) GetETA(ctx context.Context, originLatitude, originLongitude, destLatitude, destLongitude float64) (*ETAResult, error) {
	distance := haversineDistance(originLatitude, originLongitude, destLatitude, destLongitude)
	durationMinutes := (distance / p.avgSpeedKmh) * 60

	return &ETAResult{
		DistanceKm:      distance,
		DistanceMeters:  int(distance * 1000),
		DurationMinutes: durationMinutes,
		DurationSeconds: int(durationMinutes * 60),
		TrafficLevel:    TrafficModerate,
		Confidence:      0.5,
	}, nil
}

func (p *HaversineETAProvider) GetTrafficLevel(ctx context.Context, latitude, longitude float64) (TrafficLevel, error) {
	return TrafficModerate, nil
}

func (t TrafficLevel) TrafficMultiplier() float64 {
	switch t {
	case TrafficFreeFlow:
		return 1.0
	case TrafficLight:
		return 1.05
	case TrafficModerate:
		return 1.1
	case TrafficHeavy:
		return 1.2
	case TrafficSevere:
		return 1.35
	case TrafficBlocked:
		return 1.5
	default:
		return 1.1
	}
}

func (t TrafficLevel) IsHighTraffic() bool {
	return t == TrafficHeavy || t == TrafficSevere || t == TrafficBlocked
}
