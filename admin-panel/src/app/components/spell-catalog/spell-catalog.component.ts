import { Component, OnInit, signal } from '@angular/core';
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
import { MessageService, ConfirmationService } from 'primeng/api';

import { NakamaService } from '../../services/nakama.service';
import { Spell, SpellCategory, SpellDifficulty, SpellType, CCType, CreateSpellRequest, UpdateSpellRequest } from '../../models';

interface SelectOption<T> {
  label: string;
  value: T;
}

@Component({
  selector: 'app-spell-catalog',
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
    CheckboxModule
  ],
  providers: [MessageService, ConfirmationService],
  template: `
    <p-toast></p-toast>
    <p-confirmDialog header="Confirmation" icon="pi pi-exclamation-triangle"></p-confirmDialog>

    <div class="page-header">
      <h1>Catalogue des Sorts</h1>
      <p>Gérez les sorts disponibles dans le jeu</p>
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
              (input)="filterSpells()"
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
            (onChange)="filterSpells()"
            styleClass="w-12rem"
          ></p-dropdown>
          <p-dropdown
            [options]="difficultyOptions"
            [(ngModel)]="selectedDifficultyFilter"
            placeholder="Toutes difficultés"
            [showClear]="true"
            optionLabel="label"
            optionValue="value"
            (onChange)="filterSpells()"
            styleClass="w-10rem"
          ></p-dropdown>
        </div>
        <div class="flex gap-2">
          <p-button
            icon="pi pi-plus"
            label="Créer un sort"
            (onClick)="openCreateDialog()"
          ></p-button>
          <p-button
            icon="pi pi-refresh"
            [text]="true"
            (onClick)="loadSpells()"
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
          [value]="filteredSpells()"
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
              <th pSortableColumn="incantation">
                Incantation <p-sortIcon field="incantation"></p-sortIcon>
              </th>
              <th pSortableColumn="category">
                Catégorie <p-sortIcon field="category"></p-sortIcon>
              </th>
              <th pSortableColumn="difficulty">
                Difficulté <p-sortIcon field="difficulty"></p-sortIcon>
              </th>
              <th pSortableColumn="spell_type">
                Type <p-sortIcon field="spell_type"></p-sortIcon>
              </th>
              <th pSortableColumn="damage">
                Dégâts <p-sortIcon field="damage"></p-sortIcon>
              </th>
              <th pSortableColumn="mana_cost">
                Mana <p-sortIcon field="mana_cost"></p-sortIcon>
              </th>
              <th pSortableColumn="cooldown">
                Cooldown <p-sortIcon field="cooldown"></p-sortIcon>
              </th>
              <th pSortableColumn="year_required">
                Année <p-sortIcon field="year_required"></p-sortIcon>
              </th>
              <th style="width: 120px">Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-spell>
            <tr>
              <td>
                <span class="font-semibold">{{ spell.name }}</span>
              </td>
              <td>
                <span class="text-italic">{{ spell.incantation }}</span>
              </td>
              <td>
                <span class="category-badge" [class]="'category-' + spell.category">
                  {{ getCategoryLabel(spell.category) }}
                </span>
              </td>
              <td>
                <span class="difficulty-badge" [class]="'difficulty-' + spell.difficulty">
                  {{ getDifficultyLabel(spell.difficulty) }}
                </span>
              </td>
              <td>
                <span class="spell-type-badge" [class]="'type-' + (spell.spell_type || 'utility')">
                  {{ getSpellTypeLabel(spell.spell_type) }}
                </span>
              </td>
              <td>{{ spell.damage || '-' }}</td>
              <td>{{ spell.mana_cost || '-' }}</td>
              <td>{{ spell.cooldown ? spell.cooldown + 's' : '-' }}</td>
              <td>{{ spell.year_required || '-' }}</td>
              <td>
                <div class="flex gap-1">
                  <p-button
                    icon="pi pi-pencil"
                    [rounded]="true"
                    [text]="true"
                    (onClick)="openEditDialog(spell)"
                    pTooltip="Modifier"
                  ></p-button>
                  <p-button
                    icon="pi pi-trash"
                    [rounded]="true"
                    [text]="true"
                    severity="danger"
                    (onClick)="confirmDelete(spell)"
                    pTooltip="Supprimer"
                  ></p-button>
                </div>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="10" class="text-center p-4">
                @if (searchQuery || selectedCategoryFilter || selectedDifficultyFilter) {
                  Aucun sort ne correspond aux filtres
                } @else {
                  Aucun sort trouvé
                }
              </td>
            </tr>
          </ng-template>
        </p-table>
      }
    </p-card>

    <!-- Create/Edit Dialog -->
    <p-dialog
      [header]="editMode ? 'Modifier le sort' : 'Créer un sort'"
      [(visible)]="dialogVisible"
      [modal]="true"
      [style]="{ width: '700px' }"
      [closable]="true"
    >
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
              placeholder="spell_xxx"
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
              placeholder="Nom du sort"
            />
          </div>
        </div>
        <div class="col-6">
          <div class="field">
            <label class="block mb-2 font-medium">Incantation *</label>
            <input
              type="text"
              pInputText
              [(ngModel)]="form.incantation"
              class="w-full"
              placeholder="Incantation"
            />
          </div>
        </div>
        <div class="col-6">
          <div class="field">
            <label class="block mb-2 font-medium">Catégorie *</label>
            <p-dropdown
              [options]="categoryOptions"
              [(ngModel)]="form.category"
              optionLabel="label"
              optionValue="value"
              placeholder="Sélectionner"
              styleClass="w-full"
            ></p-dropdown>
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
              placeholder="Description du sort"
            />
          </div>
        </div>
        <div class="col-4">
          <div class="field">
            <label class="block mb-2 font-medium">Difficulté *</label>
            <p-dropdown
              [options]="difficultyOptions"
              [(ngModel)]="form.difficulty"
              optionLabel="label"
              optionValue="value"
              placeholder="Sélectionner"
              styleClass="w-full"
            ></p-dropdown>
          </div>
        </div>
        <div class="col-4">
          <div class="field">
            <label class="block mb-2 font-medium">Niveau min</label>
            <p-inputNumber
              [(ngModel)]="form.min_level"
              [min]="1"
              [max]="100"
              styleClass="w-full"
            ></p-inputNumber>
          </div>
        </div>
        <div class="col-4">
          <div class="field">
            <label class="block mb-2 font-medium">Année requise</label>
            <p-inputNumber
              [(ngModel)]="form.year_required"
              [min]="1"
              [max]="7"
              styleClass="w-full"
            ></p-inputNumber>
          </div>
        </div>

        <div class="col-12">
          <hr class="my-3" />
          <h4 class="mt-0 mb-3">Stats de gameplay</h4>
        </div>

        <div class="col-4">
          <div class="field">
            <label class="block mb-2 font-medium">Type de sort</label>
            <p-dropdown
              [options]="spellTypeOptions"
              [(ngModel)]="form.spell_type"
              optionLabel="label"
              optionValue="value"
              placeholder="Sélectionner"
              styleClass="w-full"
            ></p-dropdown>
          </div>
        </div>
        <div class="col-4">
          <div class="field">
            <label class="block mb-2 font-medium">Dégâts</label>
            <p-inputNumber
              [(ngModel)]="form.damage"
              [min]="0"
              styleClass="w-full"
            ></p-inputNumber>
          </div>
        </div>
        <div class="col-4">
          <div class="field">
            <label class="block mb-2 font-medium">Coût mana</label>
            <p-inputNumber
              [(ngModel)]="form.mana_cost"
              [min]="0"
              styleClass="w-full"
            ></p-inputNumber>
          </div>
        </div>
        <div class="col-4">
          <div class="field">
            <label class="block mb-2 font-medium">Cooldown (s)</label>
            <p-inputNumber
              [(ngModel)]="form.cooldown"
              [min]="0"
              [maxFractionDigits]="1"
              styleClass="w-full"
            ></p-inputNumber>
          </div>
        </div>
        <div class="col-4">
          <div class="field">
            <label class="block mb-2 font-medium">Type CC</label>
            <p-dropdown
              [options]="ccTypeOptions"
              [(ngModel)]="form.cc_type"
              optionLabel="label"
              optionValue="value"
              placeholder="Aucun"
              styleClass="w-full"
            ></p-dropdown>
          </div>
        </div>
        <div class="col-4">
          <div class="field">
            <label class="block mb-2 font-medium">Durée CC (s)</label>
            <p-inputNumber
              [(ngModel)]="form.cc_duration"
              [min]="0"
              [maxFractionDigits]="1"
              styleClass="w-full"
            ></p-inputNumber>
          </div>
        </div>
        <div class="col-4">
          <div class="field">
            <label class="block mb-2 font-medium">Portée (m)</label>
            <p-inputNumber
              [(ngModel)]="form.range"
              [min]="0"
              [maxFractionDigits]="1"
              styleClass="w-full"
            ></p-inputNumber>
          </div>
        </div>
        <div class="col-4">
          <div class="field">
            <label class="block mb-2 font-medium">Temps incantation (s)</label>
            <p-inputNumber
              [(ngModel)]="form.cast_time"
              [min]="0"
              [maxFractionDigits]="1"
              styleClass="w-full"
            ></p-inputNumber>
          </div>
        </div>
        <div class="col-4">
          <div class="field flex align-items-end h-full pb-2">
            <p-checkbox
              [(ngModel)]="form.is_channeled"
              [binary]="true"
              label="Sort canalisé"
            ></p-checkbox>
          </div>
        </div>
      </div>

      <ng-template pTemplate="footer">
        <p-button
          label="Annuler"
          [text]="true"
          (onClick)="dialogVisible = false"
        ></p-button>
        <p-button
          [label]="editMode ? 'Enregistrer' : 'Créer'"
          icon="pi pi-check"
          (onClick)="saveSpell()"
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

      &.category-charm { background: #3b82f6; color: white; }
      &.category-transfiguration { background: #8b5cf6; color: white; }
      &.category-defense { background: #059669; color: white; }
      &.category-hex { background: #f59e0b; color: black; }
      &.category-curse { background: #dc2626; color: white; }
      &.category-healing { background: #10b981; color: white; }
      &.category-utility { background: #6b7280; color: white; }
    }

    .difficulty-badge {
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.7rem;
      font-weight: 600;

      &.difficulty-beginner { background: #d1fae5; color: #065f46; }
      &.difficulty-intermediate { background: #fef3c7; color: #92400e; }
      &.difficulty-advanced { background: #fee2e2; color: #991b1b; }
      &.difficulty-master { background: #ede9fe; color: #5b21b6; }
    }

    .spell-type-badge {
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.7rem;
      font-weight: 600;

      &.type-attack { background: #ef4444; color: white; }
      &.type-defense { background: #3b82f6; color: white; }
      &.type-cc { background: #f97316; color: white; }
      &.type-buff { background: #22c55e; color: white; }
      &.type-debuff { background: #a855f7; color: white; }
      &.type-heal { background: #14b8a6; color: white; }
      &.type-utility { background: #6b7280; color: white; }
    }

    :host ::ng-deep {
      .p-datatable-hoverable-rows .p-datatable-tbody > tr:hover {
        background: var(--surface-hover);
      }
    }
  `]
})
export class SpellCatalogComponent implements OnInit {
  spells = signal<Spell[]>([]);
  filteredSpells = signal<Spell[]>([]);
  loading = signal(false);
  saving = signal(false);

