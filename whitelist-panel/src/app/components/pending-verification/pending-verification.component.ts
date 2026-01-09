import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { MessagesModule } from 'primeng/messages';
import { Message } from 'primeng/api';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-pending-verification',
  standalone: true,
  imports: [CommonModule, ButtonModule, MessagesModule],
  template: `
    <div class="pending-container">
      <div class="pending-card">
        <div class="pending-icon">
          <i class="pi pi-envelope"></i>
        </div>
        <h2>Verifiez votre email</h2>
        <p>Un email de verification a ete envoye a votre adresse.</p>
        <p class="sub-text">Cliquez sur le lien dans l'email pour activer votre compte.</p>

        <p-messages [value]="messages()" [closable]="false"></p-messages>

        <div class="actions">
          <p-button
            label="Renvoyer l'email"
            icon="pi pi-refresh"
            [loading]="loading()"
            (onClick)="resendEmail()"
            styleClass="w-full resend-btn"
          ></p-button>

          <p-button
            label="J'ai verifie mon email"
            icon="pi pi-check"
            (onClick)="checkVerification()"
            styleClass="w-full check-btn"
            [loading]="checking()"
          ></p-button>

          <p-button
            label="Deconnexion"
            icon="pi pi-sign-out"
            severity="secondary"
            (onClick)="logout()"
            styleClass="w-full"
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
      background: linear-gradient(135deg, #0c0c0c 0%, #1a1c1e 100%);
    }

    .pending-card {
      width: 100%;
      max-width: 420px;
      background: rgba(26, 28, 30, 0.95);
      border-radius: 24px;
      padding: 3rem;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(201, 162, 39, 0.2);
    }

    .pending-icon {
      width: 80px;
      height: 80px;
      margin: 0 auto 1.5rem;
      background: linear-gradient(135deg, var(--elderwood-primary) 0%, var(--elderwood-gold) 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;

      i {
        font-size: 2.5rem;
        color: #0c0c0c;
      }
    }

    h2 {
      color: var(--elderwood-primary);
      margin-bottom: 1rem;
    }

    p {
      color: rgba(255, 255, 255, 0.8);
      margin-bottom: 0.5rem;
    }

    .sub-text {
      color: rgba(255, 255, 255, 0.5);
      font-size: 0.9rem;
      margin-bottom: 2rem;
    }

    .actions {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    :host ::ng-deep {
      .resend-btn .p-button {
        background: transparent;
        border: 2px solid var(--elderwood-primary);
        color: var(--elderwood-primary);

        &:hover {
          background: var(--elderwood-primary);
          color: #0c0c0c;
        }
      }

      .check-btn .p-button {
        background: linear-gradient(135deg, var(--elderwood-primary) 0%, var(--elderwood-gold) 100%);
        border: none;
      }
    }
  `]
})
export class PendingVerificationComponent {
  loading = signal(false);
  checking = signal(false);
  messages = signal<Message[]>([]);

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  resendEmail(): void {
    this.loading.set(true);
    this.messages.set([]);

    this.authService.sendVerificationEmail().subscribe({
      next: () => {
        this.loading.set(false);
        this.messages.set([{
          severity: 'success',
          summary: 'Email envoye',
          detail: 'Un nouvel email de verification a ete envoye.'
        }]);
      },
      error: () => {
        this.loading.set(false);
        this.messages.set([{
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible d\'envoyer l\'email.'
        }]);
      }
    });
  }

  checkVerification(): void {
    this.checking.set(true);
    this.messages.set([]);

    this.authService.checkEmailVerified().subscribe({
      next: (response) => {
        this.checking.set(false);
        if (response.verified) {
          this.router.navigate(['/link-discord']);
        } else {
          this.messages.set([{
            severity: 'warn',
            summary: 'Non verifie',
            detail: 'Votre email n\'est pas encore verifie.'
          }]);
        }
      },
      error: () => {
        this.checking.set(false);
        this.messages.set([{
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de verifier le statut.'
        }]);
      }
    });
  }

  logout(): void {
    this.authService.logout();
  }
}
