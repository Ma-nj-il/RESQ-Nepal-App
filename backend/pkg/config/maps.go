package config

type MapsConfig struct {
	Enabled             bool
	PrimaryProvider     string
	GoogleAPIKey        string
	HEREAPIKey          string
	CacheEnabled        bool
	CacheTTLSeconds     int
	TrafficEnabled      bool
	TrafficRefreshSecs  int
	FallbackToHaversine bool
}
