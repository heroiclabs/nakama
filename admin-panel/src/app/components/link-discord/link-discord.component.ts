import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { MessagesModule } from 'primeng/messages';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { Message } from 'primeng/api';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-link-discord',
  standalone: true,
  imports: [CommonModule, CardModule, ButtonModule, MessagesModule, ProgressSpinnerModule],
  template: `
    <div class="flex align-items-center justify-content-center min-h-screen">
      <p-card styleClass="w-full md:w-30rem">
        <ng-template pTemplate="header">
          <div class="text-center p-4">
            <i class="pi pi-discord text-6xl text-primary"></i>
            <h2 class="mt-3 mb-0">Lier votre compte Discord</h2>
          </div>
        </ng-template>

        <p-messages [value]="messages()" [closable]="false"></p-messages>

        <div class="text-center">
          <p class="text-color-secondary mb-4">
            Pour finaliser votre inscription, vous devez lier votre compte Discord.
            Cela nous permet de vous identifier sur notre serveur.
          </p>

          @if (loading()) {
            <p-progressSpinner strokeWidth="4" styleClass="w-4rem h-4rem"></p-progressSpinner>
            <p class="mt-3 text-color-secondary">Redirection vers Discord...</p>
          } @else {
            <p-button
              label="Lier mon compte Discord"
              icon="pi pi-discord"
              (onClick)="linkDiscord()"
              styleClass="w-full"
              [disabled]="loading()"
            ></p-button>

            <div class="mt-4">
              <p-button
                label="Se déconnecter"
                [link]="true"
                (onClick)="logout()"
              ></p-button>
            </div>
          }
        </div>

        <ng-template pTemplate="footer">
          <div class="text-center text-color-secondary text-sm">
            <p>En liant votre compte Discord, vous acceptez que nous accédions à votre identifiant et nom d'utilisateur Discord.</p>
          </div>
        </ng-template>
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
export class LinkDiscordComponent implements OnInit {
  private authService = inject(AuthService);
  private router = inject(Router);

  loading = signal(false);
  messages = signal<Message[]>([]);

  ngOnInit() {
    // Check if already linked
    this.checkDiscordStatus();
  }

  checkDiscordStatus() {
    this.authService.checkDiscordLinked().subscribe({
      next: (response) => {
        if (response.linked) {
          // Already linked, redirect to home
          this.router.navigate(['/']);
        }
      },
      error: (error) => {
        console.error('Error checking Discord status:', error);
      }
    });
  }

  linkDiscord() {
    this.loading.set(true);
    this.messages.set([]);

    this.authService.getDiscordAuthUrl().subscribe({
      next: (response) => {
        // Redirect to Discord OAuth
        window.location.href = response.url;
      },
      error: (error) => {
        this.loading.set(false);
        this.messages.set([{
          severity: 'error',
          summary: 'Erreur',
          detail: error.error?.message || 'Impossible d\'initialiser la connexion Discord'
        }]);
      }
    });
  }

  logout() {
    this.authService.logout();
    this.router.navigate(['/login']);
  }
}
