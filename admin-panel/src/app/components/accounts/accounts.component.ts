import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// PrimeNG
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { InputTextModule } from 'primeng/inputtext';
import { DropdownModule } from 'primeng/dropdown';
import { ToastModule } from 'primeng/toast';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { MessageService, ConfirmationService } from 'primeng/api';

import { NakamaService } from '../../services/nakama.service';
import { AccountInfo, AdminRole } from '../../models';

interface RoleOption {
  label: string;
  value: AdminRole;
}

@Component({
  selector: 'app-accounts',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    TableModule,
    InputTextModule,
    DropdownModule,
    ToastModule,
    ProgressSpinnerModule,
    TagModule,
    DialogModule,
    ConfirmDialogModule
  ],
  providers: [MessageService, ConfirmationService],
  template: `
    <p-toast></p-toast>
    <p-confirmDialog header="Confirmation" icon="pi pi-exclamation-triangle"></p-confirmDialog>

    <div class="page-header">
      <h1>Gestion des Comptes</h1>
      <p>Consultez et modifiez les comptes Nakama</p>
    </div>

    <p-card>
      <div class="flex justify-content-between align-items-center mb-3">
        <div class="flex gap-2">
          <span class="p-input-icon-left">
            <i class="pi pi-search"></i>
            <input
              type="text"
              pInputText
              [(ngModel)]="searchQuery"
              placeholder="Rechercher..."
              (input)="filterAccounts()"
              class="w-15rem"
            />
          </span>
          <p-dropdown
            [options]="roleOptions"
            [(ngModel)]="selectedRoleFilter"
            placeholder="Tous les rôles"
            [showClear]="true"
            optionLabel="label"
            optionValue="value"
            (onChange)="filterAccounts()"
            styleClass="w-12rem"
          ></p-dropdown>
        </div>
        <p-button
          icon="pi pi-refresh"
          [text]="true"
          (onClick)="loadAccounts()"
          pTooltip="Actualiser"
        ></p-button>
      </div>

      @if (loading()) {
        <div class="flex justify-content-center p-4">
          <p-progressSpinner styleClass="w-3rem h-3rem"></p-progressSpinner>
        </div>
      } @else {
        <p-table
          [value]="filteredAccounts()"
          [paginator]="true"
          [rows]="10"
          [rowsPerPageOptions]="[10, 25, 50]"
          [sortField]="'username'"
          [sortOrder]="1"
          styleClass="p-datatable-sm p-datatable-hoverable-rows"
          [rowHover]="true"
        >
          <ng-template pTemplate="header">
            <tr>
              <th pSortableColumn="username">
                Nom d'utilisateur <p-sortIcon field="username"></p-sortIcon>
              </th>
              <th pSortableColumn="display_name">
                Nom d'affichage <p-sortIcon field="display_name"></p-sortIcon>
              </th>
              <th pSortableColumn="email">
                Email <p-sortIcon field="email"></p-sortIcon>
              </th>
              <th pSortableColumn="role">
                Rôle <p-sortIcon field="role"></p-sortIcon>
              </th>
              <th pSortableColumn="create_time">
                Créé le <p-sortIcon field="create_time"></p-sortIcon>
              </th>
              <th style="width: 150px">Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-account>
            <tr>
              <td>
                <div class="flex align-items-center gap-2">
                  <div class="account-avatar">
                    {{ account.username.charAt(0).toUpperCase() }}
                  </div>
                  <span class="font-semibold">{{ account.username }}</span>
                </div>
              </td>
              <td>{{ account.display_name || '-' }}</td>
              <td>{{ account.email || '-' }}</td>
              <td>
                @if (account.role) {
                  <span class="role-badge" [class]="getRoleClass(account.role)">
                    {{ account.role }}
                  </span>
                } @else {
                  <span class="text-color-secondary">Aucun rôle</span>
                }
              </td>
              <td>{{ account.create_time * 1000 | date:'dd/MM/yyyy HH:mm' }}</td>
              <td>
                <div class="flex gap-1">
                  <p-button
                    icon="pi pi-pencil"
                    [rounded]="true"
                    [text]="true"
                    (onClick)="openEditDialog(account)"
                    pTooltip="Modifier"
                  ></p-button>
                  <p-button
                    icon="pi pi-trash"
                    [rounded]="true"
                    [text]="true"
                    severity="danger"
                    (onClick)="confirmDelete(account)"
                    pTooltip="Supprimer"
                  ></p-button>
                </div>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="6" class="text-center p-4">
                @if (searchQuery || selectedRoleFilter) {
                  Aucun compte ne correspond aux filtres
                } @else {
                  Aucun compte trouvé
                }
              </td>
            </tr>
          </ng-template>
        </p-table>
      }
    </p-card>

    <!-- Edit Dialog -->
    <p-dialog
      header="Modifier le compte"
      [(visible)]="editDialogVisible"
      [modal]="true"
      [style]="{ width: '500px' }"
      [closable]="true"
    >
      @if (selectedAccount) {
        <div class="flex flex-column gap-3">
          <div class="field">
            <label for="username" class="block mb-2 font-medium">Nom d'utilisateur</label>
            <input
              id="username"
              type="text"
              pInputText
              [(ngModel)]="editForm.username"
              class="w-full"
            />
          </div>

          <div class="field">
            <label for="display_name" class="block mb-2 font-medium">Nom d'affichage</label>
            <input
              id="display_name"
              type="text"
              pInputText
              [(ngModel)]="editForm.display_name"
              class="w-full"
            />
          </div>

          <div class="field">
            <label for="role" class="block mb-2 font-medium">Rôle</label>
            <p-dropdown
              id="role"
              [options]="roleOptions"
              [(ngModel)]="editForm.role"
              optionLabel="label"
              optionValue="value"
              placeholder="Sélectionner un rôle"
              [showClear]="true"
              styleClass="w-full"
            ></p-dropdown>
          </div>
        </div>
      }

      <ng-template pTemplate="footer">
        <p-button
          label="Annuler"
          [text]="true"
          (onClick)="editDialogVisible = false"
        ></p-button>
        <p-button
          label="Enregistrer"
          icon="pi pi-check"
          (onClick)="saveAccount()"
          [loading]="saving()"
        ></p-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .account-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--primary-color);
      color: var(--primary-color-text);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 0.875rem;
    }

    .role-badge {
      padding: 0.25rem 0.75rem;
      border-radius: 1rem;
      font-size: 0.75rem;
      font-weight: 600;
      color: white;

      &.douanier { background-color: #6366f1; }
      &.mj { background-color: #ec4899; }
      &.animateur { background-color: #f97316; }
      &.owner { background-color: #dc2626; }
      &.coordinateur { background-color: #14b8a6; }
      &.gerant { background-color: #8b5cf6; }
      &.developeur { background-color: #22c55e; }
    }

    :host ::ng-deep {
      .p-datatable-hoverable-rows .p-datatable-tbody > tr:hover {
        background: var(--surface-hover);
      }
    }
  `]
})
export class AccountsComponent implements OnInit {
  accounts = signal<AccountInfo[]>([]);
  filteredAccounts = signal<AccountInfo[]>([]);
  loading = signal(false);
  saving = signal(false);

