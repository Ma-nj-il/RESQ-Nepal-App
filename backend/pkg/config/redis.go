package config

import "fmt"

type RedisConfig struct {
	Host     string
	Port     string
	Password string
	DB       int
}

func (c *RedisConfig) RedisAddr() string {
	return fmt.Sprintf("%s:%s", c.Host, c.Port)
}
