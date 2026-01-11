package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

const (
	WhitelistCollection = "whitelist_applications"
	WhitelistCooldownHours = 24
)

// WhitelistStatus represents the status of a whitelist application
type WhitelistStatus string

const (
	WhitelistStatusPending       WhitelistStatus = "pending"        // Étape 1: Candidature RP en attente
	WhitelistStatusRPApproved    WhitelistStatus = "rp_approved"    // Étape 1 validée, en attente de soumission HRP
	WhitelistStatusHRPPending    WhitelistStatus = "hrp_pending"    // Étape 2: Candidature HRP en attente
	WhitelistStatusHRPApproved   WhitelistStatus = "hrp_approved"   // Étape 2 validée, en attente de proposition de semaine
	WhitelistStatusOralPending   WhitelistStatus = "oral_pending"   // Étape 3: Semaine proposée, en attente de choix du joueur
	WhitelistStatusOralScheduled WhitelistStatus = "oral_scheduled" // Étape 3: Oral programmé, en attente de passage
	WhitelistStatusApproved      WhitelistStatus = "approved"       // Complètement validé (RP + HRP + Oral)
	WhitelistStatusRejected      WhitelistStatus = "rejected"       // Refusé, doit attendre 24h
)

// WhitelistApplication represents a whitelist application
type WhitelistApplication struct {
	ID              string `json:"id"`
	UserID          string `json:"user_id"`
	Username        string `json:"username"`
	Email           string `json:"email"`
	DiscordID       string `json:"discord_id"`
	DiscordUsername string `json:"discord_username"`

	// Étape 1: Candidature RP (In-Game Character)
	CharacterFirstName  string `json:"character_first_name"`
	CharacterLastName   string `json:"character_last_name"`
	CharacterAge        int    `json:"character_age"`
	CharacterBlood      string `json:"character_blood"`      // Pur, Mêlé, Né-moldu
	CharacterHistory    string `json:"character_history"`    // Background story
	CharacterMotivation string `json:"character_motivation"` // Why Hogwarts?

	// Étape 2: Candidature HRP (Hors RP - Real Person)
	HRPFirstName       string `json:"hrp_first_name,omitempty"`       // Prénom réel
	HRPAge             int    `json:"hrp_age,omitempty"`              // Âge réel
	HRPExperienceYears int    `json:"hrp_experience_years,omitempty"` // Années d'expérience RP
	HRPExperienceText  string `json:"hrp_experience_text,omitempty"`  // Texte explicatif expérience RP
	HRPHPKnowledge     string `json:"hrp_hp_knowledge,omitempty"`     // Connaissances Harry Potter

	// Étape 3: Candidature Orale
	OralProposedWeekStart string `json:"oral_proposed_week_start,omitempty"` // Début de la semaine proposée (format: 2006-01-02)
	OralProposedWeekEnd   string `json:"oral_proposed_week_end,omitempty"`   // Fin de la semaine proposée (format: 2006-01-02)
	OralSelectedSlot      string `json:"oral_selected_slot,omitempty"`       // Créneau choisi par le joueur (format: 2006-01-02T15:04)
	OralDiscordInviteSent bool   `json:"oral_discord_invite_sent,omitempty"` // Invitation Discord envoyée

	// Status
	Status          WhitelistStatus `json:"status"`
	CurrentStep     string          `json:"current_step"`                // "rp" ou "hrp"
	RejectionReason string          `json:"rejection_reason,omitempty"`
	RejectedStep    string          `json:"rejected_step,omitempty"`     // Quelle étape a été refusée
	ReviewedBy      string          `json:"reviewed_by,omitempty"`
	ReviewedAt      string          `json:"reviewed_at,omitempty"`

	// Timestamps
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// rpcSubmitWhitelistApplication submits a new whitelist application
func rpcSubmitWhitelistApplication(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("authentication required")
	}

	// Parse request
	var req struct {
		CharacterFirstName  string `json:"character_first_name"`
		CharacterLastName   string `json:"character_last_name"`
		CharacterAge        int    `json:"character_age"`
		CharacterBlood      string `json:"character_blood"`
		CharacterHistory    string `json:"character_history"`
		CharacterMotivation string `json:"character_motivation"`
	}
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		return "", errors.New("invalid request format")
	}

	// Validate required fields
	if req.CharacterFirstName == "" || req.CharacterLastName == "" {
		return "", errors.New("character first and last name are required")
	}
	if req.CharacterAge < 11 || req.CharacterAge > 17 {
		return "", errors.New("character age must be between 11 and 17")
	}
	if req.CharacterBlood == "" {
		return "", errors.New("character blood status is required")
	}
	if len(req.CharacterHistory) < 100 {
		return "", errors.New("character history must be at least 100 characters")
	}

	// Get user account info
	account, err := nk.AccountGetId(ctx, userID)
	if err != nil {
		return "", errors.New("failed to get account")
	}

	// Check Discord is linked
	metadata := make(map[string]interface{})
	if account.User.Metadata != "" {
		json.Unmarshal([]byte(account.User.Metadata), &metadata)
	}
	discordID, _ := metadata["discord_id"].(string)
	discordUsername, _ := metadata["discord_username"].(string)
	if discordID == "" {
		return "", errors.New("Discord account must be linked before applying")
	}

	// Check for existing pending application
	objects, _, err := nk.StorageList(ctx, "", userID, WhitelistCollection, 10, "")
	if err != nil {
		logger.Error("Failed to list whitelist applications: %v", err)
		return "", errors.New("failed to check existing applications")
	}

	now := time.Now()
	for _, obj := range objects {
		var existingApp WhitelistApplication
		if err := json.Unmarshal([]byte(obj.Value), &existingApp); err != nil {
			continue
		}

		// Check if there's a pending RP application
		if existingApp.Status == WhitelistStatusPending {
			return "", errors.New("you already have a pending application")
		}

		// Check if RP is approved (user should submit HRP instead)
		if existingApp.Status == WhitelistStatusRPApproved {
			return "", errors.New("your RP application is approved, please submit your HRP application")
		}

		// Check if HRP is pending
		if existingApp.Status == WhitelistStatusHRPPending {
			return "", errors.New("you already have a pending HRP application")
		}

		// Check if already fully approved
		if existingApp.Status == WhitelistStatusApproved {
			return "", errors.New("your application has already been approved")
		}

		// Check 24h cooldown for rejected applications
		if existingApp.Status == WhitelistStatusRejected {
			rejectedAt, _ := time.Parse(time.RFC3339, existingApp.ReviewedAt)
			cooldownEnd := rejectedAt.Add(WhitelistCooldownHours * time.Hour)
			if now.Before(cooldownEnd) {
				remaining := cooldownEnd.Sub(now)
				hours := int(remaining.Hours())
				minutes := int(remaining.Minutes()) % 60
				return "", fmt.Errorf("you must wait %dh%dm before submitting a new application", hours, minutes)
			}
		}
	}

	// Create new application
	app := WhitelistApplication{
		ID:                  fmt.Sprintf("%s_%d", userID, now.Unix()),
		UserID:              userID,
		Username:            account.User.Username,
		Email:               account.Email,
		DiscordID:           discordID,
		DiscordUsername:     discordUsername,
		CharacterFirstName:  req.CharacterFirstName,
		CharacterLastName:   req.CharacterLastName,
		CharacterAge:        req.CharacterAge,
		CharacterBlood:      req.CharacterBlood,
		CharacterHistory:    req.CharacterHistory,
		CharacterMotivation: req.CharacterMotivation,
		Status:              WhitelistStatusPending,
		CurrentStep:         "rp",
		CreatedAt:           now.Format(time.RFC3339),
		UpdatedAt:           now.Format(time.RFC3339),
	}

	appJSON, _ := json.Marshal(app)
	_, err = nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection:      WhitelistCollection,
		Key:             app.ID,
		UserID:          userID,
		Value:           string(appJSON),
		PermissionRead:  1, // Owner can read
		PermissionWrite: 0, // Only server can write
	}})
	if err != nil {
		logger.Error("Failed to save whitelist application: %v", err)
		return "", errors.New("failed to submit application")
	}

	// Also store in system index for Douaniers to list
	_, err = nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection:      "whitelist_index",
		Key:             app.ID,
		UserID:          SystemUserID,
		Value:           string(appJSON),
		PermissionRead:  0,
		PermissionWrite: 0,
	}})
	if err != nil {
		logger.Warn("Failed to update whitelist index: %v", err)
	}

	// Update user metadata with whitelist status
	if err := updateUserWhitelistStatus(ctx, nk, userID, WhitelistStatusPending); err != nil {
		logger.Warn("Failed to update user whitelist status: %v", err)
	}

	logger.Info("Whitelist RP application submitted: user=%s, app=%s", userID, app.ID)

	response := map[string]interface{}{
		"status":  "submitted",
		"app_id":  app.ID,
		"message": "Votre candidature RP a été soumise. Elle est en attente de validation.",
	}
	responseJSON, _ := json.Marshal(response)
	return string(responseJSON), nil
}

