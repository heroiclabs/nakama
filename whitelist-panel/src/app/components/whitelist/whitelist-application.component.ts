import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

// PrimeNG
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { DropdownModule } from 'primeng/dropdown';
import { StepsModule } from 'primeng/steps';
import { ToastModule } from 'primeng/toast';
import { TagModule } from 'primeng/tag';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageService, MenuItem } from 'primeng/api';

import { WhitelistService, WhitelistApplication, WhitelistStatusResponse } from '../../services/whitelist.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-whitelist-application',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    InputTextareaModule,
    DropdownModule,
    StepsModule,
    ToastModule,
    TagModule,
    ProgressSpinnerModule
  ],
  providers: [MessageService],
  template: `
    <p-toast></p-toast>

    <div class="whitelist-container">
      @if (loading()) {
        <div class="loading-container">
          <p-progressSpinner></p-progressSpinner>
          <p>Chargement...</p>
        </div>
      } @else if (status()?.has_application && !status()?.can_apply) {
        <!-- Show application status -->
        <div class="status-view">
          <p-card styleClass="status-card">
            <ng-template pTemplate="header">
              <div class="card-header">
                <i class="pi pi-file-edit"></i>
                <h2>Votre candidature</h2>
              </div>
            </ng-template>

            <div class="status-content">
              <div class="status-badge">
                <p-tag
                  [severity]="whitelistService.getStatusSeverity(status()!.application!.status)"
                  [value]="whitelistService.getStatusLabel(status()!.application!.status)"
                  styleClass="large-tag"
                ></p-tag>
              </div>

              @switch (status()!.application!.status) {
                @case ('pending') {
                  <div class="status-message pending">
                    <i class="pi pi-clock"></i>
                    <p>Votre candidature est en cours d'examen par nos Douaniers. Vous serez notifié dès qu'une décision sera prise.</p>
                  </div>
                }
                @case ('approved') {
                  <div class="status-message approved">
                    <i class="pi pi-check-circle"></i>
                    <p>Félicitations ! Votre candidature a été approuvée. Vous pouvez maintenant accéder au jeu.</p>
                    <p class="reviewer">Approuvée par {{ status()!.application!.reviewed_by }} le {{ formatDate(status()!.application!.reviewed_at!) }}</p>
                  </div>
                }
                @case ('rejected') {
                  <div class="status-message rejected">
                    <i class="pi pi-times-circle"></i>
                    <p>Votre candidature a été refusée.</p>
                    <div class="rejection-reason">
                      <strong>Raison :</strong>
                      <p>{{ status()!.application!.rejection_reason }}</p>
                    </div>
                    <p class="reviewer">Refusée par {{ status()!.application!.reviewed_by }} le {{ formatDate(status()!.application!.reviewed_at!) }}</p>

                    @if (status()!.cooldown_remaining) {
                      <div class="cooldown">
                        <i class="pi pi-hourglass"></i>
                        <p>Vous pourrez soumettre une nouvelle candidature dans <strong>{{ status()!.cooldown_remaining }}</strong></p>
                      </div>
                    }
                  </div>
                }
              }

              <div class="application-summary">
                <h3>Résumé de votre candidature</h3>
                <div class="summary-grid">
                  <div class="summary-item">
                    <label>Personnage</label>
                    <span>{{ status()!.application!.character_first_name }} {{ status()!.application!.character_last_name }}</span>
                  </div>
                  <div class="summary-item">
                    <label>Âge</label>
                    <span>{{ status()!.application!.character_age }} ans</span>
                  </div>
                  <div class="summary-item">
                    <label>Statut de sang</label>
                    <span>{{ whitelistService.getBloodLabel(status()!.application!.character_blood) }}</span>
                  </div>
                  <div class="summary-item">
                    <label>Soumise le</label>
                    <span>{{ formatDate(status()!.application!.created_at) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </p-card>
        </div>
      } @else {
        <!-- Show application form -->
        <div class="application-form">
          <p-card styleClass="form-card">
            <ng-template pTemplate="header">
              <div class="card-header">
                <i class="pi pi-user-plus"></i>
                <h2>Candidature Whitelist</h2>
              </div>
            </ng-template>

            <p-steps [model]="steps" [activeIndex]="activeStep()" [readonly]="true" styleClass="mb-4"></p-steps>

            <div class="step-content">
              @switch (activeStep()) {
                @case (0) {
                  <!-- Step 1: Character Info -->
                  <div class="form-step">
                    <h3>Informations du personnage</h3>
                    <p class="step-description">Décrivez le personnage que vous souhaitez incarner à Poudlard.</p>

                    <div class="form-grid">
                      <div class="form-field">
                        <label for="firstName">Prénom du personnage *</label>
                        <input pInputText id="firstName" [(ngModel)]="form.character_first_name" placeholder="Ex: Hermione" />
                      </div>
                      <div class="form-field">
                        <label for="lastName">Nom de famille *</label>
                        <input pInputText id="lastName" [(ngModel)]="form.character_last_name" placeholder="Ex: Granger" />
                      </div>
                      <div class="form-field">
                        <label for="age">Âge (11-17 ans) *</label>
                        <p-inputNumber id="age" [(ngModel)]="form.character_age" [min]="11" [max]="17" [showButtons]="true"></p-inputNumber>
                      </div>
                      <div class="form-field">
                        <label for="blood">Statut de sang *</label>
                        <p-dropdown
                          id="blood"
                          [(ngModel)]="form.character_blood"
                          [options]="bloodOptions"
                          placeholder="Sélectionnez..."
                          styleClass="w-full"
                        ></p-dropdown>
                      </div>
                    </div>
                  </div>
                }
                @case (1) {
                  <!-- Step 2: Character History -->
                  <div class="form-step">
                    <h3>Histoire du personnage</h3>
                    <p class="step-description">Racontez-nous l'histoire de votre personnage avant son arrivée à Poudlard. Minimum 100 caractères.</p>

                    <div class="form-field">
                      <label for="history">Background *</label>
                      <textarea
                        pInputTextarea
                        id="history"
                        [(ngModel)]="form.character_history"
                        rows="10"
                        placeholder="Décrivez l'enfance de votre personnage, sa famille, ses expériences avec la magie avant Poudlard..."
                      ></textarea>
                      <small [class.error]="form.character_history.length < 100">
                        {{ form.character_history.length }} / 100 caractères minimum
                      </small>
                    </div>
                  </div>
                }
                @case (2) {
                  <!-- Step 3: Motivation -->
                  <div class="form-step">
                    <h3>Motivation</h3>
                    <p class="step-description">Expliquez pourquoi votre personnage souhaite étudier à Poudlard et quels sont ses objectifs.</p>

                    <div class="form-field">
                      <label for="motivation">Motivation</label>
                      <textarea
                        pInputTextarea
                        id="motivation"
                        [(ngModel)]="form.character_motivation"
                        rows="6"
                        placeholder="Quels sont les rêves et ambitions de votre personnage ?"
                      ></textarea>
                    </div>

                    <div class="summary-preview">
                      <h4>Récapitulatif</h4>
                      <ul>
                        <li><strong>Personnage :</strong> {{ form.character_first_name }} {{ form.character_last_name }}</li>
                        <li><strong>Âge :</strong> {{ form.character_age }} ans</li>
                        <li><strong>Sang :</strong> {{ getBloodLabel(form.character_blood) }}</li>
                        <li><strong>Histoire :</strong> {{ form.character_history.length }} caractères</li>
                      </ul>
                    </div>
                  </div>
                }
              }
            </div>

            <div class="form-actions">
              @if (activeStep() > 0) {
                <p-button label="Précédent" icon="pi pi-arrow-left" styleClass="p-button-outlined" (click)="previousStep()"></p-button>
              }
              @if (activeStep() < 2) {
                <p-button label="Suivant" icon="pi pi-arrow-right" iconPos="right" (click)="nextStep()" [disabled]="!canProceed()"></p-button>
              } @else {
                <p-button label="Soumettre ma candidature" icon="pi pi-send" iconPos="right" (click)="submit()" [disabled]="!canSubmit()" [loading]="submitting()"></p-button>
              }
            </div>
          </p-card>
        </div>
      }
    </div>
  `,
  styles: [`
    .whitelist-container {
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
    }

    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 300px;

      p {
        margin-top: 1rem;
        color: var(--text-color-secondary);
      }
    }

    .card-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1.5rem;
      background: linear-gradient(135deg, var(--primary-color), var(--primary-700));
      color: white;

      i {
        font-size: 2rem;
      }

      h2 {
        margin: 0;
      }
    }

    /* Status View */
    .status-content {
      padding: 1rem 0;
    }

    .status-badge {
      text-align: center;
      margin-bottom: 2rem;
    }

    :host ::ng-deep .large-tag {
      font-size: 1.2rem;
      padding: 0.75rem 1.5rem;
    }

    .status-message {
      padding: 1.5rem;
      border-radius: 8px;
      margin-bottom: 2rem;

      i {
        font-size: 2rem;
        margin-bottom: 1rem;
        display: block;
        text-align: center;
      }

      p {
        text-align: center;
        margin: 0;
      }

      &.pending {
        background: rgba(234, 179, 8, 0.1);
        border-left: 4px solid var(--yellow-500);

        i { color: var(--yellow-500); }
      }

      &.approved {
        background: rgba(34, 197, 94, 0.1);
        border-left: 4px solid var(--green-500);

        i { color: var(--green-500); }
      }

      &.rejected {
        background: rgba(239, 68, 68, 0.1);
        border-left: 4px solid var(--red-500);

        i { color: var(--red-500); }
      }
    }

    .rejection-reason {
      background: rgba(0, 0, 0, 0.2);
      padding: 1rem;
      border-radius: 6px;
      margin: 1rem 0;
      text-align: left;
    }

    .reviewer {
      font-size: 0.875rem;
      color: var(--text-color-secondary);
      margin-top: 1rem;
    }

    .cooldown {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      margin-top: 1rem;
      padding: 1rem;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 6px;

      i {
        font-size: 1rem;
        margin: 0;
      }

      p {
        margin: 0;
      }
    }

    .application-summary {
      h3 {
        color: var(--primary-color);
        margin-bottom: 1rem;
      }
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;
    }

    .summary-item {
      label {
        display: block;
        font-size: 0.875rem;
        color: var(--text-color-secondary);
        margin-bottom: 0.25rem;
      }

      span {
        font-weight: 500;
      }
    }

    /* Form View */
    .form-step {
      h3 {
        color: var(--primary-color);
        margin-bottom: 0.5rem;
      }

      .step-description {
        color: var(--text-color-secondary);
        margin-bottom: 1.5rem;
      }
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;
    }

    .form-field {
      margin-bottom: 1rem;

      label {
        display: block;
        margin-bottom: 0.5rem;
        font-weight: 500;
      }

      input, textarea, :host ::ng-deep .p-dropdown, :host ::ng-deep .p-inputnumber {
        width: 100%;
      }

      small {
        display: block;
        margin-top: 0.25rem;
        color: var(--text-color-secondary);

        &.error {
          color: var(--red-500);
        }
      }
    }

    .summary-preview {
      background: var(--surface-ground);
      padding: 1rem;
      border-radius: 6px;
      margin-top: 1rem;

      h4 {
        margin-bottom: 0.5rem;
        color: var(--primary-color);
      }

      ul {
        list-style: none;
        padding: 0;
        margin: 0;

        li {
          padding: 0.25rem 0;
        }
      }
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: 1rem;
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid var(--surface-border);
    }

    :host ::ng-deep .mb-4 {
      margin-bottom: 2rem;
    }
  `]
})
export class WhitelistApplicationComponent implements OnInit {
  whitelistService = inject(WhitelistService);
  private authService = inject(AuthService);
  private messageService = inject(MessageService);
  private router = inject(Router);

