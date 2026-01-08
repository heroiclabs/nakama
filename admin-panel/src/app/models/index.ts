// User & Authentication
export interface User {
  id: string;
  username: string;
  email?: string;
  role: UserRole;
}

export type UserRole = 'admin' | 'moderator' | 'user';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  refresh_token?: string;
  user: User;
}

// Houses
export type HouseName = 'Venatrix' | 'Falcon' | 'Brumval' | 'Aerwyn' | 'Pas de Maison';

export interface HouseRanking {
  rank: number;
  house: HouseName;
  points: number;
}

export interface HouseRankingsResponse {
  rankings: HouseRanking[];
  updated_at: number;
}

export interface HousePointsEntry {
  id: string;
  house: HouseName;
  points: number;
  character_name: string;
  reason: string;
  created_at: number;
}

export interface HousePointsHistoryResponse {
  entries: HousePointsEntry[];
}

export interface ModifyHousePointsRequest {
  house: HouseName;
  points: number;
  character_name?: string;
  reason: string;
}

// Characters
export interface Character {
  id: string;
  name: string;
  house: HouseName;
  level: number;
  xp: number;
  created_at: number;
  updated_at: number;
}

export interface CharacterListResponse {
  characters: Character[];
}

export interface UpdateCharacterRequest {
  id: string;
  level?: number;
  xp?: number;
  name?: string;
  house?: HouseName;
}

// Items & Inventory
export type ItemCategory = 'equipment' | 'wand' | 'consumable' | 'broom' | 'money' | 'resource';
export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type EquipmentSlot = 'head' | 'chest' | 'hands' | 'legs' | 'feet' | 'neck' | 'ring' | 'back' | 'mainhand' | 'offhand';
export type ConsumableEffectType = 'heal_hp' | 'heal_mana' | 'buff_stat' | 'transform' | 'invisibility' | 'speed' | 'luck' | 'resistance' | 'custom';

export interface ConsumableEffect {
  type: ConsumableEffectType;
  value?: number;
  duration?: number;
  stat_type?: string;
  target_form?: string;
  custom_data?: string;
}

export interface EquipmentStats {
  health?: number;
  mana?: number;
  strength?: number;
  intelligence?: number;
  defense?: number;
  magic_defense?: number;
  speed?: number;
}

export interface BroomStats {
  max_speed: number;
  acceleration: number;
  handling: number;
  max_altitude: number;
}

export interface Item {
  id: string;
  name: string;
  description: string;
  category: ItemCategory;
  rarity: ItemRarity;
  stackable: boolean;
  max_stack: number;
  // Equipment fields
  equipment_slot?: EquipmentSlot;
  equipment_stats?: EquipmentStats;
  // Wand fields
  wand_damage?: number;
  wand_core?: string;
  wand_wood?: string;
  wand_length?: number;
  // Consumable fields
  effect?: ConsumableEffect;
  // Broom fields
  broom_stats?: BroomStats;
  // Money fields
  money_value?: number;
}

export interface ItemsCatalogResponse {
  items: Item[];
  count: number;
}

export interface InventoryItem {
  item_id: string;
  name: string;
  description: string;
  category: ItemCategory;
  rarity: ItemRarity;
  quantity: number;
  max_stack: number;
}

export interface InventoryResponse {
  character_id: string;
  items: InventoryItem[];
  total_items: number;
  updated_at: number;
}

export interface AddItemRequest {
  character_id: string;
  item_id: string;
  quantity: number;
}

export interface RemoveItemRequest {
  character_id: string;
  item_id: string;
  quantity: number;
}

// Spells
export type SpellCategory = 'charm' | 'transfiguration' | 'defense' | 'hex' | 'curse' | 'healing' | 'utility';
export type SpellDifficulty = 'beginner' | 'intermediate' | 'advanced' | 'master';
export type SpellType = 'attack' | 'defense' | 'cc' | 'buff' | 'debuff' | 'heal' | 'utility';
export type CCType = 'none' | 'stun' | 'slow' | 'airborne' | 'root' | 'silence' | 'blind' | 'fear' | 'charm' | 'knockback';

export interface Spell {
  id: string;
  name: string;
  incantation: string;
  description: string;
  category: SpellCategory;
  difficulty: SpellDifficulty;
  min_level: number;
  // Gameplay stats
  spell_type?: SpellType;
  damage?: number;
  mana_cost?: number;
  cooldown?: number;
  cc_type?: CCType;
  cc_duration?: number;
  year_required?: number;
  range?: number;
  cast_time?: number;
  is_channeled?: boolean;
}

export interface SpellsCatalogResponse {
  spells: Spell[];
  count: number;
}

