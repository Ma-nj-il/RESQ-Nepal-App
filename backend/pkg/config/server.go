package config

type ServerConfig struct {
	Port         string
	Environment  string
	ServiceName  string
	ReadTimeout  int
	WriteTimeout int
	CORSOrigins  string
}
