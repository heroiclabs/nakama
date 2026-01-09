import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

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
      <div class="magic-particles">
        <div class="particle" *ngFor="let p of particles"></div>
      </div>

      <div class="register-card">
        <div class="register-header">
          <div class="logo-icon">
            <i class="pi pi-star"></i>
          </div>
          <h1>Rejoindre Elderwood</h1>
          <p>Commencez votre aventure magique</p>
        </div>

        <p-messages [value]="messages()" [closable]="false"></p-messages>

        <form (ngSubmit)="onRegister()" class="register-form">
          <div class="form-field">
            <label for="username">Nom de sorcier</label>
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
              placeholder="Minimum 8 caracteres"
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
              placeholder="Confirmez votre mot de passe"
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
            label="Creer mon compte"
            icon="pi pi-user-plus"
            styleClass="w-full register-btn"
            [loading]="loading()"
            [disabled]="!isFormValid()"
          ></p-button>
        </form>

        <div class="login-link">
          <span>Deja inscrit ?</span>
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
      background: linear-gradient(135deg, #0c0c0c 0%, #1a1c1e 50%, #0c0c0c 100%);
      position: relative;
      overflow: hidden;
    }

    .magic-particles {
      position: absolute;
      inset: 0;
      overflow: hidden;
      pointer-events: none;
    }

    .particle {
      position: absolute;
      width: 4px;
      height: 4px;
      background: var(--elderwood-secondary);
      border-radius: 50%;
      opacity: 0;
      animation: float-particle 6s infinite;
    }

    @for $i from 1 through 20 {
      .particle:nth-child(#{$i}) {
        left: random(100) * 1%;
        top: random(100) * 1%;
        animation-delay: random(6) * 1s;
        animation-duration: 4s + random(4) * 1s;
      }
    }

    @keyframes float-particle {
      0% { opacity: 0; transform: translateY(100px) scale(0); }
      20% { opacity: 0.8; }
      100% { opacity: 0; transform: translateY(-100px) scale(1); }
    }

    .register-card {
      width: 100%;
      max-width: 420px;
      background: rgba(26, 28, 30, 0.95);
      border-radius: 24px;
      padding: 3rem;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(139, 92, 246, 0.2);
      backdrop-filter: blur(10px);
      position: relative;
      z-index: 1;
      animation: fadeIn 0.6s ease;
    }

    .register-header {
      text-align: center;
      margin-bottom: 2rem;

      .logo-icon {
        width: 80px;
        height: 80px;
        margin: 0 auto 1.5rem;
        background: linear-gradient(135deg, var(--elderwood-secondary) 0%, var(--elderwood-purple) 100%);
        border-radius: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: glow-purple 3s infinite;

        i {
          font-size: 2.5rem;
          color: #ffffff;
        }
      }

      h1 {
        font-size: 1.75rem;
        font-weight: 700;
        margin: 0 0 0.5rem 0;
        background: linear-gradient(135deg, var(--elderwood-secondary) 0%, var(--elderwood-purple) 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      p {
        color: rgba(255, 255, 255, 0.6);
        margin: 0;
        font-size: 1rem;
      }
    }

    @keyframes glow-purple {
      0%, 100% { box-shadow: 0 0 20px rgba(139, 92, 246, 0.3); }
      50% { box-shadow: 0 0 40px rgba(139, 92, 246, 0.5); }
    }

    .register-form {
      .form-field {
        margin-bottom: 1.25rem;

        label {
          display: block;
          margin-bottom: 0.5rem;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.8);
          font-size: 0.9rem;
        }
      }
    }

    .login-link {
      text-align: center;
      margin-top: 1.5rem;
      color: rgba(255, 255, 255, 0.5);

      a {
        color: var(--elderwood-secondary);
        text-decoration: none;
        margin-left: 0.5rem;
        font-weight: 600;
        transition: all 0.3s ease;

        &:hover {
          color: var(--elderwood-purple);
          text-decoration: underline;
        }
      }
    }

    :host ::ng-deep {
      .p-password {
        width: 100%;
      }

      .p-inputtext {
        background: rgba(41, 42, 44, 0.8);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        padding: 0.875rem 1rem;
        transition: all 0.3s ease;

        &:hover {
          border-color: rgba(139, 92, 246, 0.3);
        }

        &:focus {
          border-color: var(--elderwood-secondary);
          box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.15);
        }
      }

      .register-btn {
        margin-top: 0.5rem;

        .p-button {
          background: linear-gradient(135deg, var(--elderwood-secondary) 0%, var(--elderwood-purple) 100%);
          border: none;
          border-radius: 12px;
          padding: 0.875rem;
          font-weight: 600;
          transition: all 0.3s ease;

          &:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 30px rgba(139, 92, 246, 0.3);
          }
        }
      }
    }
  `]
})
export class RegisterComponent {
  username = '';
  email = '';
  password = '';
  confirmPassword = '';
  particles = Array(20).fill(0);

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
        detail: 'Le mot de passe doit contenir au moins 8 caracteres'
      }]);
      return;
    }

    this.loading.set(true);
    this.messages.set([]);

    this.authService.register(this.email, this.password, this.username).subscribe({
      next: (success) => {
        if (success) {
          this.authService.sendVerificationEmail().subscribe({
            next: () => {
              this.loading.set(false);
              this.messages.set([{
                severity: 'success',
                summary: 'Compte cree',
                detail: 'Un email de confirmation a ete envoye. Verifiez votre boite de reception.'
              }]);
              setTimeout(() => {
                this.router.navigate(['/pending-verification']);
              }, 2000);
            },
            error: () => {
              this.loading.set(false);
              this.messages.set([{
                severity: 'warn',
                summary: 'Compte cree',
                detail: 'Votre compte a ete cree mais l\'envoi de l\'email a echoue.'
              }]);
              setTimeout(() => {
                this.router.navigate(['/pending-verification']);
              }, 2000);
            }
          });
        } else {
          this.loading.set(false);
          this.messages.set([{
            severity: 'error',
            summary: 'Erreur',
            detail: 'Impossible de creer le compte. Cet email est peut-etre deja utilise.'
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
