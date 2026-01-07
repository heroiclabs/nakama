// Copyright 2026 Elderwood - Harry Potter MMO
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Package main provides character storage management for the Elderwood Harry Potter MMO.
// Characters are stored per account with the following attributes:
// - id: unique character identifier (UUID)
// - name: character display name
// - level: character level (1+)
// - xp: experience points
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/runtime"
)

const (
	// CharacterCollection is the storage collection name for characters
	CharacterCollection = "characters"
	// MaxCharactersPerAccount is the maximum number of characters allowed per account
	MaxCharactersPerAccount = 5
	// DefaultCharacterLevel is the starting level for new characters
	DefaultCharacterLevel = 1
	// DefaultCharacterXP is the starting XP for new characters
	DefaultCharacterXP = 0
)

// Character represents a player character in the Elderwood MMO
type Character struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Level     int    `json:"level"`
	XP        int64  `json:"xp"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
}

// CreateCharacterRequest is the payload for creating a new character
type CreateCharacterRequest struct {
	Name string `json:"name"`
}

// UpdateCharacterRequest is the payload for updating a character
type UpdateCharacterRequest struct {
	ID    string `json:"id"`
	Level *int   `json:"level,omitempty"`
	XP    *int64 `json:"xp,omitempty"`
	Name  *string `json:"name,omitempty"`
}

// GetCharacterRequest is the payload for getting a specific character
type GetCharacterRequest struct {
	ID string `json:"id"`
}

// DeleteCharacterRequest is the payload for deleting a character
type DeleteCharacterRequest struct {
	ID string `json:"id"`
}

// CharacterListResponse is the response containing a list of characters
type CharacterListResponse struct {
	Characters []Character `json:"characters"`
}

// InitModule initializes the Elderwood characters module
func InitModule(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, initializer runtime.Initializer) error {
	logger.Info("Initializing Elderwood Characters Module")

	// Register RPC endpoints for character management
	if err := initializer.RegisterRpc("elderwood_create_character", rpcCreateCharacter); err != nil {
		logger.Error("Failed to register elderwood_create_character RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_get_characters", rpcGetCharacters); err != nil {
		logger.Error("Failed to register elderwood_get_characters RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_get_character", rpcGetCharacter); err != nil {
		logger.Error("Failed to register elderwood_get_character RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_update_character", rpcUpdateCharacter); err != nil {
		logger.Error("Failed to register elderwood_update_character RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_delete_character", rpcDeleteCharacter); err != nil {
		logger.Error("Failed to register elderwood_delete_character RPC: %v", err)
		return err
	}

	logger.Info("Elderwood Characters Module initialized successfully")
	return nil
}

// rpcCreateCharacter creates a new character for the authenticated user
func rpcCreateCharacter(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("user ID not found in context - authentication required")
	}

	// Parse the request
	var req CreateCharacterRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		logger.Error("Failed to parse create character request: %v", err)
		return "", errors.New("invalid request payload")
	}

	// Validate character name
	if req.Name == "" {
		return "", errors.New("character name is required")
	}
	if len(req.Name) < 2 || len(req.Name) > 32 {
		return "", errors.New("character name must be between 2 and 32 characters")
	}

	// Check how many characters the user already has
	existingCharacters, _, err := nk.StorageList(ctx, "", userID, CharacterCollection, MaxCharactersPerAccount+1, "")
	if err != nil {
		logger.Error("Failed to list existing characters: %v", err)
		return "", errors.New("failed to check existing characters")
	}

	if len(existingCharacters) >= MaxCharactersPerAccount {
		return "", errors.New("maximum number of characters reached")
	}

	// Check if a character with the same name already exists for this user
	for _, obj := range existingCharacters {
		var existing Character
		if err := json.Unmarshal([]byte(obj.Value), &existing); err == nil {
			if existing.Name == req.Name {
				return "", errors.New("a character with this name already exists")
			}
		}
	}

	// Generate a new character ID
	characterID := uuid.Must(uuid.NewV4()).String()
	now := time.Now().Unix()

	// Create the character
	character := Character{
		ID:        characterID,
		Name:      req.Name,
		Level:     DefaultCharacterLevel,
		XP:        DefaultCharacterXP,
		CreatedAt: now,
		UpdatedAt: now,
	}

	// Serialize the character
	characterJSON, err := json.Marshal(character)
	if err != nil {
		logger.Error("Failed to serialize character: %v", err)
		return "", errors.New("failed to create character")
	}

	// Store the character
	writes := []*runtime.StorageWrite{
		{
			Collection:      CharacterCollection,
			Key:             characterID,
			UserID:          userID,
			Value:           string(characterJSON),
			PermissionRead:  1, // Owner can read
			PermissionWrite: 1, // Owner can write
		},
	}

	if _, err := nk.StorageWrite(ctx, writes); err != nil {
		logger.Error("Failed to store character: %v", err)
		return "", errors.New("failed to save character")
	}

	logger.Info("Character created: %s for user %s", characterID, userID)
	return string(characterJSON), nil
}

// rpcGetCharacters returns all characters for the authenticated user
func rpcGetCharacters(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("user ID not found in context - authentication required")
	}

	// List all characters for this user
	objects, _, err := nk.StorageList(ctx, "", userID, CharacterCollection, MaxCharactersPerAccount, "")
	if err != nil {
		logger.Error("Failed to list characters: %v", err)
		return "", errors.New("failed to retrieve characters")
	}

	// Parse and collect characters
	characters := make([]Character, 0, len(objects))
	for _, obj := range objects {
		var character Character
		if err := json.Unmarshal([]byte(obj.Value), &character); err != nil {
			logger.Warn("Failed to parse character %s: %v", obj.Key, err)
			continue
		}
		characters = append(characters, character)
	}

	// Create the response
	response := CharacterListResponse{
		Characters: characters,
	}

	responseJSON, err := json.Marshal(response)
	if err != nil {
		logger.Error("Failed to serialize response: %v", err)
		return "", errors.New("failed to build response")
	}

	return string(responseJSON), nil
}

// rpcGetCharacter returns a specific character by ID
func rpcGetCharacter(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("user ID not found in context - authentication required")
	}

	// Parse the request
	var req GetCharacterRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		logger.Error("Failed to parse get character request: %v", err)
		return "", errors.New("invalid request payload")
	}

	if req.ID == "" {
		return "", errors.New("character ID is required")
	}

	// Read the character from storage
	reads := []*runtime.StorageRead{
		{
			Collection: CharacterCollection,
			Key:        req.ID,
			UserID:     userID,
		},
	}

	objects, err := nk.StorageRead(ctx, reads)
	if err != nil {
		logger.Error("Failed to read character: %v", err)
		return "", errors.New("failed to retrieve character")
	}

	if len(objects) == 0 {
		return "", errors.New("character not found")
	}

	return objects[0].Value, nil
}

// rpcUpdateCharacter updates a character's level, XP, or name
func rpcUpdateCharacter(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("user ID not found in context - authentication required")
	}

	// Parse the request
	var req UpdateCharacterRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		logger.Error("Failed to parse update character request: %v", err)
		return "", errors.New("invalid request payload")
	}

	if req.ID == "" {
		return "", errors.New("character ID is required")
	}

	// Read the existing character
	reads := []*runtime.StorageRead{
		{
			Collection: CharacterCollection,
			Key:        req.ID,
			UserID:     userID,
		},
	}

	objects, err := nk.StorageRead(ctx, reads)
	if err != nil {
		logger.Error("Failed to read character for update: %v", err)
		return "", errors.New("failed to retrieve character")
	}

	if len(objects) == 0 {
		return "", errors.New("character not found")
	}

	// Parse the existing character
	var character Character
	if err := json.Unmarshal([]byte(objects[0].Value), &character); err != nil {
		logger.Error("Failed to parse existing character: %v", err)
		return "", errors.New("failed to parse character data")
	}

	// Apply updates
	if req.Level != nil {
		if *req.Level < 1 {
			return "", errors.New("level must be at least 1")
		}
		character.Level = *req.Level
	}

	if req.XP != nil {
		if *req.XP < 0 {
			return "", errors.New("XP cannot be negative")
		}
		character.XP = *req.XP
	}

	if req.Name != nil {
		if len(*req.Name) < 2 || len(*req.Name) > 32 {
			return "", errors.New("character name must be between 2 and 32 characters")
		}
		character.Name = *req.Name
	}

	character.UpdatedAt = time.Now().Unix()

	// Serialize the updated character
	characterJSON, err := json.Marshal(character)
	if err != nil {
		logger.Error("Failed to serialize updated character: %v", err)
		return "", errors.New("failed to update character")
	}

	// Store the updated character
	writes := []*runtime.StorageWrite{
		{
			Collection:      CharacterCollection,
			Key:             req.ID,
			UserID:          userID,
			Value:           string(characterJSON),
			Version:         objects[0].Version, // Use version for optimistic locking
			PermissionRead:  1,
			PermissionWrite: 1,
		},
	}

	if _, err := nk.StorageWrite(ctx, writes); err != nil {
		logger.Error("Failed to store updated character: %v", err)
		return "", errors.New("failed to save character - it may have been modified")
	}

	logger.Info("Character updated: %s for user %s", req.ID, userID)
	return string(characterJSON), nil
}

// rpcDeleteCharacter deletes a character by ID
func rpcDeleteCharacter(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("user ID not found in context - authentication required")
	}

	// Parse the request
	var req DeleteCharacterRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		logger.Error("Failed to parse delete character request: %v", err)
		return "", errors.New("invalid request payload")
	}

	if req.ID == "" {
		return "", errors.New("character ID is required")
	}

	// Verify the character exists before deleting
	reads := []*runtime.StorageRead{
		{
			Collection: CharacterCollection,
			Key:        req.ID,
			UserID:     userID,
		},
	}

	objects, err := nk.StorageRead(ctx, reads)
	if err != nil {
		logger.Error("Failed to read character for deletion: %v", err)
		return "", errors.New("failed to verify character")
	}

	if len(objects) == 0 {
		return "", errors.New("character not found")
	}

	// Delete the character
	deletes := []*runtime.StorageDelete{
		{
			Collection: CharacterCollection,
			Key:        req.ID,
			UserID:     userID,
		},
	}

	if err := nk.StorageDelete(ctx, deletes); err != nil {
		logger.Error("Failed to delete character: %v", err)
		return "", errors.New("failed to delete character")
	}

	logger.Info("Character deleted: %s for user %s", req.ID, userID)

	// Return success message
	response := map[string]string{
		"status":  "success",
		"message": "Character deleted successfully",
		"id":      req.ID,
	}
	responseJSON, _ := json.Marshal(response)
	return string(responseJSON), nil
}