  searchQuery = '';
  selectedRoleFilter: AdminRole | null = null;

  roleOptions: RoleOption[] = [
    { label: 'Douanier', value: 'Douanier' },
    { label: 'MJ', value: 'MJ' },
    { label: 'Animateur', value: 'Animateur' },
    { label: 'Owner', value: 'Owner' },
    { label: 'Coordinateur', value: 'Coordinateur' },
    { label: 'Gérant', value: 'Gérant' },
    { label: 'Développeur', value: 'Developeur' }
  ];

  editDialogVisible = false;
  selectedAccount: AccountInfo | null = null;
  editForm = {
    username: '',
    display_name: '',
    role: '' as AdminRole
  };

  constructor(
    private nakamaService: NakamaService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService
  ) {}

  ngOnInit(): void {
    this.loadAccounts();
  }

  loadAccounts(): void {
    this.loading.set(true);

    this.nakamaService.listAccounts().subscribe({
      next: (response) => {
        this.accounts.set(response.accounts || []);
        this.filterAccounts();
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to load accounts:', err);
        this.loading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de charger les comptes'
        });
      }
    });
  }

  filterAccounts(): void {
    let filtered = this.accounts();

    // Filter by search query
    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(a =>
        a.username.toLowerCase().includes(query) ||
        a.display_name?.toLowerCase().includes(query) ||
        a.email?.toLowerCase().includes(query) ||
        a.user_id.toLowerCase().includes(query)
      );
    }

    // Filter by role
    if (this.selectedRoleFilter) {
      filtered = filtered.filter(a => a.role === this.selectedRoleFilter);
    }

    this.filteredAccounts.set(filtered);
  }

  openEditDialog(account: AccountInfo): void {
    this.selectedAccount = account;
    this.editForm = {
      username: account.username,
      display_name: account.display_name || '',
      role: account.role
    };
    this.editDialogVisible = true;
  }

  saveAccount(): void {
    if (!this.selectedAccount) return;

    this.saving.set(true);

    this.nakamaService.updateAccount({
      user_id: this.selectedAccount.user_id,
      username: this.editForm.username,
      display_name: this.editForm.display_name,
      role: this.editForm.role
    }).subscribe({
      next: (updated) => {
        // Update local state
        const accounts = this.accounts();
        const index = accounts.findIndex(a => a.user_id === updated.user_id);
        if (index >= 0) {
          accounts[index] = updated;
          this.accounts.set([...accounts]);
          this.filterAccounts();
        }

        this.saving.set(false);
        this.editDialogVisible = false;
        this.messageService.add({
          severity: 'success',
          summary: 'Succès',
          detail: 'Compte mis à jour avec succès'
        });
      },
      error: (err) => {
        console.error('Failed to update account:', err);
        this.saving.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de mettre à jour le compte'
        });
      }
    });
  }

  confirmDelete(account: AccountInfo): void {
    this.confirmationService.confirm({
      message: `Êtes-vous sûr de vouloir supprimer le compte "${account.username}" ? Cette action est irréversible.`,
      accept: () => this.deleteAccount(account)
    });
  }

  deleteAccount(account: AccountInfo): void {
    this.nakamaService.deleteAccount(account.user_id).subscribe({
      next: () => {
        // Remove from local state
        const accounts = this.accounts().filter(a => a.user_id !== account.user_id);
        this.accounts.set(accounts);
        this.filterAccounts();

        this.messageService.add({
          severity: 'success',
          summary: 'Succès',
          detail: 'Compte supprimé avec succès'
        });
      },
      error: (err) => {
        console.error('Failed to delete account:', err);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de supprimer le compte'
        });
      }
    });
  }

  getRoleClass(role: string): string {
    return role.toLowerCase()
      .replace(/é/g, 'e')
      .replace(/ /g, '-');
  }
}
