import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

// PrimeNG
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TabViewModule } from 'primeng/tabview';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { DropdownModule } from 'primeng/dropdown';
import { ToastModule } from 'primeng/toast';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TagModule } from 'primeng/tag';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { MessageService, ConfirmationService } from 'primeng/api';

import { NakamaService } from '../../services/nakama.service';
import {
  Character,
  HouseName,
  CharacterSpell,
  InventoryItem,
  Spell,
  Item
} from '../../models';

@Component({
  selector: 'app-character-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    TabViewModule,
    TableModule,
    DialogModule,
    InputTextModule,
    InputNumberModule,
    DropdownModule,
    ToastModule,
    ProgressSpinnerModule,
    TagModule,
    ConfirmDialogModule
  ],
  providers: [MessageService, ConfirmationService],
  template: `
    <p-toast></p-toast>
    <p-confirmDialog></p-confirmDialog>

    <!-- Back Button -->
    <div class="mb-3">
      <p-button
        icon="pi pi-arrow-left"
        label="Retour"
        [text]="true"
        (onClick)="goBack()"
      ></p-button>
    </div>

    @if (loading()) {
      <div class="flex justify-content-center p-4">
        <p-progressSpinner styleClass="w-4rem h-4rem"></p-progressSpinner>
      </div>
    } @else if (character()) {
      <!-- Character Header -->
      <div class="character-header mb-4">
        <div class="character-avatar-large">
          {{ character()!.name.charAt(0).toUpperCase() }}
        </div>
        <div class="character-info">
          <h1>{{ character()!.name }}</h1>
          <div class="character-meta">
            <span class="house-badge" [class]="getHouseClass(character()!.house)">
              {{ character()!.house }}
            </span>
            <span class="level-badge">Niveau {{ character()!.level }}</span>
            <span class="xp-badge">{{ character()!.xp | number }} XP</span>
          </div>
        </div>
        <div class="character-actions">
          <p-button
            icon="pi pi-pencil"
            label="Modifier"
            (onClick)="openEditDialog()"
          ></p-button>
        </div>
      </div>

      <!-- Tabs -->
      <p-tabView>
        <!-- Info Tab -->
        <p-tabPanel header="Informations">
          <div class="grid">
            <div class="col-12 md:col-6">
              <p-card header="Détails du personnage">
                <div class="info-grid">
                  <div class="info-item">
                    <span class="info-label">ID</span>
                    <span class="info-value">{{ character()!.id }}</span>
                  </div>
                  <div class="info-item">
                    <span class="info-label">Nom</span>
                    <span class="info-value">{{ character()!.name }}</span>
                  </div>
                  <div class="info-item">
                    <span class="info-label">Maison</span>
                    <span class="info-value">{{ character()!.house }}</span>
                  </div>
                  <div class="info-item">
                    <span class="info-label">Niveau</span>
                    <span class="info-value">{{ character()!.level }}</span>
                  </div>
                  <div class="info-item">
                    <span class="info-label">Expérience</span>
                    <span class="info-value">{{ character()!.xp | number }}</span>
                  </div>
                  <div class="info-item">
                    <span class="info-label">Créé le</span>
                    <span class="info-value">{{ character()!.created_at * 1000 | date:'dd/MM/yyyy HH:mm' }}</span>
                  </div>
                  <div class="info-item">
                    <span class="info-label">Modifié le</span>
                    <span class="info-value">{{ character()!.updated_at * 1000 | date:'dd/MM/yyyy HH:mm' }}</span>
                  </div>
                </div>
              </p-card>
            </div>
          </div>
        </p-tabPanel>

        <!-- Spells Tab -->
        <p-tabPanel header="Sorts" [cache]="false">
          <div class="flex justify-content-between align-items-center mb-3">
            <span class="text-lg font-semibold">
              {{ spells().length }} sort(s) appris
            </span>
            <p-button
              icon="pi pi-plus"
              label="Ajouter un sort"
              (onClick)="openAddSpellDialog()"
            ></p-button>
          </div>

          @if (loadingSpells()) {
            <div class="flex justify-content-center p-4">
              <p-progressSpinner styleClass="w-3rem h-3rem"></p-progressSpinner>
            </div>
          } @else {
            <p-table
              [value]="spells()"
              [paginator]="spells().length > 10"
              [rows]="10"
              styleClass="p-datatable-sm"
            >
              <ng-template pTemplate="header">
                <tr>
                  <th>Nom</th>
                  <th>Incantation</th>
                  <th>Catégorie</th>
                  <th>Difficulté</th>
                  <th>Niveau</th>
                  <th style="width: 150px">Actions</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-spell>
                <tr>
                  <td class="font-semibold">{{ spell.name }}</td>
                  <td><em>{{ spell.incantation }}</em></td>
                  <td>
                    <p-tag [value]="getCategoryLabel(spell.category)" [severity]="getCategorySeverity(spell.category)"></p-tag>
                  </td>
                  <td>{{ getDifficultyLabel(spell.difficulty) }}</td>
                  <td>
                    <div class="flex align-items-center gap-2">
                      <span>{{ spell.level }} / {{ spell.max_level }}</span>
                      @if (spell.level < spell.max_level) {
                        <p-button
                          icon="pi pi-arrow-up"
                          [rounded]="true"
                          [text]="true"
                          size="small"
                          severity="success"
                          (onClick)="upgradeSpell(spell)"
                          pTooltip="Améliorer"
                        ></p-button>
                      }
                    </div>
                  </td>
                  <td>
                    <p-button
                      icon="pi pi-trash"
                      [rounded]="true"
                      [text]="true"
                      severity="danger"
                      (onClick)="confirmRemoveSpell(spell)"
                      pTooltip="Oublier le sort"
                    ></p-button>
                  </td>
                </tr>
              </ng-template>
              <ng-template pTemplate="emptymessage">
                <tr>
                  <td colspan="6" class="text-center p-4">
                    Ce personnage n'a appris aucun sort
                  </td>
                </tr>
              </ng-template>
            </p-table>
          }
        </p-tabPanel>

        <!-- Inventory Tab -->
        <p-tabPanel header="Inventaire" [cache]="false">
          <div class="flex justify-content-between align-items-center mb-3">
            <span class="text-lg font-semibold">
              {{ totalItems() }} objet(s) en inventaire
            </span>
            <p-button
              icon="pi pi-plus"
              label="Ajouter un objet"
              (onClick)="openAddItemDialog()"
            ></p-button>
          </div>

          @if (loadingInventory()) {
            <div class="flex justify-content-center p-4">
              <p-progressSpinner styleClass="w-3rem h-3rem"></p-progressSpinner>
            </div>
          } @else {
            <p-table
              [value]="inventory()"
              [paginator]="inventory().length > 10"
              [rows]="10"
              styleClass="p-datatable-sm"
            >
              <ng-template pTemplate="header">
                <tr>
                  <th>Nom</th>
                  <th>Catégorie</th>
                  <th>Rareté</th>
                  <th>Quantité</th>
                  <th style="width: 150px">Actions</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-item>
                <tr>
                  <td>
                    <div class="flex flex-column">
                      <span class="font-semibold">{{ item.name }}</span>
                      <span class="text-sm text-color-secondary">{{ item.description }}</span>
                    </div>
                  </td>
                  <td>{{ getItemCategoryLabel(item.category) }}</td>
                  <td>
                    <p-tag [value]="getRarityLabel(item.rarity)" [severity]="getRaritySeverity(item.rarity)"></p-tag>
                  </td>
                  <td>{{ item.quantity }} / {{ item.max_stack }}</td>
                  <td>
                    <p-button
                      icon="pi pi-minus"
                      [rounded]="true"
                      [text]="true"
                      severity="warning"
                      (onClick)="openRemoveItemDialog(item)"
                      pTooltip="Retirer"
                    ></p-button>
                    <p-button
                      icon="pi pi-trash"
                      [rounded]="true"
                      [text]="true"
                      severity="danger"
                      (onClick)="confirmRemoveAllItems(item)"
                      pTooltip="Supprimer tout"
                    ></p-button>
                  </td>
                </tr>
              </ng-template>
              <ng-template pTemplate="emptymessage">
                <tr>
                  <td colspan="5" class="text-center p-4">
                    L'inventaire est vide
                  </td>
                </tr>
              </ng-template>
            </p-table>
          }
        </p-tabPanel>
      </p-tabView>
    } @else {
      <p-card>
        <div class="text-center p-4">
          <i class="pi pi-exclamation-triangle text-4xl text-yellow-500 mb-3"></i>
          <p>Personnage non trouvé</p>
          <p-button label="Retour à la liste" (onClick)="goBack()"></p-button>
        </div>
      </p-card>
    }

    <!-- Edit Character Dialog -->
    <p-dialog
      [(visible)]="editDialogVisible"
      header="Modifier le personnage"
      [modal]="true"
      [style]="{width: '450px'}"
    >
      <div class="flex flex-column gap-3">
        <div class="form-field">
          <label>Nom</label>
          <input
            type="text"
            pInputText
            [(ngModel)]="editForm.name"
            class="w-full"
          />
        </div>
        <div class="form-field">
          <label>Maison</label>
          <p-dropdown
            [options]="houseOptions"
            [(ngModel)]="editForm.house"
            optionLabel="label"
            optionValue="value"
            styleClass="w-full"
          ></p-dropdown>
        </div>
        <div class="form-field">
          <label>Niveau</label>
          <p-inputNumber
            [(ngModel)]="editForm.level"
            [min]="1"
            [max]="100"
            styleClass="w-full"
          ></p-inputNumber>
        </div>
        <div class="form-field">
          <label>Expérience</label>
          <p-inputNumber
            [(ngModel)]="editForm.xp"
            [min]="0"
            styleClass="w-full"
          ></p-inputNumber>
        </div>
      </div>
      <ng-template pTemplate="footer">
        <p-button label="Annuler" [text]="true" severity="secondary" (onClick)="editDialogVisible = false"></p-button>
        <p-button label="Enregistrer" icon="pi pi-check" (onClick)="saveCharacter()" [loading]="saving()"></p-button>
      </ng-template>
    </p-dialog>

    <!-- Add Spell Dialog -->
    <p-dialog
      [(visible)]="addSpellDialogVisible"
      header="Ajouter un sort"
      [modal]="true"
      [style]="{width: '500px'}"
    >
      <div class="form-field">
        <label>Sélectionner un sort</label>
        <p-dropdown
          [options]="availableSpells()"
          [(ngModel)]="selectedSpell"
          optionLabel="name"
          [filter]="true"
          filterBy="name,incantation"
          placeholder="Rechercher un sort..."
          styleClass="w-full"
        >
          <ng-template let-spell pTemplate="item">
            <div class="flex flex-column">
              <span class="font-semibold">{{ spell.name }}</span>
              <span class="text-sm text-color-secondary">{{ spell.incantation }} - {{ spell.description }}</span>
            </div>
          </ng-template>
        </p-dropdown>
      </div>
      <ng-template pTemplate="footer">
        <p-button label="Annuler" [text]="true" severity="secondary" (onClick)="addSpellDialogVisible = false"></p-button>
        <p-button label="Apprendre" icon="pi pi-plus" (onClick)="addSpell()" [loading]="addingSpell()" [disabled]="!selectedSpell"></p-button>
      </ng-template>
    </p-dialog>

    <!-- Add Item Dialog -->
    <p-dialog
      [(visible)]="addItemDialogVisible"
      header="Ajouter un objet"
      [modal]="true"
      [style]="{width: '500px'}"
    >
      <div class="flex flex-column gap-3">
        <div class="form-field">
          <label>Sélectionner un objet</label>
          <p-dropdown
            [options]="availableItems()"
            [(ngModel)]="selectedItem"
            optionLabel="name"
            [filter]="true"
            filterBy="name"
            placeholder="Rechercher un objet..."
            styleClass="w-full"
          >
            <ng-template let-item pTemplate="item">
              <div class="flex flex-column">
                <span class="font-semibold">{{ item.name }}</span>
                <span class="text-sm text-color-secondary">{{ item.description }}</span>
              </div>
            </ng-template>
          </p-dropdown>
        </div>
        <div class="form-field">
          <label>Quantité</label>
          <p-inputNumber
            [(ngModel)]="itemQuantity"
            [min]="1"
            [max]="selectedItem?.max_stack || 999"
            styleClass="w-full"
          ></p-inputNumber>
        </div>
      </div>
      <ng-template pTemplate="footer">
        <p-button label="Annuler" [text]="true" severity="secondary" (onClick)="addItemDialogVisible = false"></p-button>
        <p-button label="Ajouter" icon="pi pi-plus" (onClick)="addItem()" [loading]="addingItem()" [disabled]="!selectedItem"></p-button>
      </ng-template>
    </p-dialog>

    <!-- Remove Item Dialog -->
    <p-dialog
      [(visible)]="removeItemDialogVisible"
      header="Retirer des objets"
      [modal]="true"
      [style]="{width: '400px'}"
    >
      @if (itemToRemove) {
        <div class="flex flex-column gap-3">
          <p>Combien de <strong>{{ itemToRemove.name }}</strong> voulez-vous retirer ?</p>
          <div class="form-field">
            <label>Quantité (max: {{ itemToRemove.quantity }})</label>
            <p-inputNumber
              [(ngModel)]="removeQuantity"
              [min]="1"
              [max]="itemToRemove.quantity"
              styleClass="w-full"
            ></p-inputNumber>
          </div>
        </div>
      }
      <ng-template pTemplate="footer">
        <p-button label="Annuler" [text]="true" severity="secondary" (onClick)="removeItemDialogVisible = false"></p-button>
        <p-button label="Retirer" icon="pi pi-minus" severity="warning" (onClick)="removeItem()" [loading]="removingItem()"></p-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .character-header {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      padding: 1.5rem;
      background: var(--surface-card);
      border-radius: 0.75rem;
    }

    .character-avatar-large {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: var(--primary-color);
      color: var(--primary-color-text);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 2rem;
    }

    .character-info {
      flex: 1;

      h1 {
        margin: 0 0 0.5rem 0;
        font-size: 1.5rem;
        font-weight: 700;
      }
    }

    .character-meta {
      display: flex;
      gap: 0.75rem;
      align-items: center;
    }

    .house-badge {
      padding: 0.25rem 0.75rem;
      border-radius: 1rem;
      font-size: 0.75rem;
      font-weight: 600;
      color: white;

      &.venatrix { background-color: #dc2626; }
      &.falcon { background-color: #2563eb; }
      &.brumval { background-color: #16a34a; }
      &.aerwyn { background-color: #eab308; color: #000; }
      &.pas-de-maison { background-color: var(--surface-400); color: var(--text-color); }
    }

    .level-badge, .xp-badge {
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      background: var(--surface-200);
      color: var(--text-color);
      font-size: 0.75rem;
      font-weight: 600;
    }

    .info-grid {
      display: grid;
      gap: 1rem;
    }

    .info-item {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .info-label {
      font-size: 0.75rem;
      color: var(--text-color-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .info-value {
      font-weight: 500;
    }
  `]
})
export class CharacterDetailComponent implements OnInit {
  characterId = '';
  character = signal<Character | null>(null);
  loading = signal(true);
  saving = signal(false);

