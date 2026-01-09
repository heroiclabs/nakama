package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

const (
	DiscordAuthURL  = "https://discord.com/api/oauth2/authorize"
	DiscordTokenURL = "https://discord.com/api/oauth2/token"
	DiscordUserURL  = "https://discord.com/api/users/@me"
)

type DiscordTokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
}

type DiscordUser struct {
	ID            string `json:"id"`
	Username      string `json:"username"`
	Discriminator string `json:"discriminator"`
	GlobalName    string `json:"global_name"`
	Avatar        string `json:"avatar"`
	Email         string `json:"email"`
	Verified      bool   `json:"verified"`
}

// rpcGetDiscordAuthURL returns the Discord OAuth2 authorization URL
func rpcGetDiscordAuthURL(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("authentication required")
	}

	clientID := os.Getenv("DISCORD_CLIENT_ID")
	redirectURI := os.Getenv("DISCORD_REDIRECT_URI")

	if clientID == "" || redirectURI == "" {
		logger.Error("Discord OAuth not configured: missing DISCORD_CLIENT_ID or DISCORD_REDIRECT_URI")
		return "", errors.New("Discord integration not configured")
	}

	// Create state token to prevent CSRF - store user ID for callback
	state := fmt.Sprintf("%s_%d", userID, time.Now().Unix())

	// Store state in Nakama storage for verification later
	stateData := map[string]interface{}{
		"user_id":    userID,
		"created_at": time.Now().Format(time.RFC3339),
		"expires_at": time.Now().Add(10 * time.Minute).Format(time.RFC3339),
	}
	stateJSON, _ := json.Marshal(stateData)

	_, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection:      "discord_oauth_states",
		Key:             state,
		UserID:          SystemUserID,
		Value:           string(stateJSON),
		PermissionRead:  0,
		PermissionWrite: 0,
	}})
	if err != nil {
		logger.Error("Failed to store OAuth state: %v", err)
		return "", errors.New("failed to initiate Discord auth")
	}

	// Build authorization URL
	params := url.Values{}
	params.Set("client_id", clientID)
	params.Set("redirect_uri", redirectURI)
	params.Set("response_type", "code")
	params.Set("scope", "identify")
	params.Set("state", state)

	authURL := fmt.Sprintf("%s?%s", DiscordAuthURL, params.Encode())

	response := map[string]string{"url": authURL}
	responseJSON, _ := json.Marshal(response)
	return string(responseJSON), nil
}

