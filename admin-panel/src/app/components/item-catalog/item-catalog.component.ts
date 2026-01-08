import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// PrimeNG
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { DropdownModule } from 'primeng/dropdown';
import { ToastModule } from 'primeng/toast';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { CheckboxModule } from 'primeng/checkbox';
import { TabViewModule } from 'primeng/tabview';
import { MessageService, ConfirmationService } from 'primeng/api';

import { NakamaService } from '../../services/nakama.service';
import {
  Item, ItemCategory, ItemRarity, EquipmentSlot, ConsumableEffectType,
  ConsumableEffect, EquipmentStats, BroomStats, CreateItemRequest, UpdateItemRequest
} from '../../models';

interface SelectOption<T> {
  label: string;
  value: T;
}

@Component({
  selector: 'app-item-catalog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    TableModule,
    InputTextModule,
    InputNumberModule,
    DropdownModule,
    ToastModule,
    ProgressSpinnerModule,
    TagModule,
    DialogModule,
    ConfirmDialogModule,
    CheckboxModule,
    TabViewModule
  ],
  providers: [MessageService, ConfirmationService],
  template: `
    <p-toast></p-toast>
    <p-confirmDialog header="Confirmation" icon="pi pi-exclamation-triangle"></p-confirmDialog>

    <div class="page-header">
      <h1>Catalogue des Objets</h1>
      <p>Gérez les objets disponibles dans le jeu</p>
    </div>

    <p-card>
      <div class="flex justify-content-between align-items-center mb-3">
        <div class="flex gap-2">
          <span class="p-input-icon-left">
            <i class="pi pi-search"></i>
            <input
              type="text"
              pInputText
              [(ngModel)]="searchQuery"
              placeholder="Rechercher..."
              (input)="filterItems()"
              class="w-15rem"
            />
          </span>
          <p-dropdown
            [options]="categoryOptions"
            [(ngModel)]="selectedCategoryFilter"
            placeholder="Toutes catégories"
            [showClear]="true"
            optionLabel="label"
            optionValue="value"
            (onChange)="filterItems()"
            styleClass="w-12rem"
          ></p-dropdown>
          <p-dropdown
            [options]="rarityOptions"
            [(ngModel)]="selectedRarityFilter"
            placeholder="Toutes raretés"
            [showClear]="true"
            optionLabel="label"
            optionValue="value"
            (onChange)="filterItems()"
            styleClass="w-10rem"
          ></p-dropdown>
        </div>
        <div class="flex gap-2">
          <p-button
            icon="pi pi-plus"
            label="Créer un objet"
            (onClick)="openCreateDialog()"
          ></p-button>
          <p-button
            icon="pi pi-refresh"
            [text]="true"
            (onClick)="loadItems()"
            pTooltip="Actualiser"
          ></p-button>
        </div>
      </div>

      @if (loading()) {
        <div class="flex justify-content-center p-4">
          <p-progressSpinner styleClass="w-3rem h-3rem"></p-progressSpinner>
        </div>
      } @else {
        <p-table
          [value]="filteredItems()"
          [paginator]="true"
          [rows]="15"
          [rowsPerPageOptions]="[15, 30, 50]"
          [sortField]="'name'"
          [sortOrder]="1"
          styleClass="p-datatable-sm p-datatable-hoverable-rows"
          [rowHover]="true"
        >
          <ng-template pTemplate="header">
            <tr>
              <th pSortableColumn="name">
                Nom <p-sortIcon field="name"></p-sortIcon>
              </th>
              <th pSortableColumn="category">
                Catégorie <p-sortIcon field="category"></p-sortIcon>
              </th>
              <th pSortableColumn="rarity">
                Rareté <p-sortIcon field="rarity"></p-sortIcon>
              </th>
              <th>Détails</th>
              <th pSortableColumn="stackable">
                Empilable <p-sortIcon field="stackable"></p-sortIcon>
              </th>
              <th pSortableColumn="max_stack">
                Max Stack <p-sortIcon field="max_stack"></p-sortIcon>
              </th>
              <th style="width: 120px">Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-item>
            <tr>
              <td>
                <div class="flex flex-column">
                  <span class="font-semibold">{{ item.name }}</span>
                  <span class="text-xs text-color-secondary">{{ item.id }}</span>
                </div>
              </td>
              <td>
                <span class="category-badge" [class]="'category-' + item.category">
                  {{ getCategoryLabel(item.category) }}
                </span>
              </td>
              <td>
                <span class="rarity-badge" [class]="'rarity-' + item.rarity">
                  {{ getRarityLabel(item.rarity) }}
                </span>
              </td>
              <td>
                <span class="text-sm">{{ getItemDetails(item) }}</span>
              </td>
              <td>
                <i [class]="item.stackable ? 'pi pi-check text-green-500' : 'pi pi-times text-red-500'"></i>
              </td>
              <td>{{ item.max_stack }}</td>
              <td>
                <div class="flex gap-1">
                  <p-button
                    icon="pi pi-pencil"
                    [rounded]="true"
                    [text]="true"
                    (onClick)="openEditDialog(item)"
                    pTooltip="Modifier"
                  ></p-button>
                  <p-button
                    icon="pi pi-trash"
                    [rounded]="true"
                    [text]="true"
                    severity="danger"
                    (onClick)="confirmDelete(item)"
                    pTooltip="Supprimer"
                  ></p-button>
                </div>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="7" class="text-center p-4">
                @if (searchQuery || selectedCategoryFilter || selectedRarityFilter) {
                  Aucun objet ne correspond aux filtres
                } @else {
                  Aucun objet trouvé
                }
              </td>
            </tr>
          </ng-template>
        </p-table>
      }
    </p-card>

    <!-- Create/Edit Dialog -->
    <p-dialog
      [header]="editMode ? 'Modifier l\\'objet' : 'Créer un objet'"
      [(visible)]="dialogVisible"
      [modal]="true"
      [style]="{ width: '800px' }"
      [closable]="true"
    >
      <p-tabView>
        <!-- General Tab -->
        <p-tabPanel header="Général">
          <div class="grid">
            <div class="col-6">
              <div class="field">
                <label class="block mb-2 font-medium">ID *</label>
                <input
                  type="text"
                  pInputText
                  [(ngModel)]="form.id"
                  class="w-full"
                  [disabled]="editMode"
                  placeholder="item_xxx"
                />
              </div>
            </div>
            <div class="col-6">
              <div class="field">
                <label class="block mb-2 font-medium">Nom *</label>
                <input
                  type="text"
                  pInputText
                  [(ngModel)]="form.name"
                  class="w-full"
                  placeholder="Nom de l'objet"
                />
              </div>
            </div>
            <div class="col-12">
              <div class="field">
                <label class="block mb-2 font-medium">Description</label>
                <input
                  type="text"
                  pInputText
                  [(ngModel)]="form.description"
                  class="w-full"
                  placeholder="Description de l'objet"
                />
              </div>
            </div>
            <div class="col-4">
              <div class="field">
                <label class="block mb-2 font-medium">Catégorie *</label>
                <p-dropdown
                  [options]="categoryOptions"
                  [(ngModel)]="form.category"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Sélectionner"
                  styleClass="w-full"
                  (onChange)="onCategoryChange()"
                ></p-dropdown>
              </div>
            </div>
            <div class="col-4">
              <div class="field">
                <label class="block mb-2 font-medium">Rareté *</label>
                <p-dropdown
                  [options]="rarityOptions"
                  [(ngModel)]="form.rarity"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Sélectionner"
                  styleClass="w-full"
                ></p-dropdown>
              </div>
            </div>
            <div class="col-4">
              <div class="field">
                <label class="block mb-2 font-medium">Max Stack</label>
                <p-inputNumber
                  [(ngModel)]="form.max_stack"
                  [min]="1"
                  styleClass="w-full"
                ></p-inputNumber>
              </div>
            </div>
            <div class="col-12">
              <p-checkbox
                [(ngModel)]="form.stackable"
                [binary]="true"
                label="Empilable"
              ></p-checkbox>
            </div>
          </div>
        </p-tabPanel>

        <!-- Equipment Tab -->
        <p-tabPanel header="Équipement" [disabled]="form.category !== 'equipment'">
          <div class="grid">
            <div class="col-6">
              <div class="field">
                <label class="block mb-2 font-medium">Emplacement</label>
                <p-dropdown
                  [options]="equipmentSlotOptions"
                  [(ngModel)]="form.equipment_slot"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Sélectionner"
                  styleClass="w-full"
                ></p-dropdown>
              </div>
            </div>
            <div class="col-12 mt-2">
              <h5>Stats d'équipement</h5>
            </div>
            <div class="col-3">
              <div class="field">
                <label class="block mb-2 font-medium">Vie</label>
                <p-inputNumber [(ngModel)]="equipmentStats.health" styleClass="w-full"></p-inputNumber>
              </div>
            </div>
            <div class="col-3">
              <div class="field">
                <label class="block mb-2 font-medium">Mana</label>
                <p-inputNumber [(ngModel)]="equipmentStats.mana" styleClass="w-full"></p-inputNumber>
              </div>
            </div>
            <div class="col-3">
              <div class="field">
                <label class="block mb-2 font-medium">Force</label>
                <p-inputNumber [(ngModel)]="equipmentStats.strength" styleClass="w-full"></p-inputNumber>
              </div>
            </div>
            <div class="col-3">
              <div class="field">
                <label class="block mb-2 font-medium">Intelligence</label>
                <p-inputNumber [(ngModel)]="equipmentStats.intelligence" styleClass="w-full"></p-inputNumber>
              </div>
            </div>
            <div class="col-3">
              <div class="field">
                <label class="block mb-2 font-medium">Défense</label>
                <p-inputNumber [(ngModel)]="equipmentStats.defense" styleClass="w-full"></p-inputNumber>
              </div>
            </div>
            <div class="col-3">
              <div class="field">
                <label class="block mb-2 font-medium">Déf. Magique</label>
                <p-inputNumber [(ngModel)]="equipmentStats.magic_defense" styleClass="w-full"></p-inputNumber>
              </div>
            </div>
            <div class="col-3">
              <div class="field">
                <label class="block mb-2 font-medium">Vitesse</label>
                <p-inputNumber [(ngModel)]="equipmentStats.speed" styleClass="w-full"></p-inputNumber>
              </div>
            </div>
          </div>
        </p-tabPanel>

        <!-- Wand Tab -->
        <p-tabPanel header="Baguette" [disabled]="form.category !== 'wand'">
          <div class="grid">
            <div class="col-3">
              <div class="field">
                <label class="block mb-2 font-medium">Dégâts</label>
                <p-inputNumber [(ngModel)]="form.wand_damage" [min]="0" styleClass="w-full"></p-inputNumber>
              </div>
            </div>
            <div class="col-3">
              <div class="field">
                <label class="block mb-2 font-medium">Bois</label>
                <input type="text" pInputText [(ngModel)]="form.wand_wood" class="w-full" placeholder="Ex: Chêne" />
              </div>
            </div>
            <div class="col-3">
              <div class="field">
                <label class="block mb-2 font-medium">Cœur</label>
                <input type="text" pInputText [(ngModel)]="form.wand_core" class="w-full" placeholder="Ex: Plume de phénix" />
              </div>
            </div>
            <div class="col-3">
              <div class="field">
                <label class="block mb-2 font-medium">Longueur (cm)</label>
                <p-inputNumber [(ngModel)]="form.wand_length" [min]="0" [maxFractionDigits]="1" styleClass="w-full"></p-inputNumber>
              </div>
            </div>
          </div>
        </p-tabPanel>

        <!-- Consumable Tab -->
        <p-tabPanel header="Consommable" [disabled]="form.category !== 'consumable'">
          <div class="grid">
            <div class="col-4">
              <div class="field">
                <label class="block mb-2 font-medium">Type d'effet</label>
                <p-dropdown
                  [options]="effectTypeOptions"
                  [(ngModel)]="consumableEffect.type"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Sélectionner"
                  styleClass="w-full"
                ></p-dropdown>
              </div>
            </div>
            <div class="col-4">
              <div class="field">
                <label class="block mb-2 font-medium">Valeur</label>
                <p-inputNumber [(ngModel)]="consumableEffect.value" styleClass="w-full"></p-inputNumber>
              </div>
            </div>
            <div class="col-4">
              <div class="field">
                <label class="block mb-2 font-medium">Durée (s)</label>
                <p-inputNumber [(ngModel)]="consumableEffect.duration" [min]="0" [maxFractionDigits]="1" styleClass="w-full"></p-inputNumber>
              </div>
            </div>
            <div class="col-4">
              <div class="field">
                <label class="block mb-2 font-medium">Type de stat (buff)</label>
                <input type="text" pInputText [(ngModel)]="consumableEffect.stat_type" class="w-full" placeholder="Ex: strength" />
              </div>
            </div>
            <div class="col-4">
              <div class="field">
                <label class="block mb-2 font-medium">Forme cible (transform)</label>
                <input type="text" pInputText [(ngModel)]="consumableEffect.target_form" class="w-full" />
              </div>
            </div>
            <div class="col-4">
              <div class="field">
                <label class="block mb-2 font-medium">Données custom</label>
                <input type="text" pInputText [(ngModel)]="consumableEffect.custom_data" class="w-full" />
              </div>
            </div>
          </div>
        </p-tabPanel>

        <!-- Broom Tab -->
        <p-tabPanel header="Balai" [disabled]="form.category !== 'broom'">
          <div class="grid">
            <div class="col-3">
              <div class="field">
                <label class="block mb-2 font-medium">Vitesse max (m/s)</label>
                <p-inputNumber [(ngModel)]="broomStats.max_speed" [min]="0" [maxFractionDigits]="1" styleClass="w-full"></p-inputNumber>
              </div>
            </div>
            <div class="col-3">
              <div class="field">
                <label class="block mb-2 font-medium">Accélération (m/s²)</label>
                <p-inputNumber [(ngModel)]="broomStats.acceleration" [min]="0" [maxFractionDigits]="1" styleClass="w-full"></p-inputNumber>
              </div>
            </div>
            <div class="col-3">
              <div class="field">
                <label class="block mb-2 font-medium">Maniabilité (1-10)</label>
                <p-inputNumber [(ngModel)]="broomStats.handling" [min]="1" [max]="10" [maxFractionDigits]="1" styleClass="w-full"></p-inputNumber>
              </div>
            </div>
            <div class="col-3">
              <div class="field">
                <label class="block mb-2 font-medium">Altitude max (m)</label>
                <p-inputNumber [(ngModel)]="broomStats.max_altitude" [min]="0" styleClass="w-full"></p-inputNumber>
              </div>
            </div>
          </div>
        </p-tabPanel>

        <!-- Money Tab -->
        <p-tabPanel header="Monnaie" [disabled]="form.category !== 'money'">
          <div class="grid">
            <div class="col-6">
              <div class="field">
                <label class="block mb-2 font-medium">Valeur (en Noises)</label>
                <p-inputNumber [(ngModel)]="form.money_value" [min]="1" styleClass="w-full"></p-inputNumber>
              </div>
            </div>
          </div>
        </p-tabPanel>
      </p-tabView>

      <ng-template pTemplate="footer">
        <p-button
          label="Annuler"
          [text]="true"
          (onClick)="dialogVisible = false"
        ></p-button>
        <p-button
          [label]="editMode ? 'Enregistrer' : 'Créer'"
          icon="pi pi-check"
          (onClick)="saveItem()"
          [loading]="saving()"
          [disabled]="!isFormValid()"
        ></p-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .category-badge {
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;

      &.category-equipment { background: #3b82f6; color: white; }
      &.category-wand { background: #8b5cf6; color: white; }
      &.category-consumable { background: #10b981; color: white; }
      &.category-broom { background: #f59e0b; color: black; }
      &.category-money { background: #eab308; color: black; }
      &.category-resource { background: #6b7280; color: white; }
    }

    .rarity-badge {
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.7rem;
      font-weight: 600;

      &.rarity-common { background: #e5e7eb; color: #374151; }
      &.rarity-uncommon { background: #d1fae5; color: #065f46; }
      &.rarity-rare { background: #dbeafe; color: #1e40af; }
      &.rarity-epic { background: #ede9fe; color: #5b21b6; }
      &.rarity-legendary { background: #fef3c7; color: #92400e; }
    }

    :host ::ng-deep {
      .p-datatable-hoverable-rows .p-datatable-tbody > tr:hover {
        background: var(--surface-hover);
      }
    }
  `]
})
export class ItemCatalogComponent implements OnInit {
  items = signal<Item[]>([]);
  filteredItems = signal<Item[]>([]);
  loading = signal(false);
  saving = signal(false);