  // Spells
  spells = signal<CharacterSpell[]>([]);
  loadingSpells = signal(false);
  allSpells = signal<Spell[]>([]);
  addSpellDialogVisible = false;
  selectedSpell: Spell | null = null;
  addingSpell = signal(false);

  // Inventory
  inventory = signal<InventoryItem[]>([]);
  totalItems = signal(0);
  loadingInventory = signal(false);
  allItems = signal<Item[]>([]);
  addItemDialogVisible = false;
  selectedItem: Item | null = null;
  itemQuantity = 1;
  addingItem = signal(false);
  removeItemDialogVisible = false;
  itemToRemove: InventoryItem | null = null;
  removeQuantity = 1;
  removingItem = signal(false);

  // Edit dialog
  editDialogVisible = false;
  editForm = {
    name: '',
    house: '' as HouseName,
    level: 1,
    xp: 0
  };

  houseOptions = [
    { label: 'Venatrix', value: 'Venatrix' },
    { label: 'Falcon', value: 'Falcon' },
    { label: 'Brumval', value: 'Brumval' },
    { label: 'Aerwyn', value: 'Aerwyn' },
    { label: 'Pas de Maison', value: 'Pas de Maison' }
  ];

  availableSpells = computed(() => {
    const learnedIds = new Set(this.spells().map(s => s.spell_id));
    return this.allSpells().filter(s => !learnedIds.has(s.id));
  });

