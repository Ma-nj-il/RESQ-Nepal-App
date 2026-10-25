package ratings

import (
	"context"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/database"
	"github.com/google/uuid"
)

type Repository struct {
	db *database.DBPool
}

func NewRepository(db *database.DBPool) *Repository {
	return &Repository{db: db}
}

func (r *Repository) CreateRating(ctx context.Context, rating *Rating) error {
	return r.db.Primary.WithContext(ctx).Create(rating).Error
}

func (r *Repository) GetRatingByRideAndRater(ctx context.Context, rideID, raterID uuid.UUID) (*Rating, error) {
	var rating Rating
	err := r.db.Primary.WithContext(ctx).Where("ride_id = ? AND rater_id = ?", rideID, raterID).First(&rating).Error
	if err != nil {
		return nil, err
	}
	return &rating, nil
}

func (r *Repository) GetRatingByID(ctx context.Context, id uuid.UUID) (*Rating, error) {
	var rating Rating
	err := r.db.Primary.WithContext(ctx).First(&rating, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	return &rating, nil
}

func (r *Repository) GetAverageRating(ctx context.Context, userID uuid.UUID) (float64, int, error) {
	var count int64
	var avg float64
	err := r.db.Primary.WithContext(ctx).Model(&Rating{}).Where("ratee_id = ?", userID).
		Select("COALESCE(AVG(score), 0)").Scan(&avg).
		Count(&count).Error
	return avg, int(count), err
}

// GetRatingDistribution returns count per score (1-5)
func (r *Repository) GetRatingDistribution(ctx context.Context, userID uuid.UUID) (map[int]int, error) {
	var results []struct {
		Score int
		Count int
	}
	err := r.db.Primary.WithContext(ctx).Model(&Rating{}).
		Select("score, COUNT(*) as count").
		Where("ratee_id = ?", userID).
		Group("score").Order("score").
		Scan(&results).Error
	if err != nil {
		return nil, err
	}

	dist := map[int]int{1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
	for _, res := range results {
		dist[res.Score] = res.Count
	}
	return dist, nil
}

// GetTopTags returns the most common tags for a user
func (r *Repository) GetTopTags(ctx context.Context, userID uuid.UUID, limit int) ([]TagCount, error) {
	var tags []TagCount
	// Since GORM doesn't natively handle UNNEST well without raw SQL, we'll use raw SQL through GORM
	err := r.db.Primary.WithContext(ctx).Raw(`
		SELECT tag, COUNT(*) as count
		FROM ratings, UNNEST(tags) as tag
		WHERE ratee_id = ?
		GROUP BY tag
		ORDER BY count DESC
		LIMIT ?`, userID, limit).Scan(&tags).Error
	return tags, err
}

// GetRecentRatings returns recent ratings received by a user
func (r *Repository) GetRecentRatings(ctx context.Context, userID uuid.UUID, limit int) ([]Rating, error) {
	var ratings []Rating
	err := r.db.Primary.WithContext(ctx).
		Where("ratee_id = ? AND is_public = ?", userID, true).
		Order("created_at DESC").
		Limit(limit).
		Find(&ratings).Error
	return ratings, err
}

// GetRatingsGiven returns ratings a user has given
func (r *Repository) GetRatingsGiven(ctx context.Context, userID uuid.UUID, limit, offset int) ([]Rating, int, error) {
	var total int64
	query := r.db.Primary.WithContext(ctx).Model(&Rating{}).Where("rater_id = ?", userID)

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var ratings []Rating
	err := query.Order("created_at DESC").Limit(limit).Offset(offset).Find(&ratings).Error
	return ratings, int(total), err
}

// GetRatingTrend compares current month average to last month
func (r *Repository) GetRatingTrend(ctx context.Context, userID uuid.UUID) (float64, error) {
	now := time.Now()
	firstOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	firstOfLastMonth := firstOfMonth.AddDate(0, -1, 0)

	var currentAvg, lastAvg float64

	r.db.Primary.WithContext(ctx).Model(&Rating{}).
		Select("COALESCE(AVG(score), 0)").
		Where("ratee_id = ? AND created_at >= ?", userID, firstOfMonth).
		Scan(&currentAvg)

	r.db.Primary.WithContext(ctx).Model(&Rating{}).
		Select("COALESCE(AVG(score), 0)").
		Where("ratee_id = ? AND created_at >= ? AND created_at < ?", userID, firstOfLastMonth, firstOfMonth).
		Scan(&lastAvg)

	if lastAvg == 0 {
		return 0, nil
	}
	return currentAvg - lastAvg, nil
}

// CreateRatingResponse creates a response to a rating
func (r *Repository) CreateRatingResponse(ctx context.Context, resp *RatingResponse) error {
	return r.db.Primary.WithContext(ctx).Create(resp).Error
}
