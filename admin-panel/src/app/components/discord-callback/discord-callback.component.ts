import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { MessagesModule } from 'primeng/messages';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { Message } from 'primeng/api';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-discord-callback',
  standalone: true,
  imports: [CommonModule, CardModule, ButtonModule, MessagesModule, ProgressSpinnerModule],
  template: `
    <div class="flex align-items-center justify-content-center min-h-screen">
      <p-card styleClass="w-full md:w-30rem">
        <ng-template pTemplate="header">
          <div class="text-center p-4">
            <i class="pi pi-discord text-6xl" [ngClass]="success() ? 'text-green-500' : error() ? 'text-red-500' : 'text-primary'"></i>
            <h2 class="mt-3 mb-0">
              @if (loading()) {
                Liaison en cours...
              } @else if (success()) {
                Compte Discord lié !
              } @else {
                Erreur de liaison
              }
            </h2>
          </div>
        </ng-template>

        <p-messages [value]="messages()" [closable]="false"></p-messages>

        <div class="text-center">
          @if (loading()) {
            <p-progressSpinner strokeWidth="4" styleClass="w-4rem h-4rem"></p-progressSpinner>
            <p class="mt-3 text-color-secondary">Vérification de votre compte Discord...</p>
          } @else if (success()) {
            <div class="mb-4">
              <p class="text-color-secondary">
                Votre compte Discord <strong>{{ discordUsername() }}</strong> a été lié avec succès !
              </p>
              <p class="text-color-secondary">
                Vous allez être redirigé vers l'application...
              </p>
            </div>
            <p-progressSpinner strokeWidth="4" styleClass="w-3rem h-3rem"></p-progressSpinner>
          } @else {
            <p class="text-color-secondary mb-4">
              Une erreur est survenue lors de la liaison de votre compte Discord.
            </p>
            <p-button
              label="Réessayer"
              icon="pi pi-refresh"
              (onClick)="retry()"
              styleClass="w-full"
            ></p-button>
          }
        </div>
      </p-card>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      background: var(--surface-ground);
    }
  `]
})
export class DiscordCallbackComponent implements OnInit {
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  loading = signal(true);
  success = signal(false);
  error = signal(false);
  messages = signal<Message[]>([]);
  discordUsername = signal('');

  ngOnInit() {
    this.handleCallback();
  }

  handleCallback() {
    const code = this.route.snapshot.queryParamMap.get('code');
    const state = this.route.snapshot.queryParamMap.get('state');
    const errorParam = this.route.snapshot.queryParamMap.get('error');

    if (errorParam) {
      this.handleError('Vous avez annulé la connexion Discord');
      return;
    }

    if (!code || !state) {
      this.handleError('Paramètres manquants dans la réponse Discord');
      return;
    }

    // Exchange code for Discord info
    this.authService.discordCallback(code, state).subscribe({
      next: (response) => {
        this.loading.set(false);
        this.success.set(true);
        this.discordUsername.set(response.discord_username);
        this.messages.set([{
          severity: 'success',
          summary: 'Succès',
          detail: 'Votre compte Discord a été lié avec succès !'
        }]);

        // Redirect to home after a short delay
        setTimeout(() => {
          this.router.navigate(['/']);
        }, 2000);
      },
      error: (error) => {
        this.handleError(error.error?.error?.message || error.error?.message || 'Erreur lors de la liaison Discord');
      }
    });
  }

  handleError(message: string) {
    this.loading.set(false);
    this.error.set(true);
    this.messages.set([{
      severity: 'error',
      summary: 'Erreur',
      detail: message
    }]);
  }

  retry() {
    this.router.navigate(['/link-discord']);
  }
}
