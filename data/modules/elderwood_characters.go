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

// Spells constants
const (
	// SpellsCollection stores character spells
	SpellsCollection = "character_spells"
	// MaxSpellLevel is the maximum level a spell can reach
	MaxSpellLevel = 3
	// MinSpellLevel is the starting level for learned spells
	MinSpellLevel = 0
)

// Notebook constants
const (
	// NotebooksCollection stores character notebooks
	NotebooksCollection = "notebooks"
	// MaxNotebookTitleLength is the maximum length of a notebook title
	MaxNotebookTitleLength = 128
	// MaxNotebookContentLength is the maximum length of notebook content
	MaxNotebookContentLength = 10000
)

// AdminRole represents a staff role
type AdminRole string

const (
	RoleDouanier     AdminRole = "Douanier"
	RoleMJ           AdminRole = "MJ"
	RoleAnimateur    AdminRole = "Animateur"
	RoleOwner        AdminRole = "Owner"
	RoleCoordinateur AdminRole = "Coordinateur"
	RoleGerant       AdminRole = "Gérant"
	RoleDeveloper    AdminRole = "Developeur"
)

// ValidAdminRoles contains all valid admin roles
var ValidAdminRoles = []AdminRole{
	RoleDouanier,
	RoleMJ,
	RoleAnimateur,
	RoleOwner,
	RoleCoordinateur,
	RoleGerant,
	RoleDeveloper,
}

// IsValidAdminRole checks if a role is valid
func IsValidAdminRole(role AdminRole) bool {
	for _, r := range ValidAdminRoles {
		if r == role {
			return true
		}
	}
	return false
}

// Subject represents a school subject for notebooks
type Subject string

const (
	SubjectDefense         Subject = "Défense contre les forces du mal"
	SubjectPotions         Subject = "Potions"
	SubjectTransfiguration Subject = "Métamorphose"
	SubjectCharms          Subject = "Sortilèges"
	SubjectHistory         Subject = "Histoire de la Magie"
	SubjectHerbology       Subject = "Botanique"
	SubjectAstronomy       Subject = "Astronomie"
	SubjectDivination      Subject = "Divination"
	SubjectArithmancy      Subject = "Arithmancie"
	SubjectAncientRunes    Subject = "Étude des Runes"
	SubjectCareCreatures   Subject = "Soins aux Créatures Magiques"
	SubjectMuggleStudies   Subject = "Étude des Moldus"
	SubjectAlchemy         Subject = "Alchimie"
	SubjectFlying          Subject = "Vol sur Balai"
	SubjectOther           Subject = "Autre"
)

// ValidSubjects contains all valid school subjects
var ValidSubjects = map[Subject]bool{
	SubjectDefense:         true,
	SubjectPotions:         true,
	SubjectTransfiguration: true,
	SubjectCharms:          true,
	SubjectHistory:         true,
	SubjectHerbology:       true,
	SubjectAstronomy:       true,
	SubjectDivination:      true,
	SubjectArithmancy:      true,
	SubjectAncientRunes:    true,
	SubjectCareCreatures:   true,
	SubjectMuggleStudies:   true,
	SubjectAlchemy:         true,
	SubjectFlying:          true,
	SubjectOther:           true,
}

// IsValidSubject checks if a subject is valid
func IsValidSubject(subject Subject) bool {
	return ValidSubjects[subject]
}

// GetAllSubjects returns a list of all valid subjects
func GetAllSubjects() []Subject {
	return []Subject{
		SubjectDefense,
		SubjectPotions,
		SubjectTransfiguration,
		SubjectCharms,
		SubjectHistory,
		SubjectHerbology,
		SubjectAstronomy,
		SubjectDivination,
		SubjectArithmancy,
		SubjectAncientRunes,
		SubjectCareCreatures,
		SubjectMuggleStudies,
		SubjectAlchemy,
		SubjectFlying,
		SubjectOther,
	}
}

// SpellCategory represents the category of a spell
type SpellCategory string

const (
	SpellCategoryCharm       SpellCategory = "charm"        // Enchantements
	SpellCategoryTransfiguration SpellCategory = "transfiguration" // Métamorphose
	SpellCategoryDefense     SpellCategory = "defense"      // Défense contre les forces du mal
	SpellCategoryHex         SpellCategory = "hex"          // Maléfices
	SpellCategoryCurse       SpellCategory = "curse"        // Sortilèges
	SpellCategoryHealing     SpellCategory = "healing"      // Soins
	SpellCategoryUtility     SpellCategory = "utility"      // Utilitaires
)

// SpellDifficulty represents how hard a spell is to learn
type SpellDifficulty string

const (
	DifficultyBeginner     SpellDifficulty = "beginner"
	DifficultyIntermediate SpellDifficulty = "intermediate"
	DifficultyAdvanced     SpellDifficulty = "advanced"
	DifficultyMaster       SpellDifficulty = "master"
)

// Spell represents a spell definition in the game catalog
type Spell struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Incantation string          `json:"incantation"`
	Description string          `json:"description"`
	Category    SpellCategory   `json:"category"`
	Difficulty  SpellDifficulty `json:"difficulty"`
	MinLevel    int             `json:"min_level"` // Minimum character level to learn
}

