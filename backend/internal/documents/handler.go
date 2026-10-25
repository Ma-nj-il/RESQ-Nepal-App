package documents

import (
	"context"
	"net/http"
	"strconv"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/jwtkeys"
	"github.com/bikky-kc013/medi-ambulance/pkg/middleware"
	"github.com/bikky-kc013/medi-ambulance/pkg/models"
	"github.com/bikky-kc013/medi-ambulance/pkg/pagination"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type Handler struct {
	service       *Service
	driverService DriverServiceInterface
}

type DriverServiceInterface interface {
	GetDriverByUserID(ctx context.Context, userID uuid.UUID) (*models.Driver, error)
}

func NewHandler(service *Service, driverService DriverServiceInterface) *Handler {
	return &Handler{
		service:       service,
		driverService: driverService,
	}
}

func (h *Handler) getDriverID(c *gin.Context) (uuid.UUID, error) {
	userID, err := middleware.GetUserID(c)
	if err != nil {
		return uuid.Nil, err
	}

	driver, err := h.driverService.GetDriverByUserID(c.Request.Context(), userID)
	if err != nil {
		return uuid.Nil, err
	}

	return driver.ID, nil
}

func (h *Handler) GetDocumentTypes(c *gin.Context) {
	types, err := h.service.GetDocumentTypes(c.Request.Context())
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get document types")
		return
	}

	common.SuccessResponse(c, DocumentTypeListResponse{DocumentTypes: types})
}

func (h *Handler) GetMyDocuments(c *gin.Context) {
	driverID, err := h.getDriverID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "not a registered driver")
		return
	}

	docs, err := h.service.GetDriverDocuments(c.Request.Context(), driverID)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get documents")
		return
	}

	common.SuccessResponse(c, gin.H{"documents": docs})
}

func (h *Handler) GetMyVerificationStatus(c *gin.Context) {
	driverID, err := h.getDriverID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "not a registered driver")
		return
	}

	status, err := h.service.GetDriverVerificationStatus(c.Request.Context(), driverID)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get verification status")
		return
	}

	common.SuccessResponse(c, status)
}

func (h *Handler) UploadDocument(c *gin.Context) {
	driverID, err := h.getDriverID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "not a registered driver")
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "file is required")
		return
	}
	defer file.Close()

	documentTypeCode := c.PostForm("document_type_code")
	if documentTypeCode == "" {
		common.ErrorResponse(c, http.StatusBadRequest, "document_type_code is required")
		return
	}

	req := &UploadDocumentRequest{
		DocumentTypeCode: documentTypeCode,
		DocumentNumber:   c.PostForm("document_number"),
		IssuingAuthority: c.PostForm("issuing_authority"),
	}

	if issueDate := c.PostForm("issue_date"); issueDate != "" {

	}
	if expiryDate := c.PostForm("expiry_date"); expiryDate != "" {
	}

	response, err := h.service.UploadDocument(
		c.Request.Context(),
		driverID,
		req,
		file,
		header.Size,
		header.Filename,
		header.Header.Get("Content-Type"),
	)

	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to upload document")
		return
	}

	common.CreatedResponse(c, response)
}

func (h *Handler) UploadDocumentBackSide(c *gin.Context) {
	documentIDStr := c.Param("id")
	documentID, err := uuid.Parse(documentIDStr)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid document ID")
		return
	}

	driverID, err := h.getDriverID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "not a registered driver")
		return
	}

	doc, err := h.service.GetDocument(c.Request.Context(), documentID)
	if err != nil {
		common.ErrorResponse(c, http.StatusNotFound, "document not found")
		return
	}

	if doc.DriverID != driverID {
		common.ErrorResponse(c, http.StatusForbidden, "not your document")
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "file is required")
		return
	}
	defer file.Close()

	if err := h.service.UploadDocumentBackSide(
		c.Request.Context(),
		documentID,
		file,
		header.Size,
		header.Filename,
		header.Header.Get("Content-Type"),
	); err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to upload back side")
		return
	}

	common.SuccessResponse(c, gin.H{"message": "Back side uploaded successfully"})
}

func (h *Handler) GetPresignedUploadURL(c *gin.Context) {
	driverID, err := h.getDriverID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "not a registered driver")
		return
	}

	var req PresignedUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	response, err := h.service.GetPresignedUploadURL(c.Request.Context(), driverID, &req)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to generate upload URL")
		return
	}

	common.SuccessResponse(c, response)
}

func (h *Handler) CompleteDirectUpload(c *gin.Context) {
	driverID, err := h.getDriverID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "not a registered driver")
		return
	}

	var req UploadCompleteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	response, err := h.service.CompleteDirectUpload(c.Request.Context(), driverID, &req)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to complete upload")
		return
	}

	common.SuccessResponse(c, response)
}

func (h *Handler) GetDocument(c *gin.Context) {
	documentIDStr := c.Param("id")
	documentID, err := uuid.Parse(documentIDStr)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid document ID")
		return
	}

	doc, err := h.service.GetDocument(c.Request.Context(), documentID)
	if err != nil {
		common.ErrorResponse(c, http.StatusNotFound, "document not found")
		return
	}

	role, _ := middleware.GetUserRole(c)
	if role != models.RoleAdmin {
		driverID, err := h.getDriverID(c)
		if err != nil || doc.DriverID != driverID {
			common.ErrorResponse(c, http.StatusForbidden, "not your document")
			return
		}
	}

	common.SuccessResponse(c, doc)
}