// rpcSubmitWhitelistHRP submits the HRP (Hors RP) part of the application
func rpcSubmitWhitelistHRP(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("authentication required")
	}

	// Parse request
	var req struct {
		HRPFirstName       string `json:"hrp_first_name"`
		HRPAge             int    `json:"hrp_age"`
		HRPExperienceYears int    `json:"hrp_experience_years"`
		HRPExperienceText  string `json:"hrp_experience_text"`
		HRPHPKnowledge     string `json:"hrp_hp_knowledge"`
	}
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		return "", errors.New("invalid request format")
	}

	// Validate required fields
	if req.HRPFirstName == "" {
		return "", errors.New("first name is required")
	}
	if req.HRPAge < 13 {
		return "", errors.New("you must be at least 13 years old")
	}
	if len(req.HRPExperienceText) < 50 {
		return "", errors.New("experience text must be at least 50 characters")
	}
	if len(req.HRPHPKnowledge) < 50 {
		return "", errors.New("Harry Potter knowledge text must be at least 50 characters")
	}

	// Find the user's RP-approved application
	objects, _, err := nk.StorageList(ctx, "", userID, WhitelistCollection, 10, "")
	if err != nil {
		logger.Error("Failed to list whitelist applications: %v", err)
		return "", errors.New("failed to check existing applications")
	}

	var approvedApp *WhitelistApplication
	for _, obj := range objects {
		var app WhitelistApplication
		if err := json.Unmarshal([]byte(obj.Value), &app); err != nil {
			continue
		}
		if app.Status == WhitelistStatusRPApproved {
			approvedApp = &app
			break
		}
	}

	if approvedApp == nil {
		return "", errors.New("no RP-approved application found, please submit RP application first")
	}

	// Update the application with HRP data
	now := time.Now()
	approvedApp.HRPFirstName = req.HRPFirstName
	approvedApp.HRPAge = req.HRPAge
	approvedApp.HRPExperienceYears = req.HRPExperienceYears
	approvedApp.HRPExperienceText = req.HRPExperienceText
	approvedApp.HRPHPKnowledge = req.HRPHPKnowledge
	approvedApp.Status = WhitelistStatusHRPPending
	approvedApp.CurrentStep = "hrp"
	approvedApp.UpdatedAt = now.Format(time.RFC3339)

	appJSON, _ := json.Marshal(approvedApp)

	// Update in user's storage
	_, err = nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection:      WhitelistCollection,
		Key:             approvedApp.ID,
		UserID:          userID,
		Value:           string(appJSON),
		PermissionRead:  1,
		PermissionWrite: 0,
	}})
	if err != nil {
		logger.Error("Failed to save HRP application: %v", err)
		return "", errors.New("failed to submit HRP application")
	}

	// Update in system index
	nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection:      "whitelist_index",
		Key:             approvedApp.ID,
		UserID:          SystemUserID,
		Value:           string(appJSON),
		PermissionRead:  0,
		PermissionWrite: 0,
	}})

	// Update user metadata with whitelist status
	if err := updateUserWhitelistStatus(ctx, nk, userID, WhitelistStatusHRPPending); err != nil {
		logger.Warn("Failed to update user whitelist status: %v", err)
	}

	logger.Info("Whitelist HRP application submitted: user=%s, app=%s", userID, approvedApp.ID)

	response := map[string]interface{}{
		"status":  "submitted",
		"app_id":  approvedApp.ID,
		"message": "Votre candidature HRP a été soumise. Elle est en attente de validation.",
	}
	responseJSON, _ := json.Marshal(response)
	return string(responseJSON), nil
}

