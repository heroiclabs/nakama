import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { AvatarModule } from 'primeng/avatar';
import { TooltipModule } from 'primeng/tooltip';
import { AuthService } from '../../services/auth.service';
import { User } from '../../models';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, ButtonModule, CardModule, AvatarModule, TooltipModule],
  template: `
    <div class="dashboard-wrapper">
      <!-- Sidebar -->
      <aside class="sidebar">
        <div class="sidebar-logo">
          <div class="logo-icon">
            <i class="pi pi-bolt"></i>
          </div>
          <span class="rank-badge">#1</span>
        </div>

        <nav class="sidebar-nav">
          <button class="nav-item active" pTooltip="Accueil" tooltipPosition="right">
            <i class="pi pi-home"></i>
          </button>

          <div class="nav-group">
            <button class="nav-item" pTooltip="Nouvelle demande" tooltipPosition="right" routerLink="/whitelist">
              <i class="pi pi-plus"></i>
            </button>
            <button class="nav-item" pTooltip="Mes demandes" tooltipPosition="right" routerLink="/whitelist">
              <i class="pi pi-comments"></i>
            </button>
            <button class="nav-item" pTooltip="Reglement" tooltipPosition="right">
              <i class="pi pi-bookmark"></i>
            </button>
          </div>

          @if (isDouanier()) {
            <div class="nav-group">
              <button class="nav-item douanier" pTooltip="Gestion Douanier" tooltipPosition="right" routerLink="/douanier">
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
        <header class="dashboard-header">
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

        <!-- Dashboard Content -->
        <div class="dashboard-content">
          <!-- Hero Banner -->
          <div class="hero-section">
            <div class="hero-content">
              <img src="assets/wanted.svg" alt="Wanted" class="wanted-badge" onerror="this.style.display='none'"/>
              <div class="hero-text">
                <p>De nouveaux sorciers arrivent a Elderwood...</p>
                <p>Rejoignez l'aventure magique !</p>
              </div>
              <a routerLink="/whitelist" class="hero-btn">
                <span>Candidature Whitelist</span>
                <i class="pi pi-arrow-right"></i>
              </a>
            </div>
            <div class="hero-decoration">
              <div class="magic-orb"></div>
            </div>
          </div>

          <!-- Stats Row -->
          <div class="stats-row">
            <div class="stat-card">
              <div class="stat-icon">
                <i class="pi pi-users"></i>
              </div>
              <div class="stat-info">
                <span class="stat-label">Joueurs inscrits</span>
                <span class="stat-highlight">Communaute</span>
              </div>
              <span class="stat-value">127</span>
            </div>

            <div class="stat-card">
              <div class="stat-icon">
                <i class="pi pi-star"></i>
              </div>
              <div class="stat-info">
                <span class="stat-label">Maison dominante</span>
                <span class="stat-highlight">Serpentard</span>
              </div>
              <span class="stat-value">42</span>
            </div>

            <div class="stat-card clickable">
              <div class="stat-icon fire">
                <i class="pi pi-bolt"></i>
              </div>
              <div class="stat-info">
                <span class="stat-label">Votre statut</span>
                <span class="stat-highlight" [class]="getStatusClass()">{{ getWhitelistStatus() }}</span>
              </div>
              <i class="pi pi-chevron-right stat-arrow"></i>
            </div>
          </div>

          <!-- Tickets Section -->
          <div class="tickets-section">
            <div class="section-header">
              <div>
                <span class="section-subtitle">CANDIDATURES</span>
                <h2>Demandes</h2>
              </div>
              <button class="see-all-btn">Tout voir</button>
            </div>

            <div class="tickets-grid">
              <div class="ticket-card">
                <div class="ticket-icon">
                  <i class="pi pi-file-edit"></i>
                </div>
                <h3>Candidature Whitelist</h3>
                <p>Soumettez votre candidature pour rejoindre le serveur Elderwood RP.</p>
                <button class="ticket-btn" routerLink="/whitelist">Postuler</button>
              </div>

              <div class="ticket-card">
                <div class="ticket-icon">
                  <i class="pi pi-question-circle"></i>
                </div>
                <h3>Support</h3>
                <p>Besoin d'aide ? Contactez notre equipe pour toute question.</p>
                <button class="ticket-btn" disabled>Bientot disponible</button>
              </div>

              <div class="ticket-card">
                <div class="ticket-icon">
                  <i class="pi pi-users"></i>
                </div>
                <h3>Candidature Staff</h3>
                <p>Rejoignez l'equipe Elderwood en tant que moderateur ou game master.</p>
                <button class="ticket-btn" disabled>Bientot disponible</button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  `,
  styles: [`
    .dashboard-wrapper {
      display: flex;
      min-height: 100vh;
      background: #0c0c0c;
    }

    // Sidebar
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

      .logo-icon {
        width: 50px;
        height: 50px;
        background: linear-gradient(135deg, var(--elderwood-primary) 0%, var(--elderwood-gold) 100%);
        border-radius: 16px;
        display: flex;
        align-items: center;
        justify-content: center;

        i {
          font-size: 1.5rem;
          color: #0c0c0c;
        }
      }

      .rank-badge {
        position: absolute;
        top: -5px;
        right: -15px;
        color: var(--elderwood-primary);
        font-weight: bold;
        font-size: 0.8rem;
      }
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

      i {
        font-size: 1.25rem;
      }

      &:hover {
        background: #2a2a30;
        color: white;
        transform: translateY(-2px);
      }

      &.active {
        background: var(--elderwood-primary);
        color: #0c0c0c;
      }
    }

    .sidebar-bottom {
      margin-top: auto;
      background: #1d1f21;
      border-radius: 30px;
      padding: 0.5rem;
    }

    // Main Content
    .main-content {
      flex: 1;
      margin-left: 80px;
      padding: 1.5rem 2rem;
    }

    // Header
    .dashboard-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 2rem;
      position: relative;
    }

    .search-bar {
      display: flex;
      align-items: center;
      background: #1a1c1e;
      border-radius: 30px;
      padding: 0.5rem 0.5rem 0.5rem 1rem;
      gap: 0.75rem;

      i {
        color: rgba(255, 255, 255, 0.4);
      }

      input {
        background: transparent;
        border: none;
        color: white;
        width: 200px;
        outline: none;

        &::placeholder {
          color: rgba(255, 255, 255, 0.4);
        }
      }

      .search-btn {
        background: #232527;
        border: none;
        color: white;
        padding: 0.5rem 1rem;
        border-radius: 20px;
        cursor: pointer;
        transition: all 0.3s ease;

        &:hover {
          background: #2a2a30;
        }
      }
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 1rem;
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

      i {
        color: #5865F2;
      }

      span {
        font-size: 0.85rem;
      }

      &:hover {
        background: #1e2e38;
      }
    }

    .social-icons {
      display: flex;
      gap: 0.25rem;
    }

    .social-btn, .icon-btn {
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

      &:hover {
        color: var(--elderwood-primary);
      }
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

      &:hover {
        background: rgba(255, 255, 255, 0.05);
      }

      .user-info {
        display: flex;
        flex-direction: column;

        .user-name {
          font-weight: 500;
          color: white;
        }

        .user-role {
          font-size: 0.75rem;
          color: var(--elderwood-primary);
          font-weight: 600;
        }
      }

      i {
        color: rgba(255, 255, 255, 0.5);
        font-size: 0.75rem;
      }
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

      button {
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

        &:hover {
          background: rgba(255, 255, 255, 0.1);
        }
      }
    }

    // Hero Section
    .hero-section {
      background: linear-gradient(135deg, rgba(26, 28, 30, 0.9) 0%, rgba(12, 12, 12, 0.9) 100%);
      border-radius: 48px;
      padding: 2.5rem;
      margin-bottom: 1.5rem;
      position: relative;
      overflow: hidden;
      border: 5px solid rgba(32, 37, 42, 0.6);
      min-height: 280px;
      display: flex;
      align-items: center;

      &::before {
        content: '';
        position: absolute;
        bottom: -50px;
        left: 0;
        right: 0;
        height: 150px;
        background: var(--elderwood-primary);
        opacity: 0.2;
        filter: blur(50px);
        border-radius: 50%;
      }
    }

    .hero-content {
      position: relative;
      z-index: 1;
      flex: 1;

      .wanted-badge {
        height: 50px;
        margin-bottom: 1rem;
      }

      .hero-text {
        margin-bottom: 1.5rem;

        p {
          color: rgba(255, 255, 255, 0.7);
          font-size: 1rem;
          margin: 0.25rem 0;
        }
      }

      .hero-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        background: var(--elderwood-primary);
        color: #0c0c0c;
        padding: 0.75rem 1.5rem;
        border-radius: 30px;
        text-decoration: none;
        font-weight: 600;
        transition: all 0.3s ease;

        &:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 30px rgba(201, 162, 39, 0.3);
        }
      }
    }

    .hero-decoration {
      position: absolute;
      right: 50px;
      top: 50%;
      transform: translateY(-50%);

      .magic-orb {
        width: 200px;
        height: 200px;
        background: radial-gradient(circle, var(--elderwood-primary) 0%, transparent 70%);
        border-radius: 50%;
        opacity: 0.3;
        animation: pulse 3s infinite;
      }
    }

    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 0.3; }
      50% { transform: scale(1.1); opacity: 0.5; }
    }

    // Stats Row
    .stats-row {
      display: flex;
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .stat-card {
      flex: 1;
      background: #1d1f21;
      border-radius: 24px;
      padding: 1.25rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      transition: all 0.3s ease;

      &.clickable {
        cursor: pointer;

        &:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        }
      }

      .stat-icon {
        width: 48px;
        height: 48px;
        background: #313234;
        border-radius: 16px;
        display: flex;
        align-items: center;
        justify-content: center;

        i {
          font-size: 1.25rem;
          color: rgba(255, 255, 255, 0.6);
        }

        &.fire i {
          color: var(--elderwood-primary);
        }
      }

      .stat-info {
        flex: 1;

        .stat-label {
          display: block;
          font-size: 0.85rem;
          color: white;
          font-weight: 500;
        }

        .stat-highlight {
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--elderwood-accent);

          &.pending { color: #f59e0b; }
          &.approved { color: #22c55e; }
          &.rejected { color: #ef4444; }
          &.none { color: rgba(255,255,255,0.5); }
        }
      }

      .stat-value {
        font-size: 1rem;
        color: rgba(255, 255, 255, 0.3);
        font-weight: 500;
      }

      .stat-arrow {
        color: rgba(255, 255, 255, 0.3);
      }
    }

    // Tickets Section
    .tickets-section {
      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;

        .section-subtitle {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.4);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          font-weight: 600;
        }

        h2 {
          font-size: 1.5rem;
          color: white;
          margin: 0.25rem 0 0 0;
        }

        .see-all-btn {
          background: transparent;
          border: none;
          color: var(--elderwood-accent);
          cursor: pointer;
          font-size: 0.9rem;
          transition: all 0.3s ease;

          &:hover {
            text-decoration: underline;
          }
        }
      }
    }

    .tickets-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1.5rem;
    }

    .ticket-card {
      background: transparent;
      border-radius: 16px;
      padding: 1.5rem;
      transition: all 0.3s ease;

      &:hover {
        background: #1a1d1f;
        transform: translateY(-2px);
      }

      .ticket-icon {
        color: var(--elderwood-accent);
        margin-bottom: 1rem;

        i {
          font-size: 1.5rem;
        }
      }

      h3 {
        font-size: 1.1rem;
        color: white;
        margin-bottom: 0.75rem;
      }

      p {
        font-size: 0.9rem;
        color: rgba(255, 255, 255, 0.6);
        margin-bottom: 1.5rem;
        line-height: 1.5;
      }

      .ticket-btn {
        width: 100%;
        padding: 0.875rem;
        background: #15181a;
        border: 3px solid #191b1d;
        color: rgba(255, 255, 255, 0.5);
        border-radius: 30px;
        cursor: pointer;
        font-weight: 500;
        transition: all 0.3s ease;

        &:hover:not(:disabled) {
          background: #1a1d1f;
          border-color: rgba(255, 255, 255, 0.1);
          color: white;
        }

        &:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      }
    }

    // Responsive
    @media (max-width: 1200px) {
      .tickets-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    @media (max-width: 768px) {
      .sidebar {
        display: none;
      }

      .main-content {
        margin-left: 0;
        padding: 1rem;
      }

      .stats-row {
        flex-direction: column;
      }

      .tickets-grid {
        grid-template-columns: 1fr;
      }

      .hero-decoration {
        display: none;
      }
    }
  `]
})
export class DashboardComponent implements OnInit {
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

  getWhitelistStatus(): string {
    const status = this.user()?.whitelist_status;
    switch (status) {
      case 'pending': return 'En attente';
      case 'approved': return 'Approuve';
      case 'rejected': return 'Refuse';
      default: return 'Non postule';
    }
  }

  getStatusClass(): string {
    return this.user()?.whitelist_status || 'none';
  }

  isDouanier(): boolean {
    const user = this.user();
    if (!user) return false;

    // Check for admin or douanier role
    const role = user.role;
    if (role === 'admin' || role === 'douanier') return true;

    // Check roles array if exists
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
