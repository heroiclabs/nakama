import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  HouseRankingsResponse,
  HousePointsHistoryResponse,
  ModifyHousePointsRequest,
  Character,
  CharacterListResponse,
  UpdateCharacterRequest,
  Item,
  ItemsCatalogResponse,
  InventoryResponse,
  AddItemRequest,
  RemoveItemRequest,
  Spell,
  SpellsCatalogResponse,
  CharacterSpellsResponse,
  LearnSpellRequest,
  ForgetSpellRequest,
  UpgradeSpellRequest,
  HouseName
} from '../models';

interface RpcResponse<T> {
  payload: string;
}

@Injectable({
  providedIn: 'root'
})
export class NakamaService {
  private readonly baseUrl = environment.nakamaUrl;

  constructor(private http: HttpClient) {}

  private rpc<T>(id: string, payload: object = {}): Observable<T> {
    const url = `${this.baseUrl}/v2/rpc/${id}`;
    // Nakama RPC expects the payload as a JSON string directly in the body
    return this.http.post<{ payload: string }>(url, JSON.stringify(payload)).pipe(
      map(response => JSON.parse(response.payload) as T)
    );
  }

  // ==================== House Points ====================

  getHouseRankings(): Observable<HouseRankingsResponse> {
    return this.rpc<HouseRankingsResponse>('elderwood_get_house_rankings');
  }

  getHousePointsHistory(house?: HouseName, limit?: number): Observable<HousePointsHistoryResponse> {
    const payload: { house?: string; limit?: number } = {};
    if (house) payload.house = house;
    if (limit) payload.limit = limit;
    return this.rpc<HousePointsHistoryResponse>('elderwood_get_house_points_history', payload);
  }

  modifyHousePoints(request: ModifyHousePointsRequest): Observable<any> {
    return this.rpc('elderwood_modify_house_points', request);
  }

  // ==================== Characters ====================

  // Note: For admin, we need to use server-to-server API or admin console API
  // For now, this will work with the authenticated user's characters
  getCharacters(): Observable<Character[]> {
    return this.rpc<CharacterListResponse>('elderwood_get_characters').pipe(
      map(response => response.characters)
    );
  }

  getCharacter(id: string): Observable<Character> {
    return this.rpc<Character>('elderwood_get_character', { id });
  }

  updateCharacter(request: UpdateCharacterRequest): Observable<Character> {
    return this.rpc<Character>('elderwood_update_character', request);
  }

  // ==================== Items Catalog ====================

  getItemsCatalog(category?: string, rarity?: string): Observable<Item[]> {
    const payload: { category?: string; rarity?: string } = {};
    if (category) payload.category = category;
    if (rarity) payload.rarity = rarity;
    return this.rpc<ItemsCatalogResponse>('elderwood_get_items_catalog', payload).pipe(
      map(response => response.items)
    );
  }

  // ==================== Inventory ====================

  getInventory(characterId: string): Observable<InventoryResponse> {
    return this.rpc<InventoryResponse>('elderwood_get_inventory', { character_id: characterId });
  }

  addItem(request: AddItemRequest): Observable<any> {
    return this.rpc('elderwood_add_item', request);
  }

  removeItem(request: RemoveItemRequest): Observable<any> {
    return this.rpc('elderwood_remove_item', request);
  }

  // ==================== Spells Catalog ====================

  getSpellsCatalog(category?: string, difficulty?: string): Observable<Spell[]> {
    const payload: { category?: string; difficulty?: string } = {};
    if (category) payload.category = category;
    if (difficulty) payload.difficulty = difficulty;
    return this.rpc<SpellsCatalogResponse>('elderwood_get_spells_catalog', payload).pipe(
      map(response => response.spells)
    );
  }

  // ==================== Character Spells ====================

  getCharacterSpells(characterId: string): Observable<CharacterSpellsResponse> {
    return this.rpc<CharacterSpellsResponse>('elderwood_get_character_spells', { character_id: characterId });
  }

  learnSpell(request: LearnSpellRequest): Observable<any> {
    return this.rpc('elderwood_learn_spell', request);
  }

  forgetSpell(request: ForgetSpellRequest): Observable<any> {
    return this.rpc('elderwood_forget_spell', request);
  }

  upgradeSpell(request: UpgradeSpellRequest): Observable<any> {
    return this.rpc('elderwood_upgrade_spell', request);
  }
}