// rpcGetWhitelistStatus gets the current user's whitelist application status
func rpcGetWhitelistStatus(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("authentication required")
	}

	objects, _, err := nk.StorageList(ctx, "", userID, WhitelistCollection, 10, "")
	if err != nil {
		logger.Error("Failed to list whitelist applications: %v", err)
		return "", errors.New("failed to get application status")
	}

	if len(objects) == 0 {
		response := map[string]interface{}{
			"has_application": false,
			"can_apply":       true,
		}
		responseJSON, _ := json.Marshal(response)
		return string(responseJSON), nil
	}

	// Find the most recent application
	var latestApp WhitelistApplication
	var latestTime time.Time
	for _, obj := range objects {
		var app WhitelistApplication
		if err := json.Unmarshal([]byte(obj.Value), &app); err != nil {
			continue
		}
		appTime, _ := time.Parse(time.RFC3339, app.CreatedAt)
		if appTime.After(latestTime) {
			latestTime = appTime
			latestApp = app
		}
	}

	// Calculate if user can apply again (for rejected applications)
	canApply := false
	canSubmitHRP := false
	canSelectOralSlot := false
	var cooldownRemaining string

	switch latestApp.Status {
	case WhitelistStatusRejected:
		rejectedAt, _ := time.Parse(time.RFC3339, latestApp.ReviewedAt)
		cooldownEnd := rejectedAt.Add(WhitelistCooldownHours * time.Hour)
		if time.Now().After(cooldownEnd) {
			canApply = true
		} else {
			remaining := cooldownEnd.Sub(time.Now())
			hours := int(remaining.Hours())
			minutes := int(remaining.Minutes()) % 60
			cooldownRemaining = fmt.Sprintf("%dh%dm", hours, minutes)
		}
	case WhitelistStatusRPApproved:
		// User's RP is approved, they can now submit HRP
		canSubmitHRP = true
	case WhitelistStatusOralPending:
		// User received a week proposal, they can select a slot
		canSelectOralSlot = true
	}

	response := map[string]interface{}{
		"has_application":       true,
		"application":           latestApp,
		"can_apply":             canApply,
		"can_submit_hrp":        canSubmitHRP,
		"can_select_oral_slot":  canSelectOralSlot,
		"cooldown_remaining":    cooldownRemaining,
	}
	responseJSON, _ := json.Marshal(response)
	return string(responseJSON), nil
}

