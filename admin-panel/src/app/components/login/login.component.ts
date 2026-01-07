import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

// PrimeNG
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { ButtonModule } from 'primeng/button';
import { MessagesModule } from 'primeng/messages';
import { Message } from 'primeng/api';

import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    InputTextModule,
    PasswordModule,
    ButtonModule,
    MessagesModule
  ],
  template: `
    <div class="login-container">
      <div class="login-card">
        <div class="login-header">
          <i class="pi pi-shield text-5xl mb-3" style="color: var(--elderwood-primary)"></i>
          <h1>Elderwood Admin</h1>
          <p>Panneau d'administration</p>
        </div>

        <p-messages [value]="messages()" [closable]="false"></p-messages>

        <form (ngSubmit)="onLogin()" class="login-form">
          <div class="form-field">
            <label for="email">Email</label>
            <input
              id="email"
              type="email"
              pInputText
              [(ngModel)]="email"
              name="email"
              placeholder="admin@elderwood.com"
              class="w-full"
              [disabled]="loading()"
              required
            />
          </div>

          <div class="form-field">
            <label for="password">Mot de passe</label>
            <p-password
              id="password"
              [(ngModel)]="password"
              name="password"
              placeholder="••••••••"
              [feedback]="false"
              [toggleMask]="true"
              styleClass="w-full"
              inputStyleClass="w-full"
              [disabled]="loading()"
              required
            ></p-password>
          </div>

          <p-button
            type="submit"
            label="Se connecter"
            icon="pi pi-sign-in"
            styleClass="w-full"
            [loading]="loading()"
            [disabled]="!email || !password"
          ></p-button>
        </form>
      </div>
    </div>
  `,
  styles: [`
    .login-container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      background: linear-gradient(135deg, var(--surface-ground) 0%, var(--surface-card) 100%);
    }

    .login-card {
      width: 100%;
      max-width: 400px;
      background: var(--surface-card);
      border-radius: 1rem;
      padding: 2.5rem;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
    }

    .login-header {
      text-align: center;
      margin-bottom: 2rem;

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

    .login-form {
      .form-field {
        margin-bottom: 1.25rem;

        label {
          display: block;
          margin-bottom: 0.5rem;
          font-weight: 500;
          color: var(--text-color);
        }
      }
    }

    :host ::ng-deep {
      .p-password {
        width: 100%;
      }

      .p-button {
        margin-top: 0.5rem;
      }
    }
  `]
})
export class LoginComponent {
  email = '';
  password = '';

  loading = signal(false);
  messages = signal<Message[]>([]);

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  onLogin(): void {
    if (!this.email || !this.password) return;

    this.loading.set(true);
    this.messages.set([]);

    this.authService.login(this.email, this.password).subscribe({
      next: (success) => {
        this.loading.set(false);
        if (success) {
          this.router.navigate(['/admin']);
        } else {
          this.messages.set([{
            severity: 'error',
            summary: 'Erreur',
            detail: 'Email ou mot de passe incorrect'
          }]);
        }
      },
      error: () => {
        this.loading.set(false);
        this.messages.set([{
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de se connecter au serveur'
        }]);
      }
    });
  }
}
