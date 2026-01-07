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
// - house: character's house (Venatrix, Falcon, Brumval, Aerwyn, or "Pas de Maison")
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sort"
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

// House constants for Elderwood
const (
	HouseNone     = "Pas de Maison" // Default house for new characters
	HouseVenatrix = "Venatrix"
	HouseFalcon   = "Falcon"
	HouseBrumval  = "Brumval"
	HouseAerwyn   = "Aerwyn"
)

// Storage collections for house points
const (
	// HouseScoresCollection stores the current score for each house
	HouseScoresCollection = "house_scores"
	// HousePointsHistoryCollection stores the history of point changes
	HousePointsHistoryCollection = "house_points_history"
	// SystemUserID is used for server-owned storage (house scores)
	SystemUserID = "00000000-0000-0000-0000-000000000000"
	// MaxHistoryEntries is the maximum number of history entries to return
	MaxHistoryEntries = 100
)

// Inventory constants
const (
	// InventoryCollection stores character inventories
	InventoryCollection = "inventories"
	// MaxStackSize is the maximum quantity of a single item
	MaxStackSize = 999
)

// ItemCategory represents the category of an item
type ItemCategory string

const (
	CategoryWand        ItemCategory = "wand"
	CategoryPotion      ItemCategory = "potion"
	CategoryIngredient  ItemCategory = "ingredient"
	CategoryBook        ItemCategory = "book"
	CategoryEquipment   ItemCategory = "equipment"
	CategoryConsumable  ItemCategory = "consumable"
	CategoryQuestItem   ItemCategory = "quest_item"
	CategoryMiscellaneous ItemCategory = "misc"
)

// ItemRarity represents the rarity of an item
type ItemRarity string

const (
	RarityCommon    ItemRarity = "common"
	RarityUncommon  ItemRarity = "uncommon"
	RarityRare      ItemRarity = "rare"
	RarityEpic      ItemRarity = "epic"
	RarityLegendary ItemRarity = "legendary"
)

// Item represents an item definition in the game catalog
type Item struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Category    ItemCategory `json:"category"`
	Rarity      ItemRarity   `json:"rarity"`
	Stackable   bool         `json:"stackable"`
	MaxStack    int          `json:"max_stack"`
}

