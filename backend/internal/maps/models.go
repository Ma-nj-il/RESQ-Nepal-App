package maps

import (
	"time"
)

type Provider string

const (
	ProviderGoogle           Provider = "google"
	ProviderHERE             Provider = "here"
	ProviderOpenRouteService Provider = "openrouteservice"
	ProviderMapbox           Provider = "mapbox"
)

type TrafficLevel string

const (
	TrafficFreeFlow TrafficLevel = "free_flow"
	TrafficLight    TrafficLevel = "light"
	TrafficModerate TrafficLevel = "moderate"
	TrafficHeavy    TrafficLevel = "heavy"
	TrafficSevere   TrafficLevel = "severe"
	TrafficBlocked  TrafficLevel = "blocked"
)

type Coordinate struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type RouteRequest struct {
	Origin        Coordinate   `json:"origin"`
	Destination   Coordinate   `json:"destination"`
	Waypoints     []Coordinate `json:"waypoints,omitempty"`
	DepartureTime *time.Time   `json:"departure_time,omitempty"`
	ArrivalTime   *time.Time   `json:"arrival_time,omitempty"`
	Alternatives  bool         `json:"alternatives,omitempty"`
	AvoidTolls    bool         `json:"avoid_tolls,omitempty"`
	AvoidHighways bool         `json:"avoid_highways,omitempty"`
	AvoidFerries  bool         `json:"avoid_ferries,omitempty"`
	TrafficModel  string       `json:"traffic_model,omitempty"`
	Units         string       `json:"units,omitempty"`
	VehicleType   string       `json:"vehicle_type,omitempty"`
}

type RouteResponse struct {
	Routes      []Route   `json:"routes"`
	Provider    Provider  `json:"provider"`
	RequestedAt time.Time `json:"requested_at"`
	CacheHit    bool      `json:"cache_hit,omitempty"`
}

type Route struct {
	// Core metrics
	DistanceMeters  int     `json:"distance_meters"`
	DistanceKm      float64 `json:"distance_km"`
	DurationSeconds int     `json:"duration_seconds"`
	DurationMinutes float64 `json:"duration_minutes"`

	DurationInTraffic    int     `json:"duration_in_traffic_seconds,omitempty"`
	DurationInTrafficMin float64 `json:"duration_in_traffic_minutes,omitempty"`
	TrafficDelaySeconds  int     `json:"traffic_delay_seconds,omitempty"`

	EncodedPolyline string       `json:"encoded_polyline,omitempty"`
	Coordinates     []Coordinate `json:"coordinates,omitempty"`
	BoundingBox     *BoundingBox `json:"bounding_box,omitempty"`

	Legs     []RouteLeg `json:"legs,omitempty"`
	Summary  string     `json:"summary,omitempty"`
	Warnings []string   `json:"warnings,omitempty"`

	TollInfo *TollInfo `json:"toll_info,omitempty"`

	TrafficLevel    TrafficLevel     `json:"traffic_level,omitempty"`
	TrafficSegments []TrafficSegment `json:"traffic_segments,omitempty"`
}

type RouteLeg struct {
	StartLocation     Coordinate   `json:"start_location"`
	EndLocation       Coordinate   `json:"end_location"`
	StartAddress      string       `json:"start_address,omitempty"`
	EndAddress        string       `json:"end_address,omitempty"`
	DistanceMeters    int          `json:"distance_meters"`
	DurationSeconds   int          `json:"duration_seconds"`
	DurationInTraffic int          `json:"duration_in_traffic_seconds,omitempty"`
	Steps             []RouteStep  `json:"steps,omitempty"`
	TrafficLevel      TrafficLevel `json:"traffic_level,omitempty"`
}

type RouteStep struct {
	Instruction     string     `json:"instruction"`
	Maneuver        string     `json:"maneuver,omitempty"`
	DistanceMeters  int        `json:"distance_meters"`
	DurationSeconds int        `json:"duration_seconds"`
	StartLocation   Coordinate `json:"start_location"`
	EndLocation     Coordinate `json:"end_location"`
	RoadName        string     `json:"road_name,omitempty"`
	EncodedPolyline string     `json:"encoded_polyline,omitempty"`
}

type BoundingBox struct {
	Northeast Coordinate `json:"northeast"`
	Southwest Coordinate `json:"southwest"`
}