// rpcListWhitelistApplications lists all whitelist applications (Douanier only)
func rpcListWhitelistApplications(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("authentication required")
	}

	// Check if user is a Douanier
	if !isDouanier(ctx, nk, userID) {
		return "", errors.New("access denied: Douanier role required")
	}

	// Parse optional filters
	var req struct {
		Status string `json:"status"` // pending, approved, rejected, or empty for all
		Limit  int    `json:"limit"`
	}
	if payload != "" {
		json.Unmarshal([]byte(payload), &req)
	}
	if req.Limit <= 0 || req.Limit > 100 {
		req.Limit = 50
	}

	// List all applications using storage index or iterate through users
	// For now, we'll use a system collection to track all applications
	objects, _, err := nk.StorageList(ctx, "", SystemUserID, "whitelist_index", 1000, "")
	if err != nil {
		// Fallback: if no index exists, return empty list
		logger.Warn("No whitelist index found, returning empty list")
		response := map[string]interface{}{
			"applications": []WhitelistApplication{},
			"total":        0,
		}
		responseJSON, _ := json.Marshal(response)
		return string(responseJSON), nil
	}

	var applications []WhitelistApplication
	for _, obj := range objects {
		var app WhitelistApplication
		if err := json.Unmarshal([]byte(obj.Value), &app); err != nil {
			continue
		}

		// Filter by status if specified
		if req.Status != "" && string(app.Status) != req.Status {
			continue
		}

		applications = append(applications, app)
	}

	response := map[string]interface{}{
		"applications": applications,
		"total":        len(applications),
	}
	responseJSON, _ := json.Marshal(response)
	return string(responseJSON), nil
}