// SpellsCatalog contains all available spells in the game
var SpellsCatalog = map[string]Spell{
	// Charms (Enchantements)
	"spell_lumos": {
		ID: "spell_lumos", Name: "Lumos", Incantation: "Lumos",
		Description: "Produit un faisceau de lumière au bout de la baguette",
		Category: SpellCategoryCharm, Difficulty: DifficultyBeginner, MinLevel: 1,
	},
	"spell_nox": {
		ID: "spell_nox", Name: "Nox", Incantation: "Nox",
		Description: "Éteint la lumière produite par Lumos",
		Category: SpellCategoryCharm, Difficulty: DifficultyBeginner, MinLevel: 1,
	},
	"spell_wingardium_leviosa": {
		ID: "spell_wingardium_leviosa", Name: "Wingardium Leviosa", Incantation: "Wingardium Leviosa",
		Description: "Fait léviter un objet",
		Category: SpellCategoryCharm, Difficulty: DifficultyBeginner, MinLevel: 1,
	},
	"spell_accio": {
		ID: "spell_accio", Name: "Accio", Incantation: "Accio",
		Description: "Attire un objet vers le lanceur",
		Category: SpellCategoryCharm, Difficulty: DifficultyIntermediate, MinLevel: 4,
	},
	"spell_aguamenti": {
		ID: "spell_aguamenti", Name: "Aguamenti", Incantation: "Aguamenti",
		Description: "Fait jaillir de l'eau de la baguette",
		Category: SpellCategoryCharm, Difficulty: DifficultyIntermediate, MinLevel: 5,
	},
	"spell_alohomora": {
		ID: "spell_alohomora", Name: "Alohomora", Incantation: "Alohomora",
		Description: "Déverrouille les portes et serrures",
		Category: SpellCategoryCharm, Difficulty: DifficultyBeginner, MinLevel: 1,
	},
	"spell_reparo": {
		ID: "spell_reparo", Name: "Reparo", Incantation: "Reparo",
		Description: "Répare un objet cassé",
		Category: SpellCategoryCharm, Difficulty: DifficultyBeginner, MinLevel: 2,
	},
	"spell_expecto_patronum": {
		ID: "spell_expecto_patronum", Name: "Expecto Patronum", Incantation: "Expecto Patronum",
		Description: "Invoque un Patronus pour repousser les Détraqueurs",
		Category: SpellCategoryCharm, Difficulty: DifficultyMaster, MinLevel: 13,
	},

	// Transfiguration (Métamorphose)
	"spell_vera_verto": {
		ID: "spell_vera_verto", Name: "Vera Verto", Incantation: "Vera Verto",
		Description: "Transforme un animal en calice",
		Category: SpellCategoryTransfiguration, Difficulty: DifficultyIntermediate, MinLevel: 4,
	},
	"spell_avifors": {
		ID: "spell_avifors", Name: "Avifors", Incantation: "Avifors",
		Description: "Transforme un objet en oiseau",
		Category: SpellCategoryTransfiguration, Difficulty: DifficultyIntermediate, MinLevel: 5,
	},
	"spell_lapifors": {
		ID: "spell_lapifors", Name: "Lapifors", Incantation: "Lapifors",
		Description: "Transforme un objet en lapin",
		Category: SpellCategoryTransfiguration, Difficulty: DifficultyIntermediate, MinLevel: 6,
	},

	// Defense (Défense contre les forces du mal)
	"spell_expelliarmus": {
		ID: "spell_expelliarmus", Name: "Expelliarmus", Incantation: "Expelliarmus",
		Description: "Désarme l'adversaire",
		Category: SpellCategoryDefense, Difficulty: DifficultyIntermediate, MinLevel: 4,
	},
	"spell_protego": {
		ID: "spell_protego", Name: "Protego", Incantation: "Protego",
		Description: "Crée un bouclier magique protecteur",
		Category: SpellCategoryDefense, Difficulty: DifficultyIntermediate, MinLevel: 5,
	},
	"spell_stupefy": {
		ID: "spell_stupefy", Name: "Stupefix", Incantation: "Stupefy",
		Description: "Stupéfixie l'adversaire",
		Category: SpellCategoryDefense, Difficulty: DifficultyIntermediate, MinLevel: 5,
	},
	"spell_impedimenta": {
		ID: "spell_impedimenta", Name: "Impedimenta", Incantation: "Impedimenta",
		Description: "Ralentit ou immobilise la cible",
		Category: SpellCategoryDefense, Difficulty: DifficultyIntermediate, MinLevel: 6,
	},
	"spell_riddikulus": {
		ID: "spell_riddikulus", Name: "Riddikulus", Incantation: "Riddikulus",
		Description: "Transforme un Épouvantard en quelque chose de ridicule",
		Category: SpellCategoryDefense, Difficulty: DifficultyAdvanced, MinLevel: 7,
	},
	"spell_protego_maxima": {
		ID: "spell_protego_maxima", Name: "Protego Maxima", Incantation: "Protego Maxima",
		Description: "Version puissante du sortilège du Bouclier",
		Category: SpellCategoryDefense, Difficulty: DifficultyMaster, MinLevel: 15,
	},

	// Hex (Maléfices)
	"spell_flipendo": {
		ID: "spell_flipendo", Name: "Flipendo", Incantation: "Flipendo",
		Description: "Repousse la cible avec force",
		Category: SpellCategoryHex, Difficulty: DifficultyBeginner, MinLevel: 2,
	},
	"spell_petrificus_totalus": {
		ID: "spell_petrificus_totalus", Name: "Petrificus Totalus", Incantation: "Petrificus Totalus",
		Description: "Pétrifie complètement la cible",
		Category: SpellCategoryHex, Difficulty: DifficultyIntermediate, MinLevel: 5,
	},
	"spell_locomotor_mortis": {
		ID: "spell_locomotor_mortis", Name: "Locomotor Mortis", Incantation: "Locomotor Mortis",
		Description: "Bloque les jambes de la cible",
		Category: SpellCategoryHex, Difficulty: DifficultyBeginner, MinLevel: 3,
	},
	"spell_incendio": {
		ID: "spell_incendio", Name: "Incendio", Incantation: "Incendio",
		Description: "Produit des flammes",
		Category: SpellCategoryHex, Difficulty: DifficultyIntermediate, MinLevel: 4,
	},
	"spell_confringo": {
		ID: "spell_confringo", Name: "Confringo", Incantation: "Confringo",
		Description: "Provoque une explosion",
		Category: SpellCategoryHex, Difficulty: DifficultyAdvanced, MinLevel: 10,
	},

	// Curse (Sortilèges puissants)
	"spell_sectumsempra": {
		ID: "spell_sectumsempra", Name: "Sectumsempra", Incantation: "Sectumsempra",
		Description: "Inflige de profondes entailles à la cible",
		Category: SpellCategoryCurse, Difficulty: DifficultyMaster, MinLevel: 15,
	},
	"spell_levicorpus": {
		ID: "spell_levicorpus", Name: "Levicorpus", Incantation: "Levicorpus",
		Description: "Suspend la cible par la cheville dans les airs",
		Category: SpellCategoryCurse, Difficulty: DifficultyAdvanced, MinLevel: 8,
	},
	"spell_liberacorpus": {
		ID: "spell_liberacorpus", Name: "Liberacorpus", Incantation: "Liberacorpus",
		Description: "Contre-sort de Levicorpus",
		Category: SpellCategoryCurse, Difficulty: DifficultyAdvanced, MinLevel: 8,
	},

	// Healing (Soins)
	"spell_episkey": {
		ID: "spell_episkey", Name: "Episkey", Incantation: "Episkey",
		Description: "Soigne les blessures légères",
		Category: SpellCategoryHealing, Difficulty: DifficultyIntermediate, MinLevel: 5,
	},
	"spell_vulnera_sanentur": {
		ID: "spell_vulnera_sanentur", Name: "Vulnera Sanentur", Incantation: "Vulnera Sanentur",
		Description: "Soigne les blessures graves et les hémorragies",
		Category: SpellCategoryHealing, Difficulty: DifficultyMaster, MinLevel: 15,
	},
	"spell_ferula": {
		ID: "spell_ferula", Name: "Ferula", Incantation: "Ferula",
		Description: "Crée une attelle et des bandages",
		Category: SpellCategoryHealing, Difficulty: DifficultyIntermediate, MinLevel: 6,
	},

	// Utility (Utilitaires)
	"spell_scourgify": {
		ID: "spell_scourgify", Name: "Scourgify", Incantation: "Scourgify",
		Description: "Nettoie un objet ou une surface",
		Category: SpellCategoryUtility, Difficulty: DifficultyBeginner, MinLevel: 1,
	},
	"spell_pack": {
		ID: "spell_pack", Name: "Pack", Incantation: "Pack",
		Description: "Range automatiquement les affaires dans une valise",
		Category: SpellCategoryUtility, Difficulty: DifficultyBeginner, MinLevel: 2,
	},
	"spell_point_me": {
		ID: "spell_point_me", Name: "Point Me", Incantation: "Point Me",
		Description: "Transforme la baguette en boussole",
		Category: SpellCategoryUtility, Difficulty: DifficultyBeginner, MinLevel: 3,
	},
	"spell_muffliato": {
		ID: "spell_muffliato", Name: "Muffliato", Incantation: "Muffliato",
		Description: "Empêche les autres d'entendre une conversation",
		Category: SpellCategoryUtility, Difficulty: DifficultyAdvanced, MinLevel: 9,
	},
	"spell_apparition": {
		ID: "spell_apparition", Name: "Transplanage", Incantation: "Apparition",
		Description: "Permet de se téléporter instantanément",
		Category: SpellCategoryUtility, Difficulty: DifficultyMaster, MinLevel: 17,
	},
}

// IsValidSpell checks if a spell ID exists in the catalog
func IsValidSpell(spellID string) bool {
	_, exists := SpellsCatalog[spellID]
	return exists
}

// GetSpell returns a spell from the catalog
func GetSpell(spellID string) (Spell, bool) {
	spell, exists := SpellsCatalog[spellID]
	return spell, exists
}

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

// CharacterSpell represents a spell learned by a character
type CharacterSpell struct {
	SpellID   string `json:"spell_id"`
	Level     int    `json:"level"` // 0 to MaxSpellLevel
	LearnedAt int64  `json:"learned_at"`
	UpdatedAt int64  `json:"updated_at"`
}

// CharacterSpells represents all spells learned by a character
type CharacterSpells struct {
	CharacterID string                    `json:"character_id"`
	Spells      map[string]CharacterSpell `json:"spells"` // Key is spell_id
	UpdatedAt   int64                     `json:"updated_at"`
}

