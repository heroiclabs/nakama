import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

// PrimeNG
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { DropdownModule } from 'primeng/dropdown';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { CardModule } from 'primeng/card';
import { TabViewModule } from 'primeng/tabview';
import { MessageService, ConfirmationService } from 'primeng/api';

import { WhitelistService, WhitelistApplication, WhitelistStatus } from '../../services/whitelist.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-douanier-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    TagModule,
    DialogModule,
    InputTextareaModule,
    DropdownModule,
    ToastModule,
    ConfirmDialogModule,
    CardModule,
    TabViewModule
  ],
  providers: [MessageService, ConfirmationService],
  template: `
    <p-toast></p-toast>
    <p-confirmDialog></p-confirmDialog>

    <div class="douanier-dashboard">
      <div class="header">
        <h1>Tableau de bord Douanier</h1>
        <p>Gestion des candidatures Whitelist</p>
      </div>

      <div class="stats-cards">
        <p-card styleClass="stat-card pending">
          <div class="stat-content">
            <span class="stat-number">{{ pendingCount() }}</span>
            <span class="stat-label">En attente</span>
          </div>
        </p-card>
        <p-card styleClass="stat-card approved">
          <div class="stat-content">
            <span class="stat-number">{{ approvedCount() }}</span>
            <span class="stat-label">Approuvées</span>
          </div>
        </p-card>
        <p-card styleClass="stat-card rejected">
          <div class="stat-content">
            <span class="stat-number">{{ rejectedCount() }}</span>
            <span class="stat-label">Refusées</span>
          </div>
        </p-card>
      </div>

      <p-tabView>
        <p-tabPanel header="En attente ({{ pendingCount() }})">
          <ng-container *ngTemplateOutlet="applicationsTable; context: { $implicit: pendingApplications() }"></ng-container>
        </p-tabPanel>
        <p-tabPanel header="Approuvées ({{ approvedCount() }})">
          <ng-container *ngTemplateOutlet="applicationsTable; context: { $implicit: approvedApplications() }"></ng-container>
        </p-tabPanel>
        <p-tabPanel header="Refusées ({{ rejectedCount() }})">
          <ng-container *ngTemplateOutlet="applicationsTable; context: { $implicit: rejectedApplications() }"></ng-container>
        </p-tabPanel>
      </p-tabView>

      <!-- Applications Table Template -->
      <ng-template #applicationsTable let-apps>
        <p-table
          [value]="apps"
          [paginator]="true"
          [rows]="10"
          [showCurrentPageReport]="true"
          currentPageReportTemplate="Affichage {first} à {last} sur {totalRecords} candidatures"
          [rowsPerPageOptions]="[10, 25, 50]"
          styleClass="p-datatable-striped"
        >
          <ng-template pTemplate="header">
            <tr>
              <th pSortableColumn="username">Utilisateur <p-sortIcon field="username"></p-sortIcon></th>
              <th>Discord</th>
              <th pSortableColumn="character_first_name">Personnage <p-sortIcon field="character_first_name"></p-sortIcon></th>
              <th>Âge</th>
              <th>Sang</th>
              <th pSortableColumn="created_at">Date <p-sortIcon field="created_at"></p-sortIcon></th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-app>
            <tr>
              <td>{{ app.username }}</td>
              <td>{{ app.discord_username }}</td>
              <td>{{ app.character_first_name }} {{ app.character_last_name }}</td>
              <td>{{ app.character_age }} ans</td>
              <td>{{ whitelistService.getBloodLabel(app.character_blood) }}</td>
              <td>{{ formatDate(app.created_at) }}</td>
              <td>
                <p-tag [severity]="whitelistService.getStatusSeverity(app.status)">
                  {{ whitelistService.getStatusLabel(app.status) }}
                </p-tag>
              </td>
              <td>
                <div class="action-buttons">
                  <p-button
                    icon="pi pi-eye"
                    styleClass="p-button-info p-button-sm"
                    (click)="viewApplication(app)"
                    pTooltip="Voir les détails"
                  ></p-button>
                  @if (app.status === 'pending') {
                    <p-button
                      icon="pi pi-check"
                      styleClass="p-button-success p-button-sm"
                      (click)="approveApplication(app)"
                      pTooltip="Approuver"
                    ></p-button>
                    <p-button
                      icon="pi pi-times"
                      styleClass="p-button-danger p-button-sm"
                      (click)="openRejectDialog(app)"
                      pTooltip="Refuser"
                    ></p-button>
                  }
                </div>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="8" class="text-center">Aucune candidature dans cette catégorie</td>
            </tr>
          </ng-template>
        </p-table>
      </ng-template>

      <!-- View Application Dialog -->
      <p-dialog
        header="Détails de la candidature"
        [(visible)]="viewDialogVisible"
        [modal]="true"
        [style]="{ width: '700px' }"
        [draggable]="false"
        [resizable]="false"
      >
        @if (selectedApplication()) {
          <div class="application-details">
            <div class="detail-section">
              <h3>Informations utilisateur</h3>
              <div class="detail-grid">
                <div class="detail-item">
                  <label>Nom d'utilisateur</label>
                  <span>{{ selectedApplication()!.username }}</span>
                </div>
                <div class="detail-item">
                  <label>Email</label>
                  <span>{{ selectedApplication()!.email }}</span>
                </div>
                <div class="detail-item">
                  <label>Discord</label>
                  <span>{{ selectedApplication()!.discord_username }}</span>
                </div>
              </div>
            </div>

            <div class="detail-section">
              <h3>Personnage</h3>
              <div class="detail-grid">
                <div class="detail-item">
                  <label>Prénom</label>
                  <span>{{ selectedApplication()!.character_first_name }}</span>
                </div>
                <div class="detail-item">
                  <label>Nom</label>
                  <span>{{ selectedApplication()!.character_last_name }}</span>
                </div>
                <div class="detail-item">
                  <label>Âge</label>
                  <span>{{ selectedApplication()!.character_age }} ans</span>
                </div>
                <div class="detail-item">
                  <label>Statut de sang</label>
                  <span>{{ whitelistService.getBloodLabel(selectedApplication()!.character_blood) }}</span>
                </div>
              </div>
            </div>

            <div class="detail-section">
              <h3>Histoire du personnage</h3>
              <p class="story-text">{{ selectedApplication()!.character_history }}</p>
            </div>

            <div class="detail-section">
              <h3>Motivation</h3>
              <p class="story-text">{{ selectedApplication()!.character_motivation }}</p>
            </div>

            @if (selectedApplication()!.status === 'rejected' && selectedApplication()!.rejection_reason) {
              <div class="detail-section rejection-section">
                <h3>Raison du refus</h3>
                <p class="rejection-text">{{ selectedApplication()!.rejection_reason }}</p>
                <p class="reviewed-by">Refusé par {{ selectedApplication()!.reviewed_by }} le {{ formatDate(selectedApplication()!.reviewed_at!) }}</p>
              </div>
            }

            @if (selectedApplication()!.status === 'approved') {
              <div class="detail-section approved-section">
                <h3>Approuvée</h3>
                <p class="reviewed-by">Par {{ selectedApplication()!.reviewed_by }} le {{ formatDate(selectedApplication()!.reviewed_at!) }}</p>
              </div>
            }
          </div>
        }

        <ng-template pTemplate="footer">
          @if (selectedApplication()?.status === 'pending') {
            <p-button label="Refuser" icon="pi pi-times" styleClass="p-button-danger" (click)="openRejectDialog(selectedApplication()!)"></p-button>
            <p-button label="Approuver" icon="pi pi-check" styleClass="p-button-success" (click)="approveApplication(selectedApplication()!)"></p-button>
          }
          <p-button label="Fermer" icon="pi pi-times" styleClass="p-button-text" (click)="viewDialogVisible = false"></p-button>
        </ng-template>
      </p-dialog>

      <!-- Reject Dialog -->
      <p-dialog
        header="Refuser la candidature"
        [(visible)]="rejectDialogVisible"
        [modal]="true"
        [style]="{ width: '500px' }"
        [draggable]="false"
        [resizable]="false"
      >
        <div class="reject-form">
          <p>Vous êtes sur le point de refuser la candidature de <strong>{{ applicationToReject()?.username }}</strong>.</p>
          <p class="warn-text">Le candidat devra attendre 24 heures avant de pouvoir soumettre une nouvelle candidature.</p>

          <div class="form-field">
            <label for="rejectionReason">Raison du refus *</label>
            <textarea
              pInputTextarea
              id="rejectionReason"
              [(ngModel)]="rejectionReason"
              rows="4"
              placeholder="Expliquez pourquoi cette candidature est refusée..."
            ></textarea>
          </div>
        </div>

        <ng-template pTemplate="footer">
          <p-button label="Annuler" icon="pi pi-times" styleClass="p-button-text" (click)="rejectDialogVisible = false"></p-button>
          <p-button
            label="Confirmer le refus"
            icon="pi pi-check"
            styleClass="p-button-danger"
            (click)="confirmReject()"
            [disabled]="!rejectionReason.trim()"
          ></p-button>
        </ng-template>
      </p-dialog>
    </div>
  `,
  styles: [`
    .douanier-dashboard {
      padding: 2rem;
      background: #0c0c0c;
      min-height: 100vh;
    }

    .header {
      margin-bottom: 2rem;
    }

    .header h1 {
      color: var(--elderwood-primary);
      margin-bottom: 0.5rem;
    }

    .header p {
      color: rgba(255, 255, 255, 0.6);
    }

    .stats-cards {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
      margin-bottom: 2rem;
    }

    :host ::ng-deep .stat-card .p-card {
      background: #1d1f21;
      border: none;
    }

    :host ::ng-deep .stat-card .p-card-body {
      padding: 1.5rem;
    }

    :host ::ng-deep .stat-card.pending .p-card {
      border-left: 4px solid #f59e0b;
    }

    :host ::ng-deep .stat-card.approved .p-card {
      border-left: 4px solid #22c55e;
    }

    :host ::ng-deep .stat-card.rejected .p-card {
      border-left: 4px solid #ef4444;
    }

    .stat-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
    }

    .stat-content .stat-number {
      font-size: 2.5rem;
      font-weight: bold;
      color: var(--elderwood-primary);
    }

    .stat-content .stat-label {
      color: rgba(255, 255, 255, 0.6);
      font-size: 0.9rem;
    }

    /* TabView styling */
    :host ::ng-deep .p-tabview {
      background: transparent;
    }

    :host ::ng-deep .p-tabview .p-tabview-nav {
      background: #1d1f21;
      border: none;
      border-radius: 12px 12px 0 0;
      padding: 0.5rem 0.5rem 0;
    }

    :host ::ng-deep .p-tabview .p-tabview-nav li .p-tabview-nav-link {
      background: transparent;
      border: none;
      color: rgba(255, 255, 255, 0.5);
      padding: 1rem 1.5rem;
      border-radius: 8px 8px 0 0;
    }

    :host ::ng-deep .p-tabview .p-tabview-nav li.p-highlight .p-tabview-nav-link {
      background: var(--elderwood-surface);
      color: var(--elderwood-primary);
      border: none;
    }

    :host ::ng-deep .p-tabview .p-tabview-nav li:not(.p-highlight):not(.p-disabled):hover .p-tabview-nav-link {
      background: rgba(255, 255, 255, 0.05);
      color: white;
    }

    :host ::ng-deep .p-tabview .p-tabview-panels {
      background: var(--elderwood-surface);
      border-radius: 0 0 12px 12px;
      padding: 1.5rem;
    }

    /* Table styling */
    :host ::ng-deep .p-datatable {
      background: transparent;
    }

    :host ::ng-deep .p-datatable .p-datatable-header {
      background: transparent;
      border: none;
    }

    :host ::ng-deep .p-datatable .p-datatable-thead > tr > th {
      background: rgba(0, 0, 0, 0.3);
      border: none;
      color: rgba(255, 255, 255, 0.7);
      padding: 1rem;
      font-weight: 600;
    }

    :host ::ng-deep .p-datatable .p-datatable-tbody > tr {
      background: transparent;
      transition: background 0.2s;
    }

    :host ::ng-deep .p-datatable .p-datatable-tbody > tr:hover {
      background: rgba(255, 255, 255, 0.03);
    }

    :host ::ng-deep .p-datatable .p-datatable-tbody > tr > td {
      border: none;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      padding: 1rem;
      color: white;
    }

    :host ::ng-deep .p-datatable-striped .p-datatable-tbody > tr:nth-child(even) {
      background: rgba(255, 255, 255, 0.02);
    }

    :host ::ng-deep .p-paginator {
      background: transparent;
      border: none;
      padding: 1rem 0;
    }

    :host ::ng-deep .p-paginator .p-paginator-element {
      background: #292a2c;
      border: none;
      color: rgba(255, 255, 255, 0.6);
    }

    :host ::ng-deep .p-paginator .p-paginator-element:hover {
      background: #3a3b3d;
      color: white;
    }

    :host ::ng-deep .p-paginator .p-highlight {
      background: var(--elderwood-primary);
      color: #0c0c0c;
    }

    .action-buttons {
      display: flex;
      gap: 0.5rem;
    }

    :host ::ng-deep .action-buttons .p-button {
      width: 36px;
      height: 36px;
      padding: 0;
    }

    :host ::ng-deep .action-buttons .p-button-info {
      background: #3b82f6;
    }

    :host ::ng-deep .action-buttons .p-button-success {
      background: #22c55e;
    }

    :host ::ng-deep .action-buttons .p-button-danger {
      background: #ef4444;
    }

    /* Dialog styling */
    :host ::ng-deep .p-dialog {
      background: var(--elderwood-surface);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
    }

    :host ::ng-deep .p-dialog .p-dialog-header {
      background: var(--elderwood-surface);
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      color: white;
      border-radius: 16px 16px 0 0;
    }

    :host ::ng-deep .p-dialog .p-dialog-content {
      background: var(--elderwood-surface);
      color: white;
    }

    :host ::ng-deep .p-dialog .p-dialog-footer {
      background: var(--elderwood-surface);
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 0 0 16px 16px;
    }

    .application-details .detail-section {
      margin-bottom: 1.5rem;
    }

    .application-details .detail-section h3 {
      color: var(--elderwood-primary);
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .detail-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;
    }

    .detail-item label {
      display: block;
      font-weight: bold;
      color: rgba(255, 255, 255, 0.5);
      margin-bottom: 0.25rem;
      font-size: 0.875rem;
    }

    .detail-item span {
      color: white;
    }

    .story-text {
      white-space: pre-wrap;
      background: rgba(0, 0, 0, 0.3);
      padding: 1rem;
      border-radius: 8px;
      line-height: 1.6;
      color: rgba(255, 255, 255, 0.9);
    }

    .rejection-section {
      background: rgba(239, 68, 68, 0.1);
      padding: 1rem;
      border-radius: 8px;
      border-left: 4px solid #ef4444;
    }

    .rejection-section h3 {
      color: #ef4444 !important;
      border: none !important;
    }

    .rejection-text {
      color: #fca5a5;
    }

    .approved-section {
      background: rgba(34, 197, 94, 0.1);
      padding: 1rem;
      border-radius: 8px;
      border-left: 4px solid #22c55e;
    }

    .approved-section h3 {
      color: #22c55e !important;
      border: none !important;
    }

    .reviewed-by {
      font-size: 0.875rem;
      color: rgba(255, 255, 255, 0.5);
      margin-top: 0.5rem;
    }

    .reject-form p {
      margin-bottom: 0.5rem;
    }

    .warn-text {
      color: #f59e0b;
      font-size: 0.875rem;
      margin-bottom: 1rem;
    }

    .form-field {
      margin-top: 1rem;
    }

    .form-field label {
      display: block;
      margin-bottom: 0.5rem;
      font-weight: bold;
      color: rgba(255, 255, 255, 0.8);
    }

    :host ::ng-deep .form-field textarea {
      width: 100%;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: white;
      border-radius: 8px;
    }

    :host ::ng-deep .form-field textarea:focus {
      border-color: var(--elderwood-primary);
      box-shadow: 0 0 0 2px rgba(201, 162, 39, 0.2);
    }

    .text-center {
      text-align: center;
      padding: 2rem;
      color: rgba(255, 255, 255, 0.5);
    }

    /* Tag styling */
    :host ::ng-deep .p-tag {
      font-size: 0.75rem;
      padding: 0.25rem 0.75rem;
    }

    :host ::ng-deep .p-tag.p-tag-warning {
      background: rgba(245, 158, 11, 0.2);
      color: #f59e0b;
    }

    :host ::ng-deep .p-tag.p-tag-success {
      background: rgba(34, 197, 94, 0.2);
      color: #22c55e;
    }

    :host ::ng-deep .p-tag.p-tag-danger {
      background: rgba(239, 68, 68, 0.2);
      color: #ef4444;
    }

    /* Confirm dialog */
    :host ::ng-deep .p-confirm-dialog {
      background: var(--elderwood-surface);
    }

    :host ::ng-deep .p-confirm-dialog .p-dialog-header {
      background: var(--elderwood-surface);
      color: white;
    }

    :host ::ng-deep .p-confirm-dialog .p-dialog-content {
      background: var(--elderwood-surface);
      color: white;
    }

    :host ::ng-deep .p-confirm-dialog .p-dialog-footer {
      background: var(--elderwood-surface);
    }

    /* Responsive */
    @media (max-width: 768px) {
      .stats-cards {
        grid-template-columns: 1fr;
      }

      .detail-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class DouanierDashboardComponent implements OnInit {
  whitelistService = inject(WhitelistService);
  private authService = inject(AuthService);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);
  private router = inject(Router);

  // Dialog visibility
  viewDialogVisible = false;
  rejectDialogVisible = false;

  // Selected application
  selectedApplication = signal<WhitelistApplication | null>(null);
  applicationToReject = signal<WhitelistApplication | null>(null);
  rejectionReason = '';

  // Computed counts
  pendingCount = signal(0);
  approvedCount = signal(0);
  rejectedCount = signal(0);

  // Filtered applications
  pendingApplications = signal<WhitelistApplication[]>([]);
  approvedApplications = signal<WhitelistApplication[]>([]);
  rejectedApplications = signal<WhitelistApplication[]>([]);

  ngOnInit() {
    this.loadApplications();
  }

  loadApplications() {
    this.whitelistService.listApplications().subscribe({
      next: (response) => {
        const apps = response.applications || [];

        // Filter by status
        const pending = apps.filter(a => a.status === 'pending');
        const approved = apps.filter(a => a.status === 'approved');
        const rejected = apps.filter(a => a.status === 'rejected');

        this.pendingApplications.set(pending);
        this.approvedApplications.set(approved);
        this.rejectedApplications.set(rejected);

        this.pendingCount.set(pending.length);
        this.approvedCount.set(approved.length);
        this.rejectedCount.set(rejected.length);
      },
      error: (error) => {
        console.error('Failed to load applications:', error);
        if (error.error?.message?.includes('access denied')) {
          this.messageService.add({
            severity: 'error',
            summary: 'Accès refusé',
            detail: 'Vous n\'avez pas les permissions nécessaires pour accéder à cette page.'
          });
          this.router.navigate(['/dashboard']);
        } else {
          this.messageService.add({
            severity: 'error',
            summary: 'Erreur',
            detail: 'Impossible de charger les candidatures.'
          });
        }
      }
    });
  }

  viewApplication(app: WhitelistApplication) {
    this.selectedApplication.set(app);
    this.viewDialogVisible = true;
  }

  approveApplication(app: WhitelistApplication) {
    this.confirmationService.confirm({
      message: `Êtes-vous sûr de vouloir approuver la candidature de ${app.username} ?`,
      header: 'Confirmation',
      icon: 'pi pi-check-circle',
      accept: () => {
        this.whitelistService.reviewApplication(app.id, app.user_id, true).subscribe({
          next: () => {
            this.messageService.add({
              severity: 'success',
              summary: 'Succès',
              detail: 'Candidature approuvée avec succès.'
            });
            this.viewDialogVisible = false;
            this.loadApplications();
          },
          error: (error) => {
            this.messageService.add({
              severity: 'error',
              summary: 'Erreur',
              detail: error.error?.message || 'Impossible d\'approuver la candidature.'
            });
          }
        });
      }
    });
  }

  openRejectDialog(app: WhitelistApplication) {
    this.applicationToReject.set(app);
    this.rejectionReason = '';
    this.rejectDialogVisible = true;
    this.viewDialogVisible = false;
  }

  confirmReject() {
    const app = this.applicationToReject();
    if (!app || !this.rejectionReason.trim()) return;

    this.whitelistService.reviewApplication(app.id, app.user_id, false, this.rejectionReason).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Succès',
          detail: 'Candidature refusée.'
        });
        this.rejectDialogVisible = false;
        this.loadApplications();
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: error.error?.message || 'Impossible de refuser la candidature.'
        });
      }
    });
  }

  formatDate(dateString: string): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}
