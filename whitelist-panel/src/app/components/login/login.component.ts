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
  selector: 'app-login',
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
    <div class="login-container">
      <div class="magic-particles">
        <div class="particle" *ngFor="let p of particles"></div>
      </div>

      <div class="login-card">
        <div class="login-header">
          <div class="logo-icon">
            <i class="pi pi-bolt"></i>
          </div>
          <h1>Elderwood</h1>
          <p>Portail des sorciers</p>
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
              placeholder="sorcier@elderwood.com"
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
              placeholder="Votre mot de passe secret"
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
            label="Entrer dans Elderwood"
            icon="pi pi-sign-in"
            styleClass="w-full login-btn"
            [loading]="loading()"
            [disabled]="!email || !password"
          ></p-button>
        </form>

        <div class="register-link">
          <span>Nouveau sorcier ?</span>
          <a routerLink="/register">Rejoindre l'aventure</a>
        </div>
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
      background: var(--elderwood-primary);
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

    .login-card {
      width: 100%;
      max-width: 420px;
      background: rgba(26, 28, 30, 0.95);
      border-radius: 24px;
      padding: 3rem;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(201, 162, 39, 0.2);
      backdrop-filter: blur(10px);
      position: relative;
      z-index: 1;
      animation: fadeIn 0.6s ease;
    }

    .login-header {
      text-align: center;
      margin-bottom: 2.5rem;

      .logo-icon {
        width: 80px;
        height: 80px;
        margin: 0 auto 1.5rem;
        background: linear-gradient(135deg, var(--elderwood-primary) 0%, var(--elderwood-gold) 100%);
        border-radius: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: glow 3s infinite;

        i {
          font-size: 2.5rem;
          color: #0c0c0c;
        }
      }

      h1 {
        font-size: 2rem;
        font-weight: 700;
        margin: 0 0 0.5rem 0;
        background: linear-gradient(135deg, var(--elderwood-primary) 0%, var(--elderwood-gold) 100%);
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

    .login-form {
      .form-field {
        margin-bottom: 1.5rem;

        label {
          display: block;
          margin-bottom: 0.5rem;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.8);
          font-size: 0.9rem;
        }
      }
    }

    .register-link {
      text-align: center;
      margin-top: 2rem;
      color: rgba(255, 255, 255, 0.5);

      a {
        color: var(--elderwood-primary);
        text-decoration: none;
        margin-left: 0.5rem;
        font-weight: 600;
        transition: all 0.3s ease;

        &:hover {
          color: var(--elderwood-gold);
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
          border-color: rgba(201, 162, 39, 0.3);
        }

        &:focus {
          border-color: var(--elderwood-primary);
          box-shadow: 0 0 0 3px rgba(201, 162, 39, 0.15);
        }
      }

      .login-btn {
        margin-top: 0.5rem;

        .p-button {
          background: linear-gradient(135deg, var(--elderwood-primary) 0%, var(--elderwood-gold) 100%);
          border: none;
          border-radius: 12px;
          padding: 0.875rem;
          font-weight: 600;
          transition: all 0.3s ease;

          &:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 30px rgba(201, 162, 39, 0.3);
          }
        }
      }
    }
  `]
})
export class LoginComponent {
  email = '';
  password = '';
  particles = Array(20).fill(0);

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
          this.router.navigate(['/dashboard']);
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
