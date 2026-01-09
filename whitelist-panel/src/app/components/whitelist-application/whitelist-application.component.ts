import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { StepsModule } from 'primeng/steps';
import { MessagesModule } from 'primeng/messages';
import { Message, MenuItem } from 'primeng/api';

import { AuthService } from '../../services/auth.service';

interface WhitelistForm {
  characterName: string;
  characterAge: number | null;
  bloodStatus: string;
  housePreference: string;
  backstory: string;
  roleplayExperience: string;
  whyJoin: string;
}

@Component({
  selector: 'app-whitelist-application',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    ButtonModule,
    InputTextModule,
    InputTextareaModule,
    DropdownModule,
    InputNumberModule,
    StepsModule,
    MessagesModule
  ],
  template: `
    <div class="application-container">
      <div class="application-header">
        <a routerLink="/dashboard" class="back-btn">
          <i class="pi pi-arrow-left"></i>
          <span>Retour au dashboard</span>
        </a>
        <h1>Candidature Whitelist</h1>
        <p>Remplissez le formulaire pour rejoindre Elderwood</p>
      </div>

      <div class="steps-container">
        <p-steps [model]="steps" [activeIndex]="currentStep()" [readonly]="true"></p-steps>
      </div>

      <p-messages [value]="messages()" [closable]="false"></p-messages>

      <div class="form-container">
        <!-- Step 1: Character Info -->
        @if (currentStep() === 0) {
          <div class="form-step" [@fadeIn]>
            <h2>Informations du personnage</h2>
            <p class="step-description">Decrivez votre futur personnage dans l'univers d'Elderwood.</p>

            <div class="form-group">
              <label for="characterName">Nom du personnage *</label>
              <input
                id="characterName"
                type="text"
                pInputText
                [(ngModel)]="form.characterName"
                placeholder="Ex: Artemis Black"
                class="w-full"
              />
              <small>Prenom et nom de famille (style Harry Potter)</small>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="characterAge">Age du personnage *</label>
                <p-inputNumber
                  id="characterAge"
                  [(ngModel)]="form.characterAge"
                  [min]="11"
                  [max]="80"
                  placeholder="17"
                  styleClass="w-full"
                ></p-inputNumber>
                <small>Entre 11 et 80 ans</small>
              </div>

              <div class="form-group">
                <label for="bloodStatus">Statut du sang *</label>
                <p-dropdown
                  id="bloodStatus"
                  [(ngModel)]="form.bloodStatus"
                  [options]="bloodStatusOptions"
                  placeholder="Selectionnez..."
                  styleClass="w-full"
                ></p-dropdown>
              </div>
            </div>

            <div class="form-group">
              <label for="housePreference">Maison preferee</label>
              <p-dropdown
                id="housePreference"
                [(ngModel)]="form.housePreference"
                [options]="houseOptions"
                placeholder="Selectionnez une maison (optionnel)"
                styleClass="w-full"
              ></p-dropdown>
              <small>Ceci n'est qu'une preference, le Choixpeau decidera</small>
            </div>

            <div class="form-actions">
              <button pButton label="Suivant" icon="pi pi-arrow-right" iconPos="right" (click)="nextStep()" [disabled]="!isStep1Valid()"></button>
            </div>
          </div>
        }

        <!-- Step 2: Backstory -->
        @if (currentStep() === 1) {
          <div class="form-step">
            <h2>Histoire du personnage</h2>
            <p class="step-description">Racontez-nous l'histoire de votre personnage.</p>

            <div class="form-group">
              <label for="backstory">Backstory du personnage *</label>
              <textarea
                id="backstory"
                pInputTextarea
                [(ngModel)]="form.backstory"
                [rows]="8"
                placeholder="Decrivez l'enfance, la famille, les evenements marquants de votre personnage..."
                class="w-full"
              ></textarea>
              <small>Minimum 200 caracteres - {{ form.backstory.length }}/200</small>
            </div>

            <div class="form-actions">
              <button pButton label="Precedent" icon="pi pi-arrow-left" severity="secondary" (click)="prevStep()"></button>
              <button pButton label="Suivant" icon="pi pi-arrow-right" iconPos="right" (click)="nextStep()" [disabled]="!isStep2Valid()"></button>
            </div>
          </div>
        }

        <!-- Step 3: Experience -->
        @if (currentStep() === 2) {
          <div class="form-step">
            <h2>Votre experience</h2>
            <p class="step-description">Parlez-nous de vous et de votre experience en roleplay.</p>

            <div class="form-group">
              <label for="roleplayExperience">Experience en roleplay *</label>
              <textarea
                id="roleplayExperience"
                pInputTextarea
                [(ngModel)]="form.roleplayExperience"
                [rows]="5"
                placeholder="Avez-vous deja fait du RP ? Sur quels serveurs ? Depuis combien de temps ?"
                class="w-full"
              ></textarea>
              <small>Minimum 100 caracteres - {{ form.roleplayExperience.length }}/100</small>
            </div>

            <div class="form-group">
              <label for="whyJoin">Pourquoi Elderwood ? *</label>
              <textarea
                id="whyJoin"
                pInputTextarea
                [(ngModel)]="form.whyJoin"
                [rows]="5"
                placeholder="Qu'est-ce qui vous attire dans notre serveur ? Que recherchez-vous ?"
                class="w-full"
              ></textarea>
              <small>Minimum 100 caracteres - {{ form.whyJoin.length }}/100</small>
            </div>

            <div class="form-actions">
              <button pButton label="Precedent" icon="pi pi-arrow-left" severity="secondary" (click)="prevStep()"></button>
              <button pButton label="Envoyer ma candidature" icon="pi pi-send" iconPos="right" (click)="submitApplication()" [disabled]="!isStep3Valid()" [loading]="loading()"></button>
            </div>
          </div>
        }

        <!-- Success -->
        @if (currentStep() === 3) {
          <div class="form-step success-step">
            <div class="success-icon">
              <i class="pi pi-check-circle"></i>
            </div>
            <h2>Candidature envoyee !</h2>
            <p>Votre candidature a ete soumise avec succes.</p>
            <p class="sub-text">Notre equipe l'examinera dans les plus brefs delais. Vous recevrez une notification une fois la decision prise.</p>

            <button pButton label="Retour au dashboard" icon="pi pi-home" routerLink="/dashboard"></button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .application-container {
      min-height: 100vh;
      background: #0c0c0c;
      padding: 2rem;
    }

    .application-header {
      text-align: center;
      margin-bottom: 2rem;

      .back-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        color: rgba(255, 255, 255, 0.6);
        text-decoration: none;
        margin-bottom: 1rem;
        transition: all 0.3s ease;

        &:hover {
          color: var(--elderwood-primary);
        }
      }

      h1 {
        font-size: 2rem;
        background: linear-gradient(135deg, var(--elderwood-primary) 0%, var(--elderwood-gold) 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        margin: 0 0 0.5rem 0;
      }

      p {
        color: rgba(255, 255, 255, 0.6);
        margin: 0;
      }
    }

    .steps-container {
      max-width: 600px;
      margin: 0 auto 2rem;
    }

    .form-container {
      max-width: 700px;
      margin: 0 auto;
      background: rgba(26, 28, 30, 0.95);
      border-radius: 24px;
      padding: 2.5rem;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(201, 162, 39, 0.2);
    }

    .form-step {
      h2 {
        font-size: 1.5rem;
        color: var(--elderwood-primary);
        margin: 0 0 0.5rem 0;
      }

      .step-description {
        color: rgba(255, 255, 255, 0.6);
        margin-bottom: 2rem;
      }
    }

    .form-group {
      margin-bottom: 1.5rem;

      label {
        display: block;
        margin-bottom: 0.5rem;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.9);
      }

      small {
        display: block;
        margin-top: 0.5rem;
        color: rgba(255, 255, 255, 0.4);
        font-size: 0.8rem;
      }
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;

      @media (max-width: 600px) {
        grid-template-columns: 1fr;
      }
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: 1rem;
      margin-top: 2rem;
      padding-top: 1.5rem;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
    }

    .success-step {
      text-align: center;

      .success-icon {
        i {
          font-size: 5rem;
          color: #22c55e;
          margin-bottom: 1.5rem;
        }
      }

      h2 {
        color: #22c55e;
      }

      p {
        color: rgba(255, 255, 255, 0.8);
        margin-bottom: 0.5rem;
      }

      .sub-text {
        color: rgba(255, 255, 255, 0.5);
        margin-bottom: 2rem;
      }
    }

    :host ::ng-deep {
      .p-steps {
        .p-steps-item {
          .p-menuitem-link {
            background: transparent;

            .p-steps-number {
              background: #292a2c;
              color: rgba(255, 255, 255, 0.5);
              border: 2px solid #292a2c;
            }

            .p-steps-title {
              color: rgba(255, 255, 255, 0.5);
            }
          }

          &.p-highlight {
            .p-menuitem-link {
              .p-steps-number {
                background: var(--elderwood-primary);
                color: #0c0c0c;
                border-color: var(--elderwood-primary);
              }

              .p-steps-title {
                color: var(--elderwood-primary);
              }
            }
          }
        }
      }

      .p-inputtext, .p-inputtextarea, .p-dropdown, .p-inputnumber-input {
        background: rgba(41, 42, 44, 0.8);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        color: white;

        &:hover {
          border-color: rgba(201, 162, 39, 0.3);
        }

        &:focus {
          border-color: var(--elderwood-primary);
          box-shadow: 0 0 0 3px rgba(201, 162, 39, 0.15);
        }
      }

      .p-dropdown-panel {
        background: #1d1f21;
        border: 1px solid rgba(255, 255, 255, 0.1);

        .p-dropdown-items {
          .p-dropdown-item {
            color: white;

            &:hover {
              background: rgba(201, 162, 39, 0.1);
            }

            &.p-highlight {
              background: var(--elderwood-primary);
              color: #0c0c0c;
            }
          }
        }
      }

      .p-button {
        border-radius: 12px;
      }
    }
  `]
})
export class WhitelistApplicationComponent {
  currentStep = signal(0);
  loading = signal(false);
  messages = signal<Message[]>([]);

