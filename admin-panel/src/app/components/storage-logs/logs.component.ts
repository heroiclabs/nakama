import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// PrimeNG
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { InputTextModule } from 'primeng/inputtext';
import { DropdownModule } from 'primeng/dropdown';
import { ToastModule } from 'primeng/toast';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { MessageService } from 'primeng/api';

import { NakamaService } from '../../services/nakama.service';
import { StorageObjectEntry } from '../../models';

interface CollectionOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-logs',
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
    TagModule,
    DialogModule
  ],
  providers: [MessageService],
  template: `
    <p-toast></p-toast>

    <div class="page-header">
      <h1>Logs Storage</h1>
      <p>Consultez tous les objets de stockage Nakama</p>
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
              (input)="filterObjects()"
              class="w-15rem"
            />
          </span>
          <p-dropdown
            [options]="collectionOptions()"
            [(ngModel)]="selectedCollection"
            placeholder="Toutes les collections"
            [showClear]="true"
            optionLabel="label"
            optionValue="value"
            (onChange)="filterObjects()"
            styleClass="w-14rem"
          ></p-dropdown>
        </div>
        <div class="flex align-items-center gap-3">
          <span class="text-color-secondary">{{ filteredObjects().length }} objets</span>
          <p-button
            icon="pi pi-refresh"
            [text]="true"
            (onClick)="loadObjects()"
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
          [value]="filteredObjects()"
          [paginator]="true"
          [rows]="15"
          [rowsPerPageOptions]="[15, 30, 50, 100]"
          [sortField]="'update_time'"
          [sortOrder]="-1"
          styleClass="p-datatable-sm p-datatable-hoverable-rows"
          [rowHover]="true"
        >
          <ng-template pTemplate="header">
            <tr>
              <th pSortableColumn="collection" style="width: 140px">
                Collection <p-sortIcon field="collection"></p-sortIcon>
              </th>
              <th pSortableColumn="key">
                Clé <p-sortIcon field="key"></p-sortIcon>
              </th>
              <th pSortableColumn="username">
                Utilisateur <p-sortIcon field="username"></p-sortIcon>
              </th>
              <th pSortableColumn="update_time" style="width: 160px">
                Mis à jour <p-sortIcon field="update_time"></p-sortIcon>
              </th>
              <th style="width: 80px">Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-obj>
            <tr>
              <td>
                <span class="collection-badge" [class]="getCollectionClass(obj.collection)">
                  {{ getCollectionLabel(obj.collection) }}
                </span>
              </td>
              <td>
                <span class="font-medium text-sm">{{ obj.key }}</span>
              </td>
              <td>
                <div class="flex align-items-center gap-2">
                  @if (obj.username) {
                    <div class="user-avatar">
                      {{ obj.username.charAt(0).toUpperCase() }}
                    </div>
                    <span>{{ obj.username }}</span>
                  } @else {
                    <span class="text-color-secondary">-</span>
                  }
                </div>
              </td>
              <td>
                <span class="text-sm">{{ obj.update_time * 1000 | date:'dd/MM/yyyy HH:mm:ss' }}</span>
              </td>
              <td>
                <p-button
                  icon="pi pi-eye"
                  [rounded]="true"
                  [text]="true"
                  (onClick)="viewObject(obj)"
                  pTooltip="Voir les données"
                ></p-button>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="5" class="text-center p-4">
                @if (searchQuery || selectedCollection) {
                  Aucun objet ne correspond aux filtres
                } @else {
                  Aucun objet de stockage trouvé
                }
              </td>
            </tr>
          </ng-template>
        </p-table>
      }
    </p-card>

    <!-- View Dialog -->
    <p-dialog
      header="Détails de l'objet"
      [(visible)]="viewDialogVisible"
      [modal]="true"
      [style]="{ width: '700px', maxHeight: '80vh' }"
      [closable]="true"
    >
      @if (selectedObject) {
        <div class="flex flex-column gap-3">
          <div class="grid">
            <div class="col-6">
              <label class="block mb-1 text-color-secondary text-sm">Collection</label>
              <span class="collection-badge" [class]="getCollectionClass(selectedObject.collection)">
                {{ getCollectionLabel(selectedObject.collection) }}
              </span>
            </div>
            <div class="col-6">
              <label class="block mb-1 text-color-secondary text-sm">Clé</label>
              <span class="font-medium">{{ selectedObject.key }}</span>
            </div>
          </div>

          <div class="grid">
            <div class="col-6">
              <label class="block mb-1 text-color-secondary text-sm">Utilisateur</label>
              <span>{{ selectedObject.username || '-' }}</span>
            </div>
            <div class="col-6">
              <label class="block mb-1 text-color-secondary text-sm">User ID</label>
              <span class="text-sm font-mono">{{ selectedObject.user_id || '-' }}</span>
            </div>
          </div>

          <div class="grid">
            <div class="col-6">
              <label class="block mb-1 text-color-secondary text-sm">Créé le</label>
              <span>{{ selectedObject.create_time * 1000 | date:'dd/MM/yyyy HH:mm:ss' }}</span>
            </div>
            <div class="col-6">
              <label class="block mb-1 text-color-secondary text-sm">Mis à jour le</label>
              <span>{{ selectedObject.update_time * 1000 | date:'dd/MM/yyyy HH:mm:ss' }}</span>
            </div>
          </div>

          <div>
            <label class="block mb-1 text-color-secondary text-sm">Données (JSON)</label>
            <pre class="json-viewer">{{ formatJson(selectedObject.value) }}</pre>
          </div>
        </div>
      }

      <ng-template pTemplate="footer">
        <p-button
          label="Fermer"
          (onClick)="viewDialogVisible = false"
        ></p-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .collection-badge {
      padding: 0.25rem 0.75rem;
      border-radius: 1rem;
      font-size: 0.7rem;
      font-weight: 600;
      color: white;
      text-transform: uppercase;
      letter-spacing: 0.5px;

      &.characters { background-color: #3b82f6; }
      &.inventory { background-color: #f59e0b; }
      &.spells { background-color: #8b5cf6; }
      &.notebooks { background-color: #10b981; }
      &.house-points { background-color: #ef4444; }
      &.other { background-color: #6b7280; }
    }

    .user-avatar {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--primary-color);
      color: var(--primary-color-text);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 0.7rem;
    }

    .json-viewer {
      background: var(--surface-100);
      border: 1px solid var(--surface-border);
      border-radius: 0.5rem;
      padding: 1rem;
      font-size: 0.8rem;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      overflow-x: auto;
      max-height: 300px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }

    :host ::ng-deep {
      .p-datatable-hoverable-rows .p-datatable-tbody > tr:hover {
        background: var(--surface-hover);
      }
    }
  `]
})
export class LogsComponent implements OnInit {
  objects = signal<StorageObjectEntry[]>([]);
  filteredObjects = signal<StorageObjectEntry[]>([]);
  loading = signal(false);