  searchQuery = '';
  selectedCategoryFilter: SpellCategory | null = null;
  selectedDifficultyFilter: SpellDifficulty | null = null;

  categoryOptions: SelectOption<SpellCategory>[] = [
    { label: 'Enchantements', value: 'charm' },
    { label: 'Métamorphose', value: 'transfiguration' },
    { label: 'Défense', value: 'defense' },
    { label: 'Maléfices', value: 'hex' },
    { label: 'Sortilèges', value: 'curse' },
    { label: 'Soins', value: 'healing' },
    { label: 'Utilitaires', value: 'utility' }
  ];

  difficultyOptions: SelectOption<SpellDifficulty>[] = [
    { label: 'Débutant', value: 'beginner' },
    { label: 'Intermédiaire', value: 'intermediate' },
    { label: 'Avancé', value: 'advanced' },
    { label: 'Maître', value: 'master' }
  ];

  spellTypeOptions: SelectOption<SpellType>[] = [
    { label: 'Attaque', value: 'attack' },
    { label: 'Défense', value: 'defense' },
    { label: 'CC', value: 'cc' },
    { label: 'Buff', value: 'buff' },
    { label: 'Debuff', value: 'debuff' },
    { label: 'Soin', value: 'heal' },
    { label: 'Utilitaire', value: 'utility' }
  ];