// rpcReviewWhitelistApplication approves or rejects an application (Douanier only)
func rpcReviewWhitelistApplication(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	reviewerID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || reviewerID == "" {
		return "", errors.New("authentication required")
	}

	// Check if user is a Douanier
	if !isDouanier(ctx, nk, reviewerID) {
		return "", errors.New("access denied: Douanier role required")
	}

	var req struct {
		ApplicationID   string `json:"application_id"`
		UserID          string `json:"user_id"`
		Approved        bool   `json:"approved"`
		RejectionReason string `json:"rejection_reason"`
	}
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		return "", errors.New("invalid request format")
	}

	if req.ApplicationID == "" || req.UserID == "" {
		return "", errors.New("application_id and user_id are required")
	}

	if !req.Approved && req.RejectionReason == "" {
		return "", errors.New("rejection reason is required when rejecting an application")
	}

	// Get the application
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{
		Collection: WhitelistCollection,
		Key:        req.ApplicationID,
		UserID:     req.UserID,
	}})
	if err != nil || len(objects) == 0 {
		return "", errors.New("application not found")
	}

	var app WhitelistApplication
	if err := json.Unmarshal([]byte(objects[0].Value), &app); err != nil {
		return "", errors.New("failed to read application")
	}

	// Determine which step is being reviewed based on Status (more reliable than CurrentStep)
	var currentStep string
	switch app.Status {
	case WhitelistStatusPending:
		currentStep = "rp"
	case WhitelistStatusHRPPending:
		currentStep = "hrp"
	case WhitelistStatusOralScheduled:
		currentStep = "oral"
	default:
		return "", errors.New("application is not in a reviewable state")
	}

	// Get reviewer info
	reviewerAccount, _ := nk.AccountGetId(ctx, reviewerID)
	reviewerName := reviewerID
	if reviewerAccount != nil {
		reviewerName = reviewerAccount.User.Username
	}

	// Update application status based on step
	now := time.Now()
	if req.Approved {
		switch currentStep {
		case "rp":
			// RP approved -> move to HRP step
			app.Status = WhitelistStatusRPApproved
		case "hrp":
			// HRP approved -> move to oral step (waiting for week proposal)
			app.Status = WhitelistStatusHRPApproved
		case "oral":
			// Oral approved -> fully approved
			app.Status = WhitelistStatusApproved
		}
	} else {
		app.Status = WhitelistStatusRejected
		app.RejectionReason = req.RejectionReason
		app.RejectedStep = currentStep
	}
	app.ReviewedBy = reviewerName
	app.ReviewedAt = now.Format(time.RFC3339)
	app.UpdatedAt = now.Format(time.RFC3339)

	appJSON, _ := json.Marshal(app)

	// Update in user's storage
	_, err = nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection:      WhitelistCollection,
		Key:             req.ApplicationID,
		UserID:          req.UserID,
		Value:           string(appJSON),
		PermissionRead:  1,
		PermissionWrite: 0,
	}})
	if err != nil {
		logger.Error("Failed to update application: %v", err)
		return "", errors.New("failed to update application")
	}

	// Update in system index
	nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection:      "whitelist_index",
		Key:             req.ApplicationID,
		UserID:          SystemUserID,
		Value:           string(appJSON),
		PermissionRead:  0,
		PermissionWrite: 0,
	}})

	// Update user metadata with whitelist status
	if err := updateUserWhitelistStatus(ctx, nk, req.UserID, app.Status); err != nil {
		logger.Warn("Failed to update user whitelist status: %v", err)
	}

	// Generate status text for logging and response
	var statusText string
	if req.Approved {
		switch currentStep {
		case "rp":
			statusText = "rp_approved"
		case "hrp":
			statusText = "hrp_approved"
		case "oral":
			statusText = "approved"
		}
	} else {
		statusText = "rejected"
	}
	logger.Info("Whitelist application %s (%s step): app=%s, user=%s, reviewer=%s", statusText, currentStep, req.ApplicationID, req.UserID, reviewerName)

	response := map[string]interface{}{
		"status":  statusText,
		"message": fmt.Sprintf("Application %s successfully", statusText),
	}
	responseJSON, _ := json.Marshal(response)
	return string(responseJSON), nil
}