  loading = signal(true);
  submitting = signal(false);
  status = signal<WhitelistStatusResponse | null>(null);
  activeStep = signal(0);

  steps: MenuItem[] = [
    { label: 'Personnage' },
    { label: 'Histoire' },
    { label: 'Motivation' }
  ];

  bloodOptions = this.whitelistService.getBloodOptions();

  form = {
    character_first_name: '',
    character_last_name: '',
    character_age: 11,
    character_blood: '',
    character_history: '',
    character_motivation: ''
  };

  ngOnInit() {
    this.loadStatus();
  }

  loadStatus() {
    this.loading.set(true);
    this.whitelistService.getStatus().subscribe({
      next: (response) => {
        this.status.set(response);
        this.loading.set(false);
      },
      error: (error) => {
        console.error('Failed to load whitelist status:', error);
        this.loading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de charger le statut de votre candidature.'
        });
      }
    });
  }

  canProceed(): boolean {
    switch (this.activeStep()) {
      case 0:
        return !!this.form.character_first_name &&
               !!this.form.character_last_name &&
               this.form.character_age >= 11 &&
               this.form.character_age <= 17 &&
               !!this.form.character_blood;
      case 1:
        return this.form.character_history.length >= 100;
      default:
        return true;
    }
  }

  canSubmit(): boolean {
    return this.canProceed() && this.form.character_history.length >= 100;
  }

  nextStep() {
    if (this.canProceed() && this.activeStep() < 2) {
      this.activeStep.set(this.activeStep() + 1);
    }
  }

  previousStep() {
    if (this.activeStep() > 0) {
      this.activeStep.set(this.activeStep() - 1);
    }
  }

  submit() {
    if (!this.canSubmit()) return;

    this.submitting.set(true);
    this.whitelistService.submitApplication(this.form).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.messageService.add({
          severity: 'success',
          summary: 'Candidature soumise',
          detail: response.message
        });
        this.loadStatus();
      },
      error: (error) => {
        this.submitting.set(false);
        const message = error.error?.message || 'Impossible de soumettre votre candidature.';
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: message
        });
      }
    });
  }

  getBloodLabel(blood: string): string {
    return this.whitelistService.getBloodLabel(blood);
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