// ItemsCatalog contains all available items in the game
var ItemsCatalog = map[string]Item{
	// Wands
	"wand_oak": {
		ID: "wand_oak", Name: "Baguette en Chêne", Description: "Une baguette solide en bois de chêne",
		Category: CategoryWand, Rarity: RarityCommon, Stackable: false, MaxStack: 1,
	},
	"wand_holly": {
		ID: "wand_holly", Name: "Baguette en Houx", Description: "Une baguette élégante en bois de houx",
		Category: CategoryWand, Rarity: RarityUncommon, Stackable: false, MaxStack: 1,
	},
	"wand_elder": {
		ID: "wand_elder", Name: "Baguette de Sureau", Description: "Une baguette légendaire en bois de sureau",
		Category: CategoryWand, Rarity: RarityLegendary, Stackable: false, MaxStack: 1,
	},

	// Potions
	"potion_health": {
		ID: "potion_health", Name: "Potion de Soin", Description: "Restaure les points de vie",
		Category: CategoryPotion, Rarity: RarityCommon, Stackable: true, MaxStack: 99,
	},
	"potion_mana": {
		ID: "potion_mana", Name: "Potion de Mana", Description: "Restaure les points de mana",
		Category: CategoryPotion, Rarity: RarityCommon, Stackable: true, MaxStack: 99,
	},
	"potion_felix_felicis": {
		ID: "potion_felix_felicis", Name: "Felix Felicis", Description: "Potion de chance liquide",
		Category: CategoryPotion, Rarity: RarityLegendary, Stackable: true, MaxStack: 10,
	},
	"potion_polyjuice": {
		ID: "potion_polyjuice", Name: "Polynectar", Description: "Permet de prendre l'apparence d'une autre personne",
		Category: CategoryPotion, Rarity: RarityEpic, Stackable: true, MaxStack: 20,
	},
	"potion_invisibility": {
		ID: "potion_invisibility", Name: "Potion d'Invisibilité", Description: "Rend temporairement invisible",
		Category: CategoryPotion, Rarity: RarityRare, Stackable: true, MaxStack: 50,
	},

	// Ingredients
	"ingredient_moonstone": {
		ID: "ingredient_moonstone", Name: "Pierre de Lune", Description: "Ingrédient magique rare",
		Category: CategoryIngredient, Rarity: RarityRare, Stackable: true, MaxStack: 999,
	},
	"ingredient_bezoar": {
		ID: "ingredient_bezoar", Name: "Bézoard", Description: "Antidote universel trouvé dans l'estomac d'une chèvre",
		Category: CategoryIngredient, Rarity: RarityUncommon, Stackable: true, MaxStack: 999,
	},
	"ingredient_mandrake": {
		ID: "ingredient_mandrake", Name: "Racine de Mandragore", Description: "Plante magique aux propriétés curatives",
		Category: CategoryIngredient, Rarity: RarityUncommon, Stackable: true, MaxStack: 999,
	},
	"ingredient_phoenix_feather": {
		ID: "ingredient_phoenix_feather", Name: "Plume de Phénix", Description: "Plume rare aux propriétés magiques puissantes",
		Category: CategoryIngredient, Rarity: RarityEpic, Stackable: true, MaxStack: 100,
	},
	"ingredient_dragon_blood": {
		ID: "ingredient_dragon_blood", Name: "Sang de Dragon", Description: "Ingrédient aux 12 usages magiques",
		Category: CategoryIngredient, Rarity: RarityRare, Stackable: true, MaxStack: 500,
	},

	// Books
	"book_spells_beginner": {
		ID: "book_spells_beginner", Name: "Livre des Sorts - Niveau 1", Description: "Manuel de sorts pour débutants",
		Category: CategoryBook, Rarity: RarityCommon, Stackable: false, MaxStack: 1,
	},
	"book_potions_advanced": {
		ID: "book_potions_advanced", Name: "Potions Avancées", Description: "Guide des potions complexes",
		Category: CategoryBook, Rarity: RarityRare, Stackable: false, MaxStack: 1,
	},
	"book_dark_arts": {
		ID: "book_dark_arts", Name: "Secrets des Forces du Mal", Description: "Tome interdit sur les arts sombres",
		Category: CategoryBook, Rarity: RarityEpic, Stackable: false, MaxStack: 1,
	},

	// Equipment
	"equipment_robe_student": {
		ID: "equipment_robe_student", Name: "Robe d'Étudiant", Description: "Robe standard d'étudiant",
		Category: CategoryEquipment, Rarity: RarityCommon, Stackable: false, MaxStack: 1,
	},
	"equipment_hat_wizard": {
		ID: "equipment_hat_wizard", Name: "Chapeau de Sorcier", Description: "Chapeau pointu traditionnel",
		Category: CategoryEquipment, Rarity: RarityCommon, Stackable: false, MaxStack: 1,
	},
	"equipment_cloak_invisibility": {
		ID: "equipment_cloak_invisibility", Name: "Cape d'Invisibilité", Description: "Cape légendaire rendant invisible",
		Category: CategoryEquipment, Rarity: RarityLegendary, Stackable: false, MaxStack: 1,
	},
	"equipment_broom_nimbus": {
		ID: "equipment_broom_nimbus", Name: "Nimbus 2000", Description: "Balai de course haute performance",
		Category: CategoryEquipment, Rarity: RarityRare, Stackable: false, MaxStack: 1,
	},
	"equipment_broom_firebolt": {
		ID: "equipment_broom_firebolt", Name: "Éclair de Feu", Description: "Le meilleur balai de course au monde",
		Category: CategoryEquipment, Rarity: RarityEpic, Stackable: false, MaxStack: 1,
	},

	// Consumables
	"consumable_chocolate_frog": {
		ID: "consumable_chocolate_frog", Name: "Chocogrenouille", Description: "Friandise avec carte de collection",
		Category: CategoryConsumable, Rarity: RarityCommon, Stackable: true, MaxStack: 999,
	},
	"consumable_bertie_beans": {
		ID: "consumable_bertie_beans", Name: "Dragées de Bertie Crochue", Description: "Bonbons à tous les goûts",
		Category: CategoryConsumable, Rarity: RarityCommon, Stackable: true, MaxStack: 999,
	},
	"consumable_butterbeer": {
		ID: "consumable_butterbeer", Name: "Bièraubeurre", Description: "Boisson chaude réconfortante",
		Category: CategoryConsumable, Rarity: RarityCommon, Stackable: true, MaxStack: 99,
	},

	// Quest Items
	"quest_golden_snitch": {
		ID: "quest_golden_snitch", Name: "Vif d'Or", Description: "La balle dorée du Quidditch",
		Category: CategoryQuestItem, Rarity: RarityEpic, Stackable: false, MaxStack: 1,
	},
	"quest_marauders_map": {
		ID: "quest_marauders_map", Name: "Carte du Maraudeur", Description: "Je jure solennellement que mes intentions sont mauvaises",
		Category: CategoryQuestItem, Rarity: RarityLegendary, Stackable: false, MaxStack: 1,
	},
	"quest_time_turner": {
		ID: "quest_time_turner", Name: "Retourneur de Temps", Description: "Permet de voyager dans le temps",
		Category: CategoryQuestItem, Rarity: RarityLegendary, Stackable: false, MaxStack: 1,
	},

	// Misc
	"misc_galleon": {
		ID: "misc_galleon", Name: "Gallion", Description: "Pièce d'or des sorciers",
		Category: CategoryMiscellaneous, Rarity: RarityCommon, Stackable: true, MaxStack: 999999,
	},
	"misc_owl_treat": {
		ID: "misc_owl_treat", Name: "Friandise pour Hibou", Description: "Récompense pour votre hibou fidèle",
		Category: CategoryMiscellaneous, Rarity: RarityCommon, Stackable: true, MaxStack: 999,
	},
}

