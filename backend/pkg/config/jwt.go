package config

type JWTConfig struct {
	Secret         string
	Expiration     int
	KeyFile        string
	RotationHours  int
	GraceHours     int
	RefreshMinutes int
}
