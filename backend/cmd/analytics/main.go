package main

import (
	"github.com/bikky-kc013/medi-ambulance/internal/analytics"
	"go.uber.org/fx"
)

func main() {
	app := fx.New(
		analytics.AppModule(),
	)
	app.Run()
}