  ccTypeOptions: SelectOption<CCType>[] = [
    { label: 'Aucun', value: 'none' },
    { label: 'Étourdissement', value: 'stun' },
    { label: 'Ralentissement', value: 'slow' },
    { label: 'Projection', value: 'airborne' },
    { label: 'Immobilisation', value: 'root' },
    { label: 'Silence', value: 'silence' },
    { label: 'Aveuglement', value: 'blind' },
    { label: 'Peur', value: 'fear' },
    { label: 'Charme', value: 'charm' },
    { label: 'Recul', value: 'knockback' }
  ];

  // Dialog
  dialogVisible = false;
  editMode = false;
  selectedSpell: Spell | null = null;
  form: CreateSpellRequest = this.getEmptyForm();

  constructor(
    private nakamaService: NakamaService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService
  ) {}

  ngOnInit(): void {
    this.loadSpells();
  }

  getEmptyForm(): CreateSpellRequest {
    return {
      id: '',
      name: '',
      incantation: '',
      description: '',
      category: 'charm',
      difficulty: 'beginner',
      min_level: 1,
      spell_type: 'utility',
      damage: 0,
      mana_cost: 0,
      cooldown: 0,
      cc_type: 'none',
      cc_duration: 0,
      year_required: 1,
      range: 0,
      cast_time: 0,
      is_channeled: false
    };
  }

