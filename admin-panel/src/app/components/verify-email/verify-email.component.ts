import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

// PrimeNG
import { ButtonModule } from 'primeng/button';
import { ProgressSpinnerModule } from 'primeng/progressspinner';

import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ButtonModule,
    ProgressSpinnerModule
  ],
  template: `
    <div class="verify-container">
      <div class="verify-card">
        @if (loading()) {
          <div class="verify-loading">
            <p-progressSpinner strokeWidth="4" styleClass="w-12 h-12"></p-progressSpinner>
            <p>Vérification en cours...</p>
          </div>
        } @else if (success()) {
          <div class="verify-success">
            <i class="pi pi-check-circle text-6xl mb-4" style="color: var(--green-500)"></i>
            <h1>Email vérifié !</h1>
            <p>Votre adresse email a été vérifiée avec succès.</p>
            <p>Vous pouvez maintenant vous connecter à votre compte.</p>
            <p-button
              label="Se connecter"
              icon="pi pi-sign-in"
              routerLink="/login"
              styleClass="mt-4"
            ></p-button>
          </div>
        } @else if (alreadyVerified()) {
          <div class="verify-info">
            <i class="pi pi-info-circle text-6xl mb-4" style="color: var(--blue-500)"></i>
            <h1>Déjà vérifié</h1>
            <p>Cette adresse email a déjà été vérifiée.</p>
            <p-button
              label="Se connecter"
              icon="pi pi-sign-in"
              routerLink="/login"
              styleClass="mt-4"
            ></p-button>
          </div>
        } @else {
          <div class="verify-error">
            <i class="pi pi-times-circle text-6xl mb-4" style="color: var(--red-500)"></i>
            <h1>Échec de la vérification</h1>
            <p>{{ errorMessage() }}</p>
            <p>Le lien est peut-être expiré ou invalide.</p>
            <div class="button-group">
              <p-button
                label="Retour à l'accueil"
                icon="pi pi-home"
                routerLink="/login"
                styleClass="mt-4"
                severity="secondary"
              ></p-button>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .verify-container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      background: linear-gradient(135deg, var(--surface-ground) 0%, var(--surface-card) 100%);
    }

    .verify-card {
      width: 100%;
      max-width: 450px;
      background: var(--surface-card);
      border-radius: 1rem;
      padding: 3rem;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
      text-align: center;
    }

    .verify-loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;

      p {
        color: var(--text-color-secondary);
        margin: 0;
      }
    }

    .verify-success, .verify-error, .verify-info {
      h1 {
        font-size: 1.75rem;
        font-weight: 700;
        margin: 0 0 1rem 0;
        color: var(--text-color);
      }

      p {
        color: var(--text-color-secondary);
        margin: 0.5rem 0;
      }
    }

    .button-group {
      display: flex;
      gap: 1rem;
      justify-content: center;
      margin-top: 1.5rem;
    }
  `]
})
export class VerifyEmailComponent implements OnInit {
  loading = signal(true);
  success = signal(false);
  alreadyVerified = signal(false);
  errorMessage = signal('');

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    const token = this.route.snapshot.queryParams['token'];

    if (!token) {
      this.loading.set(false);
      this.errorMessage.set('Aucun token de vérification fourni.');
      return;
    }

    this.authService.verifyEmail(token).subscribe({
      next: (response) => {
        this.loading.set(false);
        if (response.status === 'verified') {
          this.success.set(true);
        } else if (response.status === 'already_verified') {
          this.alreadyVerified.set(true);
        }
      },
      error: (error) => {
        this.loading.set(false);
        this.errorMessage.set(error?.error?.message || 'Le token est invalide ou expiré.');
      }
    });
  }
}
