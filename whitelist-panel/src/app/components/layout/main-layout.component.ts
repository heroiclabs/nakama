import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { AvatarModule } from 'primeng/avatar';
import { TooltipModule } from 'primeng/tooltip';
import { AuthService } from '../../services/auth.service';
import { User } from '../../models';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterOutlet, AvatarModule, TooltipModule],
  template: `
    <div class="layout-wrapper">
      <!-- Sidebar -->
      <aside class="sidebar">
        <div class="sidebar-logo">
          <div class="logo-icon">
            <i class="pi pi-bolt"></i>
          </div>
          <span class="rank-badge">#1</span>
        </div>

        <nav class="sidebar-nav">
          <button class="nav-item" [class.active]="isActive('/dashboard')" pTooltip="Accueil" tooltipPosition="right" routerLink="/dashboard">
            <i class="pi pi-home"></i>
          </button>

          <div class="nav-group">
            <button class="nav-item" [class.active]="isActive('/whitelist')" pTooltip="Candidature" tooltipPosition="right" routerLink="/whitelist">
              <i class="pi pi-file-edit"></i>
            </button>
            <button class="nav-item" pTooltip="Reglement" tooltipPosition="right">
              <i class="pi pi-bookmark"></i>
            </button>
          </div>

          @if (isDouanier()) {
            <div class="nav-group">
              <button class="nav-item douanier" [class.active]="isActive('/douanier')" pTooltip="Gestion Douanier" tooltipPosition="right" routerLink="/douanier">
                <i class="pi pi-shield"></i>
              </button>
            </div>
          }

          <div class="nav-group">
            <button class="nav-item" pTooltip="Lore" tooltipPosition="right">
              <i class="pi pi-book"></i>
            </button>
          </div>
        </nav>

        <div class="sidebar-bottom">
          <button class="nav-item" pTooltip="Parametres" tooltipPosition="right">
            <i class="pi pi-cog"></i>
          </button>
        </div>
      </aside>

      <!-- Main Content -->
      <main class="main-content">
        <!-- Header -->
        <header class="main-header">
          <div class="search-bar">
            <i class="pi pi-search"></i>
            <input type="text" placeholder="Rechercher..." />
            <button class="search-btn">Explorer</button>
          </div>

          <div class="header-actions">
            <button class="discord-link" pTooltip="Discord">
              <i class="pi pi-discord"></i>
              <span>.gg/elderwood</span>
            </button>

            <div class="social-icons">
              <button class="social-btn"><i class="pi pi-twitter"></i></button>
            </div>

            <div class="header-divider"></div>

            <button class="icon-btn" pTooltip="Notifications">
              <i class="pi pi-bell"></i>
            </button>

            <div class="user-menu" (click)="toggleUserMenu()">
              <p-avatar
                [label]="user()?.username?.charAt(0)?.toUpperCase() || '?'"
                shape="circle"
                size="large"
                [style]="{'background-color': 'var(--elderwood-primary)', 'color': '#0c0c0c'}"
              ></p-avatar>
              <div class="user-info">
                <span class="user-name">{{ user()?.username || 'Utilisateur' }}</span>
                <span class="user-role">{{ getWhitelistStatus() }}</span>
              </div>
              <i class="pi pi-chevron-down"></i>
            </div>

            @if (showUserMenu()) {
              <div class="user-dropdown">
                <button (click)="logout()">
                  <i class="pi pi-sign-out"></i>
                  Deconnexion
                </button>
              </div>
            }
          </div>
        </header>

        <!-- Page Content -->
        <div class="page-content">
          <router-outlet></router-outlet>
        </div>
      </main>
    </div>
  `,
  styles: [`
    .layout-wrapper {
      display: flex;
      min-height: 100vh;
      background: #0c0c0c;
    }

    /* Sidebar */
    .sidebar {
      width: 80px;
      background: transparent;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2rem 0;
      position: fixed;
      height: 100vh;
      z-index: 100;
    }

    .sidebar-logo {
      position: relative;
      margin-bottom: 2rem;
    }

    .sidebar-logo .logo-icon {
      width: 50px;
      height: 50px;
      background: linear-gradient(135deg, var(--elderwood-primary) 0%, var(--elderwood-gold) 100%);
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .sidebar-logo .logo-icon i {
      font-size: 1.5rem;
      color: #0c0c0c;
    }

    .sidebar-logo .rank-badge {
      position: absolute;
      top: -5px;
      right: -15px;
      color: var(--elderwood-primary);
      font-weight: bold;
      font-size: 0.8rem;
    }

    .sidebar-nav {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      flex: 1;
    }

    .nav-group {
      background: #1d1f21;
      border-radius: 30px;
      padding: 0.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .nav-item {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: none;
      background: #292a2c;
      color: rgba(255, 255, 255, 0.5);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s ease;
    }

    .nav-item i {
      font-size: 1.25rem;
    }

    .nav-item:hover {
      background: #2a2a30;
      color: white;
      transform: translateY(-2px);
    }

    .nav-item.active {
      background: var(--elderwood-primary);
      color: #0c0c0c;
    }

    .nav-item.douanier.active {
      background: linear-gradient(135deg, #7c3aed, #a855f7);
      color: white;
    }

    .sidebar-bottom {
      margin-top: auto;
      background: #1d1f21;
      border-radius: 30px;
      padding: 0.5rem;
    }

    /* Main Content */
    .main-content {
      flex: 1;
      margin-left: 80px;
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }

    /* Header */
    .main-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1.5rem 2rem;
      position: sticky;
      top: 0;
      background: rgba(12, 12, 12, 0.9);
      backdrop-filter: blur(10px);
      z-index: 50;
    }

    .search-bar {
      display: flex;
      align-items: center;
      background: #1a1c1e;
      border-radius: 30px;
      padding: 0.5rem 0.5rem 0.5rem 1rem;
      gap: 0.75rem;
    }

    .search-bar i {
      color: rgba(255, 255, 255, 0.4);
    }

    .search-bar input {
      background: transparent;
      border: none;
      color: white;
      width: 200px;
      outline: none;
    }

    .search-bar input::placeholder {
      color: rgba(255, 255, 255, 0.4);
    }

    .search-btn {
      background: #232527;
      border: none;
      color: white;
      padding: 0.5rem 1rem;
      border-radius: 20px;
      cursor: pointer;
      transition: all 0.3s ease;
    }

    .search-btn:hover {
      background: #2a2a30;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 1rem;
      position: relative;
    }

    .discord-link {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: #18252d;
      border: none;
      color: white;
      padding: 0.5rem 1rem;
      border-radius: 20px;
      cursor: pointer;
      transition: all 0.3s ease;
    }

    .discord-link i {
      color: #5865F2;
    }

    .discord-link span {
      font-size: 0.85rem;
    }

    .discord-link:hover {
      background: #1e2e38;
    }

    .social-icons {
      display: flex;
      gap: 0.25rem;
    }

    .social-btn,
    .icon-btn {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: rgba(255, 255, 255, 0.6);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s ease;
    }

    .social-btn:hover,
    .icon-btn:hover {
      color: var(--elderwood-primary);
    }

    .header-divider {
      width: 1px;
      height: 30px;
      background: rgba(255, 255, 255, 0.1);
    }

    .user-menu {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      cursor: pointer;
      padding: 0.5rem;
      border-radius: 30px;
      transition: all 0.3s ease;
    }

    .user-menu:hover {
      background: rgba(255, 255, 255, 0.05);
    }

    .user-info {
      display: flex;
      flex-direction: column;
    }

    .user-info .user-name {
      font-weight: 500;
      color: white;
    }

    .user-info .user-role {
      font-size: 0.75rem;
      color: var(--elderwood-primary);
      font-weight: 600;
    }

    .user-menu > i {
      color: rgba(255, 255, 255, 0.5);
      font-size: 0.75rem;
    }

    .user-dropdown {
      position: absolute;
      top: 100%;
      right: 0;
      background: #1d1f21;
      border-radius: 12px;
      padding: 0.5rem;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
      z-index: 1000;
      margin-top: 0.5rem;
    }

    .user-dropdown button {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      width: 100%;
      padding: 0.75rem 1rem;
      background: transparent;
      border: none;
      color: white;
      cursor: pointer;
      border-radius: 8px;
      transition: all 0.3s ease;
    }

    .user-dropdown button:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    /* Page Content */
    .page-content {
      flex: 1;
      padding: 0 2rem 2rem;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .sidebar {
        display: none;
      }

      .main-content {
        margin-left: 0;
      }

      .main-header {
        padding: 1rem;
      }

      .page-content {
        padding: 0 1rem 1rem;
      }

      .search-bar input {
        width: 120px;
      }

      .discord-link span {
        display: none;
      }

      .user-info {
        display: none;
      }
    }
  `]
})
export class MainLayoutComponent implements OnInit {
  user = signal<User | null>(null);
  showUserMenu = signal(false);

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.user.set(this.authService.user());
    this.authService.refreshUserAccount().then(user => {
      if (user) {
        this.user.set(user);
      }
    });
  }

  isActive(path: string): boolean {
    return this.router.url === path;
  }

  getWhitelistStatus(): string {
    const status = this.user()?.whitelist_status;
    switch (status) {
      case 'pending': return 'En attente';
      case 'approved': return 'Approuve';
      case 'rejected': return 'Refuse';
      default: return 'Non postule';
    }
  }

  isDouanier(): boolean {
    const user = this.user();
    if (!user) return false;

    const role = user.role;
    if (role === 'admin' || role === 'douanier') return true;

    const roles = user.roles;
    if (roles && Array.isArray(roles)) {
      return roles.includes('admin') || roles.includes('douanier');
    }

    return false;
  }

  toggleUserMenu(): void {
    this.showUserMenu.update(v => !v);
  }

  logout(): void {
    this.authService.logout();
  }
}