// LearnSpellRequest is the payload for learning a new spell
type LearnSpellRequest struct {
	CharacterID string `json:"character_id"`
	SpellID     string `json:"spell_id"`
}

// UpgradeSpellRequest is the payload for upgrading a spell level
type UpgradeSpellRequest struct {
	CharacterID string `json:"character_id"`
	SpellID     string `json:"spell_id"`
}

// ForgetSpellRequest is the payload for forgetting a spell
type ForgetSpellRequest struct {
	CharacterID string `json:"character_id"`
	SpellID     string `json:"spell_id"`
}

// GetCharacterSpellsRequest is the payload for getting character spells
type GetCharacterSpellsRequest struct {
	CharacterID string `json:"character_id"`
}

// GetSpellsCatalogRequest is the payload for filtering the spells catalog
type GetSpellsCatalogRequest struct {
	Category   string `json:"category,omitempty"`   // Optional: filter by category
	Difficulty string `json:"difficulty,omitempty"` // Optional: filter by difficulty
	MaxLevel   int    `json:"max_level,omitempty"`  // Optional: filter by max character level required
}

// CharacterSpellWithDetails combines learned spell with catalog details
type CharacterSpellWithDetails struct {
	SpellID     string          `json:"spell_id"`
	Name        string          `json:"name"`
	Incantation string          `json:"incantation"`
	Description string          `json:"description"`
	Category    SpellCategory   `json:"category"`
	Difficulty  SpellDifficulty `json:"difficulty"`
	Level       int             `json:"level"`     // Current mastery level (0-3)
	MaxLevel    int             `json:"max_level"` // Maximum level (always 3)
	LearnedAt   int64           `json:"learned_at"`
}

// CharacterSpellsResponse is the response containing character spells with details
type CharacterSpellsResponse struct {
	CharacterID string                      `json:"character_id"`
	Spells      []CharacterSpellWithDetails `json:"spells"`
	TotalSpells int                         `json:"total_spells"`
	UpdatedAt   int64                       `json:"updated_at"`
}

// SpellsCatalogResponse is the response containing all available spells
type SpellsCatalogResponse struct {
	Spells []Spell `json:"spells"`
	Count  int     `json:"count"`
}

// Notebook represents a character's notebook with notes for a subject
type Notebook struct {
	ID          string  `json:"id"`
	CharacterID string  `json:"character_id"`
	Title       string  `json:"title"`
	Content     string  `json:"content"`
	Subject     Subject `json:"subject"`
	CreatedAt   int64   `json:"created_at"`
	UpdatedAt   int64   `json:"updated_at"`
}

// CreateNotebookRequest is the payload for creating a new notebook
type CreateNotebookRequest struct {
	CharacterID string  `json:"character_id"`
	Title       string  `json:"title"`
	Content     string  `json:"content"`
	Subject     Subject `json:"subject"`
}

// GetNotebooksRequest is the payload for getting all notebooks of a character
type GetNotebooksRequest struct {
	CharacterID string  `json:"character_id"`
	Subject     Subject `json:"subject,omitempty"` // Optional filter by subject
}

// GetNotebookRequest is the payload for getting a specific notebook
type GetNotebookRequest struct {
	CharacterID string `json:"character_id"`
	NotebookID  string `json:"notebook_id"`
}

// UpdateNotebookRequest is the payload for updating a notebook
type UpdateNotebookRequest struct {
	CharacterID string   `json:"character_id"`
	NotebookID  string   `json:"notebook_id"`
	Title       *string  `json:"title,omitempty"`
	Content     *string  `json:"content,omitempty"`
	Subject     *Subject `json:"subject,omitempty"`
}

// DeleteNotebookRequest is the payload for deleting a notebook
type DeleteNotebookRequest struct {
	CharacterID string `json:"character_id"`
	NotebookID  string `json:"notebook_id"`
}

// NotebooksResponse is the response containing a list of notebooks
type NotebooksResponse struct {
	CharacterID string     `json:"character_id"`
	Notebooks   []Notebook `json:"notebooks"`
	Count       int        `json:"count"`
}