export interface CharacterSpell {
  spell_id: string;
  name: string;
  incantation: string;
  description: string;
  category: SpellCategory;
  difficulty: SpellDifficulty;
  level: number;
  max_level: number;
  learned_at: number;
}

export interface CharacterSpellsResponse {
  character_id: string;
  spells: CharacterSpell[];
  total_spells: number;
  updated_at: number;
}

export interface LearnSpellRequest {
  character_id: string;
  spell_id: string;
}

export interface ForgetSpellRequest {
  character_id: string;
  spell_id: string;
}

export interface UpgradeSpellRequest {
  character_id: string;
  spell_id: string;
}

// Notebooks
export type Subject =
  | 'Défense contre les forces du mal'
  | 'Potions'
  | 'Métamorphose'
  | 'Sortilèges'
  | 'Histoire de la Magie'
  | 'Botanique'
  | 'Astronomie'
  | 'Divination'
  | 'Arithmancie'
  | 'Étude des Runes'
  | 'Soins aux Créatures Magiques'
  | 'Étude des Moldus'
  | 'Alchimie'
  | 'Vol sur Balai'
  | 'Autre';

export interface Notebook {
  id: string;
  character_id: string;
  title: string;
  content: string;
  subject: Subject;
  created_at: number;
  updated_at: number;
}

export interface NotebooksResponse {
  character_id: string;
  notebooks: Notebook[];
  count: number;
}

export interface SubjectsResponse {
  subjects: Subject[];
  count: number;
}

// Admin Roles
export type AdminRole = 'Douanier' | 'MJ' | 'Animateur' | 'Owner' | 'Coordinateur' | 'Gérant' | 'Developeur' | '';

// Accounts (Admin)
export interface AccountInfo {
  user_id: string;
  username: string;
  display_name: string;
  email: string;
  role: AdminRole;
  create_time: number;
  update_time: number;
}

export interface AdminListAccountsResponse {
  accounts: AccountInfo[];
  count: number;
}

export interface AdminUpdateAccountRequest {
  user_id: string;
  username?: string;
  display_name?: string;
  role?: AdminRole;
}

export interface AdminCreateAccountRequest {
  username: string;
  email?: string;
  password?: string;
  display_name?: string;
  role?: AdminRole;
}

export interface AdminRolesResponse {
  roles: AdminRole[];
}

// Admin Character Management
export interface AdminCharacterEntry {
  id: string;
  name: string;
  house: HouseName;
  level: number;
  xp: number;
  created_at: number;
  updated_at: number;
  owner_id: string;
  owner_username: string;
}

export interface AdminListAllCharactersResponse {
  characters: AdminCharacterEntry[];
  count: number;
}

export interface AdminCreateCharacterRequest {
  user_id: string;
  name: string;
}

export interface AdminUpdateCharacterRequest {
  user_id: string;
  id: string;
  name?: string;
  house?: HouseName;
  level?: number;
  xp?: number;
}

export interface AdminDeleteCharacterRequest {
  user_id: string;
  id: string;
}

// Storage Logs
export interface StorageObjectEntry {
  collection: string;
  key: string;
  user_id: string;
  username: string;
  value: string;
  version: string;
  permission_read: number;
  permission_write: number;
  create_time: number;
  update_time: number;
}

export interface StorageLogsResponse {
  objects: StorageObjectEntry[];
  count: number;
}

// Catalog Management (Admin)
export interface SpellCatalogResponse {
  spells: Spell[];
  count: number;
}

export interface CreateSpellRequest {
  id: string;
  name: string;
  incantation: string;
  description: string;
  category: SpellCategory;
  difficulty: SpellDifficulty;
  min_level: number;
  spell_type?: SpellType;
  damage?: number;
  mana_cost?: number;
  cooldown?: number;
  cc_type?: CCType;
  cc_duration?: number;
  year_required?: number;
  range?: number;
  cast_time?: number;
  is_channeled?: boolean;
}

export interface UpdateSpellRequest extends Partial<CreateSpellRequest> {
  id: string;
}

export interface ItemCatalogResponse {
  items: Item[];
  count: number;
}

export interface CreateItemRequest {
  id: string;
  name: string;
  description: string;
  category: ItemCategory;
  rarity: ItemRarity;
  stackable: boolean;
  max_stack: number;
  equipment_slot?: EquipmentSlot;
  equipment_stats?: EquipmentStats;
  wand_damage?: number;
  wand_core?: string;
  wand_wood?: string;
  wand_length?: number;
  effect?: ConsumableEffect;
  broom_stats?: BroomStats;
  money_value?: number;
}

export interface UpdateItemRequest extends Partial<CreateItemRequest> {
  id: string;
}