// rpcProposeOralWeek allows a Douanier to propose a calendar week for an oral interview
func rpcProposeOralWeek(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	reviewerID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || reviewerID == "" {
		return "", errors.New("authentication required")
	}

	// Check if user is a Douanier
	if !isDouanier(ctx, nk, reviewerID) {
		return "", errors.New("access denied: Douanier role required")
	}

	var req struct {
		ApplicationID string `json:"application_id"`
		UserID        string `json:"user_id"`
		WeekStart     string `json:"week_start"` // Format: 2006-01-02
		WeekEnd       string `json:"week_end"`   // Format: 2006-01-02
	}
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		return "", errors.New("invalid request format")
	}

	if req.ApplicationID == "" || req.UserID == "" {
		return "", errors.New("application_id and user_id are required")
	}

	// Validate date format
	_, err := time.Parse("2006-01-02", req.WeekStart)
	if err != nil {
		return "", errors.New("invalid week_start format, use YYYY-MM-DD")
	}
	_, err = time.Parse("2006-01-02", req.WeekEnd)
	if err != nil {
		return "", errors.New("invalid week_end format, use YYYY-MM-DD")
	}

	// Get the application
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{
		Collection: WhitelistCollection,
		Key:        req.ApplicationID,
		UserID:     req.UserID,
	}})
	if err != nil || len(objects) == 0 {
		return "", errors.New("application not found")
	}

	var app WhitelistApplication
	if err := json.Unmarshal([]byte(objects[0].Value), &app); err != nil {
		return "", errors.New("failed to read application")
	}

	// Check application is in hrp_approved status
	if app.Status != WhitelistStatusHRPApproved {
		return "", errors.New("application must be in hrp_approved status to propose an oral week")
	}

	// Update application with proposed week
	now := time.Now()
	app.OralProposedWeekStart = req.WeekStart
	app.OralProposedWeekEnd = req.WeekEnd
	app.Status = WhitelistStatusOralPending
	app.UpdatedAt = now.Format(time.RFC3339)

	appJSON, _ := json.Marshal(app)

	// Update in user's storage
	_, err = nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection:      WhitelistCollection,
		Key:             req.ApplicationID,
		UserID:          req.UserID,
		Value:           string(appJSON),
		PermissionRead:  1,
		PermissionWrite: 0,
	}})
	if err != nil {
		logger.Error("Failed to update application: %v", err)
		return "", errors.New("failed to propose oral week")
	}

	// Update in system index
	nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection:      "whitelist_index",
		Key:             req.ApplicationID,
		UserID:          SystemUserID,
		Value:           string(appJSON),
		PermissionRead:  0,
		PermissionWrite: 0,
	}})

	// Update user metadata with whitelist status
	if err := updateUserWhitelistStatus(ctx, nk, req.UserID, WhitelistStatusOralPending); err != nil {
		logger.Warn("Failed to update user whitelist status: %v", err)
	}

	logger.Info("Oral week proposed for application %s: %s to %s", req.ApplicationID, req.WeekStart, req.WeekEnd)

	response := map[string]interface{}{
		"status":     "oral_pending",
		"message":    "Semaine proposée au candidat",
		"week_start": req.WeekStart,
		"week_end":   req.WeekEnd,
	}
	responseJSON, _ := json.Marshal(response)
	return string(responseJSON), nil
}

// rpcSelectOralSlot allows a player to select a day/time slot for their oral interview
func rpcSelectOralSlot(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("authentication required")
	}

	var req struct {
		SelectedSlot string `json:"selected_slot"` // Format: 2006-01-02T15:04
	}
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		return "", errors.New("invalid request format")
	}

	// Validate datetime format
	selectedTime, err := time.Parse("2006-01-02T15:04", req.SelectedSlot)
	if err != nil {
		return "", errors.New("invalid selected_slot format, use YYYY-MM-DDTHH:MM")
	}

	// Find the user's oral_pending application
	objects, _, err := nk.StorageList(ctx, "", userID, WhitelistCollection, 10, "")
	if err != nil {
		logger.Error("Failed to list whitelist applications: %v", err)
		return "", errors.New("failed to check existing applications")
	}

	var pendingApp *WhitelistApplication
	var pendingAppKey string
	for _, obj := range objects {
		var app WhitelistApplication
		if err := json.Unmarshal([]byte(obj.Value), &app); err != nil {
			continue
		}
		if app.Status == WhitelistStatusOralPending {
			pendingApp = &app
			pendingAppKey = obj.Key
			break
		}
	}

	if pendingApp == nil {
		return "", errors.New("no oral-pending application found")
	}

	// Validate selected slot is within proposed week
	weekStart, _ := time.Parse("2006-01-02", pendingApp.OralProposedWeekStart)
	weekEnd, _ := time.Parse("2006-01-02", pendingApp.OralProposedWeekEnd)
	weekEnd = weekEnd.Add(24 * time.Hour) // Include the end day

	if selectedTime.Before(weekStart) || selectedTime.After(weekEnd) {
		return "", fmt.Errorf("selected slot must be between %s and %s", pendingApp.OralProposedWeekStart, pendingApp.OralProposedWeekEnd)
	}

	// Update application with selected slot
	now := time.Now()
	pendingApp.OralSelectedSlot = req.SelectedSlot
	pendingApp.Status = WhitelistStatusOralScheduled
	pendingApp.OralDiscordInviteSent = true // Auto-mark as sent since we show the link directly
	pendingApp.UpdatedAt = now.Format(time.RFC3339)

	appJSON, _ := json.Marshal(pendingApp)

	// Update in user's storage
	_, err = nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection:      WhitelistCollection,
		Key:             pendingAppKey,
		UserID:          userID,
		Value:           string(appJSON),
		PermissionRead:  1,
		PermissionWrite: 0,
	}})
	if err != nil {
		logger.Error("Failed to save oral slot selection: %v", err)
		return "", errors.New("failed to select oral slot")
	}

	// Update in system index
	nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection:      "whitelist_index",
		Key:             pendingAppKey,
		UserID:          SystemUserID,
		Value:           string(appJSON),
		PermissionRead:  0,
		PermissionWrite: 0,
	}})

	// Update user metadata with whitelist status
	if err := updateUserWhitelistStatus(ctx, nk, userID, WhitelistStatusOralScheduled); err != nil {
		logger.Warn("Failed to update user whitelist status: %v", err)
	}

	logger.Info("Oral slot selected for application %s: %s", pendingAppKey, req.SelectedSlot)

	// Get Discord Douane invite URL from environment
	discordInviteURL := os.Getenv("DISCORD_DOUANE_INVITE_URL")
	if discordInviteURL == "" {
		// Default fallback
		discordInviteURL = "https://discord.gg/uRKSv2z9bn"
	}

	response := map[string]interface{}{
		"status":             "oral_scheduled",
		"message":            "Créneau confirmé ! Rejoignez le serveur Discord Elderwood Douane pour passer votre oral.",
		"selected_slot":      req.SelectedSlot,
		"discord_invite_url": discordInviteURL,
		"character_name":     fmt.Sprintf("%s %s", pendingApp.CharacterFirstName, pendingApp.CharacterLastName),
	}
	responseJSON, _ := json.Marshal(response)
	return string(responseJSON), nil
}

