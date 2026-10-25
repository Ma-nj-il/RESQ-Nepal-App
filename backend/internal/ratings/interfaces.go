package ratings

import (
	"context"

	"github.com/google/uuid"
)

// RepositoryInterface defines the repository methods for ratings
type RepositoryInterface interface {
	CreateRating(ctx context.Context, rating *Rating) error
	GetRatingByRideAndRater(ctx context.Context, rideID, raterID uuid.UUID) (*Rating, error)
	GetRatingByID(ctx context.Context, id uuid.UUID) (*Rating, error)
	GetAverageRating(ctx context.Context, userID uuid.UUID) (float64, int, error)
	GetRatingDistribution(ctx context.Context, userID uuid.UUID) (map[int]int, error)
	GetTopTags(ctx context.Context, userID uuid.UUID, limit int) ([]TagCount, error)
	GetRecentRatings(ctx context.Context, userID uuid.UUID, limit int) ([]Rating, error)
	GetRatingsGiven(ctx context.Context, userID uuid.UUID, limit, offset int) ([]Rating, int, error)
	GetRatingTrend(ctx context.Context, userID uuid.UUID) (float64, error)
	CreateRatingResponse(ctx context.Context, resp *RatingResponse) error
}
