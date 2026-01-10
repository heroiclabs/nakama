import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, catchError, of } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export type WhitelistStatus = 'pending' | 'approved' | 'rejected';

export interface WhitelistApplication {
  id: string;
  user_id: string;
  username: string;
  email: string;
  discord_id: string;
  discord_username: string;
  character_first_name: string;
  character_last_name: string;
  character_age: number;
  character_blood: string;
  character_history: string;
  character_motivation: string;
  status: WhitelistStatus;
  rejection_reason?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface WhitelistStatusResponse {
  has_application: boolean;
  can_apply: boolean;
  application?: WhitelistApplication;
  cooldown_remaining?: string;
}

export interface WhitelistListResponse {
  applications: WhitelistApplication[];
  total: number;
}

@Injectable({
  providedIn: 'root'
})
export class WhitelistService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);

  // Signals for reactive state
  userStatus = signal<WhitelistStatusResponse | null>(null);
  applications = signal<WhitelistApplication[]>([]);
  loading = signal(false);

  private getHeaders() {
    return {
      'Authorization': `Bearer ${this.authService.getToken()}`,
      'Content-Type': 'application/json'
    };
  }

  // Submit a new whitelist application
  submitApplication(data: {
    character_first_name: string;
    character_last_name: string;
    character_age: number;
    character_blood: string;
    character_history: string;
    character_motivation: string;
  }): Observable<{ status: string; app_id: string; message: string }> {
    const url = `${environment.nakamaUrl}/v2/rpc/elderwood_submit_whitelist`;
    const payload = JSON.stringify(data);

    return this.http.post<{ payload: string }>(url, JSON.stringify(payload), {
      headers: this.getHeaders()
    }).pipe(
      map(response => JSON.parse(response.payload || '{}')),
      catchError(error => {
        console.error('Failed to submit whitelist application:', error);
        throw error;
      })
    );
  }

  // Get current user's whitelist status
  getStatus(): Observable<WhitelistStatusResponse> {
    const url = `${environment.nakamaUrl}/v2/rpc/elderwood_get_whitelist_status`;

    return this.http.post<{ payload: string }>(url, '""', {
      headers: this.getHeaders()
    }).pipe(
      map(response => {
        const status = JSON.parse(response.payload || '{}');
        this.userStatus.set(status);
        return status;
      }),
      catchError(error => {
        console.error('Failed to get whitelist status:', error);
        throw error;
      })
    );
  }

  // List all applications (Douanier only)
  listApplications(status?: WhitelistStatus): Observable<WhitelistListResponse> {
    const url = `${environment.nakamaUrl}/v2/rpc/elderwood_list_whitelist_applications`;
    const payload = status ? JSON.stringify({ status }) : '""';

    return this.http.post<{ payload: string }>(url, JSON.stringify(payload), {
      headers: this.getHeaders()
    }).pipe(
      map(response => {
        const data = JSON.parse(response.payload || '{"applications":[],"total":0}');
        this.applications.set(data.applications || []);
        return data;
      }),
      catchError(error => {
        console.error('Failed to list whitelist applications:', error);
        throw error;
      })
    );
  }

  // Review an application (Douanier only)
  reviewApplication(
    applicationId: string,
    userId: string,
    approved: boolean,
    rejectionReason?: string
  ): Observable<{ status: string; message: string }> {
    const url = `${environment.nakamaUrl}/v2/rpc/elderwood_review_whitelist`;
    const payload = JSON.stringify({
      application_id: applicationId,
      user_id: userId,
      approved,
      rejection_reason: rejectionReason || ''
    });

    return this.http.post<{ payload: string }>(url, JSON.stringify(payload), {
      headers: this.getHeaders()
    }).pipe(
      map(response => JSON.parse(response.payload || '{}')),
      catchError(error => {
        console.error('Failed to review application:', error);
        throw error;
      })
    );
  }

  // Helper to get status label in French
  getStatusLabel(status: WhitelistStatus): string {
    switch (status) {
      case 'pending':
        return 'En attente de validation';
      case 'approved':
        return 'Approuvée';
      case 'rejected':
        return 'Refusée';
      default:
        return status;
    }
  }

  // Helper to get status severity for PrimeNG
  getStatusSeverity(status: WhitelistStatus): 'info' | 'success' | 'danger' | 'warning' {
    switch (status) {
      case 'pending':
        return 'warning';
      case 'approved':
        return 'success';
      case 'rejected':
        return 'danger';
      default:
        return 'info';
    }
  }

  // Helper to get blood status options
  getBloodOptions() {
    return [
      { label: 'Sang-Pur', value: 'pure' },
      { label: 'Sang-Mêlé', value: 'mixed' },
      { label: 'Né-Moldu', value: 'muggle-born' }
    ];
  }

  // Helper to get blood label in French
  getBloodLabel(blood: string): string {
    switch (blood) {
      case 'pure':
        return 'Sang-Pur';
      case 'mixed':
        return 'Sang-Mêlé';
      case 'muggle-born':
        return 'Né-Moldu';
      default:
        return blood;
    }
  }
}
