import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

// PrimeNG
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { ButtonModule } from 'primeng/button';
import { MessagesModule } from 'primeng/messages';
import { Message } from 'primeng/api';

import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    CardModule,
    InputTextModule,
    PasswordModule,
    ButtonModule,
    MessagesModule
  ],
  template: `
    <div class="register-container">
      <div class="register-card">
        <div class="register-header">
          <i class="pi pi-user-plus text-5xl mb-3" style="color: var(--elderwood-primary)"></i>
          <h1>Créer un compte</h1>
          <p>Rejoignez Elderwood</p>
        </div>

        <p-messages [value]="messages()" [closable]="false"></p-messages>

        <form (ngSubmit)="onRegister()" class="register-form">
          <div class="form-field">
            <label for="username">Nom d'utilisateur</label>
            <input
              id="username"
              type="text"
              pInputText
              [(ngModel)]="username"
              name="username"
              placeholder="VotrePseudo"
              class="w-full"
              [disabled]="loading()"
              required
            />
          </div>

          <div class="form-field">
            <label for="email">Email</label>
            <input
              id="email"
              type="email"
              pInputText
              [(ngModel)]="email"
              name="email"
              placeholder="votre@email.com"
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
              [feedback]="true"
              [toggleMask]="true"
              styleClass="w-full"
              inputStyleClass="w-full"
              [disabled]="loading()"
              required
            ></p-password>
          </div>

          <div class="form-field">
            <label for="confirmPassword">Confirmer le mot de passe</label>
            <p-password
              id="confirmPassword"
              [(ngModel)]="confirmPassword"
              name="confirmPassword"
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
            label="Créer mon compte"
            icon="pi pi-user-plus"
            styleClass="w-full"
            [loading]="loading()"
            [disabled]="!isFormValid()"
          ></p-button>
        </form>

        <div class="login-link">
          <span>Déjà un compte ?</span>
          <a routerLink="/login">Se connecter</a>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .register-container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      background: linear-gradient(135deg, var(--surface-ground) 0%, var(--surface-card) 100%);
    }

    .register-card {
      width: 100%;
      max-width: 400px;
      background: var(--surface-card);
      border-radius: 1rem;
      padding: 2.5rem;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
    }

    .register-header {
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

    .register-form {
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

    .login-link {
      text-align: center;
      margin-top: 1.5rem;
      color: var(--text-color-secondary);

      a {
        color: var(--elderwood-primary);
        text-decoration: none;
        margin-left: 0.5rem;
        font-weight: 500;

        &:hover {
          text-decoration: underline;
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
export class RegisterComponent {
  username = '';
  email = '';
  password = '';
  confirmPassword = '';

  loading = signal(false);
  messages = signal<Message[]>([]);

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  isFormValid(): boolean {
    return !!(this.username && this.email && this.password && this.confirmPassword && this.password === this.confirmPassword);
  }

  onRegister(): void {
    if (!this.isFormValid()) return;

    if (this.password !== this.confirmPassword) {
      this.messages.set([{
        severity: 'error',
        summary: 'Erreur',
        detail: 'Les mots de passe ne correspondent pas'
      }]);
      return;
    }

    if (this.password.length < 8) {
      this.messages.set([{
        severity: 'error',
        summary: 'Erreur',
        detail: 'Le mot de passe doit contenir au moins 8 caractères'
      }]);
      return;
    }

    this.loading.set(true);
    this.messages.set([]);

    this.authService.register(this.email, this.password, this.username).subscribe({
      next: (success) => {
        this.loading.set(false);
        if (success) {
          this.messages.set([{
            severity: 'success',
            summary: 'Compte créé',
            detail: 'Votre compte a été créé avec succès'
          }]);
          setTimeout(() => {
            this.router.navigate(['/admin']);
          }, 1500);
        } else {
          this.messages.set([{
            severity: 'error',
            summary: 'Erreur',
            detail: 'Impossible de créer le compte. Cet email est peut-être déjà utilisé.'
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