type TollInfo struct {
	HasTolls      bool     `json:"has_tolls"`
	EstimatedCost *float64 `json:"estimated_cost,omitempty"`
	Currency      string   `json:"currency,omitempty"`
	TollRoads     []string `json:"toll_roads,omitempty"`
}

type TrafficSegment struct {
	StartIndex       int          `json:"start_index"`
	EndIndex         int          `json:"end_index"`
	StartLocation    Coordinate   `json:"start_location"`
	EndLocation      Coordinate   `json:"end_location"`
	TrafficLevel     TrafficLevel `json:"traffic_level"`
	SpeedKmh         float64      `json:"speed_kmh,omitempty"`
	FreeFlowSpeedKmh float64      `json:"free_flow_speed_kmh,omitempty"`
	DelaySeconds     int          `json:"delay_seconds,omitempty"`
}

type ETARequest struct {
	Origin        Coordinate `json:"origin"`
	Destination   Coordinate `json:"destination"`
	DepartureTime *time.Time `json:"departure_time,omitempty"`
	TrafficModel  string     `json:"traffic_model,omitempty"`
}

type ETAResponse struct {
	DistanceKm          float64      `json:"distance_km"`
	DistanceMeters      int          `json:"distance_meters"`
	DurationMinutes     float64      `json:"duration_minutes"`
	DurationSeconds     int          `json:"duration_seconds"`
	DurationInTraffic   float64      `json:"duration_in_traffic_minutes"`
	TrafficDelayMinutes float64      `json:"traffic_delay_minutes"`
	TrafficLevel        TrafficLevel `json:"traffic_level"`
	EstimatedArrival    time.Time    `json:"estimated_arrival"`
	Provider            Provider     `json:"provider"`
	Confidence          float64      `json:"confidence"`
	CacheHit            bool         `json:"cache_hit"`
}

type DistanceMatrixRequest struct {
	Origins       []Coordinate `json:"origins"`
	Destinations  []Coordinate `json:"destinations"`
	DepartureTime *time.Time   `json:"departure_time,omitempty"`
	TrafficModel  string       `json:"traffic_model,omitempty"`
}

type DistanceMatrixResponse struct {
	Rows        []DistanceMatrixRow `json:"rows"`
	Provider    Provider            `json:"provider"`
	RequestedAt time.Time           `json:"requested_at"`
}

type DistanceMatrixRow struct {
	Elements []DistanceMatrixElement `json:"elements"`
}

type DistanceMatrixElement struct {
	Status            string       `json:"status"`
	DistanceKm        float64      `json:"distance_km"`
	DistanceMeters    int          `json:"distance_meters"`
	DurationMinutes   float64      `json:"duration_minutes"`
	DurationSeconds   int          `json:"duration_seconds"`
	DurationInTraffic float64      `json:"duration_in_traffic_minutes,omitempty"`
	TrafficLevel      TrafficLevel `json:"traffic_level,omitempty"`
}

type TrafficFlowRequest struct {
	Location     Coordinate   `json:"location"`
	RadiusMeters int          `json:"radius_meters,omitempty"`
	BoundingBox  *BoundingBox `json:"bounding_box,omitempty"`
}

type TrafficFlowResponse struct {
	Segments     []TrafficFlowSegment `json:"segments"`
	OverallLevel TrafficLevel         `json:"overall_level"`
	UpdatedAt    time.Time            `json:"updated_at"`
	Provider     Provider             `json:"provider"`
}

type TrafficFlowSegment struct {
	RoadName         string       `json:"road_name,omitempty"`
	Coordinates      []Coordinate `json:"coordinates"`
	CurrentSpeedKmh  float64      `json:"current_speed_kmh"`
	FreeFlowSpeedKmh float64      `json:"free_flow_speed_kmh"`
	TrafficLevel     TrafficLevel `json:"traffic_level"`
	JamFactor        float64      `json:"jam_factor"`
}

type GeocodingRequest struct {
	Address    string            `json:"address,omitempty"`
	Coordinate *Coordinate       `json:"coordinate,omitempty"`
	Language   string            `json:"language,omitempty"`
	Region     string            `json:"region,omitempty"`
	Components map[string]string `json:"components,omitempty"`
}

type GeocodingResponse struct {
	Results  []GeocodingResult `json:"results"`
	Provider Provider          `json:"provider"`
}

