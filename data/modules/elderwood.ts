// Elderwood - Nakama Runtime Module for Harry Potter MMO
// TypeScript version for direct interpretation by Nakama

// ============================================================================
// Constants
// ============================================================================

const CHARACTERS_COLLECTION = "characters";
const MAX_CHARACTERS_PER_ACCOUNT = 5;
const HOUSE_SCORES_COLLECTION = "house_scores";
const HOUSE_POINTS_HISTORY_COLLECTION = "house_points_history";
const INVENTORY_COLLECTION = "inventories";
const SPELLS_COLLECTION = "character_spells";
const NOTEBOOKS_COLLECTION = "notebooks";
const MAX_SPELL_LEVEL = 3;
const MIN_SPELL_LEVEL = 0;
const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

// Houses
const HOUSE_NONE = "Pas de Maison";
const HOUSE_VENATRIX = "Venatrix";
const HOUSE_FALCON = "Falcon";
const HOUSE_BRUMVAL = "Brumval";
const HOUSE_AERWYN = "Aerwyn";

const VALID_HOUSES = [HOUSE_NONE, HOUSE_VENATRIX, HOUSE_FALCON, HOUSE_BRUMVAL, HOUSE_AERWYN];
const SCORING_HOUSES = [HOUSE_VENATRIX, HOUSE_FALCON, HOUSE_BRUMVAL, HOUSE_AERWYN];

// Subjects
const SUBJECTS = [
  "Défense contre les forces du mal",
  "Potions",
  "Métamorphose",
  "Sortilèges",
  "Histoire de la Magie",
  "Botanique",
  "Astronomie",
  "Divination",
  "Arithmancie",
  "Étude des Runes",
  "Soins aux Créatures Magiques",
  "Étude des Moldus",
  "Alchimie",
  "Vol sur Balai",
  "Autre"
];

// ============================================================================
// Items Catalog
// ============================================================================

interface Item {
  id: string;
  name: string;
  description: string;
  category: string;
  rarity: string;
  stackable: boolean;
  maxStack: number;
}

const ITEMS_CATALOG: Item[] = [
  // Wands
  { id: "wand_holly_phoenix", name: "Baguette de Houx et Plume de Phénix", description: "Une baguette puissante avec un cœur de plume de phénix", category: "wand", rarity: "rare", stackable: false, maxStack: 1 },
  { id: "wand_elder", name: "Baguette de Sureau", description: "La baguette la plus puissante qui existe", category: "wand", rarity: "legendary", stackable: false, maxStack: 1 },
  { id: "wand_vine_dragon", name: "Baguette de Vigne et Cœur de Dragon", description: "Une baguette flexible au cœur de dragon", category: "wand", rarity: "uncommon", stackable: false, maxStack: 1 },
  // Potions
  { id: "potion_health", name: "Potion de Soin", description: "Restaure la santé", category: "potion", rarity: "common", stackable: true, maxStack: 99 },
  { id: "potion_mana", name: "Potion de Mana", description: "Restaure la magie", category: "potion", rarity: "common", stackable: true, maxStack: 99 },
  { id: "potion_felix_felicis", name: "Felix Felicis", description: "Potion de chance liquide", category: "potion", rarity: "legendary", stackable: true, maxStack: 10 },
  { id: "potion_polyjuice", name: "Polynectar", description: "Permet de prendre l'apparence d'une autre personne", category: "potion", rarity: "epic", stackable: true, maxStack: 10 },
  { id: "potion_veritaserum", name: "Veritaserum", description: "Sérum de vérité puissant", category: "potion", rarity: "epic", stackable: true, maxStack: 10 },
  // Ingredients
  { id: "ingredient_bezoar", name: "Bézoard", description: "Pierre trouvée dans l'estomac d'une chèvre, antidote universel", category: "ingredient", rarity: "rare", stackable: true, maxStack: 50 },
  { id: "ingredient_mandrake", name: "Mandragore", description: "Racine aux propriétés curatives puissantes", category: "ingredient", rarity: "uncommon", stackable: true, maxStack: 50 },
  { id: "ingredient_gillyweed", name: "Branchiflore", description: "Permet de respirer sous l'eau", category: "ingredient", rarity: "rare", stackable: true, maxStack: 50 },
  { id: "ingredient_moonstone", name: "Pierre de Lune", description: "Ingrédient magique lumineux", category: "ingredient", rarity: "uncommon", stackable: true, maxStack: 99 },
  // Books
  { id: "book_spells_standard", name: "Livre des Sorts niveau 1", description: "Manuel de sorts pour débutants", category: "book", rarity: "common", stackable: false, maxStack: 1 },
  { id: "book_potions_advanced", name: "Manuel Avancé de Potions", description: "Recettes de potions complexes", category: "book", rarity: "rare", stackable: false, maxStack: 1 },
  { id: "book_dark_arts", name: "Les Forces du Mal et comment s'en protéger", description: "Guide de défense contre les forces du mal", category: "book", rarity: "uncommon", stackable: false, maxStack: 1 },
  { id: "book_fantastic_beasts", name: "Les Animaux Fantastiques", description: "Encyclopédie des créatures magiques", category: "book", rarity: "uncommon", stackable: false, maxStack: 1 },
  // Equipment
  { id: "equip_robe_student", name: "Robe d'Étudiant", description: "Robe standard de l'école", category: "equipment", rarity: "common", stackable: false, maxStack: 1 },
  { id: "equip_robe_quidditch", name: "Tenue de Quidditch", description: "Équipement pour jouer au Quidditch", category: "equipment", rarity: "uncommon", stackable: false, maxStack: 1 },
  { id: "equip_invisibility_cloak", name: "Cape d'Invisibilité", description: "Rend invisible celui qui la porte", category: "equipment", rarity: "legendary", stackable: false, maxStack: 1 },
  { id: "equip_broom_nimbus", name: "Nimbus 2000", description: "Balai de course performant", category: "equipment", rarity: "rare", stackable: false, maxStack: 1 },
  { id: "equip_broom_firebolt", name: "Éclair de Feu", description: "Le meilleur balai de course au monde", category: "equipment", rarity: "epic", stackable: false, maxStack: 1 },
  // Consumables
  { id: "consumable_chocolate_frog", name: "Chocogrenouille", description: "Friandise avec carte de collection", category: "consumable", rarity: "common", stackable: true, maxStack: 99 },
  { id: "consumable_bertie_beans", name: "Dragées de Bertie Crochue", description: "Bonbons à tous les goûts", category: "consumable", rarity: "common", stackable: true, maxStack: 99 },
  { id: "consumable_butterbeer", name: "Bièraubeurre", description: "Boisson chaude réconfortante", category: "consumable", rarity: "common", stackable: true, maxStack: 99 },
  // Quest Items
  { id: "quest_marauders_map", name: "Carte du Maraudeur", description: "Montre tous les passages secrets", category: "quest_item", rarity: "legendary", stackable: false, maxStack: 1 },
  { id: "quest_golden_snitch", name: "Vif d'Or", description: "La balle la plus importante au Quidditch", category: "quest_item", rarity: "epic", stackable: false, maxStack: 1 },
  // Misc
  { id: "misc_galleon", name: "Gallion", description: "Monnaie d'or des sorciers", category: "misc", rarity: "common", stackable: true, maxStack: 999 },
  { id: "misc_owl_treat", name: "Friandise pour Hibou", description: "Récompense pour votre hibou postal", category: "misc", rarity: "common", stackable: true, maxStack: 99 }
];

