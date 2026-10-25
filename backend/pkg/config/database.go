package config

import "fmt"

type DatabaseConfig struct {
	Host        string
	Port        string
	User        string
	Password    string
	DBName      string
	SSLMode     string
	MaxConns    int
	MinConns    int
	ServiceName string
	Breaker     DatabaseBreakerConfig
}

type DatabaseBreakerConfig struct {
	Enabled          bool
	FailureThreshold int
	SuccessThreshold int
	TimeoutSeconds   int
	IntervalSeconds  int
}

func (c *DatabaseConfig) DSN() string {
	return fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		c.Host, c.Port, c.User, c.Password, c.DBName, c.SSLMode,
	)
}