  form: WhitelistForm = {
    characterName: '',
    characterAge: null,
    bloodStatus: '',
    housePreference: '',
    backstory: '',
    roleplayExperience: '',
    whyJoin: ''
  };

  steps: MenuItem[] = [
    { label: 'Personnage' },
    { label: 'Histoire' },
    { label: 'Experience' }
  ];

  bloodStatusOptions = [
    { label: 'Sang-Pur', value: 'pureblood' },
    { label: 'Sang-Mele', value: 'halfblood' },
    { label: 'Ne-Moldu', value: 'muggleborn' }
  ];

  houseOptions = [
    { label: 'Gryffondor', value: 'gryffindor' },
    { label: 'Serpentard', value: 'slytherin' },
    { label: 'Serdaigle', value: 'ravenclaw' },
    { label: 'Poufsouffle', value: 'hufflepuff' },
    { label: 'Pas de preference', value: 'none' }
  ];

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  isStep1Valid(): boolean {
    return !!(this.form.characterName && this.form.characterAge && this.form.bloodStatus);
  }

  isStep2Valid(): boolean {
    return this.form.backstory.length >= 200;
  }

  isStep3Valid(): boolean {
    return this.form.roleplayExperience.length >= 100 && this.form.whyJoin.length >= 100;
  }

  nextStep(): void {
    if (this.currentStep() < 2) {
      this.currentStep.update(v => v + 1);
    }
  }

  prevStep(): void {
    if (this.currentStep() > 0) {
      this.currentStep.update(v => v - 1);
    }
  }

  submitApplication(): void {
    this.loading.set(true);
    this.messages.set([]);

    // TODO: Call Nakama RPC to submit whitelist application
    // For now, simulate success after delay
    setTimeout(() => {
      this.loading.set(false);
      this.currentStep.set(3);
    }, 2000);
  }
}