// rpcListOralCalendar returns scheduled oral interviews for Douaniers
func rpcListOralCalendar(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("authentication required")
	}

	// Check if user is a Douanier
	if !isDouanier(ctx, nk, userID) {
		return "", errors.New("access denied: Douanier role required")
	}

	// List all applications with oral_scheduled status
	objects, _, err := nk.StorageList(ctx, "", SystemUserID, "whitelist_index", 1000, "")
	if err != nil {
		logger.Warn("Failed to list whitelist index: %v", err)
		response := map[string]interface{}{
			"scheduled_orals": []interface{}{},
			"total":           0,
		}
		responseJSON, _ := json.Marshal(response)
		return string(responseJSON), nil
	}

	type OralSlot struct {
		ApplicationID   string `json:"application_id"`
		UserID          string `json:"user_id"`
		Username        string `json:"username"`
		DiscordUsername string `json:"discord_username"`
		CharacterName   string `json:"character_name"`
		SelectedSlot    string `json:"selected_slot"`
		InviteSent      bool   `json:"invite_sent"`
	}

	var scheduledOrals []OralSlot
	for _, obj := range objects {
		var app WhitelistApplication
		if err := json.Unmarshal([]byte(obj.Value), &app); err != nil {
			continue
		}

		if app.Status == WhitelistStatusOralScheduled {
			scheduledOrals = append(scheduledOrals, OralSlot{
				ApplicationID:   app.ID,
				UserID:          app.UserID,
				Username:        app.Username,
				DiscordUsername: app.DiscordUsername,
				CharacterName:   fmt.Sprintf("%s %s", app.CharacterFirstName, app.CharacterLastName),
				SelectedSlot:    app.OralSelectedSlot,
				InviteSent:      app.OralDiscordInviteSent,
			})
		}
	}

	// Sort by selected slot (earliest first)
	for i := 0; i < len(scheduledOrals)-1; i++ {
		for j := i + 1; j < len(scheduledOrals); j++ {
			if scheduledOrals[i].SelectedSlot > scheduledOrals[j].SelectedSlot {
				scheduledOrals[i], scheduledOrals[j] = scheduledOrals[j], scheduledOrals[i]
			}
		}
	}

	response := map[string]interface{}{
		"scheduled_orals": scheduledOrals,
		"total":           len(scheduledOrals),
	}
	responseJSON, _ := json.Marshal(response)
	return string(responseJSON), nil
}