// SubjectsResponse is the response containing all available subjects
type SubjectsResponse struct {
	Subjects []Subject `json:"subjects"`
	Count    int       `json:"count"`
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

	// Register RPC endpoints for spells management
	if err := initializer.RegisterRpc("elderwood_get_spells_catalog", rpcGetSpellsCatalog); err != nil {
		logger.Error("Failed to register elderwood_get_spells_catalog RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_get_character_spells", rpcGetCharacterSpells); err != nil {
		logger.Error("Failed to register elderwood_get_character_spells RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_learn_spell", rpcLearnSpell); err != nil {
		logger.Error("Failed to register elderwood_learn_spell RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_upgrade_spell", rpcUpgradeSpell); err != nil {
		logger.Error("Failed to register elderwood_upgrade_spell RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_forget_spell", rpcForgetSpell); err != nil {
		logger.Error("Failed to register elderwood_forget_spell RPC: %v", err)
		return err
	}

	// Register RPC endpoints for notebook management
	if err := initializer.RegisterRpc("elderwood_get_subjects", rpcGetSubjects); err != nil {
		logger.Error("Failed to register elderwood_get_subjects RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_create_notebook", rpcCreateNotebook); err != nil {
		logger.Error("Failed to register elderwood_create_notebook RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_get_notebooks", rpcGetNotebooks); err != nil {
		logger.Error("Failed to register elderwood_get_notebooks RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_get_notebook", rpcGetNotebook); err != nil {
		logger.Error("Failed to register elderwood_get_notebook RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_update_notebook", rpcUpdateNotebook); err != nil {
		logger.Error("Failed to register elderwood_update_notebook RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_delete_notebook", rpcDeleteNotebook); err != nil {
		logger.Error("Failed to register elderwood_delete_notebook RPC: %v", err)
		return err
	}

	// Register admin RPC endpoints
	if err := initializer.RegisterRpc("elderwood_admin_list_all_characters", rpcAdminListAllCharacters); err != nil {
		logger.Error("Failed to register elderwood_admin_list_all_characters RPC: %v", err)
		return err
	}

	// Account management RPCs
	if err := initializer.RegisterRpc("elderwood_admin_list_accounts", rpcAdminListAccounts); err != nil {
		logger.Error("Failed to register elderwood_admin_list_accounts RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_admin_get_account", rpcAdminGetAccount); err != nil {
		logger.Error("Failed to register elderwood_admin_get_account RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_admin_get_roles", rpcAdminGetRoles); err != nil {
		logger.Error("Failed to register elderwood_admin_get_roles RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_admin_update_account", rpcAdminUpdateAccount); err != nil {
		logger.Error("Failed to register elderwood_admin_update_account RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_admin_delete_account", rpcAdminDeleteAccount); err != nil {
		logger.Error("Failed to register elderwood_admin_delete_account RPC: %v", err)
		return err
	}

	// Admin character management RPCs
	if err := initializer.RegisterRpc("elderwood_admin_create_character", rpcAdminCreateCharacter); err != nil {
		logger.Error("Failed to register elderwood_admin_create_character RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_admin_update_character", rpcAdminUpdateCharacter); err != nil {
		logger.Error("Failed to register elderwood_admin_update_character RPC: %v", err)
		return err
	}

	if err := initializer.RegisterRpc("elderwood_admin_delete_character", rpcAdminDeleteCharacter); err != nil {
		logger.Error("Failed to register elderwood_admin_delete_character RPC: %v", err)
		return err
	}

	logger.Info("Elderwood Characters Module initialized successfully - 32 RPCs registered")
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

// ============================================================================
// Spells System
// ============================================================================

// getCharacterSpells retrieves the spells for a character
func getCharacterSpells(ctx context.Context, nk runtime.NakamaModule, userID, characterID string) (*CharacterSpells, error) {
	reads := []*runtime.StorageRead{
		{
			Collection: SpellsCollection,
			Key:        characterID,
			UserID:     userID,
		},
	}

	objects, err := nk.StorageRead(ctx, reads)
	if err != nil {
		return nil, err
	}

	if len(objects) == 0 {
		// Return empty spells
		return &CharacterSpells{
			CharacterID: characterID,
			Spells:      make(map[string]CharacterSpell),
			UpdatedAt:   time.Now().Unix(),
		}, nil
	}

	var spells CharacterSpells
	if err := json.Unmarshal([]byte(objects[0].Value), &spells); err != nil {
		return nil, err
	}

	// Ensure Spells map is initialized
	if spells.Spells == nil {
		spells.Spells = make(map[string]CharacterSpell)
	}

	return &spells, nil
}

// saveCharacterSpells saves the spells for a character
func saveCharacterSpells(ctx context.Context, nk runtime.NakamaModule, userID string, spells *CharacterSpells) error {
	spellsJSON, err := json.Marshal(spells)
	if err != nil {
		return err
	}

	writes := []*runtime.StorageWrite{
		{
			Collection:      SpellsCollection,
			Key:             spells.CharacterID,
			UserID:          userID,
			Value:           string(spellsJSON),
			PermissionRead:  1, // Owner can read
			PermissionWrite: 1, // Owner can write
		},
	}

	_, err = nk.StorageWrite(ctx, writes)
	return err
}

// getCharacterLevel retrieves the level of a character
func getCharacterLevel(ctx context.Context, nk runtime.NakamaModule, userID, characterID string) (int, error) {
	reads := []*runtime.StorageRead{
		{
			Collection: CharacterCollection,
			Key:        characterID,
			UserID:     userID,
		},
	}

	objects, err := nk.StorageRead(ctx, reads)
	if err != nil {
		return 0, err
	}

	if len(objects) == 0 {
		return 0, errors.New("character not found")
	}

	var character Character
	if err := json.Unmarshal([]byte(objects[0].Value), &character); err != nil {
		return 0, err
	}

	return character.Level, nil
}

// rpcGetSpellsCatalog returns the list of all available spells
func rpcGetSpellsCatalog(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	// Parse optional filter request
	var req GetSpellsCatalogRequest
	if payload != "" && payload != "{}" {
		if err := json.Unmarshal([]byte(payload), &req); err != nil {
			logger.Error("Failed to parse get spells catalog request: %v", err)
			return "", errors.New("invalid request payload")
		}
	}

	// Collect and filter spells
	spells := make([]Spell, 0, len(SpellsCatalog))
	for _, spell := range SpellsCatalog {
		// Apply category filter if specified
		if req.Category != "" && string(spell.Category) != req.Category {
			continue
		}
		// Apply difficulty filter if specified
		if req.Difficulty != "" && string(spell.Difficulty) != req.Difficulty {
			continue
		}
		// Apply max level filter if specified
		if req.MaxLevel > 0 && spell.MinLevel > req.MaxLevel {
			continue
		}
		spells = append(spells, spell)
	}

	// Sort spells by category then by name for consistent ordering
	sort.Slice(spells, func(i, j int) bool {
		if spells[i].Category != spells[j].Category {
			return spells[i].Category < spells[j].Category
		}
		return spells[i].Name < spells[j].Name
	})

	response := SpellsCatalogResponse{
		Spells: spells,
		Count:  len(spells),
	}

	responseJSON, err := json.Marshal(response)
	if err != nil {
		logger.Error("Failed to serialize spells catalog response: %v", err)
		return "", errors.New("failed to build response")
	}

	return string(responseJSON), nil
}

// rpcGetCharacterSpells returns the spells learned by a character
func rpcGetCharacterSpells(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("user ID not found in context - authentication required")
	}

	// Parse the request
	var req GetCharacterSpellsRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		logger.Error("Failed to parse get character spells request: %v", err)
		return "", errors.New("invalid request payload")
	}

	if req.CharacterID == "" {
		return "", errors.New("character_id is required")
	}

	// Verify the user owns this character
	if err := verifyCharacterOwnership(ctx, nk, userID, req.CharacterID); err != nil {
		return "", err
	}

	// Get the spells
	charSpells, err := getCharacterSpells(ctx, nk, userID, req.CharacterID)
	if err != nil {
		logger.Error("Failed to get character spells: %v", err)
		return "", errors.New("failed to retrieve spells")
	}

	// Build response with spell details
	spellsWithDetails := make([]CharacterSpellWithDetails, 0, len(charSpells.Spells))

	for _, charSpell := range charSpells.Spells {
		spell, exists := GetSpell(charSpell.SpellID)
		if !exists {
			logger.Warn("Spell %s in character not found in catalog", charSpell.SpellID)
			continue
		}

		spellsWithDetails = append(spellsWithDetails, CharacterSpellWithDetails{
			SpellID:     spell.ID,
			Name:        spell.Name,
			Incantation: spell.Incantation,
			Description: spell.Description,
			Category:    spell.Category,
			Difficulty:  spell.Difficulty,
			Level:       charSpell.Level,
			MaxLevel:    MaxSpellLevel,
			LearnedAt:   charSpell.LearnedAt,
		})
	}

	// Sort by category then by name
	sort.Slice(spellsWithDetails, func(i, j int) bool {
		if spellsWithDetails[i].Category != spellsWithDetails[j].Category {
			return spellsWithDetails[i].Category < spellsWithDetails[j].Category
		}
		return spellsWithDetails[i].Name < spellsWithDetails[j].Name
	})

	response := CharacterSpellsResponse{
		CharacterID: req.CharacterID,
		Spells:      spellsWithDetails,
		TotalSpells: len(spellsWithDetails),
		UpdatedAt:   charSpells.UpdatedAt,
	}

	responseJSON, err := json.Marshal(response)
	if err != nil {
		logger.Error("Failed to serialize character spells response: %v", err)
		return "", errors.New("failed to build response")
	}

	return string(responseJSON), nil
}

// rpcLearnSpell teaches a new spell to a character
func rpcLearnSpell(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("user ID not found in context - authentication required")
	}

	// Parse the request
	var req LearnSpellRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		logger.Error("Failed to parse learn spell request: %v", err)
		return "", errors.New("invalid request payload")
	}

	// Validate request
	if req.CharacterID == "" {
		return "", errors.New("character_id is required")
	}
	if req.SpellID == "" {
		return "", errors.New("spell_id is required")
	}

	// Verify spell exists in catalog
	spell, exists := GetSpell(req.SpellID)
	if !exists {
		return "", errors.New("spell not found in catalog")
	}

	// Verify the user owns this character
	if err := verifyCharacterOwnership(ctx, nk, userID, req.CharacterID); err != nil {
		return "", err
	}

	// Check character level requirement
	charLevel, err := getCharacterLevel(ctx, nk, userID, req.CharacterID)
	if err != nil {
		logger.Error("Failed to get character level: %v", err)
		return "", errors.New("failed to verify character level")
	}

	if charLevel < spell.MinLevel {
		return "", errors.New("character level too low to learn this spell")
	}

	// Get current spells
	charSpells, err := getCharacterSpells(ctx, nk, userID, req.CharacterID)
	if err != nil {
		logger.Error("Failed to get character spells: %v", err)
		return "", errors.New("failed to retrieve spells")
	}

	// Check if spell already learned
	if _, exists := charSpells.Spells[req.SpellID]; exists {
		return "", errors.New("spell already learned")
	}

	// Add the spell
	now := time.Now().Unix()
	charSpells.Spells[req.SpellID] = CharacterSpell{
		SpellID:   req.SpellID,
		Level:     MinSpellLevel,
		LearnedAt: now,
		UpdatedAt: now,
	}
	charSpells.UpdatedAt = now

	// Save spells
	if err := saveCharacterSpells(ctx, nk, userID, charSpells); err != nil {
		logger.Error("Failed to save character spells: %v", err)
		return "", errors.New("failed to save spells")
	}

	logger.Info("Character %s learned spell %s", req.CharacterID, req.SpellID)

	// Return the learned spell info
	response := map[string]interface{}{
		"character_id": req.CharacterID,
		"spell_id":     req.SpellID,
		"spell_name":   spell.Name,
		"incantation":  spell.Incantation,
		"level":        MinSpellLevel,
		"max_level":    MaxSpellLevel,
	}
	responseJSON, _ := json.Marshal(response)
	return string(responseJSON), nil
}

// rpcUpgradeSpell upgrades a spell to the next level
func rpcUpgradeSpell(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("user ID not found in context - authentication required")
	}

	// Parse the request
	var req UpgradeSpellRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		logger.Error("Failed to parse upgrade spell request: %v", err)
		return "", errors.New("invalid request payload")
	}

	// Validate request
	if req.CharacterID == "" {
		return "", errors.New("character_id is required")
	}
	if req.SpellID == "" {
		return "", errors.New("spell_id is required")
	}

	// Verify the user owns this character
	if err := verifyCharacterOwnership(ctx, nk, userID, req.CharacterID); err != nil {
		return "", err
	}

	// Get current spells
	charSpells, err := getCharacterSpells(ctx, nk, userID, req.CharacterID)
	if err != nil {
		logger.Error("Failed to get character spells: %v", err)
		return "", errors.New("failed to retrieve spells")
	}

	// Check if spell is learned
	charSpell, exists := charSpells.Spells[req.SpellID]
	if !exists {
		return "", errors.New("spell not learned")
	}

	// Check if spell is at max level
	if charSpell.Level >= MaxSpellLevel {
		return "", errors.New("spell already at maximum level")
	}

	// Upgrade the spell
	newLevel := charSpell.Level + 1
	now := time.Now().Unix()
	charSpell.Level = newLevel
	charSpell.UpdatedAt = now
	charSpells.Spells[req.SpellID] = charSpell
	charSpells.UpdatedAt = now

	// Save spells
	if err := saveCharacterSpells(ctx, nk, userID, charSpells); err != nil {
		logger.Error("Failed to save character spells: %v", err)
		return "", errors.New("failed to save spells")
	}

	// Get spell name for response
	spellName := req.SpellID
	if spell, exists := GetSpell(req.SpellID); exists {
		spellName = spell.Name
	}

	logger.Info("Character %s upgraded spell %s to level %d", req.CharacterID, req.SpellID, newLevel)

	// Return the upgraded spell info
	response := map[string]interface{}{
		"character_id":   req.CharacterID,
		"spell_id":       req.SpellID,
		"spell_name":     spellName,
		"previous_level": newLevel - 1,
		"new_level":      newLevel,
		"max_level":      MaxSpellLevel,
	}
	responseJSON, _ := json.Marshal(response)
	return string(responseJSON), nil
}

// rpcForgetSpell removes a spell from a character
func rpcForgetSpell(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("user ID not found in context - authentication required")
	}

	// Parse the request
	var req ForgetSpellRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		logger.Error("Failed to parse forget spell request: %v", err)
		return "", errors.New("invalid request payload")
	}

	// Validate request
	if req.CharacterID == "" {
		return "", errors.New("character_id is required")
	}
	if req.SpellID == "" {
		return "", errors.New("spell_id is required")
	}

	// Verify the user owns this character
	if err := verifyCharacterOwnership(ctx, nk, userID, req.CharacterID); err != nil {
		return "", err
	}

	// Get current spells
	charSpells, err := getCharacterSpells(ctx, nk, userID, req.CharacterID)
	if err != nil {
		logger.Error("Failed to get character spells: %v", err)
		return "", errors.New("failed to retrieve spells")
	}

	// Check if spell is learned
	if _, exists := charSpells.Spells[req.SpellID]; !exists {
		return "", errors.New("spell not learned")
	}

	// Remove the spell
	delete(charSpells.Spells, req.SpellID)
	charSpells.UpdatedAt = time.Now().Unix()

	// Save spells
	if err := saveCharacterSpells(ctx, nk, userID, charSpells); err != nil {
		logger.Error("Failed to save character spells: %v", err)
		return "", errors.New("failed to save spells")
	}

	// Get spell name for response
	spellName := req.SpellID
	if spell, exists := GetSpell(req.SpellID); exists {
		spellName = spell.Name
	}

	logger.Info("Character %s forgot spell %s", req.CharacterID, req.SpellID)

	// Return success
	response := map[string]interface{}{
		"character_id": req.CharacterID,
		"spell_id":     req.SpellID,
		"spell_name":   spellName,
		"status":       "forgotten",
	}
	responseJSON, _ := json.Marshal(response)
	return string(responseJSON), nil
}

// ============================================================================
// Notebooks System
// ============================================================================

// getCharacterNotebooks retrieves all notebooks for a character
func getCharacterNotebooks(ctx context.Context, nk runtime.NakamaModule, userID, characterID string) ([]Notebook, error) {
	// List all notebooks for this character
	// We use a composite key: characterID_notebookID
	objects, _, err := nk.StorageList(ctx, "", userID, NotebooksCollection, 100, "")
	if err != nil {
		return nil, err
	}

	notebooks := make([]Notebook, 0)
	for _, obj := range objects {
		var notebook Notebook
		if err := json.Unmarshal([]byte(obj.Value), &notebook); err != nil {
			continue
		}
		// Filter by character ID
		if notebook.CharacterID == characterID {
			notebooks = append(notebooks, notebook)
		}
	}

	return notebooks, nil
}

// getNotebook retrieves a specific notebook
func getNotebook(ctx context.Context, nk runtime.NakamaModule, userID, notebookID string) (*Notebook, string, error) {
	reads := []*runtime.StorageRead{
		{
			Collection: NotebooksCollection,
			Key:        notebookID,
			UserID:     userID,
		},
	}

	objects, err := nk.StorageRead(ctx, reads)
	if err != nil {
		return nil, "", err
	}

	if len(objects) == 0 {
		return nil, "", errors.New("notebook not found")
	}

	var notebook Notebook
	if err := json.Unmarshal([]byte(objects[0].Value), &notebook); err != nil {
		return nil, "", err
	}

	return &notebook, objects[0].Version, nil
}

// saveNotebook saves a notebook to storage
func saveNotebook(ctx context.Context, nk runtime.NakamaModule, userID string, notebook *Notebook, version string) error {
	notebookJSON, err := json.Marshal(notebook)
	if err != nil {
		return err
	}

	writes := []*runtime.StorageWrite{
		{
			Collection:      NotebooksCollection,
			Key:             notebook.ID,
			UserID:          userID,
			Value:           string(notebookJSON),
			Version:         version,
			PermissionRead:  1, // Owner can read
			PermissionWrite: 1, // Owner can write
		},
	}

	_, err = nk.StorageWrite(ctx, writes)
	return err
}

// rpcGetSubjects returns the list of all available school subjects
func rpcGetSubjects(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	subjects := GetAllSubjects()

	response := SubjectsResponse{
		Subjects: subjects,
		Count:    len(subjects),
	}

	responseJSON, err := json.Marshal(response)
	if err != nil {
		logger.Error("Failed to serialize subjects response: %v", err)
		return "", errors.New("failed to build response")
	}

	return string(responseJSON), nil
}

// rpcCreateNotebook creates a new notebook for a character
func rpcCreateNotebook(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("user ID not found in context - authentication required")
	}

	// Parse the request
	var req CreateNotebookRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		logger.Error("Failed to parse create notebook request: %v", err)
		return "", errors.New("invalid request payload")
	}

	// Validate request
	if req.CharacterID == "" {
		return "", errors.New("character_id is required")
	}
	if req.Title == "" {
		return "", errors.New("title is required")
	}
	if len(req.Title) > MaxNotebookTitleLength {
		return "", errors.New("title exceeds maximum length")
	}
	if len(req.Content) > MaxNotebookContentLength {
		return "", errors.New("content exceeds maximum length")
	}
	if !IsValidSubject(req.Subject) {
		return "", errors.New("invalid subject")
	}

	// Verify the user owns this character
	if err := verifyCharacterOwnership(ctx, nk, userID, req.CharacterID); err != nil {
		return "", err
	}

	// Create the notebook
	now := time.Now().Unix()
	notebook := Notebook{
		ID:          uuid.Must(uuid.NewV4()).String(),
		CharacterID: req.CharacterID,
		Title:       req.Title,
		Content:     req.Content,
		Subject:     req.Subject,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	// Save the notebook
	if err := saveNotebook(ctx, nk, userID, &notebook, ""); err != nil {
		logger.Error("Failed to save notebook: %v", err)
		return "", errors.New("failed to create notebook")
	}

	logger.Info("Notebook created: %s for character %s", notebook.ID, req.CharacterID)

	responseJSON, err := json.Marshal(notebook)
	if err != nil {
		logger.Error("Failed to serialize notebook response: %v", err)
		return "", errors.New("failed to build response")
	}

	return string(responseJSON), nil
}

// rpcGetNotebooks returns all notebooks for a character
func rpcGetNotebooks(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("user ID not found in context - authentication required")
	}

	// Parse the request
	var req GetNotebooksRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		logger.Error("Failed to parse get notebooks request: %v", err)
		return "", errors.New("invalid request payload")
	}

	if req.CharacterID == "" {
		return "", errors.New("character_id is required")
	}

	// Validate subject filter if provided
	if req.Subject != "" && !IsValidSubject(req.Subject) {
		return "", errors.New("invalid subject filter")
	}

	// Verify the user owns this character
	if err := verifyCharacterOwnership(ctx, nk, userID, req.CharacterID); err != nil {
		return "", err
	}

	// Get all notebooks for this character
	notebooks, err := getCharacterNotebooks(ctx, nk, userID, req.CharacterID)
	if err != nil {
		logger.Error("Failed to get notebooks: %v", err)
		return "", errors.New("failed to retrieve notebooks")
	}

	// Apply subject filter if specified
	if req.Subject != "" {
		filtered := make([]Notebook, 0)
		for _, nb := range notebooks {
			if nb.Subject == req.Subject {
				filtered = append(filtered, nb)
			}
		}
		notebooks = filtered
	}

	// Sort by updated_at descending (most recent first)
	sort.Slice(notebooks, func(i, j int) bool {
		return notebooks[i].UpdatedAt > notebooks[j].UpdatedAt
	})

	response := NotebooksResponse{
		CharacterID: req.CharacterID,
		Notebooks:   notebooks,
		Count:       len(notebooks),
	}

	responseJSON, err := json.Marshal(response)
	if err != nil {
		logger.Error("Failed to serialize notebooks response: %v", err)
		return "", errors.New("failed to build response")
	}

	return string(responseJSON), nil
}

// rpcGetNotebook returns a specific notebook
func rpcGetNotebook(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("user ID not found in context - authentication required")
	}

	// Parse the request
	var req GetNotebookRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		logger.Error("Failed to parse get notebook request: %v", err)
		return "", errors.New("invalid request payload")
	}

	if req.CharacterID == "" {
		return "", errors.New("character_id is required")
	}
	if req.NotebookID == "" {
		return "", errors.New("notebook_id is required")
	}

	// Verify the user owns this character
	if err := verifyCharacterOwnership(ctx, nk, userID, req.CharacterID); err != nil {
		return "", err
	}

	// Get the notebook
	notebook, _, err := getNotebook(ctx, nk, userID, req.NotebookID)
	if err != nil {
		if err.Error() == "notebook not found" {
			return "", err
		}
		logger.Error("Failed to get notebook: %v", err)
		return "", errors.New("failed to retrieve notebook")
	}

	// Verify the notebook belongs to the character
	if notebook.CharacterID != req.CharacterID {
		return "", errors.New("notebook not found")
	}

	responseJSON, err := json.Marshal(notebook)
	if err != nil {
		logger.Error("Failed to serialize notebook response: %v", err)
		return "", errors.New("failed to build response")
	}

	return string(responseJSON), nil
}

// rpcUpdateNotebook updates a notebook's title, content, or subject
func rpcUpdateNotebook(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("user ID not found in context - authentication required")
	}

	// Parse the request
	var req UpdateNotebookRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		logger.Error("Failed to parse update notebook request: %v", err)
		return "", errors.New("invalid request payload")
	}

	if req.CharacterID == "" {
		return "", errors.New("character_id is required")
	}
	if req.NotebookID == "" {
		return "", errors.New("notebook_id is required")
	}

	// Verify the user owns this character
	if err := verifyCharacterOwnership(ctx, nk, userID, req.CharacterID); err != nil {
		return "", err
	}

	// Get the existing notebook
	notebook, version, err := getNotebook(ctx, nk, userID, req.NotebookID)
	if err != nil {
		if err.Error() == "notebook not found" {
			return "", err
		}
		logger.Error("Failed to get notebook for update: %v", err)
		return "", errors.New("failed to retrieve notebook")
	}

	// Verify the notebook belongs to the character
	if notebook.CharacterID != req.CharacterID {
		return "", errors.New("notebook not found")
	}

	// Apply updates
	if req.Title != nil {
		if *req.Title == "" {
			return "", errors.New("title cannot be empty")
		}
		if len(*req.Title) > MaxNotebookTitleLength {
			return "", errors.New("title exceeds maximum length")
		}
		notebook.Title = *req.Title
	}

	if req.Content != nil {
		if len(*req.Content) > MaxNotebookContentLength {
			return "", errors.New("content exceeds maximum length")
		}
		notebook.Content = *req.Content
	}

	if req.Subject != nil {
		if !IsValidSubject(*req.Subject) {
			return "", errors.New("invalid subject")
		}
		notebook.Subject = *req.Subject
	}

	notebook.UpdatedAt = time.Now().Unix()

	// Save the updated notebook
	if err := saveNotebook(ctx, nk, userID, notebook, version); err != nil {
		logger.Error("Failed to save updated notebook: %v", err)
		return "", errors.New("failed to update notebook - it may have been modified")
	}

	logger.Info("Notebook updated: %s for character %s", req.NotebookID, req.CharacterID)

	responseJSON, err := json.Marshal(notebook)
	if err != nil {
		logger.Error("Failed to serialize notebook response: %v", err)
		return "", errors.New("failed to build response")
	}

	return string(responseJSON), nil
}

