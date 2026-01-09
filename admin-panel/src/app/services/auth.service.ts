import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap, catchError, of, map, firstValueFrom } from 'rxjs';
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
  private readonly USER_TIMESTAMP_KEY = 'elderwood_user_timestamp';
  private readonly CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

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
    const storedTimestamp = localStorage.getItem(this.USER_TIMESTAMP_KEY);

    if (storedToken && storedUser) {
      this.token.set(storedToken);
      this.currentUser.set(JSON.parse(storedUser));

      // Refresh user data if cache is stale
      const timestamp = storedTimestamp ? parseInt(storedTimestamp, 10) : 0;
      if (Date.now() - timestamp > this.CACHE_DURATION_MS) {
        this.refreshUserAccount();
      }
    }
  }

  // Public method to refresh user account from server
  refreshUserAccount(): Promise<User | null> {
    if (!this.token()) {
      return Promise.resolve(null);
    }

    const url = `${environment.nakamaUrl}/v2/account`;

    return firstValueFrom(
      this.http.get<NakamaAccount>(url, {
        headers: {
          'Authorization': `Bearer ${this.token()}`
        }
      }).pipe(
        map(account => {
          let role: UserRole = 'user';
          try {
            const metadata = JSON.parse(account.user.metadata || '{}');
            role = metadata.role || 'user';
          } catch {
            role = 'user';
          }

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
          localStorage.setItem(this.USER_TIMESTAMP_KEY, Date.now().toString());

          return user;
        }),
        catchError(err => {
          console.error('Failed to refresh account:', err);
          return of(null);
        })
      )
    );
  }

  getToken(): string | null {
    return this.token();
  }

  register(email: string, password: string, username: string): Observable<boolean> {
    const url = `${environment.nakamaUrl}/v2/account/authenticate/email?create=true&username=${encodeURIComponent(username)}`;

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
      tap(() => this.fetchUserAccount()),
      map(() => true),
      catchError(error => {
        console.error('Registration failed:', error);
        return of(false);
      })
    );
  }

  login(email: string, password: string): Observable<boolean> {
    const url = `${environment.nakamaUrl}/v2/account/authenticate/email?create=false`;

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
    localStorage.removeItem(this.USER_TIMESTAMP_KEY);
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

  // Email verification methods
  sendVerificationEmail(): Observable<{status: string}> {
    const url = `${environment.nakamaUrl}/v2/rpc/elderwood_send_verification_email`;

    return this.http.post<{payload: string}>(url, '""', {
      headers: {
        'Authorization': `Bearer ${this.token()}`,
        'Content-Type': 'application/json'
      }
    }).pipe(
      map(response => JSON.parse(response.payload || '{}')),
      catchError(error => {
        console.error('Failed to send verification email:', error);
        throw error;
      })
    );
  }

  verifyEmail(token: string): Observable<{status: string}> {
    const url = `${environment.nakamaUrl}/v2/rpc/elderwood_verify_email`;

    // Double stringify: Nakama RPC expects a JSON string containing the payload
    return this.http.post<{payload: string}>(url, JSON.stringify(JSON.stringify({ token })), {
      headers: {
        'Authorization': `Basic ${btoa(environment.nakamaKey + ':')}`,
        'Content-Type': 'application/json'
      }
    }).pipe(
      map(response => JSON.parse(response.payload || '{}')),
      catchError(error => {
        console.error('Failed to verify email:', error);
        throw error;
      })
    );
  }

  checkEmailVerified(): Observable<{verified: boolean, email: string}> {
    const url = `${environment.nakamaUrl}/v2/rpc/elderwood_check_email_verified`;

    return this.http.post<{payload: string}>(url, '""', {
      headers: {
        'Authorization': `Bearer ${this.token()}`,
        'Content-Type': 'application/json'
      }
    }).pipe(
      map(response => JSON.parse(response.payload || '{}')),
      catchError(error => {
        console.error('Failed to check email verification:', error);
        throw error;
      })
    );
  }

  resendVerificationEmail(): Observable<{status: string}> {
    return this.sendVerificationEmail();
  }
}
