// Copyright 2026 Elderwood - Harry Potter MMO
// Email verification module for account registration

package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/smtp"
	"os"
	"strings"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

// Email verification constants
const (
	// EmailVerificationCollection stores pending email verifications
	EmailVerificationCollection = "email_verifications"
	// VerificationTokenLength is the length of the verification token in bytes
	VerificationTokenLength = 32
	// VerificationExpiryHours is how long a verification token is valid
	VerificationExpiryHours = 24
)

// EmailVerification represents a pending email verification
type EmailVerification struct {
	UserID    string    `json:"user_id"`
	Email     string    `json:"email"`
	Token     string    `json:"token"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
	Verified  bool      `json:"verified"`
}

// SMTPConfig holds SMTP configuration
type SMTPConfig struct {
	Host     string
	Port     string
	Username string
	Password string
	From     string
	FromName string
}

// getSMTPConfig reads SMTP configuration from environment variables
func getSMTPConfig() (*SMTPConfig, error) {
	host := os.Getenv("SMTP_HOST")
	port := os.Getenv("SMTP_PORT")
	username := os.Getenv("SMTP_USERNAME")
	password := os.Getenv("SMTP_PASSWORD")
	from := os.Getenv("SMTP_FROM")
	fromName := os.Getenv("SMTP_FROM_NAME")

	if host == "" || port == "" || username == "" || password == "" || from == "" {
		return nil, errors.New("SMTP configuration incomplete")
	}

	if fromName == "" {
		fromName = "Elderwood"
	}

	return &SMTPConfig{
		Host:     host,
		Port:     port,
		Username: username,
		Password: password,
		From:     from,
		FromName: fromName,
	}, nil
}

// generateToken creates a secure random token
func generateToken() (string, error) {
	bytes := make([]byte, VerificationTokenLength)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

// sendVerificationEmail sends the verification email via SMTP
func sendVerificationEmail(config *SMTPConfig, toEmail, token, baseURL string) error {
	verifyURL := fmt.Sprintf("%s/verify-email?token=%s", baseURL, token)

	subject := "Confirmez votre compte Elderwood"
	body := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #1a1a2e 0%%, #16213e 100%%); color: #fff; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .button { display: inline-block; background: #6366f1; color: #fff; padding: 15px 30px; text-decoration: none; border-radius: 8px; margin: 20px 0; }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Bienvenue sur Elderwood</h1>
        </div>
        <div class="content">
            <p>Bonjour,</p>
            <p>Merci de vous être inscrit sur Elderwood ! Pour activer votre compte, veuillez cliquer sur le bouton ci-dessous :</p>
            <p style="text-align: center;">
                <a href="%s" class="button">Confirmer mon email</a>
            </p>
            <p>Ou copiez ce lien dans votre navigateur :</p>
            <p style="word-break: break-all; color: #6366f1;">%s</p>
            <p>Ce lien expire dans 24 heures.</p>
            <p>Si vous n'avez pas créé de compte sur Elderwood, vous pouvez ignorer cet email.</p>
        </div>
        <div class="footer">
            <p>Elderwood - L'aventure magique vous attend</p>
        </div>
    </div>
</body>
</html>`, verifyURL, verifyURL)

	// Build email headers
	headers := make(map[string]string)
	headers["From"] = fmt.Sprintf("%s <%s>", config.FromName, config.From)
	headers["To"] = toEmail
	headers["Subject"] = subject
	headers["MIME-Version"] = "1.0"
	headers["Content-Type"] = "text/html; charset=UTF-8"

	var msg strings.Builder
	for k, v := range headers {
		msg.WriteString(fmt.Sprintf("%s: %s\r\n", k, v))
	}
	msg.WriteString("\r\n")
	msg.WriteString(body)

	// Send email
	auth := smtp.PlainAuth("", config.Username, config.Password, config.Host)
	addr := fmt.Sprintf("%s:%s", config.Host, config.Port)

	return smtp.SendMail(addr, auth, config.From, []string{toEmail}, []byte(msg.String()))
}