  searchQuery = '';
  selectedCategoryFilter: ItemCategory | null = null;
  selectedRarityFilter: ItemRarity | null = null;

  categoryOptions: SelectOption<ItemCategory>[] = [
    { label: 'Équipement', value: 'equipment' },
    { label: 'Baguette', value: 'wand' },
    { label: 'Consommable', value: 'consumable' },
    { label: 'Balai', value: 'broom' },
    { label: 'Monnaie', value: 'money' },
    { label: 'Ressource', value: 'resource' }
  ];

  rarityOptions: SelectOption<ItemRarity>[] = [
    { label: 'Commun', value: 'common' },
    { label: 'Peu commun', value: 'uncommon' },
    { label: 'Rare', value: 'rare' },
    { label: 'Épique', value: 'epic' },
    { label: 'Légendaire', value: 'legendary' }
  ];

  equipmentSlotOptions: SelectOption<EquipmentSlot>[] = [
    { label: 'Tête', value: 'head' },
    { label: 'Torse', value: 'chest' },
    { label: 'Mains', value: 'hands' },
    { label: 'Jambes', value: 'legs' },
    { label: 'Pieds', value: 'feet' },
    { label: 'Cou', value: 'neck' },
    { label: 'Anneau', value: 'ring' },
    { label: 'Dos', value: 'back' },
    { label: 'Main principale', value: 'mainhand' },
    { label: 'Main secondaire', value: 'offhand' }
  ];