// IsValidItem checks if an item ID exists in the catalog
func IsValidItem(itemID string) bool {
	_, exists := ItemsCatalog[itemID]
	return exists
}

// GetItem returns an item from the catalog
func GetItem(itemID string) (Item, bool) {
	item, exists := ItemsCatalog[itemID]
	return item, exists
}

// ValidHouses contains all valid house values
var ValidHouses = map[string]bool{
	HouseNone:     true,
	HouseVenatrix: true,
	HouseFalcon:   true,
	HouseBrumval:  true,
	HouseAerwyn:   true,
}

// ScoringHouses contains houses that can receive points (excludes "Pas de Maison")
var ScoringHouses = []string{
	HouseVenatrix,
	HouseFalcon,
	HouseBrumval,
	HouseAerwyn,
}

// IsScoringHouse checks if a house can receive points
func IsScoringHouse(house string) bool {
	for _, h := range ScoringHouses {
		if h == house {
			return true
		}
	}
	return false
}

// IsValidHouse checks if a house name is valid
func IsValidHouse(house string) bool {
	return ValidHouses[house]
}

// Character represents a player character in the Elderwood MMO
type Character struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	House     string `json:"house"`
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
	ID    string  `json:"id"`
	Level *int    `json:"level,omitempty"`
	XP    *int64  `json:"xp,omitempty"`
	Name  *string `json:"name,omitempty"`
	House *string `json:"house,omitempty"`
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

// HouseScore represents the current score of a house
type HouseScore struct {
	House     string `json:"house"`
	Points    int64  `json:"points"`
	UpdatedAt int64  `json:"updated_at"`
}

// HousePointsEntry represents a single point change in history
type HousePointsEntry struct {
	ID            string `json:"id"`
	House         string `json:"house"`
	Points        int64  `json:"points"`         // Positive or negative amount
	CharacterName string `json:"character_name"` // Optional: character who earned/lost points
	Reason        string `json:"reason"`         // Reason for the point change
	CreatedAt     int64  `json:"created_at"`
}

// ModifyHousePointsRequest is the payload for adding/removing house points
type ModifyHousePointsRequest struct {
	House         string `json:"house"`
	Points        int64  `json:"points"`                   // Positive to add, negative to remove
	CharacterName string `json:"character_name,omitempty"` // Optional
	Reason        string `json:"reason"`
}

// GetHouseHistoryRequest is the payload for getting house points history
type GetHouseHistoryRequest struct {
	House string `json:"house,omitempty"` // Optional: filter by house
	Limit int    `json:"limit,omitempty"` // Optional: limit results
}

// HouseRanking represents a house's position in the ranking
type HouseRanking struct {
	Rank   int    `json:"rank"`
	House  string `json:"house"`
	Points int64  `json:"points"`
}

// HouseRankingsResponse is the response containing all house rankings
type HouseRankingsResponse struct {
	Rankings  []HouseRanking `json:"rankings"`
	UpdatedAt int64          `json:"updated_at"`
}