  searchQuery = '';
  selectedCollection: string | null = null;

  collectionOptions = computed(() => {
    const collections = new Set(this.objects().map(o => o.collection));
    return Array.from(collections).map(c => ({
      label: this.getCollectionLabel(c),
      value: c
    })).sort((a, b) => a.label.localeCompare(b.label));
  });

  viewDialogVisible = false;
  selectedObject: StorageObjectEntry | null = null;

  private collectionLabels: Record<string, string> = {
    'characters': 'Personnages',
    'inventories': 'Inventaire',
    'character_spells': 'Sorts',
    'notebooks': 'Carnets',
    'house_points_history': 'Points Maison'
  };

  constructor(
    private nakamaService: NakamaService,
    private messageService: MessageService
  ) {}

  ngOnInit(): void {
    this.loadObjects();
  }

  loadObjects(): void {
    this.loading.set(true);

    this.nakamaService.listStorageObjects().subscribe({
      next: (response) => {
        this.objects.set(response.objects || []);
        this.filterObjects();
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to load storage objects:', err);
        this.loading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de charger les objets de stockage'
        });
      }
    });
  }

  filterObjects(): void {
    let filtered = this.objects();

    // Filter by search query
    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(o =>
        o.collection.toLowerCase().includes(query) ||
        o.key.toLowerCase().includes(query) ||
        o.username?.toLowerCase().includes(query) ||
        o.user_id?.toLowerCase().includes(query) ||
        o.value.toLowerCase().includes(query)
      );
    }

    // Filter by collection
    if (this.selectedCollection) {
      filtered = filtered.filter(o => o.collection === this.selectedCollection);
    }

    this.filteredObjects.set(filtered);
  }

  viewObject(obj: StorageObjectEntry): void {
    this.selectedObject = obj;
    this.viewDialogVisible = true;
  }

  getCollectionLabel(collection: string): string {
    return this.collectionLabels[collection] || collection;
  }

  getCollectionClass(collection: string): string {
    const classMap: Record<string, string> = {
      'characters': 'characters',
      'inventories': 'inventory',
      'character_spells': 'spells',
      'notebooks': 'notebooks',
      'house_points_history': 'house-points'
    };
    return classMap[collection] || 'other';
  }

  formatJson(value: string): string {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return value;
    }
  }
}
