import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, RouterOutlet } from '@angular/router';

// PrimeNG
import { MenubarModule } from 'primeng/menubar';
import { ButtonModule } from 'primeng/button';
import { AvatarModule } from 'primeng/avatar';
import { MenuModule } from 'primeng/menu';
import { MenuItem } from 'primeng/api';

import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    RouterOutlet,
    MenubarModule,
    ButtonModule,
    AvatarModule,
    MenuModule
  ],
  template: `
    <div class="admin-layout">
      <!-- Sidebar -->
      <aside class="sidebar">
        <div class="sidebar-header">
          <i class="pi pi-shield text-3xl" style="color: var(--elderwood-primary)"></i>
          <span class="sidebar-title">Elderwood</span>
        </div>

        <nav class="sidebar-nav">
          <a
            routerLink="/admin/houses"
            routerLinkActive="active"
            class="nav-item"
          >
            <i class="pi pi-home"></i>
            <span>Maisons</span>
          </a>

          <a
            routerLink="/admin/accounts"
            routerLinkActive="active"
            class="nav-item"
          >
            <i class="pi pi-id-card"></i>
            <span>Comptes</span>
          </a>

          <a
            routerLink="/admin/characters"
            routerLinkActive="active"
            class="nav-item"
          >
            <i class="pi pi-users"></i>
            <span>Personnages</span>
          </a>

          <a
            routerLink="/admin/spells"
            routerLinkActive="active"
            class="nav-item"
          >
            <i class="pi pi-bolt"></i>
            <span>Sorts</span>
          </a>

          <a
            routerLink="/admin/items"
            routerLinkActive="active"
            class="nav-item"
          >
            <i class="pi pi-box"></i>
            <span>Objets</span>
          </a>

          <a
            routerLink="/admin/logs"
            routerLinkActive="active"
            class="nav-item"
          >
            <i class="pi pi-database"></i>
            <span>Logs</span>
          </a>
        </nav>

        <div class="sidebar-footer">
          <div class="user-info">
            <p-avatar
              [label]="userInitial()"
              styleClass="mr-2"
              shape="circle"
            ></p-avatar>
            <div class="user-details">
              <span class="user-name">{{ user()?.username }}</span>
              <span class="user-role">{{ user()?.role }}</span>
            </div>
          </div>
          <p-button
            icon="pi pi-sign-out"
            [text]="true"
            severity="secondary"
            (onClick)="logout()"
            pTooltip="Déconnexion"
          ></p-button>
        </div>
      </aside>

      <!-- Main Content -->
      <main class="main-content">
        <router-outlet></router-outlet>
      </main>
    </div>
  `,
  styles: [`
    .admin-layout {
      display: flex;
      min-height: 100vh;
    }

    .sidebar {
      width: 260px;
      background: var(--surface-card);
      border-right: 1px solid var(--surface-border);
      display: flex;
      flex-direction: column;
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      z-index: 100;
    }

    .sidebar-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1.5rem;
      border-bottom: 1px solid var(--surface-border);
    }

    .sidebar-title {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--text-color);
    }

    .sidebar-nav {
      flex: 1;
      padding: 1rem;
      overflow-y: auto;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.875rem 1rem;
      border-radius: 0.5rem;
      color: var(--text-color-secondary);
      text-decoration: none;
      transition: all 0.2s ease;
      margin-bottom: 0.25rem;

      i {
        font-size: 1.125rem;
      }

      span {
        font-weight: 500;
      }

      &:hover {
        background: var(--surface-hover);
        color: var(--text-color);
      }

      &.active {
        background: var(--primary-color);
        color: var(--primary-color-text);

        i, span {
          color: var(--primary-color-text);
        }
      }
    }

    .sidebar-footer {
      padding: 1rem;
      border-top: 1px solid var(--surface-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .user-info {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .user-details {
      display: flex;
      flex-direction: column;
    }

    .user-name {
      font-weight: 500;
      font-size: 0.875rem;
      color: var(--text-color);
    }

    .user-role {
      font-size: 0.75rem;
      color: var(--text-color-secondary);
      text-transform: capitalize;
    }

    .main-content {
      flex: 1;
      margin-left: 260px;
      padding: 2rem;
      background: var(--surface-ground);
      min-height: 100vh;
    }
  `]
})
export class AdminLayoutComponent {
  user = computed(() => this.authService.user());

  userInitial = computed(() => {
    const user = this.user();
    return user?.username?.charAt(0).toUpperCase() || 'U';
  });

  constructor(private authService: AuthService) {}

  logout(): void {
    this.authService.logout();
  }
}