// rpcSendVerificationEmail sends a verification email to the user
func rpcSendVerificationEmail(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("user must be authenticated")
	}

	// Get SMTP config
	smtpConfig, err := getSMTPConfig()
	if err != nil {
		logger.Error("SMTP not configured: %v", err)
		return "", errors.New("email service not configured")
	}

	// Get user account to get email
	account, err := nk.AccountGetId(ctx, userID)
	if err != nil {
		logger.Error("Failed to get account: %v", err)
		return "", errors.New("failed to get account")
	}

	email := account.Email
	if email == "" {
		return "", errors.New("no email associated with account")
	}

	// Check if already verified
	metadata := make(map[string]interface{})
	if account.User.Metadata != "" {
		json.Unmarshal([]byte(account.User.Metadata), &metadata)
	}
	if verified, ok := metadata["email_verified"].(bool); ok && verified {
		return `{"status":"already_verified"}`, nil
	}

	// Generate verification token
	token, err := generateToken()
	if err != nil {
		logger.Error("Failed to generate token: %v", err)
		return "", errors.New("failed to generate verification token")
	}

	// Create verification record
	now := time.Now()
	verification := EmailVerification{
		UserID:    userID,
		Email:     email,
		Token:     token,
		CreatedAt: now,
		ExpiresAt: now.Add(VerificationExpiryHours * time.Hour),
		Verified:  false,
	}

	// Store verification
	verificationJSON, _ := json.Marshal(verification)
	writes := []*runtime.StorageWrite{{
		Collection:      EmailVerificationCollection,
		Key:             token,
		UserID:          SystemUserID,
		Value:           string(verificationJSON),
		PermissionRead:  0,
		PermissionWrite: 0,
	}}

	if _, err := nk.StorageWrite(ctx, writes); err != nil {
		logger.Error("Failed to store verification: %v", err)
		return "", errors.New("failed to create verification")
	}

	// Get base URL from environment
	baseURL := os.Getenv("APP_BASE_URL")
	if baseURL == "" {
		baseURL = "https://admin.elderwood-rp.com"
	}

	// Send email
	if err := sendVerificationEmail(smtpConfig, email, token, baseURL); err != nil {
		logger.Error("Failed to send verification email: %v", err)
		return "", errors.New("failed to send verification email")
	}

	logger.Info("Verification email sent to %s for user %s", email, userID)
	return `{"status":"sent"}`, nil
}

// rpcVerifyEmail verifies an email token
func rpcVerifyEmail(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	var req struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal([]byte(payload), &req); err != nil || req.Token == "" {
		return "", errors.New("token is required")
	}

	// Get verification record
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{
		Collection: EmailVerificationCollection,
		Key:        req.Token,
		UserID:     SystemUserID,
	}})
	if err != nil || len(objects) == 0 {
		return "", errors.New("invalid or expired token")
	}

	var verification EmailVerification
	if err := json.Unmarshal([]byte(objects[0].Value), &verification); err != nil {
		return "", errors.New("invalid verification data")
	}

	// Check if expired
	if time.Now().After(verification.ExpiresAt) {
		return "", errors.New("token has expired")
	}

	// Check if already verified
	if verification.Verified {
		return `{"status":"already_verified"}`, nil
	}

	// Get user account
	account, err := nk.AccountGetId(ctx, verification.UserID)
	if err != nil {
		logger.Error("Failed to get account: %v", err)
		return "", errors.New("failed to get account")
	}

	// Update user metadata to mark email as verified
	metadata := make(map[string]interface{})
	if account.User.Metadata != "" {
		json.Unmarshal([]byte(account.User.Metadata), &metadata)
	}
	metadata["email_verified"] = true
	metadata["email_verified_at"] = time.Now().Format(time.RFC3339)

	metadataJSON, _ := json.Marshal(metadata)
	if err := nk.AccountUpdateId(ctx, verification.UserID, "", metadataJSON, "", "", "", "", ""); err != nil {
		logger.Error("Failed to update account metadata: %v", err)
		return "", errors.New("failed to verify email")
	}

	// Mark verification as used
	verification.Verified = true
	verificationJSON, _ := json.Marshal(verification)
	writes := []*runtime.StorageWrite{{
		Collection:      EmailVerificationCollection,
		Key:             req.Token,
		UserID:          SystemUserID,
		Value:           string(verificationJSON),
		PermissionRead:  0,
		PermissionWrite: 0,
	}}
	nk.StorageWrite(ctx, writes)

	logger.Info("Email verified for user %s", verification.UserID)
	return `{"status":"verified"}`, nil
}

// rpcCheckEmailVerified checks if the current user's email is verified
func rpcCheckEmailVerified(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("user must be authenticated")
	}

	account, err := nk.AccountGetId(ctx, userID)
	if err != nil {
		logger.Error("Failed to get account: %v", err)
		return "", errors.New("failed to get account")
	}

	metadata := make(map[string]interface{})
	if account.User.Metadata != "" {
		json.Unmarshal([]byte(account.User.Metadata), &metadata)
	}

	verified := false
	if v, ok := metadata["email_verified"].(bool); ok {
		verified = v
	}

	response := map[string]interface{}{
		"verified": verified,
		"email":    account.Email,
	}
	responseJSON, _ := json.Marshal(response)
	return string(responseJSON), nil
}

// rpcResendVerificationEmail resends the verification email
func rpcResendVerificationEmail(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	// This is essentially the same as rpcSendVerificationEmail
	// but we could add rate limiting here
	return rpcSendVerificationEmail(ctx, logger, db, nk, payload)
}

// RegisterEmailRPCs registers all email-related RPC endpoints
func RegisterEmailRPCs(logger runtime.Logger, initializer runtime.Initializer) error {
	if err := initializer.RegisterRpc("elderwood_send_verification_email", rpcSendVerificationEmail); err != nil {
		logger.Error("Failed to register elderwood_send_verification_email RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_verify_email", rpcVerifyEmail); err != nil {
		logger.Error("Failed to register elderwood_verify_email RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_check_email_verified", rpcCheckEmailVerified); err != nil {
		logger.Error("Failed to register elderwood_check_email_verified RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_resend_verification_email", rpcResendVerificationEmail); err != nil {
		logger.Error("Failed to register elderwood_resend_verification_email RPC: %v", err)
		return err
	}

	logger.Info("Email verification RPCs registered")
	return nil
}
