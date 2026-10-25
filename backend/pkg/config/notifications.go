package config

type NotificationsConfig struct {
	TwilioAccountSID string
	TwilioAuthToken  string
	TwilioFromNumber string
	SMTPHost         string
	SMTPPort         string
	SMTPUsername     string
	SMTPPassword     string
	SMTPFromEmail    string
	SMTPFromName     string
}
