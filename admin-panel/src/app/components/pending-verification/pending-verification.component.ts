import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';

// PrimeNG
import { ButtonModule } from 'primeng/button';
import { MessagesModule } from 'primeng/messages';
import { Message } from 'primeng/api';

import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-pending-verification',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ButtonModule,
    MessagesModule
  ],
  template: `
    <div class="pending-container">
      <div class="pending-card">
        <div class="pending-header">
          <i class="pi pi-envelope text-6xl mb-4" style="color: var(--elderwood-primary)"></i>
          <h1>Vérifiez votre email</h1>
          <p>Un email de confirmation a été envoyé à votre adresse.</p>
        </div>

        <p-messages [value]="messages()" [closable]="false"></p-messages>

        <div class="pending-content">
          <p>Cliquez sur le lien dans l'email pour activer votre compte.</p>
          <p class="text-sm text-secondary">Vous n'avez pas reçu l'email ? Vérifiez vos spams ou cliquez ci-dessous pour le renvoyer.</p>
        </div>

        <div class="button-group">
          <p-button
            label="Renvoyer l'email"
            icon="pi pi-refresh"
            [loading]="loading()"
            (onClick)="resendEmail()"
            severity="secondary"
          ></p-button>
          <p-button
            label="Se connecter"
            icon="pi pi-sign-in"
            routerLink="/login"
          ></p-button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .pending-container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      background: linear-gradient(135deg, var(--surface-ground) 0%, var(--surface-card) 100%);
    }

    .pending-card {
      width: 100%;
      max-width: 450px;
      background: var(--surface-card);
      border-radius: 1rem;
      padding: 3rem;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
      text-align: center;
    }

    .pending-header {
      margin-bottom: 1.5rem;

      h1 {
        font-size: 1.75rem;
        font-weight: 700;
        margin: 0 0 0.5rem 0;
        color: var(--text-color);
      }

      p {
        color: var(--text-color-secondary);
        margin: 0;
      }
    }

    .pending-content {
      margin: 1.5rem 0;

      p {
        color: var(--text-color-secondary);
        margin: 0.5rem 0;
      }

      .text-sm {
        font-size: 0.875rem;
      }

      .text-secondary {
        opacity: 0.7;
      }
    }

    .button-group {
      display: flex;
      gap: 1rem;
      justify-content: center;
      flex-wrap: wrap;
      margin-top: 1.5rem;
    }
  `]
})
export class PendingVerificationComponent {
  loading = signal(false);
  messages = signal<Message[]>([]);

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  resendEmail(): void {
    this.loading.set(true);
    this.messages.set([]);

    this.authService.resendVerificationEmail().subscribe({
      next: (response) => {
        this.loading.set(false);
        if (response.status === 'sent') {
          this.messages.set([{
            severity: 'success',
            summary: 'Email envoyé',
            detail: 'Un nouvel email de vérification a été envoyé.'
          }]);
        } else if (response.status === 'already_verified') {
          this.messages.set([{
            severity: 'info',
            summary: 'Déjà vérifié',
            detail: 'Votre email est déjà vérifié. Vous pouvez vous connecter.'
          }]);
        }
      },
      error: () => {
        this.loading.set(false);
        this.messages.set([{
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible d\'envoyer l\'email. Veuillez réessayer plus tard.'
        }]);
      }
    });
  }
}
