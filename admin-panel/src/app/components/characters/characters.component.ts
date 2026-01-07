import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

// PrimeNG
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { InputTextModule } from 'primeng/inputtext';
import { DropdownModule } from 'primeng/dropdown';
import { ToastModule } from 'primeng/toast';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TagModule } from 'primeng/tag';
import { MessageService } from 'primeng/api';

import { NakamaService } from '../../services/nakama.service';
import { Character, HouseName } from '../../models';

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
    DropdownModule,
    ToastModule,
    ProgressSpinnerModule,
    TagModule
  ],
  providers: [MessageService],
  template: `
    <p-toast></p-toast>

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
        <p-button
          icon="pi pi-refresh"
          [text]="true"
          (onClick)="loadCharacters()"
          pTooltip="Actualiser"
        ></p-button>
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
              <th pSortableColumn="created_at">
                Créé le <p-sortIcon field="created_at"></p-sortIcon>
              </th>
              <th style="width: 100px">Actions</th>
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
              <td>{{ character.created_at * 1000 | date:'dd/MM/yyyy' }}</td>
              <td>
                <p-button
                  icon="pi pi-eye"
                  [rounded]="true"
                  [text]="true"
                  (onClick)="viewCharacter(character); $event.stopPropagation()"
                  pTooltip="Voir les détails"
                ></p-button>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="6" class="text-center p-4">
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
  characters = signal<Character[]>([]);
  filteredCharacters = signal<Character[]>([]);
  loading = signal(false);

  searchQuery = '';
  selectedHouseFilter: HouseName | null = null;

  houseOptions = [
    { label: 'Venatrix', value: 'Venatrix' },
    { label: 'Falcon', value: 'Falcon' },
    { label: 'Brumval', value: 'Brumval' },
    { label: 'Aerwyn', value: 'Aerwyn' },
    { label: 'Pas de Maison', value: 'Pas de Maison' }
  ];

  constructor(
    private nakamaService: NakamaService,
    private messageService: MessageService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadCharacters();
  }

  loadCharacters(): void {
    this.loading.set(true);

    this.nakamaService.getCharacters().subscribe({
      next: (characters) => {
        this.characters.set(characters);
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

  filterCharacters(): void {
    let filtered = this.characters();

    // Filter by search query
    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(c =>
        c.name.toLowerCase().includes(query) ||
        c.id.toLowerCase().includes(query)
      );
    }

    // Filter by house
    if (this.selectedHouseFilter) {
      filtered = filtered.filter(c => c.house === this.selectedHouseFilter);
    }

    this.filteredCharacters.set(filtered);
  }

  viewCharacter(character: Character): void {
    this.router.navigate(['/admin/characters', character.id]);
  }

  getHouseClass(house: string): string {
    return house.toLowerCase().replace(/ /g, '-');
  }
}
