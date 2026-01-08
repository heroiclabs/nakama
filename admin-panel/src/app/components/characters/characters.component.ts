import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

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
import { MessageService, ConfirmationService } from 'primeng/api';

import { NakamaService } from '../../services/nakama.service';
import { AdminCharacterEntry, HouseName, AccountInfo } from '../../models';

interface HouseOption {
  label: string;
  value: HouseName;
}

@Component({
  selector: 'app-characters',
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
    ConfirmDialogModule
  ],
  providers: [MessageService, ConfirmationService],
  template: `
    <p-toast></p-toast>
    <p-confirmDialog header="Confirmation" icon="pi pi-exclamation-triangle"></p-confirmDialog>

    <div class="page-header">
      <h1>Gestion des Personnages</h1>
      <p>Consultez et modifiez les personnages du jeu</p>
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
              (input)="filterCharacters()"
              class="w-15rem"
            />
          </span>
          <p-dropdown
            [options]="houseOptions"
            [(ngModel)]="selectedHouseFilter"
            placeholder="Toutes les maisons"
            [showClear]="true"
            optionLabel="label"
            optionValue="value"
            (onChange)="filterCharacters()"
            styleClass="w-12rem"
          ></p-dropdown>
        </div>
        <div class="flex gap-2">
          <p-button
            icon="pi pi-plus"
            label="Créer"
            (onClick)="openCreateDialog()"
          ></p-button>
          <p-button
            icon="pi pi-refresh"
            [text]="true"
            (onClick)="loadCharacters()"
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
          [value]="filteredCharacters()"
          [paginator]="true"
          [rows]="10"
          [rowsPerPageOptions]="[10, 25, 50]"
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
              <th pSortableColumn="house">
                Maison <p-sortIcon field="house"></p-sortIcon>
              </th>
              <th pSortableColumn="level">
                Niveau <p-sortIcon field="level"></p-sortIcon>
              </th>
              <th pSortableColumn="xp">
                XP <p-sortIcon field="xp"></p-sortIcon>
              </th>
              <th pSortableColumn="owner_username">
                Propriétaire <p-sortIcon field="owner_username"></p-sortIcon>
              </th>
              <th pSortableColumn="created_at">
                Créé le <p-sortIcon field="created_at"></p-sortIcon>
              </th>
              <th style="width: 150px">Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-character>
            <tr class="cursor-pointer" (click)="viewCharacter(character)">
              <td>
                <div class="flex align-items-center gap-2">
                  <div class="character-avatar">
                    {{ character.name.charAt(0).toUpperCase() }}
                  </div>
                  <span class="font-semibold">{{ character.name }}</span>
                </div>
              </td>
              <td>
                <span class="house-badge" [class]="getHouseClass(character.house)">
                  {{ character.house }}
                </span>
              </td>
              <td>
                <span class="level-badge">Niv. {{ character.level }}</span>
              </td>
              <td>{{ character.xp | number }}</td>
              <td>
                <span class="text-color-secondary">{{ character.owner_username }}</span>
              </td>
              <td>{{ character.created_at * 1000 | date:'dd/MM/yyyy' }}</td>
              <td>
                <div class="flex gap-1">
                  <p-button
                    icon="pi pi-eye"
                    [rounded]="true"
                    [text]="true"
                    (onClick)="viewCharacter(character); $event.stopPropagation()"
                    pTooltip="Voir les détails"
                  ></p-button>
                  <p-button
                    icon="pi pi-pencil"
                    [rounded]="true"
                    [text]="true"
                    (onClick)="openEditDialog(character); $event.stopPropagation()"
                    pTooltip="Modifier"
                  ></p-button>
                  <p-button
                    icon="pi pi-trash"
                    [rounded]="true"
                    [text]="true"
                    severity="danger"
                    (onClick)="confirmDelete(character); $event.stopPropagation()"
                    pTooltip="Supprimer"
                  ></p-button>
                </div>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="7" class="text-center p-4">
                @if (searchQuery || selectedHouseFilter) {
                  Aucun personnage ne correspond aux filtres
                } @else {
                  Aucun personnage trouvé
                }
              </td>
            </tr>
          </ng-template>
        </p-table>
      }
    </p-card>

    <!-- Create Dialog -->
    <p-dialog
      header="Créer un personnage"
      [(visible)]="createDialogVisible"
      [modal]="true"
      [style]="{ width: '500px' }"
      [closable]="true"
    >
      <div class="flex flex-column gap-3">
        <div class="field">
          <label for="create_account" class="block mb-2 font-medium">Compte propriétaire *</label>
          <p-dropdown
            id="create_account"
            [options]="accountOptions()"
            [(ngModel)]="createForm.user_id"
            optionLabel="label"
            optionValue="value"
            placeholder="Sélectionner un compte"
            [filter]="true"
            filterBy="label"
            styleClass="w-full"
          ></p-dropdown>
        </div>

        <div class="field">
          <label for="create_name" class="block mb-2 font-medium">Nom du personnage *</label>
          <input
            id="create_name"
            type="text"
            pInputText
            [(ngModel)]="createForm.name"
            class="w-full"
            placeholder="Entrez le nom du personnage"
          />
        </div>
      </div>

      <ng-template pTemplate="footer">
        <p-button
          label="Annuler"
          [text]="true"
          (onClick)="createDialogVisible = false"
        ></p-button>
        <p-button
          label="Créer"
          icon="pi pi-check"
          (onClick)="createCharacter()"
          [loading]="saving()"
          [disabled]="!createForm.user_id || !createForm.name"
        ></p-button>
      </ng-template>
    </p-dialog>

    <!-- Edit Dialog -->
    <p-dialog
      header="Modifier le personnage"
      [(visible)]="editDialogVisible"
      [modal]="true"
      [style]="{ width: '500px' }"
      [closable]="true"
    >
      @if (selectedCharacter) {
        <div class="flex flex-column gap-3">
          <div class="field">
            <label for="edit_name" class="block mb-2 font-medium">Nom</label>
            <input
              id="edit_name"
              type="text"
              pInputText
              [(ngModel)]="editForm.name"
              class="w-full"
            />
          </div>

          <div class="field">
            <label for="edit_house" class="block mb-2 font-medium">Maison</label>
            <p-dropdown
              id="edit_house"
              [options]="houseOptions"
              [(ngModel)]="editForm.house"
              optionLabel="label"
              optionValue="value"
              placeholder="Sélectionner une maison"
              styleClass="w-full"
            ></p-dropdown>
          </div>

          <div class="field">
            <label for="edit_level" class="block mb-2 font-medium">Niveau</label>
            <p-inputNumber
              id="edit_level"
              [(ngModel)]="editForm.level"
              [min]="1"
              [max]="100"
              styleClass="w-full"
            ></p-inputNumber>
          </div>

          <div class="field">
            <label for="edit_xp" class="block mb-2 font-medium">XP</label>
            <p-inputNumber
              id="edit_xp"
              [(ngModel)]="editForm.xp"
              [min]="0"
              styleClass="w-full"
            ></p-inputNumber>
          </div>

          <div class="field">
            <label class="block mb-2 font-medium text-color-secondary">Propriétaire</label>
            <span>{{ selectedCharacter.owner_username }}</span>
          </div>
        </div>
      }

      <ng-template pTemplate="footer">
        <p-button
          label="Annuler"
          [text]="true"
          (onClick)="editDialogVisible = false"
        ></p-button>
        <p-button
          label="Enregistrer"
          icon="pi pi-check"
          (onClick)="saveCharacter()"
          [loading]="saving()"
        ></p-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .character-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--primary-color);
      color: var(--primary-color-text);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 0.875rem;
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

    .level-badge {
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      background: var(--surface-200);
      color: var(--text-color);
      font-size: 0.75rem;
      font-weight: 600;
    }

    :host ::ng-deep {
      .p-datatable-hoverable-rows .p-datatable-tbody > tr:hover {
        background: var(--surface-hover);
      }
    }
  `]
})
export class CharactersComponent implements OnInit {
  characters = signal<AdminCharacterEntry[]>([]);
  filteredCharacters = signal<AdminCharacterEntry[]>([]);
  accounts = signal<AccountInfo[]>([]);
  accountOptions = signal<{ label: string; value: string }[]>([]);
  loading = signal(false);
  saving = signal(false);

