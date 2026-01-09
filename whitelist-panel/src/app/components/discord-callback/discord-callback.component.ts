import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { ButtonModule } from 'primeng/button';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-discord-callback',
  standalone: true,
  imports: [CommonModule, ProgressSpinnerModule, ButtonModule],
  template: `
    <div class="callback-container">
      <div class="callback-card">
        @if (loading()) {
          <p-progressSpinner strokeWidth="4" animationDuration=".5s"></p-progressSpinner>
          <p>Liaison de votre compte Discord...</p>
        } @else if (success()) {
          <i class="pi pi-check-circle success-icon"></i>
          <h2>Compte Discord lie !</h2>
          <p>Bienvenue, {{ discordUsername() }} !</p>
          <p-button
            label="Acceder au panel"
            icon="pi pi-arrow-right"
            (onClick)="goToDashboard()"
            styleClass="w-full"
          ></p-button>
        } @else {
          <i class="pi pi-times-circle error-icon"></i>
          <h2>Erreur de liaison</h2>
          <p>{{ errorMessage() }}</p>
          <p-button
            label="Reessayer"
            icon="pi pi-refresh"
            (onClick)="goToLink()"
            styleClass="w-full"
          ></p-button>
        }
      </div>
    </div>
  `,
  styles: [`
    .callback-container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      background: linear-gradient(135deg, #0c0c0c 0%, #1a1c1e 100%);
    }

    .callback-card {
      width: 100%;
      max-width: 400px;
      background: rgba(26, 28, 30, 0.95);
      border-radius: 24px;
      padding: 3rem;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    }

    .success-icon {
      font-size: 4rem;
      color: #22c55e;
      margin-bottom: 1rem;
    }

    .error-icon {
      font-size: 4rem;
      color: #ef4444;
      margin-bottom: 1rem;
    }

    h2 {
      margin-bottom: 0.5rem;
    }

    p {
      color: rgba(255, 255, 255, 0.6);
      margin-bottom: 1.5rem;
    }
  `]
})
export class DiscordCallbackComponent implements OnInit {
  loading = signal(true);
  success = signal(false);
  discordUsername = signal('');
  errorMessage = signal('Une erreur est survenue lors de la liaison.');

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    const code = this.route.snapshot.queryParamMap.get('code');
    const state = this.route.snapshot.queryParamMap.get('state');
    const error = this.route.snapshot.queryParamMap.get('error');

    if (error) {
      this.loading.set(false);
      this.errorMessage.set('L\'autorisation Discord a ete refusee.');
      return;
    }

    if (!code || !state) {
      this.loading.set(false);
      this.errorMessage.set('Parametres manquants.');
      return;
    }

    this.authService.discordCallback(code, state).subscribe({
      next: (response) => {
        this.loading.set(false);
        this.success.set(true);
        this.discordUsername.set(response.discord_username);
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(err?.error?.message || 'Erreur lors de la liaison.');
      }
    });
  }

  goToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  goToLink(): void {
    this.router.navigate(['/link-discord']);
  }
}