  availableItems = computed(() => this.allItems());

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private nakamaService: NakamaService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService
  ) {}

  ngOnInit(): void {
    this.characterId = this.route.snapshot.paramMap.get('id') || '';
    if (this.characterId) {
      this.loadCharacter();
      this.loadSpells();
      this.loadInventory();
      this.loadCatalogs();
    }
  }

  loadCharacter(): void {
    this.loading.set(true);
    this.nakamaService.getCharacter(this.characterId).subscribe({
      next: (character) => {
        this.character.set(character);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to load character:', err);
        this.loading.set(false);
      }
    });
  }

  loadSpells(): void {
    this.loadingSpells.set(true);
    this.nakamaService.getCharacterSpells(this.characterId).subscribe({
      next: (response) => {
        this.spells.set(response.spells);
        this.loadingSpells.set(false);
      },
      error: () => this.loadingSpells.set(false)
    });
  }

  loadInventory(): void {
    this.loadingInventory.set(true);
    this.nakamaService.getInventory(this.characterId).subscribe({
      next: (response) => {
        this.inventory.set(response.items);
        this.totalItems.set(response.total_items);
        this.loadingInventory.set(false);
      },
      error: () => this.loadingInventory.set(false)
    });
  }

  loadCatalogs(): void {
    this.nakamaService.getSpellsCatalog().subscribe({
      next: (spells) => this.allSpells.set(spells)
    });
    this.nakamaService.getItemsCatalog().subscribe({
      next: (items) => this.allItems.set(items)
    });
  }

  openEditDialog(): void {
    const char = this.character();
    if (char) {
      this.editForm = {
        name: char.name,
        house: char.house,
        level: char.level,
        xp: Number(char.xp)
      };
      this.editDialogVisible = true;
    }
  }

  saveCharacter(): void {
    this.saving.set(true);
    this.nakamaService.updateCharacter({
      id: this.characterId,
      name: this.editForm.name,
      house: this.editForm.house,
      level: this.editForm.level,
      xp: this.editForm.xp
    }).subscribe({
      next: (updated) => {
        this.character.set(updated);
        this.saving.set(false);
        this.editDialogVisible = false;
        this.messageService.add({
          severity: 'success',
          summary: 'Succès',
          detail: 'Personnage mis à jour'
        });
      },
      error: () => {
        this.saving.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de mettre à jour le personnage'
        });
      }
    });
  }

  // Spells methods
  openAddSpellDialog(): void {
    this.selectedSpell = null;
    this.addSpellDialogVisible = true;
  }

  addSpell(): void {
    if (!this.selectedSpell) return;
    this.addingSpell.set(true);
    this.nakamaService.learnSpell({
      character_id: this.characterId,
      spell_id: this.selectedSpell.id
    }).subscribe({
      next: () => {
        this.addingSpell.set(false);
        this.addSpellDialogVisible = false;
        this.loadSpells();
        this.messageService.add({
          severity: 'success',
          summary: 'Succès',
          detail: `Sort "${this.selectedSpell!.name}" appris`
        });
      },
      error: () => {
        this.addingSpell.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible d\'apprendre le sort'
        });
      }
    });
  }

  upgradeSpell(spell: CharacterSpell): void {
    this.nakamaService.upgradeSpell({
      character_id: this.characterId,
      spell_id: spell.spell_id
    }).subscribe({
      next: () => {
        this.loadSpells();
        this.messageService.add({
          severity: 'success',
          summary: 'Succès',
          detail: `Sort "${spell.name}" amélioré au niveau ${spell.level + 1}`
        });
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible d\'améliorer le sort'
        });
      }
    });
  }

  confirmRemoveSpell(spell: CharacterSpell): void {
    this.confirmationService.confirm({
      message: `Êtes-vous sûr de vouloir faire oublier "${spell.name}" à ce personnage ?`,
      header: 'Confirmation',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Oui, oublier',
      rejectLabel: 'Annuler',
      accept: () => this.removeSpell(spell)
    });
  }

  removeSpell(spell: CharacterSpell): void {
    this.nakamaService.forgetSpell({
      character_id: this.characterId,
      spell_id: spell.spell_id
    }).subscribe({
      next: () => {
        this.loadSpells();
        this.messageService.add({
          severity: 'success',
          summary: 'Succès',
          detail: `Sort "${spell.name}" oublié`
        });
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible d\'oublier le sort'
        });
      }
    });
  }

  // Inventory methods
  openAddItemDialog(): void {
    this.selectedItem = null;
    this.itemQuantity = 1;
    this.addItemDialogVisible = true;
  }

  addItem(): void {
    if (!this.selectedItem) return;
    this.addingItem.set(true);
    this.nakamaService.addItem({
      character_id: this.characterId,
      item_id: this.selectedItem.id,
      quantity: this.itemQuantity
    }).subscribe({
      next: () => {
        this.addingItem.set(false);
        this.addItemDialogVisible = false;
        this.loadInventory();
        this.messageService.add({
          severity: 'success',
          summary: 'Succès',
          detail: `${this.itemQuantity}x ${this.selectedItem!.name} ajouté(s)`
        });
      },
      error: () => {
        this.addingItem.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible d\'ajouter l\'objet'
        });
      }
    });
  }

  openRemoveItemDialog(item: InventoryItem): void {
    this.itemToRemove = item;
    this.removeQuantity = 1;
    this.removeItemDialogVisible = true;
  }

  removeItem(): void {
    if (!this.itemToRemove) return;
    this.removingItem.set(true);
    this.nakamaService.removeItem({
      character_id: this.characterId,
      item_id: this.itemToRemove.item_id,
      quantity: this.removeQuantity
    }).subscribe({
      next: () => {
        this.removingItem.set(false);
        this.removeItemDialogVisible = false;
        this.loadInventory();
        this.messageService.add({
          severity: 'success',
          summary: 'Succès',
          detail: `${this.removeQuantity}x ${this.itemToRemove!.name} retiré(s)`
        });
      },
      error: () => {
        this.removingItem.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de retirer l\'objet'
        });
      }
    });
  }

  confirmRemoveAllItems(item: InventoryItem): void {
    this.confirmationService.confirm({
      message: `Êtes-vous sûr de vouloir supprimer tous les "${item.name}" (${item.quantity}) ?`,
      header: 'Confirmation',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Oui, supprimer',
      rejectLabel: 'Annuler',
      accept: () => {
        this.itemToRemove = item;
        this.removeQuantity = item.quantity;
        this.removeItem();
      }
    });
  }

  goBack(): void {
    this.router.navigate(['/admin/characters']);
  }

  getHouseClass(house: string): string {
    return house.toLowerCase().replace(/ /g, '-');
  }

  getCategoryLabel(category: string): string {
    const labels: Record<string, string> = {
      'charm': 'Enchantement',
      'transfiguration': 'Métamorphose',
      'defense': 'Défense',
      'hex': 'Maléfice',
      'curse': 'Sortilège',
      'healing': 'Soin',
      'utility': 'Utilitaire'
    };
    return labels[category] || category;
  }

  getCategorySeverity(category: string): 'success' | 'info' | 'warning' | 'danger' | 'secondary' | 'contrast' {
    const severities: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'secondary'> = {
      'charm': 'info',
      'transfiguration': 'secondary',
      'defense': 'success',
      'hex': 'warning',
      'curse': 'danger',
      'healing': 'success',
      'utility': 'info'
    };
    return severities[category] || 'secondary';
  }

  getDifficultyLabel(difficulty: string): string {
    const labels: Record<string, string> = {
      'beginner': 'Débutant',
      'intermediate': 'Intermédiaire',
      'advanced': 'Avancé',
      'master': 'Maître'
    };
    return labels[difficulty] || difficulty;
  }

  getItemCategoryLabel(category: string): string {
    const labels: Record<string, string> = {
      'wand': 'Baguette',
      'potion': 'Potion',
      'ingredient': 'Ingrédient',
      'book': 'Livre',
      'equipment': 'Équipement',
      'consumable': 'Consommable',
      'quest_item': 'Objet de quête',
      'misc': 'Divers'
    };
    return labels[category] || category;
  }

  getRarityLabel(rarity: string): string {
    const labels: Record<string, string> = {
      'common': 'Commun',
      'uncommon': 'Peu commun',
      'rare': 'Rare',
      'epic': 'Épique',
      'legendary': 'Légendaire'
    };
    return labels[rarity] || rarity;
  }

  getRaritySeverity(rarity: string): 'success' | 'info' | 'warning' | 'danger' | 'secondary' | 'contrast' {
    const severities: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'secondary'> = {
      'common': 'secondary',
      'uncommon': 'success',
      'rare': 'info',
      'epic': 'warning',
      'legendary': 'danger'
    };
    return severities[rarity] || 'secondary';
  }
}