// rpcDeleteNotebook deletes a notebook
func rpcDeleteNotebook(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", errors.New("user ID not found in context - authentication required")
	}

	// Parse the request
	var req DeleteNotebookRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		logger.Error("Failed to parse delete notebook request: %v", err)
		return "", errors.New("invalid request payload")
	}

	if req.CharacterID == "" {
		return "", errors.New("character_id is required")
	}
	if req.NotebookID == "" {
		return "", errors.New("notebook_id is required")
	}

	// Verify the user owns this character
	if err := verifyCharacterOwnership(ctx, nk, userID, req.CharacterID); err != nil {
		return "", err
	}

	// Get the notebook to verify ownership
	notebook, _, err := getNotebook(ctx, nk, userID, req.NotebookID)
	if err != nil {
		if err.Error() == "notebook not found" {
			return "", err
		}
		logger.Error("Failed to get notebook for deletion: %v", err)
		return "", errors.New("failed to verify notebook")
	}

	// Verify the notebook belongs to the character
	if notebook.CharacterID != req.CharacterID {
		return "", errors.New("notebook not found")
	}

	// Delete the notebook
	deletes := []*runtime.StorageDelete{
		{
			Collection: NotebooksCollection,
			Key:        req.NotebookID,
			UserID:     userID,
		},
	}

	if err := nk.StorageDelete(ctx, deletes); err != nil {
		logger.Error("Failed to delete notebook: %v", err)
		return "", errors.New("failed to delete notebook")
	}

	logger.Info("Notebook deleted: %s for character %s", req.NotebookID, req.CharacterID)

	// Return success message
	response := map[string]string{
		"status":      "success",
		"message":     "Notebook deleted successfully",
		"notebook_id": req.NotebookID,
	}
	responseJSON, _ := json.Marshal(response)
	return string(responseJSON), nil
}