  searchQuery = '';
  selectedHouseFilter: HouseName | null = null;

  houseOptions: HouseOption[] = [
    { label: 'Venatrix', value: 'Venatrix' },
    { label: 'Falcon', value: 'Falcon' },
    { label: 'Brumval', value: 'Brumval' },
    { label: 'Aerwyn', value: 'Aerwyn' },
    { label: 'Pas de Maison', value: 'Pas de Maison' }
  ];

  // Create dialog
  createDialogVisible = false;
  createForm = {
    user_id: '',
    name: ''
  };

  // Edit dialog
  editDialogVisible = false;
  selectedCharacter: AdminCharacterEntry | null = null;
  editForm = {
    name: '',
    house: '' as HouseName,
    level: 1,
    xp: 0
  };

  constructor(
    private nakamaService: NakamaService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadCharacters();
    this.loadAccounts();
  }

  loadCharacters(): void {
    this.loading.set(true);

    this.nakamaService.listAllCharacters().subscribe({
      next: (response) => {
        this.characters.set(response.characters || []);
        this.filterCharacters();
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to load characters:', err);
        this.loading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de charger les personnages'
        });
      }
    });
  }

  loadAccounts(): void {
    this.nakamaService.listAccounts().subscribe({
      next: (response) => {
        this.accounts.set(response.accounts || []);
        this.accountOptions.set(
          (response.accounts || []).map(a => ({
            label: `${a.username}${a.display_name ? ' (' + a.display_name + ')' : ''}`,
            value: a.user_id
          }))
        );
      },
      error: (err) => {
        console.error('Failed to load accounts:', err);
      }
    });
  }

  filterCharacters(): void {
    let filtered = this.characters();

    // Filter by search query
    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(c =>
        c.name.toLowerCase().includes(query) ||
        c.id.toLowerCase().includes(query) ||
        c.owner_username.toLowerCase().includes(query)
      );
    }

    // Filter by house
    if (this.selectedHouseFilter) {
      filtered = filtered.filter(c => c.house === this.selectedHouseFilter);
    }

    this.filteredCharacters.set(filtered);
  }

  viewCharacter(character: AdminCharacterEntry): void {
    this.router.navigate(['/admin/characters', character.id]);
  }

  openCreateDialog(): void {
    this.createForm = { user_id: '', name: '' };
    this.createDialogVisible = true;
  }

  createCharacter(): void {
    if (!this.createForm.user_id || !this.createForm.name) return;

    this.saving.set(true);

    this.nakamaService.adminCreateCharacter({
      user_id: this.createForm.user_id,
      name: this.createForm.name
    }).subscribe({
      next: (created) => {
        this.characters.set([...this.characters(), created]);
        this.filterCharacters();
        this.saving.set(false);
        this.createDialogVisible = false;
        this.messageService.add({
          severity: 'success',
          summary: 'Succès',
          detail: 'Personnage créé avec succès'
        });
      },
      error: (err) => {
        console.error('Failed to create character:', err);
        this.saving.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de créer le personnage'
        });
      }
    });
  }

  openEditDialog(character: AdminCharacterEntry): void {
    this.selectedCharacter = character;
    this.editForm = {
      name: character.name,
      house: character.house,
      level: character.level,
      xp: character.xp
    };
    this.editDialogVisible = true;
  }

  saveCharacter(): void {
    if (!this.selectedCharacter) return;

    this.saving.set(true);

    this.nakamaService.adminUpdateCharacter({
      user_id: this.selectedCharacter.owner_id,
      id: this.selectedCharacter.id,
      name: this.editForm.name,
      house: this.editForm.house,
      level: this.editForm.level,
      xp: this.editForm.xp
    }).subscribe({
      next: (updated) => {
        // Update local state
        const characters = this.characters();
        const index = characters.findIndex(c => c.id === updated.id);
        if (index >= 0) {
          characters[index] = updated;
          this.characters.set([...characters]);
          this.filterCharacters();
        }

        this.saving.set(false);
        this.editDialogVisible = false;
        this.messageService.add({
          severity: 'success',
          summary: 'Succès',
          detail: 'Personnage mis à jour avec succès'
        });
      },
      error: (err) => {
        console.error('Failed to update character:', err);
        this.saving.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de mettre à jour le personnage'
        });
      }
    });
  }

  confirmDelete(character: AdminCharacterEntry): void {
    this.confirmationService.confirm({
      message: `Êtes-vous sûr de vouloir supprimer le personnage "${character.name}" ? Cette action est irréversible.`,
      accept: () => this.deleteCharacter(character)
    });
  }

  deleteCharacter(character: AdminCharacterEntry): void {
    this.nakamaService.adminDeleteCharacter({
      user_id: character.owner_id,
      id: character.id
    }).subscribe({
      next: () => {
        // Remove from local state
        const characters = this.characters().filter(c => c.id !== character.id);
        this.characters.set(characters);
        this.filterCharacters();

        this.messageService.add({
          severity: 'success',
          summary: 'Succès',
          detail: 'Personnage supprimé avec succès'
        });
      },
      error: (err) => {
        console.error('Failed to delete character:', err);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de supprimer le personnage'
        });
      }
    });
  }

  getHouseClass(house: string): string {
    return house.toLowerCase().replace(/ /g, '-');
  }
}