// HousePointsHistoryResponse is the response containing point history
type HousePointsHistoryResponse struct {
	Entries []HousePointsEntry `json:"entries"`
}

// InventoryItem represents an item in a character's inventory
type InventoryItem struct {
	ItemID   string `json:"item_id"`
	Quantity int    `json:"quantity"`
}

// Inventory represents a character's inventory
type Inventory struct {
	CharacterID string                   `json:"character_id"`
	Items       map[string]InventoryItem `json:"items"` // Key is item_id
	UpdatedAt   int64                    `json:"updated_at"`
}

// AddItemRequest is the payload for adding an item to inventory
type AddItemRequest struct {
	CharacterID string `json:"character_id"`
	ItemID      string `json:"item_id"`
	Quantity    int    `json:"quantity"`
}

// RemoveItemRequest is the payload for removing an item from inventory
type RemoveItemRequest struct {
	CharacterID string `json:"character_id"`
	ItemID      string `json:"item_id"`
	Quantity    int    `json:"quantity"`
}

// GetInventoryRequest is the payload for getting a character's inventory
type GetInventoryRequest struct {
	CharacterID string `json:"character_id"`
}

// InventoryItemWithDetails combines inventory item with catalog details
type InventoryItemWithDetails struct {
	ItemID      string       `json:"item_id"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Category    ItemCategory `json:"category"`
	Rarity      ItemRarity   `json:"rarity"`
	Quantity    int          `json:"quantity"`
	MaxStack    int          `json:"max_stack"`
}

// InventoryResponse is the response containing inventory with item details
type InventoryResponse struct {
	CharacterID string                     `json:"character_id"`
	Items       []InventoryItemWithDetails `json:"items"`
	TotalItems  int                        `json:"total_items"`
	UpdatedAt   int64                      `json:"updated_at"`
}

// ItemsCatalogResponse is the response containing all available items
type ItemsCatalogResponse struct {
	Items []Item `json:"items"`
	Count int    `json:"count"`
}

// GetItemsCatalogRequest is the payload for filtering the items catalog
type GetItemsCatalogRequest struct {
	Category string `json:"category,omitempty"` // Optional: filter by category
	Rarity   string `json:"rarity,omitempty"`   // Optional: filter by rarity
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

	// Register RPC endpoints for house points management
	if err := initializer.RegisterRpc("elderwood_modify_house_points", rpcModifyHousePoints); err != nil {
		logger.Error("Failed to register elderwood_modify_house_points RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_get_house_rankings", rpcGetHouseRankings); err != nil {
		logger.Error("Failed to register elderwood_get_house_rankings RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_get_house_points_history", rpcGetHousePointsHistory); err != nil {
		logger.Error("Failed to register elderwood_get_house_points_history RPC: %v", err)
		return err
	}

	// Register RPC endpoints for inventory management
	if err := initializer.RegisterRpc("elderwood_get_items_catalog", rpcGetItemsCatalog); err != nil {
		logger.Error("Failed to register elderwood_get_items_catalog RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_get_inventory", rpcGetInventory); err != nil {
		logger.Error("Failed to register elderwood_get_inventory RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_add_item", rpcAddItem); err != nil {
		logger.Error("Failed to register elderwood_add_item RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_remove_item", rpcRemoveItem); err != nil {
		logger.Error("Failed to register elderwood_remove_item RPC: %v", err)
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
		House:     HouseNone, // New characters start with no house
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

	if req.House != nil {
		if !IsValidHouse(*req.House) {
			return "", errors.New("invalid house - must be one of: Venatrix, Falcon, Brumval, Aerwyn, or Pas de Maison")
		}
		character.House = *req.House
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

// ============================================================================
// House Points System
// ============================================================================

// getHouseScore retrieves the current score for a house
func getHouseScore(ctx context.Context, nk runtime.NakamaModule, house string) (*HouseScore, error) {
	reads := []*runtime.StorageRead{
		{
			Collection: HouseScoresCollection,
			Key:        house,
			UserID:     SystemUserID,
		},
	}

	objects, err := nk.StorageRead(ctx, reads)
	if err != nil {
		return nil, err
	}

	if len(objects) == 0 {
		// Return default score of 0
		return &HouseScore{
			House:     house,
			Points:    0,
			UpdatedAt: time.Now().Unix(),
		}, nil
	}

	var score HouseScore
	if err := json.Unmarshal([]byte(objects[0].Value), &score); err != nil {
		return nil, err
	}

	return &score, nil
}

// saveHouseScore saves the current score for a house
func saveHouseScore(ctx context.Context, nk runtime.NakamaModule, score *HouseScore) error {
	scoreJSON, err := json.Marshal(score)
	if err != nil {
		return err
	}

	writes := []*runtime.StorageWrite{
		{
			Collection:      HouseScoresCollection,
			Key:             score.House,
			UserID:          SystemUserID,
			Value:           string(scoreJSON),
			PermissionRead:  2, // Public read
			PermissionWrite: 0, // Server only write
		},
	}

	_, err = nk.StorageWrite(ctx, writes)
	return err
}

// savePointsHistoryEntry saves a point change to history
func savePointsHistoryEntry(ctx context.Context, nk runtime.NakamaModule, entry *HousePointsEntry) error {
	entryJSON, err := json.Marshal(entry)
	if err != nil {
		return err
	}

	writes := []*runtime.StorageWrite{
		{
			Collection:      HousePointsHistoryCollection,
			Key:             entry.ID,
			UserID:          SystemUserID,
			Value:           string(entryJSON),
			PermissionRead:  2, // Public read
			PermissionWrite: 0, // Server only write
		},
	}

	_, err = nk.StorageWrite(ctx, writes)
	return err
}

// rpcModifyHousePoints adds or removes points from a house
func rpcModifyHousePoints(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	// Parse the request
	var req ModifyHousePointsRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		logger.Error("Failed to parse modify house points request: %v", err)
		return "", errors.New("invalid request payload")
	}

	// Validate house
	if !IsScoringHouse(req.House) {
		return "", errors.New("invalid house - must be one of: Venatrix, Falcon, Brumval, or Aerwyn")
	}

	// Validate points
	if req.Points == 0 {
		return "", errors.New("points must be non-zero")
	}

	// Validate reason
	if req.Reason == "" {
		return "", errors.New("reason is required")
	}
	if len(req.Reason) > 256 {
		return "", errors.New("reason must be 256 characters or less")
	}

	// Validate character name if provided
	if req.CharacterName != "" && len(req.CharacterName) > 32 {
		return "", errors.New("character name must be 32 characters or less")
	}

	// Get current score
	score, err := getHouseScore(ctx, nk, req.House)
	if err != nil {
		logger.Error("Failed to get house score: %v", err)
		return "", errors.New("failed to retrieve house score")
	}

	// Update score
	score.Points += req.Points
	score.UpdatedAt = time.Now().Unix()

	// Prevent negative total score
	if score.Points < 0 {
		score.Points = 0
	}

	// Save updated score
	if err := saveHouseScore(ctx, nk, score); err != nil {
		logger.Error("Failed to save house score: %v", err)
		return "", errors.New("failed to update house score")
	}

	// Create history entry
	entry := &HousePointsEntry{
		ID:            uuid.Must(uuid.NewV4()).String(),
		House:         req.House,
		Points:        req.Points,
		CharacterName: req.CharacterName,
		Reason:        req.Reason,
		CreatedAt:     time.Now().Unix(),
	}

	// Save history entry
	if err := savePointsHistoryEntry(ctx, nk, entry); err != nil {
		logger.Warn("Failed to save points history entry: %v", err)
		// Don't fail the request if history save fails
	}

	// Log the action
	if req.CharacterName != "" {
		logger.Info("House points modified: %s %+d points for %s (character: %s, reason: %s)",
			req.House, req.Points, req.House, req.CharacterName, req.Reason)
	} else {
		logger.Info("House points modified: %s %+d points (reason: %s)",
			req.House, req.Points, req.Reason)
	}

	// Return the updated score and history entry
	response := map[string]interface{}{
		"house_score": score,
		"entry":       entry,
	}
	responseJSON, _ := json.Marshal(response)
	return string(responseJSON), nil
}

// rpcGetHouseRankings returns the current rankings of all houses
func rpcGetHouseRankings(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	// Get scores for all scoring houses
	var scores []HouseScore
	var latestUpdate int64

	for _, house := range ScoringHouses {
		score, err := getHouseScore(ctx, nk, house)
		if err != nil {
			logger.Error("Failed to get score for house %s: %v", house, err)
			continue
		}
		scores = append(scores, *score)
		if score.UpdatedAt > latestUpdate {
			latestUpdate = score.UpdatedAt
		}
	}

	// Sort by points descending
	sort.Slice(scores, func(i, j int) bool {
		return scores[i].Points > scores[j].Points
	})

	// Build rankings with rank numbers
	rankings := make([]HouseRanking, len(scores))
	for i, score := range scores {
		rankings[i] = HouseRanking{
			Rank:   i + 1,
			House:  score.House,
			Points: score.Points,
		}
	}

	response := HouseRankingsResponse{
		Rankings:  rankings,
		UpdatedAt: latestUpdate,
	}

	responseJSON, err := json.Marshal(response)
	if err != nil {
		logger.Error("Failed to serialize rankings response: %v", err)
		return "", errors.New("failed to build response")
	}

	return string(responseJSON), nil
}

// rpcGetHousePointsHistory returns the history of point changes
func rpcGetHousePointsHistory(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	// Parse the request
	var req GetHouseHistoryRequest
	if payload != "" && payload != "{}" {
		if err := json.Unmarshal([]byte(payload), &req); err != nil {
			logger.Error("Failed to parse get house history request: %v", err)
			return "", errors.New("invalid request payload")
		}
	}

	// Validate house filter if provided
	if req.House != "" && !IsScoringHouse(req.House) {
		return "", errors.New("invalid house filter - must be one of: Venatrix, Falcon, Brumval, or Aerwyn")
	}

	// Set default limit
	limit := req.Limit
	if limit <= 0 || limit > MaxHistoryEntries {
		limit = MaxHistoryEntries
	}

	// List history entries
	objects, _, err := nk.StorageList(ctx, "", SystemUserID, HousePointsHistoryCollection, limit, "")
	if err != nil {
		logger.Error("Failed to list house points history: %v", err)
		return "", errors.New("failed to retrieve history")
	}

	// Parse entries and optionally filter by house
	entries := make([]HousePointsEntry, 0, len(objects))
	for _, obj := range objects {
		var entry HousePointsEntry
		if err := json.Unmarshal([]byte(obj.Value), &entry); err != nil {
			logger.Warn("Failed to parse history entry %s: %v", obj.Key, err)
			continue
		}

		// Apply house filter if specified
		if req.House != "" && entry.House != req.House {
			continue
		}

		entries = append(entries, entry)
	}

	// Sort by creation time descending (most recent first)
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].CreatedAt > entries[j].CreatedAt
	})

	// Apply limit after filtering
	if len(entries) > limit {
		entries = entries[:limit]
	}

	response := HousePointsHistoryResponse{
		Entries: entries,
	}

	responseJSON, err := json.Marshal(response)
	if err != nil {
		logger.Error("Failed to serialize history response: %v", err)
		return "", errors.New("failed to build response")
	}

	return string(responseJSON), nil
}

// ============================================================================
// Inventory System
// ============================================================================

// getInventory retrieves the inventory for a character
func getInventory(ctx context.Context, nk runtime.NakamaModule, userID, characterID string) (*Inventory, error) {
	reads := []*runtime.StorageRead{
		{
			Collection: InventoryCollection,
			Key:        characterID,
			UserID:     userID,
		},
	}

	objects, err := nk.StorageRead(ctx, reads)
	if err != nil {
		return nil, err
	}

	if len(objects) == 0 {
		// Return empty inventory
		return &Inventory{
			CharacterID: characterID,
			Items:       make(map[string]InventoryItem),
			UpdatedAt:   time.Now().Unix(),
		}, nil
	}

	var inventory Inventory
	if err := json.Unmarshal([]byte(objects[0].Value), &inventory); err != nil {
		return nil, err
	}

	// Ensure Items map is initialized
	if inventory.Items == nil {
		inventory.Items = make(map[string]InventoryItem)
	}

	return &inventory, nil
}

// saveInventory saves the inventory for a character
func saveInventory(ctx context.Context, nk runtime.NakamaModule, userID string, inventory *Inventory) error {
	inventoryJSON, err := json.Marshal(inventory)
	if err != nil {
		return err
	}

	writes := []*runtime.StorageWrite{
		{
			Collection:      InventoryCollection,
			Key:             inventory.CharacterID,
			UserID:          userID,
			Value:           string(inventoryJSON),
			PermissionRead:  1, // Owner can read
			PermissionWrite: 1, // Owner can write
		},
	}

	_, err = nk.StorageWrite(ctx, writes)
	return err
}

// verifyCharacterOwnership checks if the user owns the character
func verifyCharacterOwnership(ctx context.Context, nk runtime.NakamaModule, userID, characterID string) error {
	reads := []*runtime.StorageRead{
		{
			Collection: CharacterCollection,
			Key:        characterID,
			UserID:     userID,
		},
	}

	objects, err := nk.StorageRead(ctx, reads)
	if err != nil {
		return err
	}

	if len(objects) == 0 {
		return errors.New("character not found or not owned by user")
	}

	return nil
}

// rpcGetItemsCatalog returns the list of all available items
func rpcGetItemsCatalog(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	// Parse optional filter request
	var req GetItemsCatalogRequest
	if payload != "" && payload != "{}" {
		if err := json.Unmarshal([]byte(payload), &req); err != nil {
			logger.Error("Failed to parse get items catalog request: %v", err)
			return "", errors.New("invalid request payload")
		}
	}

	// Collect and filter items
	items := make([]Item, 0, len(ItemsCatalog))
	for _, item := range ItemsCatalog {
		// Apply category filter if specified
		if req.Category != "" && string(item.Category) != req.Category {
			continue
		}
		// Apply rarity filter if specified
		if req.Rarity != "" && string(item.Rarity) != req.Rarity {
			continue
		}
		items = append(items, item)
	}

	// Sort items by category then by name for consistent ordering
	sort.Slice(items, func(i, j int) bool {
		if items[i].Category != items[j].Category {
			return items[i].Category < items[j].Category
		}
		return items[i].Name < items[j].Name
	})

	response := ItemsCatalogResponse{
		Items: items,
		Count: len(items),
	}

	responseJSON, err := json.Marshal(response)
	if err != nil {
		logger.Error("Failed to serialize items catalog response: %v", err)
		return "", errors.New("failed to build response")
	}

	return string(responseJSON), nil
}

// rpcGetInventory returns the inventory for a character
func rpcGetInventory(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("user ID not found in context - authentication required")
	}

	// Parse the request
	var req GetInventoryRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		logger.Error("Failed to parse get inventory request: %v", err)
		return "", errors.New("invalid request payload")
	}

	if req.CharacterID == "" {
		return "", errors.New("character_id is required")
	}

	// Verify the user owns this character
	if err := verifyCharacterOwnership(ctx, nk, userID, req.CharacterID); err != nil {
		return "", err
	}

	// Get the inventory
	inventory, err := getInventory(ctx, nk, userID, req.CharacterID)
	if err != nil {
		logger.Error("Failed to get inventory: %v", err)
		return "", errors.New("failed to retrieve inventory")
	}

	// Build response with item details
	itemsWithDetails := make([]InventoryItemWithDetails, 0, len(inventory.Items))
	totalItems := 0

	for _, invItem := range inventory.Items {
		item, exists := GetItem(invItem.ItemID)
		if !exists {
			logger.Warn("Item %s in inventory not found in catalog", invItem.ItemID)
			continue
		}

		itemsWithDetails = append(itemsWithDetails, InventoryItemWithDetails{
			ItemID:      item.ID,
			Name:        item.Name,
			Description: item.Description,
			Category:    item.Category,
			Rarity:      item.Rarity,
			Quantity:    invItem.Quantity,
			MaxStack:    item.MaxStack,
		})
		totalItems += invItem.Quantity
	}

	// Sort by category then by name
	sort.Slice(itemsWithDetails, func(i, j int) bool {
		if itemsWithDetails[i].Category != itemsWithDetails[j].Category {
			return itemsWithDetails[i].Category < itemsWithDetails[j].Category
		}
		return itemsWithDetails[i].Name < itemsWithDetails[j].Name
	})

	response := InventoryResponse{
		CharacterID: req.CharacterID,
		Items:       itemsWithDetails,
		TotalItems:  totalItems,
		UpdatedAt:   inventory.UpdatedAt,
	}

	responseJSON, err := json.Marshal(response)
	if err != nil {
		logger.Error("Failed to serialize inventory response: %v", err)
		return "", errors.New("failed to build response")
	}

	return string(responseJSON), nil
}

// rpcAddItem adds an item to a character's inventory
func rpcAddItem(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("user ID not found in context - authentication required")
	}

	// Parse the request
	var req AddItemRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		logger.Error("Failed to parse add item request: %v", err)
		return "", errors.New("invalid request payload")
	}

	// Validate request
	if req.CharacterID == "" {
		return "", errors.New("character_id is required")
	}
	if req.ItemID == "" {
		return "", errors.New("item_id is required")
	}
	if req.Quantity <= 0 {
		return "", errors.New("quantity must be positive")
	}

	// Verify item exists in catalog
	item, exists := GetItem(req.ItemID)
	if !exists {
		return "", errors.New("item not found in catalog")
	}

	// Verify the user owns this character
	if err := verifyCharacterOwnership(ctx, nk, userID, req.CharacterID); err != nil {
		return "", err
	}

	// Get current inventory
	inventory, err := getInventory(ctx, nk, userID, req.CharacterID)
	if err != nil {
		logger.Error("Failed to get inventory: %v", err)
		return "", errors.New("failed to retrieve inventory")
	}

	// Add or update item in inventory
	currentItem, exists := inventory.Items[req.ItemID]
	newQuantity := req.Quantity
	if exists {
		newQuantity += currentItem.Quantity
	}

	// Check max stack
	if newQuantity > item.MaxStack {
		return "", errors.New("quantity exceeds maximum stack size for this item")
	}

	inventory.Items[req.ItemID] = InventoryItem{
		ItemID:   req.ItemID,
		Quantity: newQuantity,
	}
	inventory.UpdatedAt = time.Now().Unix()

	// Save inventory
	if err := saveInventory(ctx, nk, userID, inventory); err != nil {
		logger.Error("Failed to save inventory: %v", err)
		return "", errors.New("failed to save inventory")
	}

	logger.Info("Added %d x %s to character %s inventory", req.Quantity, req.ItemID, req.CharacterID)

	// Return the updated item info
	response := map[string]interface{}{
		"character_id": req.CharacterID,
		"item_id":      req.ItemID,
		"item_name":    item.Name,
		"quantity":     newQuantity,
		"added":        req.Quantity,
	}
	responseJSON, _ := json.Marshal(response)
	return string(responseJSON), nil
}

// rpcRemoveItem removes an item from a character's inventory
func rpcRemoveItem(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("user ID not found in context - authentication required")
	}

	// Parse the request
	var req RemoveItemRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		logger.Error("Failed to parse remove item request: %v", err)
		return "", errors.New("invalid request payload")
	}

	// Validate request
	if req.CharacterID == "" {
		return "", errors.New("character_id is required")
	}
	if req.ItemID == "" {
		return "", errors.New("item_id is required")
	}
	if req.Quantity <= 0 {
		return "", errors.New("quantity must be positive")
	}

	// Verify the user owns this character
	if err := verifyCharacterOwnership(ctx, nk, userID, req.CharacterID); err != nil {
		return "", err
	}

	// Get current inventory
	inventory, err := getInventory(ctx, nk, userID, req.CharacterID)
	if err != nil {
		logger.Error("Failed to get inventory: %v", err)
		return "", errors.New("failed to retrieve inventory")
	}

	// Check if item exists in inventory
	currentItem, exists := inventory.Items[req.ItemID]
	if !exists {
		return "", errors.New("item not found in inventory")
	}

	// Check if there's enough quantity
	if currentItem.Quantity < req.Quantity {
		return "", errors.New("not enough items in inventory")
	}

	// Update or remove item
	newQuantity := currentItem.Quantity - req.Quantity
	if newQuantity <= 0 {
		delete(inventory.Items, req.ItemID)
	} else {
		inventory.Items[req.ItemID] = InventoryItem{
			ItemID:   req.ItemID,
			Quantity: newQuantity,
		}
	}
	inventory.UpdatedAt = time.Now().Unix()

	// Save inventory
	if err := saveInventory(ctx, nk, userID, inventory); err != nil {
		logger.Error("Failed to save inventory: %v", err)
		return "", errors.New("failed to save inventory")
	}

	logger.Info("Removed %d x %s from character %s inventory", req.Quantity, req.ItemID, req.CharacterID)

	// Get item name for response
	itemName := req.ItemID
	if item, exists := GetItem(req.ItemID); exists {
		itemName = item.Name
	}

	// Return the updated item info
	response := map[string]interface{}{
		"character_id":     req.CharacterID,
		"item_id":          req.ItemID,
		"item_name":        itemName,
		"quantity":         newQuantity,
		"removed":          req.Quantity,
		"removed_entirely": newQuantity <= 0,
	}
	responseJSON, _ := json.Marshal(response)
	return string(responseJSON), nil
}
