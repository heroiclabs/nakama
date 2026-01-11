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
import { TooltipModule } from 'primeng/tooltip';
import { CalendarModule } from 'primeng/calendar';
import { MessageService, ConfirmationService } from 'primeng/api';

import { WhitelistService, WhitelistApplication, WhitelistStatus, OralSlot } from '../../services/whitelist.service';
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
    TabViewModule,
    TooltipModule,
    CalendarModule
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
            <span class="stat-number">{{ rpPendingCount() }}</span>
            <span class="stat-label">RP en attente</span>
          </div>
        </p-card>
        <p-card styleClass="stat-card hrp-pending">
          <div class="stat-content">
            <span class="stat-number">{{ hrpPendingCount() }}</span>
            <span class="stat-label">HRP en attente</span>
          </div>
        </p-card>
        <p-card styleClass="stat-card oral">
          <div class="stat-content">
            <span class="stat-number">{{ oralScheduledCount() }}</span>
            <span class="stat-label">Oraux programmés</span>
          </div>
        </p-card>
        <p-card styleClass="stat-card approved">
          <div class="stat-content">
            <span class="stat-number">{{ approvedCount() }}</span>
            <span class="stat-label">Approuvées</span>
          </div>
        </p-card>
      </div>

      <p-tabView>
        <p-tabPanel header="RP en attente ({{ rpPendingCount() }})">
          <ng-container *ngTemplateOutlet="applicationsTable; context: { $implicit: rpPendingApplications() }"></ng-container>
        </p-tabPanel>
        <p-tabPanel header="HRP en attente ({{ hrpPendingCount() }})">
          <ng-container *ngTemplateOutlet="applicationsTable; context: { $implicit: hrpPendingApplications() }"></ng-container>
        </p-tabPanel>
        <p-tabPanel header="À programmer ({{ hrpApprovedCount() }})">
          <ng-container *ngTemplateOutlet="applicationsTable; context: { $implicit: hrpApprovedApplications() }"></ng-container>
        </p-tabPanel>
        <p-tabPanel header="Oraux programmés ({{ oralScheduledCount() }})">
          <ng-container *ngTemplateOutlet="oralCalendarTable"></ng-container>
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
              <th>Étape</th>
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
                <p-tag [severity]="getStepSeverity(app.current_step)" styleClass="step-tag">
                  {{ getStepShortLabel(app.current_step) }}
                </p-tag>
              </td>
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
                  @if (app.status === 'pending' || app.status === 'hrp_pending') {
                    <p-button
                      icon="pi pi-check"
                      styleClass="p-button-success p-button-sm"
                      (click)="approveApplication(app)"
                      [pTooltip]="app.status === 'hrp_pending' ? 'Approuver HRP' : 'Approuver RP'"
                    ></p-button>
                    <p-button
                      icon="pi pi-times"
                      styleClass="p-button-danger p-button-sm"
                      (click)="openRejectDialog(app)"
                      [pTooltip]="app.status === 'hrp_pending' ? 'Refuser HRP' : 'Refuser RP'"
                    ></p-button>
                  }
                  @if (app.status === 'hrp_approved') {
                    <p-button
                      icon="pi pi-calendar"
                      styleClass="p-button-help p-button-sm"
                      (click)="openProposeWeekDialog(app)"
                      pTooltip="Proposer une semaine pour l'oral"
                    ></p-button>
                  }
                  @if (app.status === 'oral_scheduled') {
                    <p-button
                      icon="pi pi-check"
                      styleClass="p-button-success p-button-sm"
                      (click)="approveApplication(app)"
                      pTooltip="Approuver après oral"
                    ></p-button>
                    <p-button
                      icon="pi pi-times"
                      styleClass="p-button-danger p-button-sm"
                      (click)="openRejectDialog(app)"
                      pTooltip="Refuser après oral"
                    ></p-button>
                  }
                </div>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="9" class="text-center">Aucune candidature dans cette catégorie</td>
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

            @if (selectedApplication()!.hrp_first_name) {
              <div class="detail-section hrp-section">
                <h3><i class="pi pi-user"></i> Informations Hors-RP</h3>
                <div class="detail-grid">
                  <div class="detail-item">
                    <label>Prénom</label>
                    <span>{{ selectedApplication()!.hrp_first_name }}</span>
                  </div>
                  <div class="detail-item">
                    <label>Âge</label>
                    <span>{{ selectedApplication()!.hrp_age }} ans</span>
                  </div>
                  <div class="detail-item">
                    <label>Expérience RP</label>
                    <span>{{ selectedApplication()!.hrp_experience_years }} ans</span>
                  </div>
                </div>
                <div class="detail-item full-width">
                  <label>Description expérience RP</label>
                  <p class="story-text">{{ selectedApplication()!.hrp_experience_text }}</p>
                </div>
                <div class="detail-item full-width">
                  <label>Connaissances Harry Potter</label>
                  <p class="story-text">{{ selectedApplication()!.hrp_hp_knowledge }}</p>
                </div>
              </div>
            }

            @if (selectedApplication()!.status === 'rejected' && selectedApplication()!.rejection_reason) {
              <div class="detail-section rejection-section">
                <h3>Raison du refus ({{ selectedApplication()!.rejected_step === 'hrp' ? 'HRP' : 'RP' }})</h3>
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
          @if (selectedApplication()?.status === 'pending' || selectedApplication()?.status === 'hrp_pending') {
            <p-button
              [label]="selectedApplication()?.status === 'hrp_pending' ? 'Refuser HRP' : 'Refuser RP'"
              icon="pi pi-times"
              styleClass="p-button-danger"
              (click)="openRejectDialog(selectedApplication()!)"
            ></p-button>
            <p-button
              [label]="selectedApplication()?.status === 'hrp_pending' ? 'Approuver HRP' : 'Approuver RP'"
              icon="pi pi-check"
              styleClass="p-button-success"
              (click)="approveApplication(selectedApplication()!)"
            ></p-button>
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

      <!-- Propose Week Dialog -->
      <p-dialog
        header="Proposer une semaine pour l'oral"
        [(visible)]="proposeWeekDialogVisible"
        [modal]="true"
        [style]="{ width: '500px' }"
        [draggable]="false"
        [resizable]="false"
      >
        <div class="propose-week-form">
          <p>Proposez une semaine durant laquelle <strong>{{ applicationToProposeWeek()?.username }}</strong> pourra choisir un créneau pour son oral.</p>
          <p class="info-text">Le candidat sera invité sur le Discord <strong>Elderwood Douane</strong> et recevra le rôle "En attente d'oral".</p>

          <div class="form-field">
            <label>Semaine proposée *</label>
            <div class="week-picker">
              <div class="date-field">
                <label for="weekStart">Du</label>
                <p-calendar
                  id="weekStart"
                  [(ngModel)]="proposedWeekStart"
                  dateFormat="dd/mm/yy"
                  [minDate]="today"
                  placeholder="Date de début"
                ></p-calendar>
              </div>
              <div class="date-field">
                <label for="weekEnd">Au</label>
                <p-calendar
                  id="weekEnd"
                  [(ngModel)]="proposedWeekEnd"
                  dateFormat="dd/mm/yy"
                  [minDate]="proposedWeekStart || today"
                  placeholder="Date de fin"
                ></p-calendar>
              </div>
            </div>
          </div>
        </div>

        <ng-template pTemplate="footer">
          <p-button label="Annuler" icon="pi pi-times" styleClass="p-button-text" (click)="proposeWeekDialogVisible = false"></p-button>
          <p-button
            label="Proposer la semaine"
            icon="pi pi-calendar"
            styleClass="p-button-help"
            (click)="confirmProposeWeek()"
            [disabled]="!proposedWeekStart || !proposedWeekEnd"
          ></p-button>
        </ng-template>
      </p-dialog>

      <!-- Oral Calendar Table Template -->
      <ng-template #oralCalendarTable>
        <div class="oral-calendar-header">
          <h3><i class="pi pi-calendar"></i> Calendrier des oraux</h3>
          <p-button label="Rafraîchir" icon="pi pi-refresh" styleClass="p-button-outlined p-button-sm" (click)="loadOralCalendar()"></p-button>
        </div>

        <p-table
          [value]="oralCalendar()"
          [paginator]="true"
          [rows]="10"
          [showCurrentPageReport]="true"
          currentPageReportTemplate="Affichage {first} à {last} sur {totalRecords} oraux"
          styleClass="p-datatable-striped"
        >
          <ng-template pTemplate="header">
            <tr>
              <th pSortableColumn="selected_slot">Date/Heure <p-sortIcon field="selected_slot"></p-sortIcon></th>
              <th>Joueur</th>
              <th>Discord</th>
              <th>Personnage</th>
              <th>Invitation</th>
              <th>Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-slot>
            <tr>
              <td>
                <span class="oral-datetime">{{ formatOralSlot(slot.selected_slot) }}</span>
              </td>
              <td>{{ slot.username }}</td>
              <td>{{ slot.discord_username }}</td>
              <td>{{ slot.character_name }}</td>
              <td>
                @if (slot.invite_sent) {
                  <p-tag severity="success">Envoyée</p-tag>
                } @else {
                  <p-tag severity="warning">En attente</p-tag>
                }
              </td>
              <td>
                <div class="action-buttons">
                  @if (!slot.invite_sent) {
                    <p-button
                      icon="pi pi-send"
                      styleClass="p-button-help p-button-sm"
                      (click)="markInviteSent(slot)"
                      pTooltip="Marquer invitation envoyée"
                    ></p-button>
                  }
                  <p-button
                    icon="pi pi-check"
                    styleClass="p-button-success p-button-sm"
                    (click)="approveAfterOral(slot)"
                    pTooltip="Approuver après oral"
                  ></p-button>
                  <p-button
                    icon="pi pi-times"
                    styleClass="p-button-danger p-button-sm"
                    (click)="rejectAfterOral(slot)"
                    pTooltip="Refuser après oral"
                  ></p-button>
                </div>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="6" class="text-center">Aucun oral programmé</td>
            </tr>
          </ng-template>
        </p-table>
      </ng-template>
    </div>
  `,
  styles: [`
    .douanier-dashboard {
      animation: fadeIn 0.3s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
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
      grid-template-columns: repeat(4, 1fr);
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

    :host ::ng-deep .stat-card.hrp-pending .p-card {
      border-left: 4px solid #3b82f6;
    }

    :host ::ng-deep .stat-card.approved .p-card {
      border-left: 4px solid #22c55e;
    }

    :host ::ng-deep .stat-card.rejected .p-card {
      border-left: 4px solid #ef4444;
    }

    :host ::ng-deep .stat-card.oral .p-card {
      border-left: 4px solid #8b5cf6;
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

    .hrp-section {
      background: rgba(59, 130, 246, 0.1);
      padding: 1rem;
      border-radius: 8px;
      border-left: 4px solid #3b82f6;
    }

    .hrp-section h3 {
      color: #3b82f6 !important;
      border: none !important;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .detail-item.full-width {
      grid-column: 1 / -1;
      margin-top: 1rem;
    }

    .step-tag {
      font-size: 0.7rem;
      padding: 0.2rem 0.5rem;
    }

    :host ::ng-deep .p-tag.p-tag-info {
      background: rgba(59, 130, 246, 0.2);
      color: #3b82f6;
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

    /* Help button */
    :host ::ng-deep .action-buttons .p-button-help {
      background: #8b5cf6;
    }

    /* Propose week form */
    .propose-week-form p {
      margin-bottom: 0.5rem;
    }

    .info-text {
      color: #3b82f6;
      font-size: 0.875rem;
      margin-bottom: 1rem;
    }

    .week-picker {
      display: flex;
      gap: 1rem;
      margin-top: 0.5rem;
    }

    .date-field {
      flex: 1;
    }

    .date-field label {
      display: block;
      margin-bottom: 0.25rem;
      font-size: 0.875rem;
      color: rgba(255, 255, 255, 0.6);
    }

    :host ::ng-deep .week-picker .p-calendar {
      width: 100%;
    }

    :host ::ng-deep .week-picker .p-calendar .p-inputtext {
      width: 100%;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: white;
      border-radius: 8px;
    }

    :host ::ng-deep .week-picker .p-calendar .p-inputtext:focus {
      border-color: var(--elderwood-primary);
    }

    /* Oral calendar header */
    .oral-calendar-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
    }

    .oral-calendar-header h3 {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--elderwood-primary);
      margin: 0;
    }

    .oral-datetime {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(139, 92, 246, 0.2);
      color: #a78bfa;
      padding: 0.5rem 0.75rem;
      border-radius: 6px;
      font-weight: 600;
      font-size: 0.875rem;
    }

    /* Tag secondary */
    :host ::ng-deep .p-tag.p-tag-secondary {
      background: rgba(107, 114, 128, 0.2);
      color: #9ca3af;
    }

    /* Responsive */
    @media (max-width: 1024px) {
      .stats-cards {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    @media (max-width: 768px) {
      .stats-cards {
        grid-template-columns: 1fr;
      }

      .detail-grid {
        grid-template-columns: 1fr;
      }

      .week-picker {
        flex-direction: column;
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
  proposeWeekDialogVisible = false;

  // Selected application
  selectedApplication = signal<WhitelistApplication | null>(null);
  applicationToReject = signal<WhitelistApplication | null>(null);
  applicationToProposeWeek = signal<WhitelistApplication | null>(null);
  rejectionReason = '';

  // Week proposal
  proposedWeekStart: Date | null = null;
  proposedWeekEnd: Date | null = null;
  today = new Date();

  // Computed counts
  rpPendingCount = signal(0);
  hrpPendingCount = signal(0);
  hrpApprovedCount = signal(0);
  oralScheduledCount = signal(0);
  approvedCount = signal(0);
  rejectedCount = signal(0);

  // Filtered applications
  rpPendingApplications = signal<WhitelistApplication[]>([]);
  hrpPendingApplications = signal<WhitelistApplication[]>([]);
  hrpApprovedApplications = signal<WhitelistApplication[]>([]);
  oralScheduledApplications = signal<WhitelistApplication[]>([]);
  approvedApplications = signal<WhitelistApplication[]>([]);
  rejectedApplications = signal<WhitelistApplication[]>([]);

  // Oral calendar
  oralCalendar = signal<OralSlot[]>([]);

  ngOnInit() {
    this.loadApplications();
    this.loadOralCalendar();
  }

  loadApplications() {
    this.whitelistService.listApplications().subscribe({
      next: (response) => {
        const apps = response.applications || [];

        // Filter by status
        const rpPending = apps.filter(a => a.status === 'pending');
        const hrpPending = apps.filter(a => a.status === 'hrp_pending');
        const hrpApproved = apps.filter(a => a.status === 'hrp_approved' || a.status === 'oral_pending');
        const oralScheduled = apps.filter(a => a.status === 'oral_scheduled');
        const approved = apps.filter(a => a.status === 'approved');
        const rejected = apps.filter(a => a.status === 'rejected');

        this.rpPendingApplications.set(rpPending);
        this.hrpPendingApplications.set(hrpPending);
        this.hrpApprovedApplications.set(hrpApproved);
        this.oralScheduledApplications.set(oralScheduled);
        this.approvedApplications.set(approved);
        this.rejectedApplications.set(rejected);

        this.rpPendingCount.set(rpPending.length);
        this.hrpPendingCount.set(hrpPending.length);
        this.hrpApprovedCount.set(hrpApproved.length);
        this.oralScheduledCount.set(oralScheduled.length);
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

  loadOralCalendar() {
    this.whitelistService.listOralCalendar().subscribe({
      next: (response) => {
        this.oralCalendar.set(response.scheduled_orals || []);
      },
      error: (error) => {
        console.error('Failed to load oral calendar:', error);
      }
    });
  }

  viewApplication(app: WhitelistApplication) {
    this.selectedApplication.set(app);
    this.viewDialogVisible = true;
  }

  approveApplication(app: WhitelistApplication) {
    let stepLabel: string;
    let successMessage: string;

    switch (app.status) {
      case 'pending':
        stepLabel = 'RP';
        successMessage = 'Étape RP approuvée. Le joueur doit maintenant soumettre sa candidature HRP.';
        break;
      case 'hrp_pending':
        stepLabel = 'HRP';
        successMessage = 'Étape HRP approuvée. Vous pouvez maintenant proposer une semaine pour l\'oral.';
        break;
      case 'oral_scheduled':
        stepLabel = 'Oral';
        successMessage = 'Candidature entièrement approuvée ! Le joueur peut maintenant accéder au jeu.';
        break;
      default:
        return;
    }

    this.confirmationService.confirm({
      message: `Êtes-vous sûr de vouloir approuver l'étape ${stepLabel} de la candidature de ${app.username} ?`,
      header: 'Confirmation',
      icon: 'pi pi-check-circle',
      accept: () => {
        this.whitelistService.reviewApplication(app.id, app.user_id, true).subscribe({
          next: () => {
            this.messageService.add({
              severity: 'success',
              summary: 'Succès',
              detail: successMessage
            });
            this.viewDialogVisible = false;
            this.loadApplications();
            this.loadOralCalendar();
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

  openProposeWeekDialog(app: WhitelistApplication) {
    this.applicationToProposeWeek.set(app);
    this.proposedWeekStart = null;
    this.proposedWeekEnd = null;
    this.proposeWeekDialogVisible = true;
  }

  confirmProposeWeek() {
    const app = this.applicationToProposeWeek();
    if (!app || !this.proposedWeekStart || !this.proposedWeekEnd) return;

    // Format dates as YYYY-MM-DD
    const formatDateISO = (date: Date): string => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    this.whitelistService.proposeOralWeek(
      app.id,
      app.user_id,
      formatDateISO(this.proposedWeekStart),
      formatDateISO(this.proposedWeekEnd)
    ).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Succès',
          detail: 'Semaine proposée au candidat. Il peut maintenant choisir son créneau.'
        });
        this.proposeWeekDialogVisible = false;
        this.loadApplications();
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: error.error?.message || 'Impossible de proposer la semaine.'
        });
      }
    });
  }

  markInviteSent(slot: OralSlot) {
    this.whitelistService.markOralInviteSent(slot.application_id, slot.user_id).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Succès',
          detail: 'Invitation Discord marquée comme envoyée.'
        });
        this.loadOralCalendar();
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: error.error?.message || 'Impossible de marquer l\'invitation.'
        });
      }
    });
  }

  approveAfterOral(slot: OralSlot) {
    this.confirmationService.confirm({
      message: `Êtes-vous sûr de vouloir approuver la candidature de ${slot.username} après son oral ?`,
      header: 'Confirmation',
      icon: 'pi pi-check-circle',
      accept: () => {
        this.whitelistService.reviewApplication(slot.application_id, slot.user_id, true).subscribe({
          next: () => {
            this.messageService.add({
              severity: 'success',
              summary: 'Succès',
              detail: 'Candidature entièrement approuvée ! Le joueur peut maintenant accéder au jeu.'
            });
            this.loadApplications();
            this.loadOralCalendar();
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

  rejectAfterOral(slot: OralSlot) {
    // Create a temporary application object for the reject dialog
    this.applicationToReject.set({
      id: slot.application_id,
      user_id: slot.user_id,
      username: slot.username,
      status: 'oral_scheduled'
    } as WhitelistApplication);
    this.rejectionReason = '';
    this.rejectDialogVisible = true;
  }

  formatOralSlot(slotString: string): string {
    if (!slotString) return '';
    // Parse YYYY-MM-DDTHH:MM format
    const date = new Date(slotString);
    return date.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  getStepSeverity(step: string): 'info' | 'warning' | 'success' | 'danger' | 'secondary' {
    switch (step) {
      case 'rp':
        return 'warning';
      case 'hrp':
        return 'info';
      case 'oral':
        return 'secondary';
      default:
        return 'info';
    }
  }

  getStepShortLabel(step: string): string {
    switch (step) {
      case 'rp':
        return 'RP';
      case 'hrp':
        return 'HRP';
      case 'oral':
        return 'Oral';
      default:
        return step?.toUpperCase() || '';
    }
  }
}
