import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap, catchError, of, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { User, UserRole } from '../models';

interface NakamaSession {
  token: string;
  refresh_token: string;
  created: boolean;
}

interface NakamaAccount {
  user: {
    id: string;
    username: string;
    metadata: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly TOKEN_KEY = 'elderwood_token';
  private readonly USER_KEY = 'elderwood_user';

  private currentUser = signal<User | null>(null);
  private token = signal<string | null>(null);

  isAuthenticated = computed(() => !!this.token());
  user = computed(() => this.currentUser());
  isAdmin = computed(() => this.currentUser()?.role === 'admin');

  constructor(
    private http: HttpClient,
    private router: Router
  ) {
    this.loadStoredSession();
  }

  private loadStoredSession(): void {
    const storedToken = localStorage.getItem(this.TOKEN_KEY);
    const storedUser = localStorage.getItem(this.USER_KEY);

    if (storedToken && storedUser) {
      this.token.set(storedToken);
      this.currentUser.set(JSON.parse(storedUser));
    }
  }

  getToken(): string | null {
    return this.token();
  }

  login(email: string, password: string): Observable<boolean> {
    // create=true permet de créer automatiquement le compte s'il n'existe pas
    const url = `${environment.nakamaUrl}/v2/account/authenticate/email?create=true`;
    const auth = btoa(`${email}:${password}`);

    return this.http.post<NakamaSession>(url, {
      email,
      password
    }, {
      headers: {
        'Authorization': `Basic ${btoa(environment.nakamaKey + ':')}`,
        'Content-Type': 'application/json'
      }
    }).pipe(
      tap(session => {
        this.token.set(session.token);
        localStorage.setItem(this.TOKEN_KEY, session.token);
      }),
      // After login, fetch user account to get metadata (role)
      tap(() => this.fetchUserAccount()),
      map(() => true),
      catchError(error => {
        console.error('Login failed:', error);
        return of(false);
      })
    );
  }

  private fetchUserAccount(): void {
    const url = `${environment.nakamaUrl}/v2/account`;

    this.http.get<NakamaAccount>(url, {
      headers: {
        'Authorization': `Bearer ${this.token()}`
      }
    }).subscribe({
      next: (account) => {
        let role: UserRole = 'user';
        try {
          const metadata = JSON.parse(account.user.metadata || '{}');
          role = metadata.role || 'user';
        } catch {
          role = 'user';
        }

        // En mode dev, bypass la vérification du rôle admin
        if (environment.devBypassAdminCheck && !environment.production) {
          role = 'admin';
        }

        const user: User = {
          id: account.user.id,
          username: account.user.username,
          role
        };

        this.currentUser.set(user);
        localStorage.setItem(this.USER_KEY, JSON.stringify(user));
      },
      error: (err) => {
        console.error('Failed to fetch account:', err);
      }
    });
  }

  logout(): void {
    this.token.set(null);
    this.currentUser.set(null);
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    this.router.navigate(['/login']);
  }

  hasRole(role: UserRole): boolean {
    const user = this.currentUser();
    if (!user) return false;

    // Admin has access to everything
    if (user.role === 'admin') return true;

    // Moderator has access to moderator and user roles
    if (user.role === 'moderator' && (role === 'moderator' || role === 'user')) return true;

    return user.role === role;
  }
}