// AdminCharacterEntry represents a character with owner info for admin listing
type AdminCharacterEntry struct {
	Character
	OwnerID       string `json:"owner_id"`
	OwnerUsername string `json:"owner_username"`
}

// AdminListAllCharactersResponse is the response for admin character listing
type AdminListAllCharactersResponse struct {
	Characters []AdminCharacterEntry `json:"characters"`
	Count      int                   `json:"count"`
}

// rpcAdminListAllCharacters lists all characters from all users (admin function)
func rpcAdminListAllCharacters(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	// Get random users to iterate through (limitation: we can only get random users)
	users, err := nk.UsersGetRandom(ctx, 100)
	if err != nil {
		logger.Error("Failed to get users: %v", err)
		return "", errors.New("failed to retrieve users")
	}

	allCharacters := make([]AdminCharacterEntry, 0)

	// For each user, get their characters
	for _, user := range users {
		objects, _, err := nk.StorageList(ctx, "", user.Id, CharacterCollection, 10, "")
		if err != nil {
			logger.Warn("Failed to list characters for user %s: %v", user.Id, err)
			continue
		}

		for _, obj := range objects {
			var character Character
			if err := json.Unmarshal([]byte(obj.Value), &character); err != nil {
				logger.Warn("Failed to parse character %s: %v", obj.Key, err)
				continue
			}

			entry := AdminCharacterEntry{
				Character:     character,
				OwnerID:       user.Id,
				OwnerUsername: user.Username,
			}
			allCharacters = append(allCharacters, entry)
		}
	}

	response := AdminListAllCharactersResponse{
		Characters: allCharacters,
		Count:      len(allCharacters),
	}

	responseJSON, err := json.Marshal(response)
	if err != nil {
		logger.Error("Failed to serialize admin response: %v", err)
		return "", errors.New("failed to build response")
	}

	return string(responseJSON), nil
}

