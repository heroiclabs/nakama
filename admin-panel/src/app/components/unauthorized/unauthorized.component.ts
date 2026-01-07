import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';

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
          <p-button
            label="Retour à la connexion"
            icon="pi pi-arrow-left"
            routerLink="/login"
          ></p-button>
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
        max-width: 400px;
        width: 100%;
      }

      h1 {
        margin: 0 0 0.5rem 0;
        font-size: 1.5rem;
      }
    }
  `]
})
export class UnauthorizedComponent {}
