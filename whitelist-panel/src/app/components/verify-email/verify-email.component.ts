import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [CommonModule, RouterLink, ButtonModule, ProgressSpinnerModule],
  template: `
    <div class="verify-container">
      <div class="verify-card">
        @if (loading()) {
          <div class="verify-loading">
            <p-progressSpinner strokeWidth="4" animationDuration=".5s"></p-progressSpinner>
            <p>Verification de votre email...</p>
          </div>
        } @else if (success()) {
          <div class="verify-success">
            <i class="pi pi-check-circle"></i>
            <h2>Email verifie !</h2>
            <p>Votre adresse email a ete verifiee avec succes.</p>
            <p-button
              label="Continuer"
              icon="pi pi-arrow-right"
              routerLink="/link-discord"
              styleClass="w-full"
            ></p-button>
          </div>
        } @else {
          <div class="verify-error">
            <i class="pi pi-times-circle"></i>
            <h2>Erreur de verification</h2>
            <p>{{ errorMessage() }}</p>
            <p-button
              label="Retour"
              icon="pi pi-arrow-left"
              routerLink="/login"
              styleClass="w-full"
            ></p-button>
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
      background: linear-gradient(135deg, #0c0c0c 0%, #1a1c1e 100%);
    }

    .verify-card {
      width: 100%;
      max-width: 400px;
      background: rgba(26, 28, 30, 0.95);
      border-radius: 24px;
      padding: 3rem;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    }

    .verify-loading {
      p { margin-top: 1.5rem; color: rgba(255,255,255,0.6); }
    }

    .verify-success {
      i {
        font-size: 4rem;
        color: #22c55e;
        margin-bottom: 1rem;
      }
      h2 { color: #22c55e; margin-bottom: 0.5rem; }
      p { color: rgba(255,255,255,0.6); margin-bottom: 1.5rem; }
    }

    .verify-error {
      i {
        font-size: 4rem;
        color: #ef4444;
        margin-bottom: 1rem;
      }
      h2 { color: #ef4444; margin-bottom: 0.5rem; }
      p { color: rgba(255,255,255,0.6); margin-bottom: 1.5rem; }
    }
  `]
})
export class VerifyEmailComponent implements OnInit {
  loading = signal(true);
  success = signal(false);
  errorMessage = signal('Le lien de verification est invalide ou a expire.');

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token');

    if (!token) {
      this.loading.set(false);
      this.errorMessage.set('Token de verification manquant.');
      return;
    }

    this.authService.verifyEmail(token).subscribe({
      next: () => {
        this.loading.set(false);
        this.success.set(true);
      },
      error: (err) => {
        this.loading.set(false);
        this.success.set(false);
        this.errorMessage.set(err?.error?.message || 'Le lien est invalide ou a expire.');
      }
    });
  }
}