// ============================================================================
// Account Management Types
// ============================================================================

// AccountInfo represents a Nakama account with metadata
type AccountInfo struct {
	UserID      string    `json:"user_id"`
	Username    string    `json:"username"`
	DisplayName string    `json:"display_name"`
	Email       string    `json:"email"`
	Role        AdminRole `json:"role"`
	CreateTime  int64     `json:"create_time"`
	UpdateTime  int64     `json:"update_time"`
}

// AdminListAccountsResponse is the response for listing all accounts
type AdminListAccountsResponse struct {
	Accounts []AccountInfo `json:"accounts"`
	Count    int           `json:"count"`
}

// AdminGetAccountRequest is the request for getting a specific account
type AdminGetAccountRequest struct {
	UserID string `json:"user_id"`
}

// AdminUpdateAccountRequest is the request for updating an account
type AdminUpdateAccountRequest struct {
	UserID      string     `json:"user_id"`
	Username    *string    `json:"username,omitempty"`
	DisplayName *string    `json:"display_name,omitempty"`
	Role        *AdminRole `json:"role,omitempty"`
}

// AdminDeleteAccountRequest is the request for deleting an account
type AdminDeleteAccountRequest struct {
	UserID string `json:"user_id"`
}

// AdminCreateCharacterRequest is the request for admin creating a character for a user
type AdminCreateCharacterRequest struct {
	UserID string `json:"user_id"`
	Name   string `json:"name"`
}

// ============================================================================
// Account Management RPCs
// ============================================================================

// rpcAdminListAccounts lists all accounts in the system
func rpcAdminListAccounts(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	// Get users from the database
	users, err := nk.UsersGetRandom(ctx, 100)
	if err != nil {
		logger.Error("Failed to get users: %v", err)
		return "", errors.New("failed to retrieve users")
	}

	accounts := make([]AccountInfo, 0, len(users))
	for _, user := range users {
		// Parse metadata for role
		var role AdminRole = ""
		if user.Metadata != nil {
			var metadata map[string]interface{}
			if err := json.Unmarshal([]byte(user.Metadata), &metadata); err == nil {
				if r, ok := metadata["role"].(string); ok {
					role = AdminRole(r)
				}
			}
		}

		accounts = append(accounts, AccountInfo{
			UserID:      user.Id,
			Username:    user.Username,
			DisplayName: user.DisplayName,
			Role:        role,
			CreateTime:  user.CreateTime.Seconds,
			UpdateTime:  user.UpdateTime.Seconds,
		})
	}

	response := AdminListAccountsResponse{
		Accounts: accounts,
		Count:    len(accounts),
	}

	responseJSON, err := json.Marshal(response)
	if err != nil {
		logger.Error("Failed to serialize response: %v", err)
		return "", errors.New("failed to build response")
	}

	return string(responseJSON), nil
}

// rpcAdminGetAccount gets a specific account by user ID
func rpcAdminGetAccount(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	var req AdminGetAccountRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		logger.Error("Failed to parse request: %v", err)
		return "", errors.New("invalid request payload")
	}

	if req.UserID == "" {
		return "", errors.New("user_id is required")
	}

	users, err := nk.UsersGetId(ctx, []string{req.UserID}, nil)
	if err != nil {
		logger.Error("Failed to get user: %v", err)
		return "", errors.New("failed to retrieve user")
	}

	if len(users) == 0 {
		return "", errors.New("user not found")
	}

	user := users[0]

	// Parse metadata for role
	var role AdminRole = ""
	if user.Metadata != nil {
		var metadata map[string]interface{}
		if err := json.Unmarshal([]byte(user.Metadata), &metadata); err == nil {
			if r, ok := metadata["role"].(string); ok {
				role = AdminRole(r)
			}
		}
	}

	account := AccountInfo{
		UserID:      user.Id,
		Username:    user.Username,
		DisplayName: user.DisplayName,
		Role:        role,
		CreateTime:  user.CreateTime.Seconds,
		UpdateTime:  user.UpdateTime.Seconds,
	}

	responseJSON, err := json.Marshal(account)
	if err != nil {
		logger.Error("Failed to serialize response: %v", err)
		return "", errors.New("failed to build response")
	}

	return string(responseJSON), nil
}

// rpcAdminGetRoles returns all available admin roles
func rpcAdminGetRoles(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	response := map[string][]AdminRole{
		"roles": ValidAdminRoles,
	}

	responseJSON, err := json.Marshal(response)
	if err != nil {
		logger.Error("Failed to serialize response: %v", err)
		return "", errors.New("failed to build response")
	}

	return string(responseJSON), nil
}

// rpcAdminUpdateAccount updates an account's metadata (role)
func rpcAdminUpdateAccount(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	var req AdminUpdateAccountRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		logger.Error("Failed to parse request: %v", err)
		return "", errors.New("invalid request payload")
	}

	if req.UserID == "" {
		return "", errors.New("user_id is required")
	}

	// Get current user
	users, err := nk.UsersGetId(ctx, []string{req.UserID}, nil)
	if err != nil || len(users) == 0 {
		return "", errors.New("user not found")
	}

	user := users[0]

	// Parse existing metadata
	metadata := make(map[string]interface{})
	if user.Metadata != nil {
		json.Unmarshal([]byte(user.Metadata), &metadata)
	}

	// Update role if provided
	if req.Role != nil {
		if *req.Role != "" && !IsValidAdminRole(*req.Role) {
			return "", errors.New("invalid role")
		}
		metadata["role"] = string(*req.Role)
	}

	// Update the account
	displayName := user.DisplayName
	if req.DisplayName != nil {
		displayName = *req.DisplayName
	}

	username := user.Username
	if req.Username != nil {
		username = *req.Username
	}

	if err := nk.AccountUpdateId(ctx, req.UserID, username, metadata, displayName, "", "", "", ""); err != nil {
		logger.Error("Failed to update account: %v", err)
		return "", errors.New("failed to update account")
	}

	// Return updated account info
	var role AdminRole = ""
	if r, ok := metadata["role"].(string); ok {
		role = AdminRole(r)
	}

	account := AccountInfo{
		UserID:      req.UserID,
		Username:    username,
		DisplayName: displayName,
		Role:        role,
	}

	responseJSON, err := json.Marshal(account)
	if err != nil {
		return "", errors.New("failed to build response")
	}

	logger.Info("Account updated: %s", req.UserID)
	return string(responseJSON), nil
}

