package geo

import (
	"github.com/uber/h3-go/v4"
)

const (
	H3ResolutionMatching = 9

	H3ResolutionSurge = 8

	H3ResolutionDemand = 7

	H3ResolutionCity = 6

	H3KRingMatching = 4

	H3KRingSurge = 2
)

func LatLngToCell(latitude, longitude float64, resolution int) h3.Cell {
	latLng := h3.NewLatLng(latitude, longitude)
	cell, err := h3.LatLngToCell(latLng, resolution)
	if err != nil {
		return 0
	}
	return cell
}

func CellToLatLng(cell h3.Cell) (latitude, longitude float64) {
	latLng, err := cell.LatLng()
	if err != nil {
		return 0, 0
	}
	return latLng.Lat, latLng.Lng
}

func GetKRingCells(latitude, longitude float64, resolution, k int) []h3.Cell {
	origin := LatLngToCell(latitude, longitude, resolution)
	cells, err := origin.GridDisk(k)
	if err != nil {
		return []h3.Cell{origin}
	}
	return cells
}

func GetKRingCellStrings(latitude, longitude float64, resolution, k int) []string {
	cells := GetKRingCells(latitude, longitude, resolution, k)
	result := make([]string, len(cells))
	for i, cell := range cells {
		result[i] = cell.String()
	}
	return result
}

func CellToString(cell h3.Cell) string {
	return cell.String()
}

func StringToCell(s string) h3.Cell {
	return h3.CellFromString(s)
}

func GetSurgeZone(latitude, longitude float64) string {
	return LatLngToCell(latitude, longitude, H3ResolutionSurge).String()
}

func GetDemandZone(latitude, longitude float64) string {
	return LatLngToCell(latitude, longitude, H3ResolutionDemand).String()
}

func GetMatchingCell(latitude, longitude float64) string {
	return LatLngToCell(latitude, longitude, H3ResolutionMatching).String()
}

func CellDistance(a, b h3.Cell) int {
	dist, err := a.GridDistance(b)
	if err != nil {
		return -1
	}
	return dist
}

func GetNeighborCells(cell h3.Cell) []h3.Cell {
	ring, err := cell.GridDisk(1)
	if err != nil {
		return nil
	}
	neighbors := make([]h3.Cell, 0, len(ring)-1)
	for _, c := range ring {
		if c != cell {
			neighbors = append(neighbors, c)
		}
	}
	return neighbors
}

func CellArea(cell h3.Cell) float64 {
	area, err := h3.CellAreaKm2(cell)
	if err != nil {
		return 0
	}
	return area
}