// rpcDiscordCallback handles the OAuth2 callback from Discord
func rpcDiscordCallback(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	var req struct {
		Code  string `json:"code"`
		State string `json:"state"`
	}
	if err := json.Unmarshal([]byte(payload), &req); err != nil || req.Code == "" || req.State == "" {
		return "", errors.New("code and state are required")
	}

	// Verify state token
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{
		Collection: "discord_oauth_states",
		Key:        req.State,
		UserID:     SystemUserID,
	}})
	if err != nil || len(objects) == 0 {
		return "", errors.New("invalid or expired state")
	}

	var stateData struct {
		UserID    string `json:"user_id"`
		ExpiresAt string `json:"expires_at"`
	}
	if err := json.Unmarshal([]byte(objects[0].Value), &stateData); err != nil {
		return "", errors.New("invalid state data")
	}

	// Check expiration
	expiresAt, _ := time.Parse(time.RFC3339, stateData.ExpiresAt)
	if time.Now().After(expiresAt) {
		return "", errors.New("state has expired")
	}

	// Delete used state
	nk.StorageDelete(ctx, []*runtime.StorageDelete{{
		Collection: "discord_oauth_states",
		Key:        req.State,
		UserID:     SystemUserID,
	}})

	// Exchange code for token
	clientID := os.Getenv("DISCORD_CLIENT_ID")
	clientSecret := os.Getenv("DISCORD_CLIENT_SECRET")
	redirectURI := os.Getenv("DISCORD_REDIRECT_URI")

	tokenData := url.Values{}
	tokenData.Set("client_id", clientID)
	tokenData.Set("client_secret", clientSecret)
	tokenData.Set("grant_type", "authorization_code")
	tokenData.Set("code", req.Code)
	tokenData.Set("redirect_uri", redirectURI)

	tokenReq, _ := http.NewRequest("POST", DiscordTokenURL, strings.NewReader(tokenData.Encode()))
	tokenReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 10 * time.Second}
	tokenResp, err := client.Do(tokenReq)
	if err != nil {
		logger.Error("Failed to exchange code for token: %v", err)
		return "", errors.New("failed to authenticate with Discord")
	}
	defer tokenResp.Body.Close()

	tokenBody, _ := io.ReadAll(tokenResp.Body)
	if tokenResp.StatusCode != http.StatusOK {
		logger.Error("Discord token error: %s", string(tokenBody))
		return "", errors.New("failed to get Discord token")
	}

	var tokenResponse DiscordTokenResponse
	if err := json.Unmarshal(tokenBody, &tokenResponse); err != nil {
		logger.Error("Failed to parse token response: %v", err)
		return "", errors.New("failed to parse Discord response")
	}

	// Get Discord user info
	userReq, _ := http.NewRequest("GET", DiscordUserURL, nil)
	userReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", tokenResponse.AccessToken))

	userResp, err := client.Do(userReq)
	if err != nil {
		logger.Error("Failed to get Discord user: %v", err)
		return "", errors.New("failed to get Discord user info")
	}
	defer userResp.Body.Close()

	userBody, _ := io.ReadAll(userResp.Body)
	if userResp.StatusCode != http.StatusOK {
		logger.Error("Discord user error: %s", string(userBody))
		return "", errors.New("failed to get Discord user")
	}

	var discordUser DiscordUser
	if err := json.Unmarshal(userBody, &discordUser); err != nil {
		logger.Error("Failed to parse user response: %v", err)
		return "", errors.New("failed to parse Discord user")
	}

	// Check if this Discord ID is already linked to another account
	query := fmt.Sprintf("+value.discord_id:%s", discordUser.ID)
	result, _, err := nk.StorageIndexList(ctx, SystemUserID, "discord_links_idx", query, 1, nil, "")
	if err == nil && len(result.Objects) > 0 {
		var existingLink struct {
			UserID string `json:"user_id"`
		}
		json.Unmarshal([]byte(result.Objects[0].Value), &existingLink)
		if existingLink.UserID != stateData.UserID {
			return "", errors.New("this Discord account is already linked to another user")
		}
	}

	// Update user metadata with Discord info
	account, err := nk.AccountGetId(ctx, stateData.UserID)
	if err != nil {
		logger.Error("Failed to get account: %v", err)
		return "", errors.New("failed to get account")
	}

	metadata := make(map[string]interface{})
	if account.User.Metadata != "" {
		json.Unmarshal([]byte(account.User.Metadata), &metadata)
	}

	metadata["discord_id"] = discordUser.ID
	metadata["discord_username"] = discordUser.Username
	metadata["discord_global_name"] = discordUser.GlobalName
	metadata["discord_avatar"] = discordUser.Avatar
	metadata["discord_linked_at"] = time.Now().Format(time.RFC3339)

	if err := nk.AccountUpdateId(ctx, stateData.UserID, "", metadata, "", "", "", "", ""); err != nil {
		logger.Error("Failed to update account metadata: %v", err)
		return "", errors.New("failed to link Discord account")
	}

	// Store Discord link for lookup
	linkData := map[string]interface{}{
		"user_id":          stateData.UserID,
		"discord_id":       discordUser.ID,
		"discord_username": discordUser.Username,
		"linked_at":        time.Now().Format(time.RFC3339),
	}
	linkJSON, _ := json.Marshal(linkData)

	_, err = nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection:      "discord_links",
		Key:             discordUser.ID,
		UserID:          SystemUserID,
		Value:           string(linkJSON),
		PermissionRead:  0,
		PermissionWrite: 0,
	}})
	if err != nil {
		logger.Warn("Failed to store Discord link record: %v", err)
	}

	logger.Info("Discord account linked: user=%s discord=%s (%s)", stateData.UserID, discordUser.ID, discordUser.Username)

	response := map[string]interface{}{
		"status":           "linked",
		"discord_id":       discordUser.ID,
		"discord_username": discordUser.Username,
	}
	responseJSON, _ := json.Marshal(response)
	return string(responseJSON), nil
}

// rpcCheckDiscordLinked checks if the user has linked their Discord account
func rpcCheckDiscordLinked(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("authentication required")
	}

	account, err := nk.AccountGetId(ctx, userID)
	if err != nil {
		return "", errors.New("failed to get account")
	}

	metadata := make(map[string]interface{})
	if account.User.Metadata != "" {
		json.Unmarshal([]byte(account.User.Metadata), &metadata)
	}

	discordID, hasDiscord := metadata["discord_id"].(string)
	discordUsername, _ := metadata["discord_username"].(string)

	response := map[string]interface{}{
		"linked":           hasDiscord && discordID != "",
		"discord_id":       discordID,
		"discord_username": discordUsername,
	}
	responseJSON, _ := json.Marshal(response)
	return string(responseJSON), nil
}

// RegisterDiscordRPCs registers all Discord-related RPCs
func RegisterDiscordRPCs(initializer runtime.Initializer, logger runtime.Logger) error {
	if err := initializer.RegisterRpc("elderwood_discord_auth_url", rpcGetDiscordAuthURL); err != nil {
		logger.Error("Failed to register elderwood_discord_auth_url RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_discord_callback", rpcDiscordCallback); err != nil {
		logger.Error("Failed to register elderwood_discord_callback RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_check_discord_linked", rpcCheckDiscordLinked); err != nil {
		logger.Error("Failed to register elderwood_check_discord_linked RPC: %v", err)
		return err
	}

	logger.Info("Discord RPCs registered")
	return nil
}