// rpcAdminDeleteAccount deletes an account
func rpcAdminDeleteAccount(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	var req AdminDeleteAccountRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		logger.Error("Failed to parse request: %v", err)
		return "", errors.New("invalid request payload")
	}

	if req.UserID == "" {
		return "", errors.New("user_id is required")
	}

	// Delete the account
	if err := nk.AccountDeleteId(ctx, req.UserID, false); err != nil {
		logger.Error("Failed to delete account: %v", err)
		return "", errors.New("failed to delete account")
	}

	logger.Info("Account deleted: %s", req.UserID)

	response := map[string]string{
		"status":  "success",
		"message": "Account deleted successfully",
		"user_id": req.UserID,
	}

	responseJSON, _ := json.Marshal(response)
	return string(responseJSON), nil
}

// rpcAdminCreateCharacter creates a character for a specific user (admin function)
func rpcAdminCreateCharacter(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	var req AdminCreateCharacterRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		logger.Error("Failed to parse request: %v", err)
		return "", errors.New("invalid request payload")
	}

	if req.UserID == "" {
		return "", errors.New("user_id is required")
	}
	if req.Name == "" {
		return "", errors.New("character name is required")
	}
	if len(req.Name) < 2 || len(req.Name) > 32 {
		return "", errors.New("character name must be between 2 and 32 characters")
	}

	// Verify user exists
	users, err := nk.UsersGetId(ctx, []string{req.UserID}, nil)
	if err != nil || len(users) == 0 {
		return "", errors.New("user not found")
	}

	// Check existing characters for this user
	existingCharacters, _, err := nk.StorageList(ctx, "", req.UserID, CharacterCollection, MaxCharactersPerAccount+1, "")
	if err != nil {
		logger.Error("Failed to list existing characters: %v", err)
		return "", errors.New("failed to check existing characters")
	}

	if len(existingCharacters) >= MaxCharactersPerAccount {
		return "", errors.New("maximum number of characters reached for this user")
	}

	// Check for duplicate name
	for _, obj := range existingCharacters {
		var existing Character
		if err := json.Unmarshal([]byte(obj.Value), &existing); err == nil {
			if existing.Name == req.Name {
				return "", errors.New("a character with this name already exists for this user")
			}
		}
	}

	// Create the character
	characterID := uuid.Must(uuid.NewV4()).String()
	now := time.Now().Unix()

	character := Character{
		ID:        characterID,
		Name:      req.Name,
		House:     HouseNone,
		Level:     DefaultCharacterLevel,
		XP:        DefaultCharacterXP,
		CreatedAt: now,
		UpdatedAt: now,
	}

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
			UserID:          req.UserID,
			Value:           string(characterJSON),
			PermissionRead:  1,
			PermissionWrite: 1,
		},
	}

	if _, err := nk.StorageWrite(ctx, writes); err != nil {
		logger.Error("Failed to store character: %v", err)
		return "", errors.New("failed to save character")
	}

	// Return with owner info
	entry := AdminCharacterEntry{
		Character:     character,
		OwnerID:       req.UserID,
		OwnerUsername: users[0].Username,
	}

	responseJSON, _ := json.Marshal(entry)
	logger.Info("Admin created character: %s for user %s", characterID, req.UserID)
	return string(responseJSON), nil
}

// rpcAdminUpdateCharacter updates a character (admin function, can update any user's character)
func rpcAdminUpdateCharacter(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	var req struct {
		UserID string  `json:"user_id"`
		ID     string  `json:"id"`
		Name   *string `json:"name,omitempty"`
		House  *string `json:"house,omitempty"`
		Level  *int    `json:"level,omitempty"`
		XP     *int    `json:"xp,omitempty"`
	}
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		logger.Error("Failed to parse request: %v", err)
		return "", errors.New("invalid request payload")
	}

	if req.UserID == "" {
		return "", errors.New("user_id is required")
	}
	if req.ID == "" {
		return "", errors.New("character id is required")
	}

	// Read the existing character
	reads := []*runtime.StorageRead{
		{
			Collection: CharacterCollection,
			Key:        req.ID,
			UserID:     req.UserID,
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

	var character Character
	if err := json.Unmarshal([]byte(objects[0].Value), &character); err != nil {
		logger.Error("Failed to parse character: %v", err)
		return "", errors.New("failed to parse character data")
	}

	// Apply updates
	if req.Name != nil {
		if len(*req.Name) < 2 || len(*req.Name) > 32 {
			return "", errors.New("character name must be between 2 and 32 characters")
		}
		character.Name = *req.Name
	}
	if req.House != nil {
		if !IsValidHouse(*req.House) {
			return "", errors.New("invalid house")
		}
		character.House = *req.House
	}
	if req.Level != nil {
		if *req.Level < 1 || *req.Level > 100 {
			return "", errors.New("level must be between 1 and 100")
		}
		character.Level = *req.Level
	}
	if req.XP != nil {
		if *req.XP < 0 {
			return "", errors.New("XP cannot be negative")
		}
		character.XP = *req.XP
	}

	character.UpdatedAt = time.Now().Unix()

	characterJSON, err := json.Marshal(character)
	if err != nil {
		return "", errors.New("failed to serialize character")
	}

	// Store updated character
	writes := []*runtime.StorageWrite{
		{
			Collection:      CharacterCollection,
			Key:             req.ID,
			UserID:          req.UserID,
			Value:           string(characterJSON),
			Version:         objects[0].Version,
			PermissionRead:  1,
			PermissionWrite: 1,
		},
	}

	if _, err := nk.StorageWrite(ctx, writes); err != nil {
		logger.Error("Failed to store character: %v", err)
		return "", errors.New("failed to save character")
	}

	// Get user info
	users, _ := nk.UsersGetId(ctx, []string{req.UserID}, nil)
	username := ""
	if len(users) > 0 {
		username = users[0].Username
	}

	entry := AdminCharacterEntry{
		Character:     character,
		OwnerID:       req.UserID,
		OwnerUsername: username,
	}

	responseJSON, _ := json.Marshal(entry)
	logger.Info("Admin updated character: %s", req.ID)
	return string(responseJSON), nil
}

// rpcAdminDeleteCharacter deletes a character (admin function)
func rpcAdminDeleteCharacter(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	var req struct {
		UserID string `json:"user_id"`
		ID     string `json:"id"`
	}
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		logger.Error("Failed to parse request: %v", err)
		return "", errors.New("invalid request payload")
	}

	if req.UserID == "" {
		return "", errors.New("user_id is required")
	}
	if req.ID == "" {
		return "", errors.New("character id is required")
	}

	// Delete the character
	deletes := []*runtime.StorageDelete{
		{
			Collection: CharacterCollection,
			Key:        req.ID,
			UserID:     req.UserID,
		},
	}

	if err := nk.StorageDelete(ctx, deletes); err != nil {
		logger.Error("Failed to delete character: %v", err)
		return "", errors.New("failed to delete character")
	}

	logger.Info("Admin deleted character: %s for user %s", req.ID, req.UserID)

	response := map[string]string{
		"status":       "success",
		"message":      "Character deleted successfully",
		"character_id": req.ID,
	}

	responseJSON, _ := json.Marshal(response)
	return string(responseJSON), nil
}
