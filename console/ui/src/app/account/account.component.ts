// Copyright 2020 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {Component, Injectable, OnInit} from '@angular/core';
import {ApiAccount, ConsoleService, UserRole} from '../console.service';
import {ActivatedRoute, ActivatedRouteSnapshot, Resolve, Router, RouterStateSnapshot} from '@angular/router';
import {AuthenticationService} from '../authentication.service';
import {saveAs} from 'file-saver';
import {Observable} from 'rxjs';
import {NgbModal} from '@ng-bootstrap/ng-bootstrap';
import {DeleteConfirmDialogComponent} from '../shared/delete-confirm-dialog/delete-confirm-dialog.component';
import {DeleteConfirmService} from '../shared/delete-confirm.service';

@Component({
  templateUrl: './account.component.html',
  styleUrls: ['./account.component.scss']
})
export class AccountComponent implements OnInit {
  public account: ApiAccount;
  public error = '';

  public views = [
    {label: 'Profile', path: 'profile'},
    {label: 'Authentication', path: 'authentication'},
    {label: 'Friends', path: 'friends'},
    {label: 'Groups', path: 'groups'},
    {label: 'Wallet', path: 'wallet'},
    {label: 'Purchases', path: 'purchases'},
    {label: 'Subscriptions', path: 'subscriptions'},
  ];

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly consoleService: ConsoleService,
    private readonly authService: AuthenticationService,
    private readonly deleteConfirmService: DeleteConfirmService,
  ) {}

  ngOnInit(): void {
    this.route.data.subscribe(
      d => {
        this.account = d[0].account;
      },
      err => {
        this.error = err;
      });
  }

  deleteAccount(event, recorded: boolean): void {
    this.deleteConfirmService.openDeleteConfirmModal(
      () => {
        event.target.disabled = true;
        this.error = '';
        this.consoleService.deleteAccount('', this.account.user.id, recorded).subscribe(() => {
          this.error = '';
          this.router.navigate(['/accounts']);
        }, err => {
          this.error = err;
        });
      }
    );
  }

  banUnbanAccount(event): void {
    event.target.disabled = true;
    this.error = '';
    if (this.account.disable_time) {
      this.consoleService.unbanAccount('', this.account.user.id).subscribe(() => {
        this.error = '';
        this.account.disable_time = null;
        event.target.disabled = false;
      }, err => {
        this.error = err;
        event.target.disabled = false;
      });
    } else {
      this.consoleService.banAccount('', this.account.user.id).subscribe(() => {
        this.error = '';
        this.account.disable_time = Date.now().toString();
        event.target.disabled = false;
      }, err => {
        this.error = err;
        event.target.disabled = false;
      });
    }
  }

  exportAccount(event): void {
    event.target.disabled = true;
    this.error = '';
    this.consoleService.exportAccount('', this.account.user.id).subscribe(accountExport => {
      this.error = '';
      const fileName = this.account.user.id + '-export.json';
      const json = JSON.stringify(accountExport, null, 2);
      const bytes = new TextEncoder().encode(json);
      const blob = new Blob([bytes], {type: 'application/json;charset=utf-8'});
      saveAs(blob, fileName);
      event.target.disabled = false;
    }, err => {
      event.target.disabled = false;
      this.error = err;
    });
  }

  updateAllowed(): boolean {
    // only admin and developers are allowed.
    return this.authService.sessionRole <= UserRole.USER_ROLE_MAINTAINER;
  }

  exportAllowed(): boolean {
    // only admin and developers are allowed.
    return this.authService.sessionRole <= UserRole.USER_ROLE_MAINTAINER;
  }

  banAllowed(): boolean {
    // only admin and developers are allowed.
    return this.authService.sessionRole <= UserRole.USER_ROLE_MAINTAINER;
  }

  deleteAllowed(): boolean {
    // only admin and developers are allowed.
    return this.authService.sessionRole <= UserRole.USER_ROLE_MAINTAINER;
  }
}

@Injectable({providedIn: 'root'})
export class AccountResolver implements Resolve<ApiAccount> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<ApiAccount> {
    const userId = route.paramMap.get('id');
    return this.consoleService.getAccount('', userId);
  }
}