// ============================================================================
// Spells Catalog
// ============================================================================

interface Spell {
  id: string;
  name: string;
  incantation: string;
  description: string;
  category: string;
  difficulty: string;
  minLevel: number;
}

const SPELLS_CATALOG: Spell[] = [
  // Charms
  { id: "spell_lumos", name: "Lumos", incantation: "Lumos", description: "Produit de la lumière au bout de la baguette", category: "charm", difficulty: "beginner", minLevel: 1 },
  { id: "spell_wingardium", name: "Wingardium Leviosa", incantation: "Wingardium Leviosa", description: "Fait léviter les objets", category: "charm", difficulty: "beginner", minLevel: 1 },
  { id: "spell_accio", name: "Accio", incantation: "Accio", description: "Attire un objet vers le lanceur", category: "charm", difficulty: "intermediate", minLevel: 10 },
  { id: "spell_alohomora", name: "Alohomora", incantation: "Alohomora", description: "Ouvre les serrures", category: "charm", difficulty: "beginner", minLevel: 1 },
  { id: "spell_reparo", name: "Reparo", incantation: "Reparo", description: "Répare les objets cassés", category: "charm", difficulty: "beginner", minLevel: 5 },
  { id: "spell_aguamenti", name: "Aguamenti", incantation: "Aguamenti", description: "Produit un jet d'eau", category: "charm", difficulty: "intermediate", minLevel: 15 },
  { id: "spell_incendio", name: "Incendio", incantation: "Incendio", description: "Produit des flammes", category: "charm", difficulty: "intermediate", minLevel: 10 },
  { id: "spell_silencio", name: "Silencio", incantation: "Silencio", description: "Rend la cible muette", category: "charm", difficulty: "intermediate", minLevel: 20 },
  { id: "spell_confundus", name: "Confundus", incantation: "Confundo", description: "Confond et désoriente la cible", category: "charm", difficulty: "advanced", minLevel: 30 },
  { id: "spell_obliviate", name: "Obliviate", incantation: "Obliviate", description: "Efface les souvenirs", category: "charm", difficulty: "advanced", minLevel: 40 },
  // Transfiguration
  { id: "spell_vera_verto", name: "Vera Verto", incantation: "Vera Verto", description: "Transforme un animal en gobelet", category: "transfiguration", difficulty: "beginner", minLevel: 5 },
  { id: "spell_draconifors", name: "Draconifors", incantation: "Draconifors", description: "Transforme un objet en dragon miniature", category: "transfiguration", difficulty: "intermediate", minLevel: 15 },
  { id: "spell_lapifors", name: "Lapifors", incantation: "Lapifors", description: "Transforme un objet en lapin", category: "transfiguration", difficulty: "intermediate", minLevel: 20 },
  { id: "spell_avifors", name: "Avifors", incantation: "Avifors", description: "Transforme un objet en oiseau", category: "transfiguration", difficulty: "advanced", minLevel: 25 },
  { id: "spell_snufflifors", name: "Snufflifors", incantation: "Snufflifors", description: "Transforme un objet en souris", category: "transfiguration", difficulty: "intermediate", minLevel: 15 },
  // Defense
  { id: "spell_expelliarmus", name: "Expelliarmus", incantation: "Expelliarmus", description: "Désarme l'adversaire", category: "defense", difficulty: "beginner", minLevel: 5 },
  { id: "spell_stupefy", name: "Stupefy", incantation: "Stupefix", description: "Stupéfixie la cible", category: "defense", difficulty: "intermediate", minLevel: 10 },
  { id: "spell_protego", name: "Protego", incantation: "Protego", description: "Crée un bouclier magique", category: "defense", difficulty: "intermediate", minLevel: 15 },
  { id: "spell_impedimenta", name: "Impedimenta", incantation: "Impedimenta", description: "Ralentit ou arrête la cible", category: "defense", difficulty: "intermediate", minLevel: 20 },
  { id: "spell_finite", name: "Finite Incantatem", incantation: "Finite Incantatem", description: "Annule les effets des sorts", category: "defense", difficulty: "intermediate", minLevel: 15 },
  { id: "spell_patronus", name: "Expecto Patronum", incantation: "Expecto Patronum", description: "Invoque un Patronus protecteur", category: "defense", difficulty: "master", minLevel: 50 },
  { id: "spell_cave_inimicum", name: "Cave Inimicum", incantation: "Cave Inimicum", description: "Crée une barrière de protection", category: "defense", difficulty: "advanced", minLevel: 35 },
  // Hex
  { id: "spell_locomotor_mortis", name: "Locomotor Mortis", incantation: "Locomotor Mortis", description: "Bloque les jambes de la cible", category: "hex", difficulty: "beginner", minLevel: 5 },
  { id: "spell_petrificus", name: "Petrificus Totalus", incantation: "Petrificus Totalus", description: "Pétrifie complètement la cible", category: "hex", difficulty: "intermediate", minLevel: 15 },
  { id: "spell_levicorpus", name: "Levicorpus", incantation: "Levicorpus", description: "Suspend la cible par la cheville", category: "hex", difficulty: "intermediate", minLevel: 20 },
  { id: "spell_rictusempra", name: "Rictusempra", incantation: "Rictusempra", description: "Provoque un fou rire incontrôlable", category: "hex", difficulty: "beginner", minLevel: 5 },
  // Curse
  { id: "spell_sectumsempra", name: "Sectumsempra", incantation: "Sectumsempra", description: "Inflige des lacérations profondes", category: "curse", difficulty: "advanced", minLevel: 45 },
  { id: "spell_crucio", name: "Crucio", incantation: "Endoloris", description: "Sortilège de torture - Impardonnable", category: "curse", difficulty: "master", minLevel: 60 },
  { id: "spell_imperio", name: "Imperio", incantation: "Impero", description: "Contrôle mental - Impardonnable", category: "curse", difficulty: "master", minLevel: 60 },
  { id: "spell_avada_kedavra", name: "Avada Kedavra", incantation: "Avada Kedavra", description: "Sortilège de mort - Impardonnable", category: "curse", difficulty: "master", minLevel: 70 },
  // Healing
  { id: "spell_episkey", name: "Episkey", incantation: "Episkey", description: "Soigne les blessures mineures", category: "healing", difficulty: "beginner", minLevel: 5 },
  { id: "spell_vulnera", name: "Vulnera Sanentur", incantation: "Vulnera Sanentur", description: "Soigne les blessures graves", category: "healing", difficulty: "advanced", minLevel: 35 },
  { id: "spell_rennervate", name: "Rennervate", incantation: "Rennervate", description: "Ranime une personne inconsciente", category: "healing", difficulty: "intermediate", minLevel: 20 },
  // Utility
  { id: "spell_nox", name: "Nox", incantation: "Nox", description: "Éteint la lumière de Lumos", category: "utility", difficulty: "beginner", minLevel: 1 },
  { id: "spell_point_me", name: "Point Me", incantation: "Pointe au Nord", description: "La baguette indique le nord", category: "utility", difficulty: "beginner", minLevel: 1 }
];