func (h *Handler) GetPendingReviews(c *gin.Context) {
	params := pagination.ParseParams(c)

	reviews, total, err := h.service.GetPendingReviews(c.Request.Context(), params.Limit, params.Offset)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get pending reviews")
		return
	}

	meta := pagination.BuildMeta(params.Limit, params.Offset, int64(total))
	common.SuccessResponseWithMeta(c, gin.H{
		"documents": reviews,
	}, meta)
}

func (h *Handler) GetExpiringDocuments(c *gin.Context) {
	daysAhead, _ := strconv.Atoi(c.DefaultQuery("days", "30"))

	expiring, err := h.service.GetExpiringDocuments(c.Request.Context(), daysAhead)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get expiring documents")
		return
	}

	common.SuccessResponse(c, gin.H{"documents": expiring})
}

func (h *Handler) StartDocumentReview(c *gin.Context) {
	documentIDStr := c.Param("id")
	documentID, err := uuid.Parse(documentIDStr)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid document ID")
		return
	}

	reviewerID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	if err := h.service.StartReview(c.Request.Context(), documentID, reviewerID); err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to start review")
		return
	}

	common.SuccessResponse(c, gin.H{"message": "Review started"})
}

func (h *Handler) ReviewDocument(c *gin.Context) {
	documentIDStr := c.Param("id")
	documentID, err := uuid.Parse(documentIDStr)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid document ID")
		return
	}

	reviewerID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req ReviewDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	if err := h.service.ReviewDocument(c.Request.Context(), documentID, reviewerID, &req); err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to review document")
		return
	}

	common.SuccessResponse(c, gin.H{"message": "Document reviewed successfully"})
}

func (h *Handler) GetDriverDocumentsAdmin(c *gin.Context) {
	driverIDStr := c.Param("driver_id")
	driverID, err := uuid.Parse(driverIDStr)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid driver ID")
		return
	}

	docs, err := h.service.GetDriverDocuments(c.Request.Context(), driverID)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get documents")
		return
	}

	common.SuccessResponse(c, gin.H{"documents": docs})
}

func (h *Handler) GetDriverVerificationStatusAdmin(c *gin.Context) {
	driverIDStr := c.Param("driver_id")
	driverID, err := uuid.Parse(driverIDStr)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid driver ID")
		return
	}

	status, err := h.service.GetDriverVerificationStatus(c.Request.Context(), driverID)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get verification status")
		return
	}

	common.SuccessResponse(c, status)
}

func (h *Handler) RegisterRoutes(r *gin.Engine, jwtProvider jwtkeys.KeyProvider) {
	docs := r.Group("/api/v1/documents")
	{
		docs.GET("/types", h.GetDocumentTypes)
	}

	driverDocs := r.Group("/api/v1/documents")
	driverDocs.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
	driverDocs.Use(middleware.RequireRole(models.RoleDriver))
	{
		driverDocs.GET("", h.GetMyDocuments)
		driverDocs.GET("/verification-status", h.GetMyVerificationStatus)
		driverDocs.POST("/upload", h.UploadDocument)
		driverDocs.POST("/presigned-upload", h.GetPresignedUploadURL)
		driverDocs.POST("/upload-complete", h.CompleteDirectUpload)
		driverDocs.GET("/:id", h.GetDocument)
		driverDocs.POST("/:id/back", h.UploadDocumentBackSide)
	}

	adminDocs := r.Group("/api/v1/admin/documents")
	adminDocs.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
	adminDocs.Use(middleware.RequireRole(models.RoleAdmin))
	{
		adminDocs.GET("/pending", h.GetPendingReviews)
		adminDocs.GET("/expiring", h.GetExpiringDocuments)
		adminDocs.POST("/:id/start-review", h.StartDocumentReview)
		adminDocs.POST("/:id/review", h.ReviewDocument)
	}

	adminDriverDocs := r.Group("/api/v1/admin/drivers")
	adminDriverDocs.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
	adminDriverDocs.Use(middleware.RequireRole(models.RoleAdmin))
	{
		adminDriverDocs.GET("/:driver_id/documents", h.GetDriverDocumentsAdmin)
		adminDriverDocs.GET("/:driver_id/verification-status", h.GetDriverVerificationStatusAdmin)
	}
}

func (h *Handler) RegisterAdminRoutes(rg *gin.RouterGroup) {
	documents := rg.Group("/documents")
	{
		documents.GET("/pending", h.GetPendingReviews)
		documents.GET("/expiring", h.GetExpiringDocuments)
		documents.POST("/:id/start-review", h.StartDocumentReview)
		documents.POST("/:id/review", h.ReviewDocument)
		documents.GET("/drivers/:driver_id", h.GetDriverDocumentsAdmin)
		documents.GET("/drivers/:driver_id/verification-status", h.GetDriverVerificationStatusAdmin)
	}
}

func (h *Handler) RegisterRoutesOnGroup(rg *gin.RouterGroup) {
	rg.GET("/documents/types", h.GetDocumentTypes)

	docs := rg.Group("/documents")
	docs.Use(middleware.RequireRole(models.RoleDriver))
	{
		docs.GET("", h.GetMyDocuments)
		docs.GET("/verification-status", h.GetMyVerificationStatus)
		docs.POST("/upload", h.UploadDocument)
		docs.POST("/presigned-upload", h.GetPresignedUploadURL)
		docs.POST("/upload-complete", h.CompleteDirectUpload)
		docs.GET("/:id", h.GetDocument)
		docs.POST("/:id/back", h.UploadDocumentBackSide)
	}
}