  effectTypeOptions: SelectOption<ConsumableEffectType>[] = [
    { label: 'Soin PV', value: 'heal_hp' },
    { label: 'Soin Mana', value: 'heal_mana' },
    { label: 'Buff stat', value: 'buff_stat' },
    { label: 'Transformation', value: 'transform' },
    { label: 'Invisibilité', value: 'invisibility' },
    { label: 'Vitesse', value: 'speed' },
    { label: 'Chance', value: 'luck' },
    { label: 'Résistance', value: 'resistance' },
    { label: 'Personnalisé', value: 'custom' }
  ];

  // Dialog
  dialogVisible = false;
  editMode = false;
  selectedItem: Item | null = null;
  form: CreateItemRequest = this.getEmptyForm();
  equipmentStats: EquipmentStats = {};
  consumableEffect: ConsumableEffect = { type: 'heal_hp' };
  broomStats: BroomStats = { max_speed: 0, acceleration: 0, handling: 5, max_altitude: 100 };

  constructor(
    private nakamaService: NakamaService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService
  ) {}

  ngOnInit(): void {
    this.loadItems();
  }

  getEmptyForm(): CreateItemRequest {
    return {
      id: '',
      name: '',
      description: '',
      category: 'resource',
      rarity: 'common',
      stackable: true,
      max_stack: 99
    };
  }

