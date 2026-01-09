import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-unauthorized',
  standalone: true,
  imports: [CommonModule, RouterModule, ButtonModule, CardModule],
  template: `
    <div class="unauthorized-container">
      <p-card>
        <div class="text-center">
          <i class="pi pi-lock text-6xl text-red-500 mb-4"></i>
          <h1>Accès non autorisé</h1>
          <p class="text-color-secondary mb-4">
            Vous n'avez pas les permissions nécessaires pour accéder à cette page.
          </p>
          <div class="flex gap-2 justify-content-center">
            <p-button
              label="Rafraîchir les permissions"
              icon="pi pi-refresh"
              [loading]="refreshing()"
              (onClick)="refreshPermissions()"
              severity="secondary"
            ></p-button>
            <p-button
              label="Retour à la connexion"
              icon="pi pi-arrow-left"
              routerLink="/login"
            ></p-button>
          </div>
        </div>
      </p-card>
    </div>
  `,
  styles: [`
    .unauthorized-container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;

      p-card {
        max-width: 450px;
        width: 100%;
      }

      h1 {
        margin: 0 0 0.5rem 0;
        font-size: 1.5rem;
      }
    }
  `]
})
export class UnauthorizedComponent {
  refreshing = signal(false);

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  async refreshPermissions(): Promise<void> {
    this.refreshing.set(true);
    try {
      const user = await this.authService.refreshUserAccount();
      if (user?.role === 'admin') {
        this.router.navigate(['/']);
      }
    } finally {
      this.refreshing.set(false);
    }
  }
}
