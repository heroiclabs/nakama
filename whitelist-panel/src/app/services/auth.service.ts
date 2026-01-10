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
  private readonly TOKEN_KEY = 'elderwood_panel_token';
  private readonly USER_KEY = 'elderwood_panel_user';
  private readonly USER_TIMESTAMP_KEY = 'elderwood_panel_user_timestamp';
  private readonly CACHE_DURATION_MS = 5 * 60 * 1000;

  private currentUser = signal<User | null>(null);
  private token = signal<string | null>(null);

  isAuthenticated = computed(() => !!this.token());
  user = computed(() => this.currentUser());

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

      const timestamp = storedTimestamp ? parseInt(storedTimestamp, 10) : 0;
      if (Date.now() - timestamp > this.CACHE_DURATION_MS) {
        this.refreshUserAccount();
      }
    }
  }

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
          let metadata: Record<string, unknown> = {};
          try {
            metadata = JSON.parse(account.user.metadata || '{}');
          } catch {
            metadata = {};
          }

          const user: User = {
            id: account.user.id,
            username: account.user.username,
            role: (metadata['role'] as UserRole) || 'user',
            email_verified: metadata['email_verified'] as boolean || false,
            discord_linked: metadata['discord_linked'] as boolean || false,
            discord_username: metadata['discord_username'] as string || '',
            whitelist_status: (metadata['whitelist_status'] as User['whitelist_status']) || 'none'
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
        let metadata: Record<string, unknown> = {};
        try {
          metadata = JSON.parse(account.user.metadata || '{}');
        } catch {
          metadata = {};
        }

        const user: User = {
          id: account.user.id,
          username: account.user.username,
          role: (metadata['role'] as UserRole) || 'user',
          email_verified: metadata['email_verified'] as boolean || false,
          discord_linked: metadata['discord_linked'] as boolean || false,
          discord_username: metadata['discord_username'] as string || '',
          whitelist_status: (metadata['whitelist_status'] as User['whitelist_status']) || 'none'
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

  // Email verification
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

    return this.http.post<{payload: string}>(url, JSON.stringify(JSON.stringify({ token })), {
      headers: {
        'Authorization': `Basic ${btoa(environment.nakamaHttpKey + ':')}`,
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

  // Discord linking
  getDiscordAuthUrl(): Observable<{url: string}> {
    const url = `${environment.nakamaUrl}/v2/rpc/elderwood_discord_auth_url`;

    // Pass source: 'panel' to get the correct redirect URI
    const payload = JSON.stringify({ source: 'panel' });

    return this.http.post<{payload: string}>(url, JSON.stringify(payload), {
      headers: {
        'Authorization': `Bearer ${this.token()}`,
        'Content-Type': 'application/json'
      }
    }).pipe(
      map(response => JSON.parse(response.payload || '{}')),
      catchError(error => {
        console.error('Failed to get Discord auth URL:', error);
        throw error;
      })
    );
  }

  discordCallback(code: string, state: string): Observable<{status: string, discord_id: string, discord_username: string}> {
    const url = `${environment.nakamaUrl}/v2/rpc/elderwood_discord_callback`;

    return this.http.post<{payload: string}>(url, JSON.stringify(JSON.stringify({ code, state })), {
      headers: {
        'Authorization': `Bearer ${this.token()}`,
        'Content-Type': 'application/json'
      }
    }).pipe(
      map(response => JSON.parse(response.payload || '{}')),
      catchError(error => {
        console.error('Failed to complete Discord callback:', error);
        throw error;
      })
    );
  }

  checkDiscordLinked(): Observable<{linked: boolean, discord_id: string, discord_username: string}> {
    const url = `${environment.nakamaUrl}/v2/rpc/elderwood_check_discord_linked`;

    return this.http.post<{payload: string}>(url, '""', {
      headers: {
        'Authorization': `Bearer ${this.token()}`,
        'Content-Type': 'application/json'
      }
    }).pipe(
      map(response => JSON.parse(response.payload || '{}')),
      catchError(error => {
        console.error('Failed to check Discord status:', error);
        throw error;
      })
    );
  }
}
