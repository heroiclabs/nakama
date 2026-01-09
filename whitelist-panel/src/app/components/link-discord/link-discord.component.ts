import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { MessagesModule } from 'primeng/messages';
import { Message } from 'primeng/api';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-link-discord',
  standalone: true,
  imports: [CommonModule, ButtonModule, MessagesModule],
  template: `
    <div class="discord-container">
      <div class="discord-card">
        <div class="discord-icon">
          <i class="pi pi-discord"></i>
        </div>
        <h2>Liez votre compte Discord</h2>
        <p>Pour acceder au panel, vous devez lier votre compte Discord.</p>
        <p class="sub-text">Cela nous permet de vous identifier sur notre serveur.</p>

        <p-messages [value]="messages()" [closable]="false"></p-messages>

        <p-button
          label="Lier avec Discord"
          icon="pi pi-external-link"
          [loading]="loading()"
          (onClick)="linkDiscord()"
          styleClass="w-full discord-btn"
        ></p-button>

        <p-button
          label="Deconnexion"
          icon="pi pi-sign-out"
          severity="secondary"
          (onClick)="logout()"
          styleClass="w-full logout-btn"
        ></p-button>
      </div>
    </div>
  `,
  styles: [`
    .discord-container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      background: linear-gradient(135deg, #0c0c0c 0%, #1a1c1e 100%);
    }

    .discord-card {
      width: 100%;
      max-width: 420px;
      background: rgba(26, 28, 30, 0.95);
      border-radius: 24px;
      padding: 3rem;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(88, 101, 242, 0.3);
    }

    .discord-icon {
      width: 80px;
      height: 80px;
      margin: 0 auto 1.5rem;
      background: #5865F2;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;

      i {
        font-size: 2.5rem;
        color: white;
      }
    }

    h2 {
      color: #5865F2;
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

    :host ::ng-deep {
      .discord-btn {
        margin-bottom: 1rem;

        .p-button {
          background: #5865F2;
          border: none;

          &:hover {
            background: #4752c4;
          }
        }
      }

      .logout-btn {
        .p-button {
          background: transparent;
          border: 1px solid rgba(255,255,255,0.2);
        }
      }
    }
  `]
})
export class LinkDiscordComponent {
  loading = signal(false);
  messages = signal<Message[]>([]);

  constructor(private authService: AuthService) {}

  linkDiscord(): void {
    this.loading.set(true);
    this.messages.set([]);

    this.authService.getDiscordAuthUrl().subscribe({
      next: (response) => {
        window.location.href = response.url;
      },
      error: () => {
        this.loading.set(false);
        this.messages.set([{
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de se connecter a Discord.'
        }]);
      }
    });
  }

  logout(): void {
    this.authService.logout();
  }
}
