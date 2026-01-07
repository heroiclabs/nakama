import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// PrimeNG
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { DropdownModule } from 'primeng/dropdown';
import { ToastModule } from 'primeng/toast';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TagModule } from 'primeng/tag';
import { MessageService } from 'primeng/api';

import { NakamaService } from '../../services/nakama.service';
import { HouseRanking, HousePointsEntry, HouseName } from '../../models';

interface HouseOption {
  label: string;
  value: HouseName;
  color: string;
}

@Component({
  selector: 'app-houses',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    TableModule,
    DialogModule,
    InputTextModule,
    InputNumberModule,
    InputTextareaModule,
    DropdownModule,
    ToastModule,
    ProgressSpinnerModule,
    TagModule
  ],
  providers: [MessageService],
  template: `
    <p-toast></p-toast>

    <div class="page-header">
      <h1>Gestion des Maisons</h1>
      <p>Gérez les points des maisons et consultez l'historique</p>
    </div>

    <!-- Rankings Cards -->
    <div class="grid mb-4">
      @for (ranking of rankings(); track ranking.house) {
        <div class="col-12 md:col-6 lg:col-3">
          <div class="house-card" [class]="getHouseClass(ranking.house)">
            <div class="house-rank">#{{ ranking.rank }}</div>
            <div class="house-name">{{ ranking.house }}</div>
            <div class="house-points">{{ ranking.points | number }} pts</div>
            <div class="house-actions">
              <p-button
                icon="pi pi-plus"
                [rounded]="true"
                severity="success"
                size="small"
                (onClick)="openPointsDialog(ranking.house, 'add')"
                pTooltip="Ajouter des points"
              ></p-button>
              <p-button
                icon="pi pi-minus"
                [rounded]="true"
                severity="danger"
                size="small"
                (onClick)="openPointsDialog(ranking.house, 'remove')"
                pTooltip="Retirer des points"
              ></p-button>
            </div>
          </div>
        </div>
      }
    </div>

    <!-- History Table -->
    <p-card header="Historique des points">
      <div class="flex justify-content-between align-items-center mb-3">
        <p-dropdown
          [options]="houseOptions"
          [(ngModel)]="selectedHouseFilter"
          placeholder="Filtrer par maison"
          [showClear]="true"
          optionLabel="label"
          optionValue="value"
          (onChange)="loadHistory()"
          styleClass="w-12rem"
        ></p-dropdown>
        <p-button
          icon="pi pi-refresh"
          [text]="true"
          (onClick)="loadHistory()"
          pTooltip="Actualiser"
        ></p-button>
      </div>

      @if (loadingHistory()) {
        <div class="flex justify-content-center p-4">
          <p-progressSpinner styleClass="w-3rem h-3rem"></p-progressSpinner>
        </div>
      } @else {
        <p-table
          [value]="history()"
          [paginator]="true"
          [rows]="10"
          [rowsPerPageOptions]="[10, 25, 50]"
          styleClass="p-datatable-sm"
        >
          <ng-template pTemplate="header">
            <tr>
              <th>Date</th>
              <th>Maison</th>
              <th>Points</th>
              <th>Personnage</th>
              <th>Raison</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-entry>
            <tr>
              <td>{{ entry.created_at * 1000 | date:'dd/MM/yyyy HH:mm' }}</td>
              <td>
                <span class="house-badge" [class]="getHouseClass(entry.house)">
                  {{ entry.house }}
                </span>
              </td>
              <td>
                <span [class]="entry.points > 0 ? 'text-green-500' : 'text-red-500'">
                  {{ entry.points > 0 ? '+' : '' }}{{ entry.points }}
                </span>
              </td>
              <td>{{ entry.character_name || '-' }}</td>
              <td>{{ entry.reason }}</td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="5" class="text-center p-4">
                Aucun historique disponible
              </td>
            </tr>
          </ng-template>
        </p-table>
      }
    </p-card>

    <!-- Points Dialog -->
    <p-dialog
      [(visible)]="pointsDialogVisible"
      [header]="pointsDialogMode === 'add' ? 'Ajouter des points' : 'Retirer des points'"
      [modal]="true"
      [style]="{width: '450px'}"
    >
      <div class="flex flex-column gap-3">
        <div class="form-field">
          <label>Maison</label>
          <p-dropdown
            [options]="houseOptions"
            [(ngModel)]="selectedHouse"
            optionLabel="label"
            optionValue="value"
            styleClass="w-full"
            [disabled]="true"
          ></p-dropdown>
        </div>

        <div class="form-field">
          <label>Points</label>
          <p-inputNumber
            [(ngModel)]="pointsAmount"
            [min]="1"
            [max]="1000"
            styleClass="w-full"
            placeholder="Nombre de points"
          ></p-inputNumber>
        </div>

        <div class="form-field">
          <label>Nom du personnage (facultatif)</label>
          <input
            type="text"
            pInputText
            [(ngModel)]="characterName"
            class="w-full"
            placeholder="Ex: Harry Potter"
          />
        </div>

        <div class="form-field">
          <label>Raison</label>
          <textarea
            pInputTextarea
            [(ngModel)]="pointsReason"
            rows="3"
            class="w-full"
            placeholder="Raison de la modification..."
          ></textarea>
        </div>
      </div>

      <ng-template pTemplate="footer">
        <p-button
          label="Annuler"
          [text]="true"
          severity="secondary"
          (onClick)="pointsDialogVisible = false"
        ></p-button>
        <p-button
          [label]="pointsDialogMode === 'add' ? 'Ajouter' : 'Retirer'"
          [icon]="pointsDialogMode === 'add' ? 'pi pi-plus' : 'pi pi-minus'"
          [severity]="pointsDialogMode === 'add' ? 'success' : 'danger'"
          (onClick)="submitPoints()"
          [loading]="submitting()"
          [disabled]="!pointsAmount || !pointsReason"
        ></p-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .house-card {
      padding: 1.5rem;
      border-radius: 0.75rem;
      text-align: center;
      transition: transform 0.2s ease;
      position: relative;
      overflow: hidden;

      &:hover {
        transform: translateY(-2px);
      }

      &.venatrix { background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); }
      &.falcon { background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); }
      &.brumval { background: linear-gradient(135deg, #16a34a 0%, #15803d 100%); }
      &.aerwyn { background: linear-gradient(135deg, #eab308 0%, #ca8a04 100%); }
    }

    .house-rank {
      font-size: 0.875rem;
      opacity: 0.8;
      margin-bottom: 0.25rem;
      color: white;
    }

    .house-name {
      font-size: 1.25rem;
      font-weight: 700;
      color: white;
      margin-bottom: 0.5rem;
    }

    .house-points {
      font-size: 1.75rem;
      font-weight: 700;
      color: white;
      margin-bottom: 1rem;
    }

    .house-actions {
      display: flex;
      justify-content: center;
      gap: 0.5rem;
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
    }
  `]
})
export class HousesComponent implements OnInit {
  rankings = signal<HouseRanking[]>([]);
  history = signal<HousePointsEntry[]>([]);
  loadingHistory = signal(false);
  submitting = signal(false);