// ============================================================================
// Helper Functions
// ============================================================================

function isValidHouse(house: string): boolean {
  return VALID_HOUSES.includes(house);
}

function isValidSubject(subject: string): boolean {
  return SUBJECTS.includes(subject);
}

function getItem(itemId: string): Item | undefined {
  return ITEMS_CATALOG.find(item => item.id === itemId);
}

function getSpell(spellId: string): Spell | undefined {
  return SPELLS_CATALOG.find(spell => spell.id === spellId);
}

// ============================================================================
// RPC Handlers - Characters
// ============================================================================

function rpcCreateCharacter(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const userId = ctx.userId;
  if (!userId) {
    throw Error("User ID required");
  }

  const request = JSON.parse(payload);
  if (!request.name || request.name.trim() === "") {
    throw Error("Character name is required");
  }

  const name = request.name.trim();
  if (name.length < 2 || name.length > 32) {
    throw Error("Character name must be between 2 and 32 characters");
  }

  // Check existing characters
  const existingChars = nk.storageList(userId, CHARACTERS_COLLECTION, MAX_CHARACTERS_PER_ACCOUNT + 1, "");
  if (existingChars.objects && existingChars.objects.length >= MAX_CHARACTERS_PER_ACCOUNT) {
    throw Error(`Maximum ${MAX_CHARACTERS_PER_ACCOUNT} characters per account`);
  }

  // Check for duplicate name
  if (existingChars.objects) {
    for (const obj of existingChars.objects) {
      const char = JSON.parse(obj.value);
      if (char.name.toLowerCase() === name.toLowerCase()) {
        throw Error("Character with this name already exists");
      }
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const character = {
    id: nk.uuidv4(),
    name: name,
    house: HOUSE_NONE,
    level: 1,
    xp: 0,
    created_at: now,
    updated_at: now
  };

  nk.storageWrite([{
    collection: CHARACTERS_COLLECTION,
    key: character.id,
    userId: userId,
    value: character,
    permissionRead: 1,
    permissionWrite: 1
  }]);

  logger.info("Character created: %s for user %s", character.id, userId);
  return JSON.stringify(character);
}

function rpcGetCharacters(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const userId = ctx.userId;
  if (!userId) {
    throw Error("User ID required");
  }

  const result = nk.storageList(userId, CHARACTERS_COLLECTION, 100, "");
  const characters = result.objects ? result.objects.map(obj => JSON.parse(obj.value)) : [];

  return JSON.stringify({ characters: characters });
}

function rpcGetCharacter(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const userId = ctx.userId;
  if (!userId) {
    throw Error("User ID required");
  }

  const request = JSON.parse(payload);
  if (!request.id) {
    throw Error("Character ID is required");
  }

  const objects = nk.storageRead([{
    collection: CHARACTERS_COLLECTION,
    key: request.id,
    userId: userId
  }]);

  if (!objects || objects.length === 0) {
    throw Error("Character not found");
  }

  return objects[0].value;
}

function rpcUpdateCharacter(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const userId = ctx.userId;
  if (!userId) {
    throw Error("User ID required");
  }

  const request = JSON.parse(payload);
  if (!request.id) {
    throw Error("Character ID is required");
  }

  const objects = nk.storageRead([{
    collection: CHARACTERS_COLLECTION,
    key: request.id,
    userId: userId
  }]);

  if (!objects || objects.length === 0) {
    throw Error("Character not found");
  }

  const character = JSON.parse(objects[0].value);

  if (request.name !== undefined) {
    const name = request.name.trim();
    if (name.length < 2 || name.length > 32) {
      throw Error("Character name must be between 2 and 32 characters");
    }
    character.name = name;
  }

  if (request.house !== undefined) {
    if (!isValidHouse(request.house)) {
      throw Error("Invalid house");
    }
    character.house = request.house;
  }

  if (request.level !== undefined) {
    if (request.level < 1 || request.level > 100) {
      throw Error("Level must be between 1 and 100");
    }
    character.level = request.level;
  }

  if (request.xp !== undefined) {
    if (request.xp < 0) {
      throw Error("XP cannot be negative");
    }
    character.xp = request.xp;
  }

  character.updated_at = Math.floor(Date.now() / 1000);

  nk.storageWrite([{
    collection: CHARACTERS_COLLECTION,
    key: character.id,
    userId: userId,
    value: character,
    permissionRead: 1,
    permissionWrite: 1
  }]);

  logger.info("Character updated: %s", character.id);
  return JSON.stringify(character);
}

function rpcDeleteCharacter(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const userId = ctx.userId;
  if (!userId) {
    throw Error("User ID required");
  }

  const request = JSON.parse(payload);
  if (!request.id) {
    throw Error("Character ID is required");
  }

  nk.storageDelete([{
    collection: CHARACTERS_COLLECTION,
    key: request.id,
    userId: userId
  }]);

  logger.info("Character deleted: %s", request.id);
  return JSON.stringify({ status: "success", message: "Character deleted" });
}

// ============================================================================
// RPC Handlers - House Points
// ============================================================================

function rpcGetHouseRankings(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const rankings: { rank: number; house: string; points: number }[] = [];

  for (const house of SCORING_HOUSES) {
    const objects = nk.storageRead([{
      collection: HOUSE_SCORES_COLLECTION,
      key: house,
      userId: SYSTEM_USER_ID
    }]);

    let points = 0;
    if (objects && objects.length > 0) {
      const data = JSON.parse(objects[0].value);
      points = data.points || 0;
    }

    rankings.push({ rank: 0, house: house, points: points });
  }

  rankings.sort((a, b) => b.points - a.points);
  rankings.forEach((r, i) => r.rank = i + 1);

  return JSON.stringify({
    rankings: rankings,
    updated_at: Math.floor(Date.now() / 1000)
  });
}

function rpcModifyHousePoints(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const request = JSON.parse(payload);

  if (!request.house || !SCORING_HOUSES.includes(request.house)) {
    throw Error("Invalid house");
  }
  if (request.points === undefined || request.points === 0) {
    throw Error("Points amount is required and cannot be zero");
  }
  if (!request.reason || request.reason.trim() === "") {
    throw Error("Reason is required");
  }

  // Get current score
  const objects = nk.storageRead([{
    collection: HOUSE_SCORES_COLLECTION,
    key: request.house,
    userId: SYSTEM_USER_ID
  }]);

  let currentPoints = 0;
  if (objects && objects.length > 0) {
    const data = JSON.parse(objects[0].value);
    currentPoints = data.points || 0;
  }

  const newPoints = currentPoints + request.points;

  // Save new score
  nk.storageWrite([{
    collection: HOUSE_SCORES_COLLECTION,
    key: request.house,
    userId: SYSTEM_USER_ID,
    value: { house: request.house, points: newPoints, updated_at: Math.floor(Date.now() / 1000) },
    permissionRead: 2,
    permissionWrite: 0
  }]);

  // Save history entry
  const historyEntry = {
    id: nk.uuidv4(),
    house: request.house,
    points: request.points,
    character_name: request.character_name || "",
    reason: request.reason.trim(),
    created_at: Math.floor(Date.now() / 1000)
  };

  nk.storageWrite([{
    collection: HOUSE_POINTS_HISTORY_COLLECTION,
    key: historyEntry.id,
    userId: SYSTEM_USER_ID,
    value: historyEntry,
    permissionRead: 2,
    permissionWrite: 0
  }]);

  logger.info("House points modified: %s %+d", request.house, request.points);

  return JSON.stringify({
    house: request.house,
    previous_points: currentPoints,
    new_points: newPoints,
    change: request.points
  });
}

function rpcGetHousePointsHistory(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const request = payload ? JSON.parse(payload) : {};
  const limit = request.limit || 50;

  const result = nk.storageList(SYSTEM_USER_ID, HOUSE_POINTS_HISTORY_COLLECTION, limit, "");
  let entries = result.objects ? result.objects.map(obj => JSON.parse(obj.value)) : [];

  // Filter by house if specified
  if (request.house && SCORING_HOUSES.includes(request.house)) {
    entries = entries.filter(e => e.house === request.house);
  }

  // Sort by date descending
  entries.sort((a, b) => b.created_at - a.created_at);

  return JSON.stringify({ entries: entries });
}

// ============================================================================
// RPC Handlers - Inventory
// ============================================================================

function rpcGetItemsCatalog(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const request = payload ? JSON.parse(payload) : {};
  let items = [...ITEMS_CATALOG];

  if (request.category) {
    items = items.filter(i => i.category === request.category);
  }
  if (request.rarity) {
    items = items.filter(i => i.rarity === request.rarity);
  }

  return JSON.stringify({ items: items, count: items.length });
}

function rpcGetInventory(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const userId = ctx.userId;
  if (!userId) {
    throw Error("User ID required");
  }

  const request = JSON.parse(payload);
  if (!request.character_id) {
    throw Error("Character ID is required");
  }

  // Verify character ownership
  const charObjects = nk.storageRead([{
    collection: CHARACTERS_COLLECTION,
    key: request.character_id,
    userId: userId
  }]);
  if (!charObjects || charObjects.length === 0) {
    throw Error("Character not found");
  }

  // Get inventory
  const invObjects = nk.storageRead([{
    collection: INVENTORY_COLLECTION,
    key: request.character_id,
    userId: userId
  }]);

  let inventory = { character_id: request.character_id, items: [] as any[], updated_at: 0 };
  if (invObjects && invObjects.length > 0) {
    inventory = JSON.parse(invObjects[0].value);
  }

  // Enrich items with catalog data
  const enrichedItems = inventory.items.map((invItem: any) => {
    const catalogItem = getItem(invItem.item_id);
    return {
      item_id: invItem.item_id,
      name: catalogItem?.name || invItem.item_id,
      description: catalogItem?.description || "",
      category: catalogItem?.category || "misc",
      rarity: catalogItem?.rarity || "common",
      quantity: invItem.quantity,
      max_stack: catalogItem?.maxStack || 99
    };
  });

  return JSON.stringify({
    character_id: request.character_id,
    items: enrichedItems,
    total_items: enrichedItems.reduce((sum: number, item: any) => sum + item.quantity, 0),
    updated_at: inventory.updated_at
  });
}

function rpcAddItem(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const userId = ctx.userId;
  if (!userId) {
    throw Error("User ID required");
  }

  const request = JSON.parse(payload);
  if (!request.character_id) throw Error("Character ID is required");
  if (!request.item_id) throw Error("Item ID is required");
  if (!request.quantity || request.quantity < 1) throw Error("Quantity must be positive");

  const catalogItem = getItem(request.item_id);
  if (!catalogItem) throw Error("Item not found in catalog");

  // Verify character ownership
  const charObjects = nk.storageRead([{
    collection: CHARACTERS_COLLECTION,
    key: request.character_id,
    userId: userId
  }]);
  if (!charObjects || charObjects.length === 0) {
    throw Error("Character not found");
  }

  // Get current inventory
  const invObjects = nk.storageRead([{
    collection: INVENTORY_COLLECTION,
    key: request.character_id,
    userId: userId
  }]);

  let inventory = { character_id: request.character_id, items: [] as any[], updated_at: 0 };
  if (invObjects && invObjects.length > 0) {
    inventory = JSON.parse(invObjects[0].value);
  }

  // Find existing item or add new
  const existingItem = inventory.items.find((i: any) => i.item_id === request.item_id);
  if (existingItem) {
    existingItem.quantity = Math.min(existingItem.quantity + request.quantity, catalogItem.maxStack);
  } else {
    inventory.items.push({
      item_id: request.item_id,
      quantity: Math.min(request.quantity, catalogItem.maxStack)
    });
  }

  inventory.updated_at = Math.floor(Date.now() / 1000);

  nk.storageWrite([{
    collection: INVENTORY_COLLECTION,
    key: request.character_id,
    userId: userId,
    value: inventory,
    permissionRead: 1,
    permissionWrite: 1
  }]);

  logger.info("Item added: %s x%d to character %s", request.item_id, request.quantity, request.character_id);

  return JSON.stringify({
    character_id: request.character_id,
    item_id: request.item_id,
    item_name: catalogItem.name,
    quantity_added: request.quantity,
    status: "success"
  });
}

function rpcRemoveItem(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const userId = ctx.userId;
  if (!userId) {
    throw Error("User ID required");
  }

  const request = JSON.parse(payload);
  if (!request.character_id) throw Error("Character ID is required");
  if (!request.item_id) throw Error("Item ID is required");
  if (!request.quantity || request.quantity < 1) throw Error("Quantity must be positive");

  // Verify character ownership
  const charObjects = nk.storageRead([{
    collection: CHARACTERS_COLLECTION,
    key: request.character_id,
    userId: userId
  }]);
  if (!charObjects || charObjects.length === 0) {
    throw Error("Character not found");
  }

  // Get current inventory
  const invObjects = nk.storageRead([{
    collection: INVENTORY_COLLECTION,
    key: request.character_id,
    userId: userId
  }]);

  if (!invObjects || invObjects.length === 0) {
    throw Error("Item not found in inventory");
  }

  const inventory = JSON.parse(invObjects[0].value);
  const itemIndex = inventory.items.findIndex((i: any) => i.item_id === request.item_id);

  if (itemIndex === -1) {
    throw Error("Item not found in inventory");
  }

  const item = inventory.items[itemIndex];
  if (item.quantity < request.quantity) {
    throw Error("Insufficient quantity");
  }

  item.quantity -= request.quantity;
  if (item.quantity <= 0) {
    inventory.items.splice(itemIndex, 1);
  }

  inventory.updated_at = Math.floor(Date.now() / 1000);

  nk.storageWrite([{
    collection: INVENTORY_COLLECTION,
    key: request.character_id,
    userId: userId,
    value: inventory,
    permissionRead: 1,
    permissionWrite: 1
  }]);

  logger.info("Item removed: %s x%d from character %s", request.item_id, request.quantity, request.character_id);

  return JSON.stringify({
    character_id: request.character_id,
    item_id: request.item_id,
    quantity_removed: request.quantity,
    status: "success"
  });
}

// ============================================================================
// RPC Handlers - Spells
// ============================================================================

function rpcGetSpellsCatalog(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const request = payload ? JSON.parse(payload) : {};
  let spells = [...SPELLS_CATALOG];

  if (request.category) {
    spells = spells.filter(s => s.category === request.category);
  }
  if (request.difficulty) {
    spells = spells.filter(s => s.difficulty === request.difficulty);
  }

  return JSON.stringify({ spells: spells, count: spells.length });
}

function rpcGetCharacterSpells(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const userId = ctx.userId;
  if (!userId) {
    throw Error("User ID required");
  }

  const request = JSON.parse(payload);
  if (!request.character_id) {
    throw Error("Character ID is required");
  }

  // Verify character ownership
  const charObjects = nk.storageRead([{
    collection: CHARACTERS_COLLECTION,
    key: request.character_id,
    userId: userId
  }]);
  if (!charObjects || charObjects.length === 0) {
    throw Error("Character not found");
  }

  // Get spells
  const spellObjects = nk.storageRead([{
    collection: SPELLS_COLLECTION,
    key: request.character_id,
    userId: userId
  }]);

  let charSpells = { character_id: request.character_id, spells: {} as any, updated_at: 0 };
  if (spellObjects && spellObjects.length > 0) {
    charSpells = JSON.parse(spellObjects[0].value);
  }

  // Enrich with catalog data
  const enrichedSpells = Object.keys(charSpells.spells).map(spellId => {
    const spellData = charSpells.spells[spellId];
    const catalogSpell = getSpell(spellId);
    return {
      spell_id: spellId,
      name: catalogSpell?.name || spellId,
      incantation: catalogSpell?.incantation || "",
      description: catalogSpell?.description || "",
      category: catalogSpell?.category || "utility",
      difficulty: catalogSpell?.difficulty || "beginner",
      level: spellData.level,
      max_level: MAX_SPELL_LEVEL,
      learned_at: spellData.learned_at
    };
  });

  return JSON.stringify({
    character_id: request.character_id,
    spells: enrichedSpells,
    total_spells: enrichedSpells.length,
    updated_at: charSpells.updated_at
  });
}

function rpcLearnSpell(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const userId = ctx.userId;
  if (!userId) {
    throw Error("User ID required");
  }

  const request = JSON.parse(payload);
  if (!request.character_id) throw Error("Character ID is required");
  if (!request.spell_id) throw Error("Spell ID is required");

  const catalogSpell = getSpell(request.spell_id);
  if (!catalogSpell) throw Error("Spell not found in catalog");

  // Verify character and get level
  const charObjects = nk.storageRead([{
    collection: CHARACTERS_COLLECTION,
    key: request.character_id,
    userId: userId
  }]);
  if (!charObjects || charObjects.length === 0) {
    throw Error("Character not found");
  }

  const character = JSON.parse(charObjects[0].value);
  if (character.level < catalogSpell.minLevel) {
    throw Error(`Character must be level ${catalogSpell.minLevel} to learn this spell`);
  }

  // Get current spells
  const spellObjects = nk.storageRead([{
    collection: SPELLS_COLLECTION,
    key: request.character_id,
    userId: userId
  }]);

  let charSpells = { character_id: request.character_id, spells: {} as any, updated_at: 0 };
  if (spellObjects && spellObjects.length > 0) {
    charSpells = JSON.parse(spellObjects[0].value);
  }

  if (charSpells.spells[request.spell_id]) {
    throw Error("Spell already learned");
  }

  charSpells.spells[request.spell_id] = {
    level: MIN_SPELL_LEVEL,
    learned_at: Math.floor(Date.now() / 1000)
  };
  charSpells.updated_at = Math.floor(Date.now() / 1000);

  nk.storageWrite([{
    collection: SPELLS_COLLECTION,
    key: request.character_id,
    userId: userId,
    value: charSpells,
    permissionRead: 1,
    permissionWrite: 1
  }]);

  logger.info("Spell learned: %s by character %s", request.spell_id, request.character_id);

  return JSON.stringify({
    character_id: request.character_id,
    spell_id: request.spell_id,
    spell_name: catalogSpell.name,
    level: MIN_SPELL_LEVEL,
    status: "learned"
  });
}

function rpcUpgradeSpell(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const userId = ctx.userId;
  if (!userId) {
    throw Error("User ID required");
  }

  const request = JSON.parse(payload);
  if (!request.character_id) throw Error("Character ID is required");
  if (!request.spell_id) throw Error("Spell ID is required");

  // Verify character ownership
  const charObjects = nk.storageRead([{
    collection: CHARACTERS_COLLECTION,
    key: request.character_id,
    userId: userId
  }]);
  if (!charObjects || charObjects.length === 0) {
    throw Error("Character not found");
  }

  // Get spells
  const spellObjects = nk.storageRead([{
    collection: SPELLS_COLLECTION,
    key: request.character_id,
    userId: userId
  }]);

  if (!spellObjects || spellObjects.length === 0) {
    throw Error("Spell not learned");
  }

  const charSpells = JSON.parse(spellObjects[0].value);
  if (!charSpells.spells[request.spell_id]) {
    throw Error("Spell not learned");
  }

  const currentLevel = charSpells.spells[request.spell_id].level;
  if (currentLevel >= MAX_SPELL_LEVEL) {
    throw Error("Spell already at maximum level");
  }

  charSpells.spells[request.spell_id].level = currentLevel + 1;
  charSpells.updated_at = Math.floor(Date.now() / 1000);

  nk.storageWrite([{
    collection: SPELLS_COLLECTION,
    key: request.character_id,
    userId: userId,
    value: charSpells,
    permissionRead: 1,
    permissionWrite: 1
  }]);

  const catalogSpell = getSpell(request.spell_id);
  logger.info("Spell upgraded: %s to level %d", request.spell_id, currentLevel + 1);

  return JSON.stringify({
    character_id: request.character_id,
    spell_id: request.spell_id,
    spell_name: catalogSpell?.name || request.spell_id,
    previous_level: currentLevel,
    new_level: currentLevel + 1,
    status: "upgraded"
  });
}

function rpcForgetSpell(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const userId = ctx.userId;
  if (!userId) {
    throw Error("User ID required");
  }

  const request = JSON.parse(payload);
  if (!request.character_id) throw Error("Character ID is required");
  if (!request.spell_id) throw Error("Spell ID is required");

  // Verify character ownership
  const charObjects = nk.storageRead([{
    collection: CHARACTERS_COLLECTION,
    key: request.character_id,
    userId: userId
  }]);
  if (!charObjects || charObjects.length === 0) {
    throw Error("Character not found");
  }

  // Get spells
  const spellObjects = nk.storageRead([{
    collection: SPELLS_COLLECTION,
    key: request.character_id,
    userId: userId
  }]);

  if (!spellObjects || spellObjects.length === 0) {
    throw Error("Spell not learned");
  }

  const charSpells = JSON.parse(spellObjects[0].value);
  if (!charSpells.spells[request.spell_id]) {
    throw Error("Spell not learned");
  }

  delete charSpells.spells[request.spell_id];
  charSpells.updated_at = Math.floor(Date.now() / 1000);

  nk.storageWrite([{
    collection: SPELLS_COLLECTION,
    key: request.character_id,
    userId: userId,
    value: charSpells,
    permissionRead: 1,
    permissionWrite: 1
  }]);

  const catalogSpell = getSpell(request.spell_id);
  logger.info("Spell forgotten: %s by character %s", request.spell_id, request.character_id);

  return JSON.stringify({
    character_id: request.character_id,
    spell_id: request.spell_id,
    spell_name: catalogSpell?.name || request.spell_id,
    status: "forgotten"
  });
}

// ============================================================================
// RPC Handlers - Notebooks
// ============================================================================

function rpcGetSubjects(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return JSON.stringify({ subjects: SUBJECTS, count: SUBJECTS.length });
}

function rpcCreateNotebook(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const userId = ctx.userId;
  if (!userId) {
    throw Error("User ID required");
  }

  const request = JSON.parse(payload);
  if (!request.character_id) throw Error("Character ID is required");
  if (!request.title || request.title.trim() === "") throw Error("Title is required");
  if (!request.subject) throw Error("Subject is required");
  if (!isValidSubject(request.subject)) throw Error("Invalid subject");

  // Verify character ownership
  const charObjects = nk.storageRead([{
    collection: CHARACTERS_COLLECTION,
    key: request.character_id,
    userId: userId
  }]);
  if (!charObjects || charObjects.length === 0) {
    throw Error("Character not found");
  }

  const now = Math.floor(Date.now() / 1000);
  const notebook = {
    id: nk.uuidv4(),
    character_id: request.character_id,
    title: request.title.trim(),
    content: request.content || "",
    subject: request.subject,
    created_at: now,
    updated_at: now
  };

  nk.storageWrite([{
    collection: NOTEBOOKS_COLLECTION,
    key: notebook.id,
    userId: userId,
    value: notebook,
    permissionRead: 1,
    permissionWrite: 1
  }]);

  logger.info("Notebook created: %s for character %s", notebook.id, request.character_id);
  return JSON.stringify(notebook);
}

function rpcGetNotebooks(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const userId = ctx.userId;
  if (!userId) {
    throw Error("User ID required");
  }

  const request = JSON.parse(payload);
  if (!request.character_id) {
    throw Error("Character ID is required");
  }

  // Verify character ownership
  const charObjects = nk.storageRead([{
    collection: CHARACTERS_COLLECTION,
    key: request.character_id,
    userId: userId
  }]);
  if (!charObjects || charObjects.length === 0) {
    throw Error("Character not found");
  }

  const result = nk.storageList(userId, NOTEBOOKS_COLLECTION, 100, "");
  let notebooks = result.objects ? result.objects.map(obj => JSON.parse(obj.value)) : [];

  // Filter by character
  notebooks = notebooks.filter(n => n.character_id === request.character_id);

  // Filter by subject if specified
  if (request.subject && isValidSubject(request.subject)) {
    notebooks = notebooks.filter(n => n.subject === request.subject);
  }

  // Sort by updated_at descending
  notebooks.sort((a, b) => b.updated_at - a.updated_at);

  return JSON.stringify({
    character_id: request.character_id,
    notebooks: notebooks,
    count: notebooks.length
  });
}

function rpcGetNotebook(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const userId = ctx.userId;
  if (!userId) {
    throw Error("User ID required");
  }

  const request = JSON.parse(payload);
  if (!request.character_id) throw Error("Character ID is required");
  if (!request.notebook_id) throw Error("Notebook ID is required");

  // Verify character ownership
  const charObjects = nk.storageRead([{
    collection: CHARACTERS_COLLECTION,
    key: request.character_id,
    userId: userId
  }]);
  if (!charObjects || charObjects.length === 0) {
    throw Error("Character not found");
  }

  const objects = nk.storageRead([{
    collection: NOTEBOOKS_COLLECTION,
    key: request.notebook_id,
    userId: userId
  }]);

  if (!objects || objects.length === 0) {
    throw Error("Notebook not found");
  }

  const notebook = JSON.parse(objects[0].value);
  if (notebook.character_id !== request.character_id) {
    throw Error("Notebook not found");
  }

  return JSON.stringify(notebook);
}

function rpcUpdateNotebook(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const userId = ctx.userId;
  if (!userId) {
    throw Error("User ID required");
  }

  const request = JSON.parse(payload);
  if (!request.character_id) throw Error("Character ID is required");
  if (!request.notebook_id) throw Error("Notebook ID is required");

  // Verify character ownership
  const charObjects = nk.storageRead([{
    collection: CHARACTERS_COLLECTION,
    key: request.character_id,
    userId: userId
  }]);
  if (!charObjects || charObjects.length === 0) {
    throw Error("Character not found");
  }

  const objects = nk.storageRead([{
    collection: NOTEBOOKS_COLLECTION,
    key: request.notebook_id,
    userId: userId
  }]);

  if (!objects || objects.length === 0) {
    throw Error("Notebook not found");
  }

  const notebook = JSON.parse(objects[0].value);
  if (notebook.character_id !== request.character_id) {
    throw Error("Notebook not found");
  }

  if (request.title !== undefined) {
    if (request.title.trim() === "") throw Error("Title cannot be empty");
    notebook.title = request.title.trim();
  }
  if (request.content !== undefined) {
    notebook.content = request.content;
  }
  if (request.subject !== undefined) {
    if (!isValidSubject(request.subject)) throw Error("Invalid subject");
    notebook.subject = request.subject;
  }

  notebook.updated_at = Math.floor(Date.now() / 1000);

  nk.storageWrite([{
    collection: NOTEBOOKS_COLLECTION,
    key: notebook.id,
    userId: userId,
    value: notebook,
    permissionRead: 1,
    permissionWrite: 1
  }]);

  logger.info("Notebook updated: %s", notebook.id);
  return JSON.stringify(notebook);
}

function rpcDeleteNotebook(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const userId = ctx.userId;
  if (!userId) {
    throw Error("User ID required");
  }

  const request = JSON.parse(payload);
  if (!request.character_id) throw Error("Character ID is required");
  if (!request.notebook_id) throw Error("Notebook ID is required");

  // Verify character ownership
  const charObjects = nk.storageRead([{
    collection: CHARACTERS_COLLECTION,
    key: request.character_id,
    userId: userId
  }]);
  if (!charObjects || charObjects.length === 0) {
    throw Error("Character not found");
  }

  // Verify notebook exists and belongs to character
  const objects = nk.storageRead([{
    collection: NOTEBOOKS_COLLECTION,
    key: request.notebook_id,
    userId: userId
  }]);

  if (objects && objects.length > 0) {
    const notebook = JSON.parse(objects[0].value);
    if (notebook.character_id !== request.character_id) {
      throw Error("Notebook not found");
    }
  }

  nk.storageDelete([{
    collection: NOTEBOOKS_COLLECTION,
    key: request.notebook_id,
    userId: userId
  }]);

  logger.info("Notebook deleted: %s", request.notebook_id);
  return JSON.stringify({ status: "success", message: "Notebook deleted", notebook_id: request.notebook_id });
}

// ============================================================================
// Module Initialization
// ============================================================================

function InitModule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer) {
  logger.info("Initializing Elderwood Module");

  // Characters
  initializer.registerRpc("elderwood_create_character", rpcCreateCharacter);
  initializer.registerRpc("elderwood_get_characters", rpcGetCharacters);
  initializer.registerRpc("elderwood_get_character", rpcGetCharacter);
  initializer.registerRpc("elderwood_update_character", rpcUpdateCharacter);
  initializer.registerRpc("elderwood_delete_character", rpcDeleteCharacter);

  // House Points
  initializer.registerRpc("elderwood_get_house_rankings", rpcGetHouseRankings);
  initializer.registerRpc("elderwood_modify_house_points", rpcModifyHousePoints);
  initializer.registerRpc("elderwood_get_house_points_history", rpcGetHousePointsHistory);

  // Inventory
  initializer.registerRpc("elderwood_get_items_catalog", rpcGetItemsCatalog);
  initializer.registerRpc("elderwood_get_inventory", rpcGetInventory);
  initializer.registerRpc("elderwood_add_item", rpcAddItem);
  initializer.registerRpc("elderwood_remove_item", rpcRemoveItem);

  // Spells
  initializer.registerRpc("elderwood_get_spells_catalog", rpcGetSpellsCatalog);
  initializer.registerRpc("elderwood_get_character_spells", rpcGetCharacterSpells);
  initializer.registerRpc("elderwood_learn_spell", rpcLearnSpell);
  initializer.registerRpc("elderwood_upgrade_spell", rpcUpgradeSpell);
  initializer.registerRpc("elderwood_forget_spell", rpcForgetSpell);

  // Notebooks
  initializer.registerRpc("elderwood_get_subjects", rpcGetSubjects);
  initializer.registerRpc("elderwood_create_notebook", rpcCreateNotebook);
  initializer.registerRpc("elderwood_get_notebooks", rpcGetNotebooks);
  initializer.registerRpc("elderwood_get_notebook", rpcGetNotebook);
  initializer.registerRpc("elderwood_update_notebook", rpcUpdateNotebook);
  initializer.registerRpc("elderwood_delete_notebook", rpcDeleteNotebook);

  logger.info("Elderwood Module initialized - %d RPCs registered", 23);
}

// Export for Nakama
!InitModule && InitModule;
