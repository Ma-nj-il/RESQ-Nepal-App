package ratings

import (
	"time"

	"github.com/google/uuid"
)

type RaterType string

const (
	RaterTypeRider  RaterType = "rider"
	RaterTypeDriver RaterType = "driver"
)

type RatingTag string

const (
	TagGreatConversation RatingTag = "great_conversation"
	TagSmoothDriving     RatingTag = "smooth_driving"
	TagCleanCar          RatingTag = "clean_car"
	TagKnowsRoute        RatingTag = "knows_route"
	TagFriendly          RatingTag = "friendly"
	TagProfessional      RatingTag = "professional"
	TagGoodMusic         RatingTag = "good_music"
	TagSafeDriver        RatingTag = "safe_driver"

	TagRoughDriving RatingTag = "rough_driving"
	TagDirtyCar     RatingTag = "dirty_car"
	TagRude         RatingTag = "rude"
	TagUnsafe       RatingTag = "unsafe"
	TagLostRoute    RatingTag = "lost_route"
	TagPhoneUse     RatingTag = "phone_use"
	TagLateArrival  RatingTag = "late_arrival"

	TagPoliteRider    RatingTag = "polite_rider"
	TagOnTime         RatingTag = "on_time"
	TagRespectful     RatingTag = "respectful"
	TagGoodDirections RatingTag = "good_directions"

	TagRudeRider   RatingTag = "rude_rider"
	TagMessyRider  RatingTag = "messy_rider"
	TagLatePickup  RatingTag = "late_pickup"
	TagSlammedDoor RatingTag = "slammed_door"
)

type Rating struct {
	ID        uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	RideID    uuid.UUID `json:"ride_id" gorm:"type:uuid;index"`
	RaterID   uuid.UUID `json:"rater_id" gorm:"type:uuid;index"`
	RateeID   uuid.UUID `json:"ratee_id" gorm:"type:uuid;index"`
	RaterType RaterType `json:"rater_type" gorm:"not null"`
	Score     int       `json:"score" gorm:"not null"`
	Comment   *string   `json:"comment,omitempty"`
	IsPublic  bool      `json:"is_public" gorm:"not null;default:true"`
	CreatedAt time.Time `json:"created_at" gorm:"not null"`
}

type RatingResponse struct {
	ID        uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	RatingID  uuid.UUID `json:"rating_id" gorm:"type:uuid;index"`
	UserID    uuid.UUID `json:"user_id" gorm:"type:uuid;index"`
	Comment   string    `json:"comment" gorm:"not null"`
	CreatedAt time.Time `json:"created_at" gorm:"not null"`
}

type UserRatingProfile struct {
	UserID             uuid.UUID   `json:"user_id"`
	AverageRating      float64     `json:"average_rating"`
	TotalRatings       int         `json:"total_ratings"`
	RatingDistribution map[int]int `json:"rating_distribution"`
	TopTags            []TagCount  `json:"top_tags"`
	RecentRatings      []Rating    `json:"recent_ratings,omitempty"`
	RatingTrend        float64     `json:"rating_trend"`
}

type TagCount struct {
	Tag   string `json:"tag"`
	Count int    `json:"count"`
}

type SubmitRatingRequest struct {
	RideID  uuid.UUID `json:"ride_id" binding:"required"`
	Score   int       `json:"score" binding:"required,min=1,max=5"`
	Comment *string   `json:"comment,omitempty"`
	Tags    []string  `json:"tags,omitempty"`
}

type RespondToRatingRequest struct {
	Comment string `json:"comment" binding:"required"`
}

type RatingPrompt struct {
	RideID         uuid.UUID   `json:"ride_id"`
	OtherUserName  string      `json:"other_user_name"`
	OtherUserPhoto *string     `json:"other_user_photo,omitempty"`
	SuggestedTags  []RatingTag `json:"suggested_tags"`
	AlreadyRated   bool        `json:"already_rated"`
}
