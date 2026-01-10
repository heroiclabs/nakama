import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { User } from '../../models';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
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

        <div class="stat-card clickable" routerLink="/whitelist">
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
  `,
  styles: [`
    .dashboard-content {
      animation: fadeIn 0.3s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Hero Section */
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
    }

    .hero-section::before {
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

    .hero-content {
      position: relative;
      z-index: 1;
      flex: 1;
    }

    .hero-content .wanted-badge {
      height: 50px;
      margin-bottom: 1rem;
    }

    .hero-text {
      margin-bottom: 1.5rem;
    }

    .hero-text p {
      color: rgba(255, 255, 255, 0.7);
      font-size: 1rem;
      margin: 0.25rem 0;
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
    }

    .hero-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 30px rgba(201, 162, 39, 0.3);
    }

    .hero-decoration {
      position: absolute;
      right: 50px;
      top: 50%;
      transform: translateY(-50%);
    }

    .magic-orb {
      width: 200px;
      height: 200px;
      background: radial-gradient(circle, var(--elderwood-primary) 0%, transparent 70%);
      border-radius: 50%;
      opacity: 0.3;
      animation: pulse 3s infinite;
    }

    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 0.3; }
      50% { transform: scale(1.1); opacity: 0.5; }
    }

    /* Stats Row */
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
    }

    .stat-card.clickable {
      cursor: pointer;
    }

    .stat-card.clickable:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    }

    .stat-icon {
      width: 48px;
      height: 48px;
      background: #313234;
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .stat-icon i {
      font-size: 1.25rem;
      color: rgba(255, 255, 255, 0.6);
    }

    .stat-icon.fire i {
      color: var(--elderwood-primary);
    }

    .stat-info {
      flex: 1;
    }

    .stat-info .stat-label {
      display: block;
      font-size: 0.85rem;
      color: white;
      font-weight: 500;
    }

    .stat-info .stat-highlight {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--elderwood-accent);
    }

    .stat-info .stat-highlight.pending { color: #f59e0b; }
    .stat-info .stat-highlight.approved { color: #22c55e; }
    .stat-info .stat-highlight.rejected { color: #ef4444; }
    .stat-info .stat-highlight.none { color: rgba(255,255,255,0.5); }

    .stat-value {
      font-size: 1rem;
      color: rgba(255, 255, 255, 0.3);
      font-weight: 500;
    }

    .stat-arrow {
      color: rgba(255, 255, 255, 0.3);
    }

    /* Tickets Section */
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }

    .section-subtitle {
      font-size: 0.75rem;
      color: rgba(255, 255, 255, 0.4);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      font-weight: 600;
    }

    .section-header h2 {
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
    }

    .see-all-btn:hover {
      text-decoration: underline;
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
    }

    .ticket-card:hover {
      background: #1a1d1f;
      transform: translateY(-2px);
    }

    .ticket-icon {
      color: var(--elderwood-accent);
      margin-bottom: 1rem;
    }

    .ticket-icon i {
      font-size: 1.5rem;
    }

    .ticket-card h3 {
      font-size: 1.1rem;
      color: white;
      margin-bottom: 0.75rem;
    }

    .ticket-card p {
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
    }

    .ticket-btn:hover:not(:disabled) {
      background: #1a1d1f;
      border-color: rgba(255, 255, 255, 0.1);
      color: white;
    }

    .ticket-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Responsive */
    @media (max-width: 1200px) {
      .tickets-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    @media (max-width: 768px) {
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

  constructor(private authService: AuthService) {}

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
}