  loadSpells(): void {
    this.loading.set(true);

    this.nakamaService.listSpellCatalog().subscribe({
      next: (response) => {
        this.spells.set(response.spells || []);
        this.filterSpells();
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to load spells:', err);
        this.loading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de charger les sorts'
        });
      }
    });
  }

  filterSpells(): void {
    let filtered = this.spells();

    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(s =>
        s.name.toLowerCase().includes(query) ||
        s.incantation.toLowerCase().includes(query) ||
        s.description?.toLowerCase().includes(query)
      );
    }

    if (this.selectedCategoryFilter) {
      filtered = filtered.filter(s => s.category === this.selectedCategoryFilter);
    }

    if (this.selectedDifficultyFilter) {
      filtered = filtered.filter(s => s.difficulty === this.selectedDifficultyFilter);
    }

    this.filteredSpells.set(filtered);
  }

  openCreateDialog(): void {
    this.editMode = false;
    this.selectedSpell = null;
    this.form = this.getEmptyForm();
    this.dialogVisible = true;
  }

  openEditDialog(spell: Spell): void {
    this.editMode = true;
    this.selectedSpell = spell;
    this.form = {
      id: spell.id,
      name: spell.name,
      incantation: spell.incantation,
      description: spell.description,
      category: spell.category,
      difficulty: spell.difficulty,
      min_level: spell.min_level,
      spell_type: spell.spell_type || 'utility',
      damage: spell.damage || 0,
      mana_cost: spell.mana_cost || 0,
      cooldown: spell.cooldown || 0,
      cc_type: spell.cc_type || 'none',
      cc_duration: spell.cc_duration || 0,
      year_required: spell.year_required || 1,
      range: spell.range || 0,
      cast_time: spell.cast_time || 0,
      is_channeled: spell.is_channeled || false
    };
    this.dialogVisible = true;
  }

  isFormValid(): boolean {
    return !!(this.form.id && this.form.name && this.form.incantation && this.form.category && this.form.difficulty);
  }

  saveSpell(): void {
    if (!this.isFormValid()) return;

    this.saving.set(true);

    if (this.editMode) {
      this.nakamaService.updateSpell(this.form as UpdateSpellRequest).subscribe({
        next: (updated) => {
          const spells = this.spells();
          const index = spells.findIndex(s => s.id === updated.id);
          if (index >= 0) {
            spells[index] = updated;
            this.spells.set([...spells]);
            this.filterSpells();
          }
          this.saving.set(false);
          this.dialogVisible = false;
          this.messageService.add({
            severity: 'success',
            summary: 'Succès',
            detail: 'Sort mis à jour'
          });
        },
        error: (err) => {
          console.error('Failed to update spell:', err);
          this.saving.set(false);
          this.messageService.add({
            severity: 'error',
            summary: 'Erreur',
            detail: 'Impossible de mettre à jour le sort'
          });
        }
      });
    } else {
      this.nakamaService.createSpell(this.form).subscribe({
        next: (created) => {
          this.spells.set([...this.spells(), created]);
          this.filterSpells();
          this.saving.set(false);
          this.dialogVisible = false;
          this.messageService.add({
            severity: 'success',
            summary: 'Succès',
            detail: 'Sort créé'
          });
        },
        error: (err) => {
          console.error('Failed to create spell:', err);
          this.saving.set(false);
          this.messageService.add({
            severity: 'error',
            summary: 'Erreur',
            detail: 'Impossible de créer le sort'
          });
        }
      });
    }
  }

  confirmDelete(spell: Spell): void {
    this.confirmationService.confirm({
      message: `Êtes-vous sûr de vouloir supprimer le sort "${spell.name}" ?`,
      accept: () => this.deleteSpell(spell)
    });
  }

  deleteSpell(spell: Spell): void {
    this.nakamaService.deleteSpell(spell.id).subscribe({
      next: () => {
        const spells = this.spells().filter(s => s.id !== spell.id);
        this.spells.set(spells);
        this.filterSpells();
        this.messageService.add({
          severity: 'success',
          summary: 'Succès',
          detail: 'Sort supprimé'
        });
      },
      error: (err) => {
        console.error('Failed to delete spell:', err);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de supprimer le sort'
        });
      }
    });
  }

  getCategoryLabel(category: SpellCategory): string {
    return this.categoryOptions.find(o => o.value === category)?.label || category;
  }

  getDifficultyLabel(difficulty: SpellDifficulty): string {
    return this.difficultyOptions.find(o => o.value === difficulty)?.label || difficulty;
  }

  getSpellTypeLabel(type?: SpellType): string {
    if (!type) return 'Utilitaire';
    return this.spellTypeOptions.find(o => o.value === type)?.label || type;
  }
}