  loadItems(): void {
    this.loading.set(true);

    this.nakamaService.listItemCatalog().subscribe({
      next: (response) => {
        this.items.set(response.items || []);
        this.filterItems();
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to load items:', err);
        this.loading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de charger les objets'
        });
      }
    });
  }

  filterItems(): void {
    let filtered = this.items();

    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(i =>
        i.name.toLowerCase().includes(query) ||
        i.id.toLowerCase().includes(query) ||
        i.description?.toLowerCase().includes(query)
      );
    }

    if (this.selectedCategoryFilter) {
      filtered = filtered.filter(i => i.category === this.selectedCategoryFilter);
    }

    if (this.selectedRarityFilter) {
      filtered = filtered.filter(i => i.rarity === this.selectedRarityFilter);
    }

    this.filteredItems.set(filtered);
  }

  onCategoryChange(): void {
    // Reset category-specific fields when category changes
    this.form.equipment_slot = undefined;
    this.form.equipment_stats = undefined;
    this.form.wand_damage = undefined;
    this.form.wand_core = undefined;
    this.form.wand_wood = undefined;
    this.form.wand_length = undefined;
    this.form.effect = undefined;
    this.form.broom_stats = undefined;
    this.form.money_value = undefined;

    // Set default stackability based on category
    if (this.form.category === 'equipment' || this.form.category === 'wand' || this.form.category === 'broom') {
      this.form.stackable = false;
      this.form.max_stack = 1;
    } else {
      this.form.stackable = true;
      this.form.max_stack = 99;
    }
  }

  openCreateDialog(): void {
    this.editMode = false;
    this.selectedItem = null;
    this.form = this.getEmptyForm();
    this.equipmentStats = {};
    this.consumableEffect = { type: 'heal_hp' };
    this.broomStats = { max_speed: 0, acceleration: 0, handling: 5, max_altitude: 100 };
    this.dialogVisible = true;
  }

  openEditDialog(item: Item): void {
    this.editMode = true;
    this.selectedItem = item;
    this.form = {
      id: item.id,
      name: item.name,
      description: item.description,
      category: item.category,
      rarity: item.rarity,
      stackable: item.stackable,
      max_stack: item.max_stack,
      equipment_slot: item.equipment_slot,
      wand_damage: item.wand_damage,
      wand_core: item.wand_core,
      wand_wood: item.wand_wood,
      wand_length: item.wand_length,
      money_value: item.money_value
    };
    this.equipmentStats = item.equipment_stats ? { ...item.equipment_stats } : {};
    this.consumableEffect = item.effect ? { ...item.effect } : { type: 'heal_hp' };
    this.broomStats = item.broom_stats ? { ...item.broom_stats } : { max_speed: 0, acceleration: 0, handling: 5, max_altitude: 100 };
    this.dialogVisible = true;
  }

  isFormValid(): boolean {
    return !!(this.form.id && this.form.name && this.form.category && this.form.rarity);
  }

  buildRequest(): CreateItemRequest {
    const request: CreateItemRequest = { ...this.form };

    // Add category-specific fields
    if (this.form.category === 'equipment') {
      request.equipment_stats = this.hasStats(this.equipmentStats) ? this.equipmentStats : undefined;
    } else if (this.form.category === 'consumable') {
      request.effect = this.consumableEffect;
    } else if (this.form.category === 'broom') {
      request.broom_stats = this.broomStats;
    }

    return request;
  }

  hasStats(stats: EquipmentStats): boolean {
    return !!(stats.health || stats.mana || stats.strength || stats.intelligence ||
              stats.defense || stats.magic_defense || stats.speed);
  }

  saveItem(): void {
    if (!this.isFormValid()) return;

    this.saving.set(true);
    const request = this.buildRequest();

    if (this.editMode) {
      this.nakamaService.updateItem(request as UpdateItemRequest).subscribe({
        next: (updated) => {
          const items = this.items();
          const index = items.findIndex(i => i.id === updated.id);
          if (index >= 0) {
            items[index] = updated;
            this.items.set([...items]);
            this.filterItems();
          }
          this.saving.set(false);
          this.dialogVisible = false;
          this.messageService.add({
            severity: 'success',
            summary: 'Succès',
            detail: 'Objet mis à jour'
          });
        },
        error: (err) => {
          console.error('Failed to update item:', err);
          this.saving.set(false);
          this.messageService.add({
            severity: 'error',
            summary: 'Erreur',
            detail: 'Impossible de mettre à jour l\'objet'
          });
        }
      });
    } else {
      this.nakamaService.createItem(request).subscribe({
        next: (created) => {
          this.items.set([...this.items(), created]);
          this.filterItems();
          this.saving.set(false);
          this.dialogVisible = false;
          this.messageService.add({
            severity: 'success',
            summary: 'Succès',
            detail: 'Objet créé'
          });
        },
        error: (err) => {
          console.error('Failed to create item:', err);
          this.saving.set(false);
          this.messageService.add({
            severity: 'error',
            summary: 'Erreur',
            detail: 'Impossible de créer l\'objet'
          });
        }
      });
    }
  }

  confirmDelete(item: Item): void {
    this.confirmationService.confirm({
      message: `Êtes-vous sûr de vouloir supprimer l'objet "${item.name}" ?`,
      accept: () => this.deleteItem(item)
    });
  }

  deleteItem(item: Item): void {
    this.nakamaService.deleteItem(item.id).subscribe({
      next: () => {
        const items = this.items().filter(i => i.id !== item.id);
        this.items.set(items);
        this.filterItems();
        this.messageService.add({
          severity: 'success',
          summary: 'Succès',
          detail: 'Objet supprimé'
        });
      },
      error: (err) => {
        console.error('Failed to delete item:', err);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de supprimer l\'objet'
        });
      }
    });
  }

  getCategoryLabel(category: ItemCategory): string {
    return this.categoryOptions.find(o => o.value === category)?.label || category;
  }

  getRarityLabel(rarity: ItemRarity): string {
    return this.rarityOptions.find(o => o.value === rarity)?.label || rarity;
  }

  getItemDetails(item: Item): string {
    switch (item.category) {
      case 'wand':
        if (item.wand_damage) return `Dégâts: ${item.wand_damage}`;
        return item.wand_wood || '-';
      case 'consumable':
        if (item.effect) return this.effectTypeOptions.find(o => o.value === item.effect?.type)?.label || '-';
        return '-';
      case 'broom':
        if (item.broom_stats) return `${item.broom_stats.max_speed} m/s`;
        return '-';
      case 'money':
        if (item.money_value) return `${item.money_value} Noises`;
        return '-';
      case 'equipment':
        if (item.equipment_slot) return this.equipmentSlotOptions.find(o => o.value === item.equipment_slot)?.label || item.equipment_slot;
        return '-';
      default:
        return '-';
    }
  }
}
