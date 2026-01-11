import { Component, OnInit, inject, signal, computed } from '@angular/core';
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
import { CalendarModule } from 'primeng/calendar';
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
    ProgressSpinnerModule,
    CalendarModule
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
      } @else if (status()?.can_select_oral_slot) {
        <!-- Show Oral Slot Selection (Step 3) -->
        <div class="application-form">
          <p-card styleClass="form-card">
            <ng-template pTemplate="header">
              <div class="card-header">
                <i class="pi pi-calendar"></i>
                <h2>Candidature Orale</h2>
              </div>
            </ng-template>

            <div class="oral-intro">
              <div class="success-badge">
                <i class="pi pi-check-circle"></i>
                <span>Votre candidature HRP a été approuvée !</span>
              </div>
              <p>Félicitations <strong>{{ status()!.application!.hrp_first_name }}</strong> ! Vous passez maintenant à la dernière étape : l'entretien oral.</p>
              <p>Les Douaniers vous ont proposé une semaine pour passer votre oral. Choisissez un jour et une heure qui vous conviennent.</p>
            </div>

            <div class="proposed-week">
              <h3>Semaine proposée</h3>
              <div class="week-range">
                <span class="date-badge">
                  <i class="pi pi-calendar"></i>
                  Du {{ formatDateShort(status()!.application!.oral_proposed_week_start!) }}
                  au {{ formatDateShort(status()!.application!.oral_proposed_week_end!) }}
                </span>
              </div>
            </div>

            <div class="form-step">
              <h3>Choisissez votre créneau</h3>

              <div class="form-field">
                <label for="oralSlot">Date et heure de votre oral *</label>
                <p-calendar
                  id="oralSlot"
                  [(ngModel)]="selectedOralSlot"
                  [showTime]="true"
                  [minDate]="oralMinDate()"
                  [maxDate]="oralMaxDate()"
                  [hourFormat]="'24'"
                  [stepMinute]="15"
                  dateFormat="dd/mm/yy"
                  placeholder="Sélectionnez une date et heure"
                  appendTo="body"
                  [showIcon]="true"
                  [readonlyInput]="false"
                  styleClass="oral-slot-calendar"
                ></p-calendar>
              </div>

              <div class="oral-info">
                <i class="pi pi-info-circle"></i>
                <div>
                  <p><strong>Comment se déroule l'oral ?</strong></p>
                  <ul>
                    <li>Vous serez invité sur le serveur Discord <strong>Elderwood Douane</strong></li>
                    <li>Vous recevrez le rôle "En attente d'oral"</li>
                    <li>L'entretien porte sur le règlement et votre personnage</li>
                    <li>Durée estimée : 15-30 minutes</li>
                  </ul>
                </div>
              </div>
            </div>

            <div class="form-actions">
              <p-button
                label="Confirmer mon créneau"
                icon="pi pi-check"
                iconPos="right"
                (click)="submitOralSlot()"
                [disabled]="!selectedOralSlot"
                [loading]="submitting()"
              ></p-button>
            </div>
          </p-card>
        </div>
      } @else if (status()?.can_submit_hrp) {
        <!-- Show HRP form (Step 2) -->
        <div class="application-form">
          <p-card styleClass="form-card">
            <ng-template pTemplate="header">
              <div class="card-header">
                <i class="pi pi-user"></i>
                <h2>Candidature Hors-RP</h2>
              </div>
            </ng-template>

            <div class="hrp-intro">
              <div class="success-badge">
                <i class="pi pi-check-circle"></i>
                <span>Votre candidature RP a été approuvée !</span>
              </div>
              <p>Félicitations ! Votre personnage <strong>{{ status()!.application!.character_first_name }} {{ status()!.application!.character_last_name }}</strong> a été validé.</p>
              <p>Nous avons maintenant besoin d'en savoir un peu plus sur vous, le joueur, pour nous assurer que vous êtes prêt(e) à rejoindre notre communauté.</p>
            </div>

            <div class="form-step">
              <h3>À propos de vous</h3>

              <div class="form-grid">
                <div class="form-field">
                  <label for="hrpFirstName">Votre prénom *</label>
                  <input pInputText id="hrpFirstName" [(ngModel)]="hrpForm.hrp_first_name" placeholder="Votre vrai prénom" />
                </div>
                <div class="form-field">
                  <label for="hrpAge">Votre âge *</label>
                  <p-inputNumber id="hrpAge" [(ngModel)]="hrpForm.hrp_age" [min]="13" [max]="99" [showButtons]="true"></p-inputNumber>
                </div>
              </div>

              <div class="form-field">
                <label for="hrpExpYears">Années d'expérience en RP *</label>
                <p-inputNumber id="hrpExpYears" [(ngModel)]="hrpForm.hrp_experience_years" [min]="0" [max]="30" [showButtons]="true" suffix=" ans"></p-inputNumber>
              </div>

              <div class="form-field">
                <label for="hrpExpText">Décrivez votre expérience RP *</label>
                <textarea
                  pInputTextarea
                  id="hrpExpText"
                  [(ngModel)]="hrpForm.hrp_experience_text"
                  rows="5"
                  placeholder="Sur quels serveurs avez-vous joué ? Quels types de personnages avez-vous incarnés ? Qu'est-ce qui vous plaît dans le RP ?"
                ></textarea>
                <small [class.error]="hrpForm.hrp_experience_text.length < 50">
                  {{ hrpForm.hrp_experience_text.length }} / 50 caractères minimum
                </small>
              </div>

              <div class="form-field">
                <label for="hrpHPKnowledge">Vos connaissances de l'univers Harry Potter *</label>
                <textarea
                  pInputTextarea
                  id="hrpHPKnowledge"
                  [(ngModel)]="hrpForm.hrp_hp_knowledge"
                  rows="5"
                  placeholder="Avez-vous lu les livres ? Vu les films ? Quels sont vos personnages ou moments préférés ? Connaissez-vous le lore étendu ?"
                ></textarea>
                <small [class.error]="hrpForm.hrp_hp_knowledge.length < 50">
                  {{ hrpForm.hrp_hp_knowledge.length }} / 50 caractères minimum
                </small>
              </div>
            </div>

            <div class="form-actions">
              <p-button
                label="Soumettre ma candidature HRP"
                icon="pi pi-send"
                iconPos="right"
                (click)="submitHRP()"
                [disabled]="!canSubmitHRP()"
                [loading]="submitting()"
              ></p-button>
            </div>
          </p-card>
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
                    <p>Votre candidature RP est en cours d'examen par nos Douaniers. Vous serez notifié dès qu'une décision sera prise.</p>
                  </div>
                }
                @case ('hrp_pending') {
                  <div class="status-message pending">
                    <i class="pi pi-clock"></i>
                    <p>Votre candidature Hors-RP est en cours d'examen par nos Douaniers. Vous serez notifié dès qu'une décision sera prise.</p>
                  </div>
                }
                @case ('hrp_approved') {
                  <div class="status-message info">
                    <i class="pi pi-clock"></i>
                    <p>Votre candidature HRP a été approuvée ! En attente de proposition de semaine pour l'oral par les Douaniers.</p>
                  </div>
                }
                @case ('oral_scheduled') {
                  <div class="status-message scheduled">
                    <i class="pi pi-calendar-check"></i>
                    <p>Votre oral est programmé le <strong>{{ formatDate(status()!.application!.oral_selected_slot!) }}</strong></p>
                    <p>Vous serez invité sur le Discord <strong>Elderwood Douane</strong> pour passer votre entretien.</p>
                    @if (status()!.application!.oral_discord_invite_sent) {
                      <div class="invite-sent">
                        <i class="pi pi-check"></i>
                        <span>Invitation Discord envoyée</span>
                      </div>
                    }
                  </div>
                }
                @case ('approved') {
                  <div class="status-message approved">
                    <i class="pi pi-check-circle"></i>
                    <p>Félicitations ! Votre candidature a été entièrement approuvée. Vous pouvez maintenant accéder au jeu.</p>
                    <p class="reviewer">Approuvée par {{ status()!.application!.reviewed_by }} le {{ formatDate(status()!.application!.reviewed_at!) }}</p>
                  </div>
                }
                @case ('rejected') {
                  <div class="status-message rejected">
                    <i class="pi pi-times-circle"></i>
                    <p>Votre candidature a été refusée à l'étape {{ getRejectedStepLabel(status()!.application!.rejected_step) }}.</p>
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
                <h3>Résumé de votre candidature RP</h3>
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

              @if (status()!.application!.hrp_first_name) {
                <div class="application-summary">
                  <h3>Résumé de votre candidature HRP</h3>
                  <div class="summary-grid">
                    <div class="summary-item">
                      <label>Prénom</label>
                      <span>{{ status()!.application!.hrp_first_name }}</span>
                    </div>
                    <div class="summary-item">
                      <label>Âge</label>
                      <span>{{ status()!.application!.hrp_age }} ans</span>
                    </div>
                    <div class="summary-item">
                      <label>Expérience RP</label>
                      <span>{{ status()!.application!.hrp_experience_years }} ans</span>
                    </div>
                  </div>
                </div>
              }

              @if (status()!.application!.oral_selected_slot) {
                <div class="application-summary">
                  <h3>Résumé de votre candidature Orale</h3>
                  <div class="summary-grid">
                    <div class="summary-item">
                      <label>Créneau choisi</label>
                      <span>{{ formatDate(status()!.application!.oral_selected_slot!) }}</span>
                    </div>
                    <div class="summary-item">
                      <label>Invitation Discord</label>
                      <span>{{ status()!.application!.oral_discord_invite_sent ? 'Envoyée' : 'En attente' }}</span>
                    </div>
                  </div>
                </div>
              }
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
      animation: fadeIn 0.3s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 300px;
    }

    .loading-container p {
      margin-top: 1rem;
      color: rgba(255, 255, 255, 0.6);
    }

    /* Card styling */
    :host ::ng-deep .p-card {
      background: var(--elderwood-surface);
      border: none;
      border-radius: 12px;
      overflow: hidden;
    }

    :host ::ng-deep .p-card .p-card-header {
      padding: 0;
    }

    :host ::ng-deep .p-card .p-card-body {
      padding: 2rem;
    }

    :host ::ng-deep .p-card .p-card-content {
      padding: 0;
    }

    .card-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1.5rem 2rem;
      background: linear-gradient(135deg, var(--elderwood-primary), var(--elderwood-gold));
      color: #0c0c0c;
    }

    .card-header i {
      font-size: 2rem;
    }

    .card-header h2 {
      margin: 0;
      font-size: 1.5rem;
    }

    /* Steps styling - Elderwood theme */
    :host ::ng-deep .p-steps {
      background: transparent;
    }

    :host ::ng-deep .p-steps .p-steps-item .p-menuitem-link {
      background: transparent;
    }

    :host ::ng-deep .p-steps .p-steps-item .p-steps-number {
      background: #292a2c;
      color: rgba(255, 255, 255, 0.5);
      border: 2px solid #3a3b3d;
    }

    :host ::ng-deep .p-steps .p-steps-item.p-highlight .p-steps-number {
      background: var(--elderwood-primary);
      color: #0c0c0c;
      border-color: var(--elderwood-primary);
    }

    :host ::ng-deep .p-steps .p-steps-item .p-steps-title {
      color: rgba(255, 255, 255, 0.5);
    }

    :host ::ng-deep .p-steps .p-steps-item.p-highlight .p-steps-title {
      color: var(--elderwood-primary);
    }

    :host ::ng-deep .p-steps .p-steps-item:before {
      border-top-color: #3a3b3d;
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
    }

    .status-message i {
      font-size: 2rem;
      margin-bottom: 1rem;
      display: block;
      text-align: center;
    }

    .status-message p {
      text-align: center;
      margin: 0;
    }

    .status-message.pending {
      background: rgba(234, 179, 8, 0.1);
      border-left: 4px solid #f59e0b;
    }

    .status-message.pending i {
      color: #f59e0b;
    }

    .status-message.approved {
      background: rgba(34, 197, 94, 0.1);
      border-left: 4px solid #22c55e;
    }

    .status-message.approved i {
      color: #22c55e;
    }

    .status-message.rejected {
      background: rgba(239, 68, 68, 0.1);
      border-left: 4px solid #ef4444;
    }

    .status-message.rejected i {
      color: #ef4444;
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
      color: rgba(255, 255, 255, 0.5);
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
    }

    .cooldown i {
      font-size: 1rem;
      margin: 0;
    }

    .cooldown p {
      margin: 0;
    }

    .application-summary h3 {
      color: var(--elderwood-primary);
      margin-bottom: 1rem;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;
    }

    .summary-item label {
      display: block;
      font-size: 0.875rem;
      color: rgba(255, 255, 255, 0.5);
      margin-bottom: 0.25rem;
    }

    .summary-item span {
      font-weight: 500;
      color: white;
    }

    /* Form View */
    .step-content {
      padding: 0.5rem 0;
    }

    .form-step h3 {
      color: var(--elderwood-primary);
      margin-bottom: 0.5rem;
      font-size: 1.25rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .step-description {
      color: rgba(255, 255, 255, 0.6);
      margin-bottom: 2rem;
      font-size: 0.95rem;
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1.5rem;
    }

    .form-field {
      margin-bottom: 1.5rem;
    }

    .form-field label {
      display: block;
      margin-bottom: 0.5rem;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.9);
      font-size: 0.9rem;
    }

    /* Input text styling */
    :host ::ng-deep .form-field .p-inputtext {
      width: 100%;
      background: #151719;
      border: 2px solid #2a2d30;
      border-radius: 10px;
      color: white;
      padding: 0.875rem 1rem;
      font-size: 0.95rem;
      transition: all 0.2s ease;
    }

    :host ::ng-deep .form-field .p-inputtext:hover {
      border-color: #3a3d40;
    }

    :host ::ng-deep .form-field .p-inputtext:focus {
      border-color: var(--elderwood-primary);
      box-shadow: 0 0 0 3px rgba(201, 162, 39, 0.15);
      outline: none;
    }

    :host ::ng-deep .form-field .p-inputtext::placeholder {
      color: rgba(255, 255, 255, 0.35);
    }

    /* Textarea styling */
    :host ::ng-deep .form-field textarea.p-inputtextarea {
      width: 100%;
      background: #151719;
      border: 2px solid #2a2d30;
      border-radius: 10px;
      color: white;
      padding: 0.875rem 1rem;
      font-size: 0.95rem;
      resize: vertical;
      min-height: 120px;
      transition: all 0.2s ease;
    }

    :host ::ng-deep .form-field textarea.p-inputtextarea:hover {
      border-color: #3a3d40;
    }

    :host ::ng-deep .form-field textarea.p-inputtextarea:focus {
      border-color: var(--elderwood-primary);
      box-shadow: 0 0 0 3px rgba(201, 162, 39, 0.15);
      outline: none;
    }

    /* Dropdown styling */
    :host ::ng-deep .form-field .p-dropdown {
      width: 100%;
      background: #151719;
      border: 2px solid #2a2d30;
      border-radius: 10px;
      transition: all 0.2s ease;
    }

    :host ::ng-deep .form-field .p-dropdown:hover {
      border-color: #3a3d40;
    }

    :host ::ng-deep .form-field .p-dropdown.p-focus {
      border-color: var(--elderwood-primary);
      box-shadow: 0 0 0 3px rgba(201, 162, 39, 0.15);
    }

    :host ::ng-deep .form-field .p-dropdown .p-dropdown-label {
      background: transparent;
      color: white;
      padding: 0.875rem 1rem;
      font-size: 0.95rem;
    }

    :host ::ng-deep .form-field .p-dropdown .p-dropdown-label.p-placeholder {
      color: rgba(255, 255, 255, 0.35);
    }

    :host ::ng-deep .form-field .p-dropdown .p-dropdown-trigger {
      background: transparent;
      color: rgba(255, 255, 255, 0.5);
      width: 3rem;
    }

    /* InputNumber styling */
    :host ::ng-deep .form-field .p-inputnumber {
      width: 100%;
    }

    :host ::ng-deep .form-field .p-inputnumber .p-inputtext {
      background: #151719;
      border: 2px solid #2a2d30;
      border-radius: 10px 0 0 10px;
      color: white;
      padding: 0.875rem 1rem;
      font-size: 0.95rem;
    }

    :host ::ng-deep .form-field .p-inputnumber .p-inputtext:focus {
      border-color: var(--elderwood-primary);
      box-shadow: 0 0 0 3px rgba(201, 162, 39, 0.15);
    }

    :host ::ng-deep .form-field .p-inputnumber .p-button {
      background: #232527;
      border: 2px solid #2a2d30;
      color: white;
      width: 2.5rem;
    }

    :host ::ng-deep .form-field .p-inputnumber .p-button:hover {
      background: #2a2d30;
      border-color: #3a3d40;
    }

    :host ::ng-deep .form-field .p-inputnumber .p-button.p-inputnumber-button-up {
      border-radius: 0 10px 0 0;
      border-left: none;
    }

    :host ::ng-deep .form-field .p-inputnumber .p-button.p-inputnumber-button-down {
      border-radius: 0 0 10px 0;
      border-left: none;
      border-top: none;
    }

    .form-field small {
      display: block;
      margin-top: 0.5rem;
      color: rgba(255, 255, 255, 0.5);
      font-size: 0.8rem;
    }

    .form-field small.error {
      color: #ef4444;
    }

    .summary-preview {
      background: rgba(0, 0, 0, 0.3);
      padding: 1rem;
      border-radius: 6px;
      margin-top: 1rem;
    }

    .summary-preview h4 {
      margin-bottom: 0.5rem;
      color: var(--elderwood-primary);
    }

    .summary-preview ul {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .summary-preview li {
      padding: 0.25rem 0;
      color: rgba(255, 255, 255, 0.8);
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: 1rem;
      margin-top: 2rem;
      padding-top: 1.5rem;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
    }

    /* Button styling */
    :host ::ng-deep .form-actions .p-button {
      padding: 0.875rem 1.5rem;
      border-radius: 10px;
      font-weight: 600;
      font-size: 0.95rem;
      transition: all 0.2s ease;
    }

    :host ::ng-deep .form-actions .p-button:not(.p-button-outlined) {
      background: linear-gradient(135deg, var(--elderwood-primary), var(--elderwood-gold));
      border: none;
      color: #0c0c0c;
    }

    :host ::ng-deep .form-actions .p-button:not(.p-button-outlined):hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(201, 162, 39, 0.3);
    }

    :host ::ng-deep .form-actions .p-button.p-button-outlined {
      background: transparent;
      border: 2px solid #3a3d40;
      color: rgba(255, 255, 255, 0.8);
    }

    :host ::ng-deep .form-actions .p-button.p-button-outlined:hover {
      background: rgba(255, 255, 255, 0.05);
      border-color: #4a4d50;
      color: white;
    }

    :host ::ng-deep .form-actions .p-button .p-button-icon {
      font-size: 0.9rem;
    }

    :host ::ng-deep .mb-4 {
      margin-bottom: 2rem;
    }

    /* Tag styling */
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

    :host ::ng-deep .p-tag.p-tag-info {
      background: rgba(59, 130, 246, 0.2);
      color: #3b82f6;
    }

    /* HRP Intro Styling */
    .hrp-intro {
      background: rgba(34, 197, 94, 0.1);
      border: 1px solid rgba(34, 197, 94, 0.3);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 2rem;
    }

    .hrp-intro p {
      margin: 0.5rem 0 0 0;
      color: rgba(255, 255, 255, 0.8);
      line-height: 1.6;
    }

    .success-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(34, 197, 94, 0.2);
      color: #22c55e;
      padding: 0.5rem 1rem;
      border-radius: 20px;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }

    .success-badge i {
      font-size: 1.1rem;
    }

    /* Oral Section Styles */
    .oral-intro {
      background: rgba(59, 130, 246, 0.1);
      border: 1px solid rgba(59, 130, 246, 0.3);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 2rem;
    }

    .oral-intro p {
      margin: 0.5rem 0 0 0;
      color: rgba(255, 255, 255, 0.8);
      line-height: 1.6;
    }

    .proposed-week {
      background: rgba(201, 162, 39, 0.1);
      border: 1px solid rgba(201, 162, 39, 0.3);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 2rem;
    }

    .proposed-week h3 {
      margin: 0 0 1rem 0;
      color: var(--elderwood-primary);
    }

    .week-range {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .date-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(201, 162, 39, 0.2);
      color: var(--elderwood-primary);
      padding: 0.75rem 1.25rem;
      border-radius: 8px;
      font-weight: 600;
    }

    .oral-info {
      display: flex;
      gap: 1rem;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 12px;
      padding: 1.5rem;
      margin-top: 1.5rem;
    }

    .oral-info > i {
      font-size: 1.5rem;
      color: var(--elderwood-primary);
    }

    .oral-info p {
      margin: 0 0 0.5rem 0;
    }

    .oral-info ul {
      margin: 0;
      padding-left: 1.25rem;
    }

    .oral-info li {
      margin: 0.25rem 0;
      color: rgba(255, 255, 255, 0.7);
    }

    /* Status message - info */
    .status-message.info {
      background: rgba(59, 130, 246, 0.1);
      border-left: 4px solid #3b82f6;
    }

    .status-message.info i {
      color: #3b82f6;
    }

    /* Status message - scheduled */
    .status-message.scheduled {
      background: rgba(139, 92, 246, 0.1);
      border-left: 4px solid #8b5cf6;
    }

    .status-message.scheduled i {
      color: #8b5cf6;
    }

    .invite-sent {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(34, 197, 94, 0.2);
      color: #22c55e;
      padding: 0.5rem 1rem;
      border-radius: 20px;
      font-weight: 600;
      margin-top: 1rem;
    }

    .invite-sent i {
      font-size: 1rem !important;
      margin: 0 !important;
      color: inherit !important;
    }

    /* Calendar styling */
    :host ::ng-deep .p-calendar {
      width: 100%;
    }

    :host ::ng-deep .p-calendar .p-inputtext {
      width: 100%;
      background: #151719;
      border: 2px solid #2a2d30;
      border-radius: 10px;
      color: white;
      padding: 0.875rem 1rem;
      font-size: 0.95rem;
    }

    :host ::ng-deep .p-calendar .p-inputtext:focus {
      border-color: var(--elderwood-primary);
      box-shadow: 0 0 0 3px rgba(201, 162, 39, 0.15);
    }

    :host ::ng-deep .p-datepicker {
      background: var(--elderwood-surface);
      border: 1px solid #3a3d40;
      border-radius: 10px;
    }

    :host ::ng-deep .p-datepicker .p-datepicker-header {
      background: transparent;
      border-bottom: 1px solid #3a3d40;
    }

    :host ::ng-deep .p-datepicker table td > span {
      color: white;
    }

    :host ::ng-deep .p-datepicker table td.p-datepicker-today > span {
      background: rgba(201, 162, 39, 0.2);
      color: var(--elderwood-primary);
    }

    :host ::ng-deep .p-datepicker table td > span.p-highlight {
      background: var(--elderwood-primary);
      color: #0c0c0c;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .form-grid {
        grid-template-columns: 1fr;
      }

      .summary-grid {
        grid-template-columns: 1fr;
      }

      .oral-info {
        flex-direction: column;
      }
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

  hrpForm = {
    hrp_first_name: '',
    hrp_age: 18,
    hrp_experience_years: 0,
    hrp_experience_text: '',
    hrp_hp_knowledge: ''
  };

  selectedOralSlot: Date | null = null;

  // Computed signals for oral date range (prevents creating new Date objects on each render)
  oralMinDate = computed(() => {
    const app = this.status()?.application;
    if (app?.oral_proposed_week_start) {
      return new Date(app.oral_proposed_week_start);
    }
    return new Date();
  });

  oralMaxDate = computed(() => {
    const app = this.status()?.application;
    if (app?.oral_proposed_week_end) {
      const date = new Date(app.oral_proposed_week_end);
      date.setHours(23, 59, 59);
      return date;
    }
    return new Date();
  });

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
          summary: 'Candidature RP soumise',
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

  canSubmitHRP(): boolean {
    return !!this.hrpForm.hrp_first_name &&
           this.hrpForm.hrp_age >= 13 &&
           this.hrpForm.hrp_experience_text.length >= 50 &&
           this.hrpForm.hrp_hp_knowledge.length >= 50;
  }

  submitHRP() {
    if (!this.canSubmitHRP()) return;

    this.submitting.set(true);
    this.whitelistService.submitHRPApplication(this.hrpForm).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.messageService.add({
          severity: 'success',
          summary: 'Candidature HRP soumise',
          detail: response.message
        });
        this.loadStatus();
      },
      error: (error) => {
        this.submitting.set(false);
        const message = error.error?.message || 'Impossible de soumettre votre candidature HRP.';
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

  formatDateShort(dateString: string): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  submitOralSlot() {
    if (!this.selectedOralSlot) return;

    // Format date as YYYY-MM-DDTHH:MM
    const year = this.selectedOralSlot.getFullYear();
    const month = String(this.selectedOralSlot.getMonth() + 1).padStart(2, '0');
    const day = String(this.selectedOralSlot.getDate()).padStart(2, '0');
    const hours = String(this.selectedOralSlot.getHours()).padStart(2, '0');
    const minutes = String(this.selectedOralSlot.getMinutes()).padStart(2, '0');
    const formattedSlot = `${year}-${month}-${day}T${hours}:${minutes}`;

    this.submitting.set(true);
    this.whitelistService.selectOralSlot(formattedSlot).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.messageService.add({
          severity: 'success',
          summary: 'Créneau confirmé',
          detail: response.message
        });
        this.loadStatus();
      },
      error: (error) => {
        this.submitting.set(false);
        const message = error.error?.message || 'Impossible de confirmer le créneau.';
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: message
        });
      }
    });
  }

  getRejectedStepLabel(step?: string): string {
    switch (step) {
      case 'rp':
        return 'RP';
      case 'hrp':
        return 'Hors-RP';
      case 'oral':
        return 'Oral';
      default:
        return step || '';
    }
  }
}