  selectedHouseFilter: HouseName | null = null;

  // Dialog state
  pointsDialogVisible = false;
  pointsDialogMode: 'add' | 'remove' = 'add';
  selectedHouse: HouseName = 'Venatrix';
  pointsAmount: number = 10;
  characterName = '';
  pointsReason = '';

  houseOptions: HouseOption[] = [
    { label: 'Venatrix', value: 'Venatrix', color: '#dc2626' },
    { label: 'Falcon', value: 'Falcon', color: '#2563eb' },
    { label: 'Brumval', value: 'Brumval', color: '#16a34a' },
    { label: 'Aerwyn', value: 'Aerwyn', color: '#eab308' }
  ];

  constructor(
    private nakamaService: NakamaService,
    private messageService: MessageService
  ) {}

  ngOnInit(): void {
    this.loadRankings();
    this.loadHistory();
  }

  loadRankings(): void {
    this.nakamaService.getHouseRankings().subscribe({
      next: (response) => {
        this.rankings.set(response.rankings);
      },
      error: (err) => {
        console.error('Failed to load rankings:', err);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de charger les classements'
        });
      }
    });
  }

  loadHistory(): void {
    this.loadingHistory.set(true);
    const house = this.selectedHouseFilter || undefined;

    this.nakamaService.getHousePointsHistory(house, 100).subscribe({
      next: (response) => {
        this.history.set(response.entries);
        this.loadingHistory.set(false);
      },
      error: (err) => {
        console.error('Failed to load history:', err);
        this.loadingHistory.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de charger l\'historique'
        });
      }
    });
  }

  openPointsDialog(house: HouseName, mode: 'add' | 'remove'): void {
    this.selectedHouse = house;
    this.pointsDialogMode = mode;
    this.pointsAmount = 10;
    this.characterName = '';
    this.pointsReason = '';
    this.pointsDialogVisible = true;
  }

  submitPoints(): void {
    if (!this.pointsAmount || !this.pointsReason) return;

    this.submitting.set(true);

    const points = this.pointsDialogMode === 'add' ? this.pointsAmount : -this.pointsAmount;

    this.nakamaService.modifyHousePoints({
      house: this.selectedHouse,
      points,
      character_name: this.characterName || undefined,
      reason: this.pointsReason
    }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.pointsDialogVisible = false;
        this.messageService.add({
          severity: 'success',
          summary: 'Succès',
          detail: `${Math.abs(points)} points ${this.pointsDialogMode === 'add' ? 'ajoutés à' : 'retirés de'} ${this.selectedHouse}`
        });
        this.loadRankings();
        this.loadHistory();
      },
      error: (err) => {
        console.error('Failed to modify points:', err);
        this.submitting.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de modifier les points'
        });
      }
    });
  }

  getHouseClass(house: string): string {
    return house.toLowerCase().replace(' ', '-');
  }
}
