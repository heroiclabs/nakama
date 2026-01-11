import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, catchError, of } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export type WhitelistStatus = 'pending' | 'rp_approved' | 'hrp_pending' | 'hrp_approved' | 'oral_pending' | 'oral_scheduled' | 'approved' | 'rejected';

export interface WhitelistApplication {
  id: string;
  user_id: string;
  username: string;
  email: string;
  discord_id: string;
  discord_username: string;

  // Étape 1: RP (In-Game Character)
  character_first_name: string;
  character_last_name: string;
  character_age: number;
  character_blood: string;
  character_history: string;
  character_motivation: string;

  // Étape 2: HRP (Hors RP - Real Person)
  hrp_first_name?: string;
  hrp_age?: number;
  hrp_experience_years?: number;
  hrp_experience_text?: string;
  hrp_hp_knowledge?: string;

  // Étape 3: Oral
  oral_proposed_week_start?: string;
  oral_proposed_week_end?: string;
  oral_selected_slot?: string;
  oral_discord_invite_sent?: boolean;

  // Status
  status: WhitelistStatus;
  current_step: 'rp' | 'hrp' | 'oral';
  rejection_reason?: string;
  rejected_step?: 'rp' | 'hrp' | 'oral';
  reviewed_by?: string;
  reviewed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface WhitelistStatusResponse {
  has_application: boolean;
  can_apply: boolean;
  can_submit_hrp: boolean;
  can_select_oral_slot: boolean;
  application?: WhitelistApplication;
  cooldown_remaining?: string;
}

export interface OralSlot {
  application_id: string;
  user_id: string;
  username: string;
  discord_username: string;
  character_name: string;
  selected_slot: string;
  invite_sent: boolean;
}

export interface OralCalendarResponse {
  scheduled_orals: OralSlot[];
  total: number;
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

  // Submit a new RP whitelist application (Step 1)
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
        console.error('Failed to submit RP whitelist application:', error);
        throw error;
      })
    );
  }

  // Submit HRP whitelist application (Step 2)
  submitHRPApplication(data: {
    hrp_first_name: string;
    hrp_age: number;
    hrp_experience_years: number;
    hrp_experience_text: string;
    hrp_hp_knowledge: string;
  }): Observable<{ status: string; app_id: string; message: string }> {
    const url = `${environment.nakamaUrl}/v2/rpc/elderwood_submit_whitelist_hrp`;
    const payload = JSON.stringify(data);

    return this.http.post<{ payload: string }>(url, JSON.stringify(payload), {
      headers: this.getHeaders()
    }).pipe(
      map(response => JSON.parse(response.payload || '{}')),
      catchError(error => {
        console.error('Failed to submit HRP whitelist application:', error);
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

  // Propose an oral week (Douanier only)
  proposeOralWeek(
    applicationId: string,
    userId: string,
    weekStart: string,
    weekEnd: string
  ): Observable<{ status: string; message: string; week_start: string; week_end: string }> {
    const url = `${environment.nakamaUrl}/v2/rpc/elderwood_propose_oral_week`;
    const payload = JSON.stringify({
      application_id: applicationId,
      user_id: userId,
      week_start: weekStart,
      week_end: weekEnd
    });

    return this.http.post<{ payload: string }>(url, JSON.stringify(payload), {
      headers: this.getHeaders()
    }).pipe(
      map(response => JSON.parse(response.payload || '{}')),
      catchError(error => {
        console.error('Failed to propose oral week:', error);
        throw error;
      })
    );
  }

  // Select an oral slot (Player)
  selectOralSlot(selectedSlot: string): Observable<{ status: string; message: string; selected_slot: string }> {
    const url = `${environment.nakamaUrl}/v2/rpc/elderwood_select_oral_slot`;
    const payload = JSON.stringify({ selected_slot: selectedSlot });

    return this.http.post<{ payload: string }>(url, JSON.stringify(payload), {
      headers: this.getHeaders()
    }).pipe(
      map(response => JSON.parse(response.payload || '{}')),
      catchError(error => {
        console.error('Failed to select oral slot:', error);
        throw error;
      })
    );
  }

  // List oral calendar (Douanier only)
  listOralCalendar(): Observable<OralCalendarResponse> {
    const url = `${environment.nakamaUrl}/v2/rpc/elderwood_list_oral_calendar`;

    return this.http.post<{ payload: string }>(url, '""', {
      headers: this.getHeaders()
    }).pipe(
      map(response => JSON.parse(response.payload || '{"scheduled_orals":[],"total":0}')),
      catchError(error => {
        console.error('Failed to list oral calendar:', error);
        throw error;
      })
    );
  }

  // Mark oral invite as sent (Douanier only)
  markOralInviteSent(
    applicationId: string,
    userId: string
  ): Observable<{ status: string; message: string }> {
    const url = `${environment.nakamaUrl}/v2/rpc/elderwood_mark_oral_invite_sent`;
    const payload = JSON.stringify({
      application_id: applicationId,
      user_id: userId
    });

    return this.http.post<{ payload: string }>(url, JSON.stringify(payload), {
      headers: this.getHeaders()
    }).pipe(
      map(response => JSON.parse(response.payload || '{}')),
      catchError(error => {
        console.error('Failed to mark oral invite sent:', error);
        throw error;
      })
    );
  }

  // Helper to get status label in French
  getStatusLabel(status: WhitelistStatus): string {
    switch (status) {
      case 'pending':
        return 'RP en attente';
      case 'rp_approved':
        return 'RP approuvé - HRP à soumettre';
      case 'hrp_pending':
        return 'HRP en attente';
      case 'hrp_approved':
        return 'HRP approuvé - Oral à programmer';
      case 'oral_pending':
        return 'Semaine proposée - En attente de choix';
      case 'oral_scheduled':
        return 'Oral programmé';
      case 'approved':
        return 'Approuvée';
      case 'rejected':
        return 'Refusée';
      default:
        return status;
    }
  }

  // Helper to get step label
  getStepLabel(step: 'rp' | 'hrp' | 'oral'): string {
    switch (step) {
      case 'rp':
        return 'Étape RP';
      case 'hrp':
        return 'Étape HRP';
      case 'oral':
        return 'Étape Oral';
    }
  }

  // Helper to get status severity for PrimeNG
  getStatusSeverity(status: WhitelistStatus): 'info' | 'success' | 'danger' | 'warning' | 'secondary' {
    switch (status) {
      case 'pending':
        return 'warning';
      case 'rp_approved':
        return 'info';
      case 'hrp_pending':
        return 'warning';
      case 'hrp_approved':
        return 'info';
      case 'oral_pending':
        return 'secondary';
      case 'oral_scheduled':
        return 'info';
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