// rpcMarkOralInviteSent marks that the Discord invite has been sent to the player
func rpcMarkOralInviteSent(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	reviewerID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || reviewerID == "" {
		return "", errors.New("authentication required")
	}

	// Check if user is a Douanier
	if !isDouanier(ctx, nk, reviewerID) {
		return "", errors.New("access denied: Douanier role required")
	}

	var req struct {
		ApplicationID string `json:"application_id"`
		UserID        string `json:"user_id"`
	}
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		return "", errors.New("invalid request format")
	}

	// Get the application
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{
		Collection: WhitelistCollection,
		Key:        req.ApplicationID,
		UserID:     req.UserID,
	}})
	if err != nil || len(objects) == 0 {
		return "", errors.New("application not found")
	}

	var app WhitelistApplication
	if err := json.Unmarshal([]byte(objects[0].Value), &app); err != nil {
		return "", errors.New("failed to read application")
	}

	if app.Status != WhitelistStatusOralScheduled {
		return "", errors.New("application is not in oral_scheduled status")
	}

	// Update application
	now := time.Now()
	app.OralDiscordInviteSent = true
	app.UpdatedAt = now.Format(time.RFC3339)

	appJSON, _ := json.Marshal(app)

	// Update in user's storage
	nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection:      WhitelistCollection,
		Key:             req.ApplicationID,
		UserID:          req.UserID,
		Value:           string(appJSON),
		PermissionRead:  1,
		PermissionWrite: 0,
	}})

	// Update in system index
	nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection:      "whitelist_index",
		Key:             req.ApplicationID,
		UserID:          SystemUserID,
		Value:           string(appJSON),
		PermissionRead:  0,
		PermissionWrite: 0,
	}})

	logger.Info("Discord invite marked as sent for application %s", req.ApplicationID)

	response := map[string]interface{}{
		"status":  "invite_sent",
		"message": "Invitation Discord marquée comme envoyée",
	}
	responseJSON, _ := json.Marshal(response)
	return string(responseJSON), nil
}

// updateUserWhitelistStatus updates the whitelist_status in user's metadata
func updateUserWhitelistStatus(ctx context.Context, nk runtime.NakamaModule, userID string, status WhitelistStatus) error {
	account, err := nk.AccountGetId(ctx, userID)
	if err != nil {
		return err
	}

	metadata := make(map[string]interface{})
	if account.User.Metadata != "" {
		json.Unmarshal([]byte(account.User.Metadata), &metadata)
	}

	metadata["whitelist_status"] = string(status)
	if status == WhitelistStatusApproved {
		metadata["whitelist_approved_at"] = time.Now().Format(time.RFC3339)
	}

	return nk.AccountUpdateId(ctx, userID, "", metadata, "", "", "", "", "")
}

// isDouanier checks if a user has the Douanier role
func isDouanier(ctx context.Context, nk runtime.NakamaModule, userID string) bool {
	account, err := nk.AccountGetId(ctx, userID)
	if err != nil {
		return false
	}

	metadata := make(map[string]interface{})
	if account.User.Metadata != "" {
		json.Unmarshal([]byte(account.User.Metadata), &metadata)
	}

	// Check for admin role (admins are also douaniers)
	if role, ok := metadata["role"].(string); ok && role == "admin" {
		return true
	}

	// Check for douanier role
	if role, ok := metadata["role"].(string); ok && role == "douanier" {
		return true
	}

	// Check roles array
	if roles, ok := metadata["roles"].([]interface{}); ok {
		for _, r := range roles {
			if roleStr, ok := r.(string); ok && (roleStr == "douanier" || roleStr == "admin") {
				return true
			}
		}
	}

	return false
}

// RegisterWhitelistRPCs registers all whitelist-related RPCs
func RegisterWhitelistRPCs(initializer runtime.Initializer, logger runtime.Logger) error {
	if err := initializer.RegisterRpc("elderwood_submit_whitelist", rpcSubmitWhitelistApplication); err != nil {
		logger.Error("Failed to register elderwood_submit_whitelist RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_submit_whitelist_hrp", rpcSubmitWhitelistHRP); err != nil {
		logger.Error("Failed to register elderwood_submit_whitelist_hrp RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_get_whitelist_status", rpcGetWhitelistStatus); err != nil {
		logger.Error("Failed to register elderwood_get_whitelist_status RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_list_whitelist_applications", rpcListWhitelistApplications); err != nil {
		logger.Error("Failed to register elderwood_list_whitelist_applications RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_review_whitelist", rpcReviewWhitelistApplication); err != nil {
		logger.Error("Failed to register elderwood_review_whitelist RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_propose_oral_week", rpcProposeOralWeek); err != nil {
		logger.Error("Failed to register elderwood_propose_oral_week RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_select_oral_slot", rpcSelectOralSlot); err != nil {
		logger.Error("Failed to register elderwood_select_oral_slot RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_list_oral_calendar", rpcListOralCalendar); err != nil {
		logger.Error("Failed to register elderwood_list_oral_calendar RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_mark_oral_invite_sent", rpcMarkOralInviteSent); err != nil {
		logger.Error("Failed to register elderwood_mark_oral_invite_sent RPC: %v", err)
		return err
	}

	logger.Info("Whitelist RPCs registered")
	return nil
}