type GeocodingResult struct {
	FormattedAddress  string             `json:"formatted_address"`
	Coordinate        Coordinate         `json:"coordinate"`
	PlaceID           string             `json:"place_id,omitempty"`
	Types             []string           `json:"types,omitempty"`
	AddressComponents []AddressComponent `json:"address_components,omitempty"`
	Confidence        float64            `json:"confidence"`
}

type AddressComponent struct {
	LongName  string   `json:"long_name"`
	ShortName string   `json:"short_name"`
	Types     []string `json:"types"`
}

type PlaceSearchRequest struct {
	Query        string      `json:"query,omitempty"`
	Location     *Coordinate `json:"location,omitempty"`
	RadiusMeters int         `json:"radius_meters,omitempty"`
	Types        []string    `json:"types,omitempty"`
	Language     string      `json:"language,omitempty"`
	OpenNow      bool        `json:"open_now,omitempty"`
}

type PlaceSearchResponse struct {
	Results       []Place  `json:"results"`
	NextPageToken string   `json:"next_page_token,omitempty"`
	Provider      Provider `json:"provider"`
}

type Place struct {
	PlaceID          string        `json:"place_id"`
	Name             string        `json:"name"`
	FormattedAddress string        `json:"formatted_address"`
	Coordinate       Coordinate    `json:"coordinate"`
	Types            []string      `json:"types,omitempty"`
	Rating           *float64      `json:"rating,omitempty"`
	UserRatingsTotal *int          `json:"user_ratings_total,omitempty"`
	PriceLevel       *int          `json:"price_level,omitempty"`
	OpeningHours     *OpeningHours `json:"opening_hours,omitempty"`
	Icon             string        `json:"icon,omitempty"`
	Photos           []PhotoRef    `json:"photos,omitempty"`
}

type OpeningHours struct {
	OpenNow     bool     `json:"open_now"`
	WeekdayText []string `json:"weekday_text,omitempty"`
}

type PhotoRef struct {
	Reference    string   `json:"reference"`
	Width        int      `json:"width"`
	Height       int      `json:"height"`
	Attributions []string `json:"attributions,omitempty"`
}

type TrafficIncident struct {
	ID            string     `json:"id"`
	Type          string     `json:"type"`
	Severity      string     `json:"severity"`
	Location      Coordinate `json:"location"`
	Description   string     `json:"description"`
	StartTime     *time.Time `json:"start_time,omitempty"`
	EndTime       *time.Time `json:"end_time,omitempty"`
	RoadClosed    bool       `json:"road_closed"`
	AffectedRoads []string   `json:"affected_roads,omitempty"`
	DelayMinutes  int        `json:"delay_minutes,omitempty"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type TrafficIncidentsRequest struct {
	BoundingBox  *BoundingBox `json:"bounding_box,omitempty"`
	Location     *Coordinate  `json:"location,omitempty"`
	RadiusMeters int          `json:"radius_meters,omitempty"`
	Types        []string     `json:"types,omitempty"`
}

type TrafficIncidentsResponse struct {
	Incidents []TrafficIncident `json:"incidents"`
	UpdatedAt time.Time         `json:"updated_at"`
	Provider  Provider          `json:"provider"`
}

type SnapToRoadRequest struct {
	Path        []Coordinate `json:"path"`
	Interpolate bool         `json:"interpolate,omitempty"`
}

type SnapToRoadResponse struct {
	SnappedPoints []SnappedPoint `json:"snapped_points"`
	Provider      Provider       `json:"provider"`
}

type SnappedPoint struct {
	Location      Coordinate `json:"location"`
	OriginalIndex int        `json:"original_index,omitempty"`
	PlaceID       string     `json:"place_id,omitempty"`
	RoadName      string     `json:"road_name,omitempty"`
}

type SpeedLimit struct {
	PlaceID       string `json:"place_id"`
	SpeedLimitKmh int    `json:"speed_limit_kmh"`
	SpeedLimitMph int    `json:"speed_limit_mph"`
}

type SpeedLimitsRequest struct {
	Path     []Coordinate `json:"path,omitempty"`
	PlaceIDs []string     `json:"place_ids,omitempty"`
}

type SpeedLimitsResponse struct {
	SpeedLimits   []SpeedLimit   `json:"speed_limits"`
	SnappedPoints []SnappedPoint `json:"snapped_points,omitempty"`
	Provider      Provider       `json:"provider"`
}
