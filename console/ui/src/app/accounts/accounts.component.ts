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
import {ActivatedRoute, ActivatedRouteSnapshot, Resolve, Router, RouterStateSnapshot} from '@angular/router';
import {AccountList, ApiUser, ConsoleService, UserRole} from '../console.service';
import {Observable} from 'rxjs';
import {FormBuilder, FormGroup} from '@angular/forms';
import {AuthenticationService} from '../authentication.service';

@Component({
  templateUrl: './accounts.component.html',
  styleUrls: ['./accounts.component.scss']
})
export class AccountListComponent implements OnInit {
  public readonly systemUserId = '00000000-0000-0000-0000-000000000000';
  public error = '';
  public accountsCount = 0;
  public accounts: Array<ApiUser> = [];
  public nextCursor = '';
  public prevCursor = '';
  public searchForm: FormGroup;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly consoleService: ConsoleService,
    private readonly authService: AuthenticationService,
    private readonly formBuilder: FormBuilder,
  ) {}

  ngOnInit(): void {
    this.searchForm = this.formBuilder.group({
      filter: [''],
      filter_type: [0], // 0 for all, 1 for tombstones
    });

    const qp = this.route.snapshot.queryParamMap;
    this.f.filter.setValue(qp.get('filter'));
    this.f.filter_type.setValue(+qp.get('filter_type'));
    this.nextCursor = qp.get('cursor');

    if (this.nextCursor && this.nextCursor !== '') {
      this.search(1);
    } else if (this.f.filter.value || this.f.filter_type.value) {
      this.search(0);
    }

    this.route.data.subscribe(
      d => {
        this.accounts.length = 0;
        if (d) {
          this.accounts.push(...d[0].users);
          this.accountsCount = d[0].total_count;
          this.nextCursor = d[0].next_cursor;
          this.prevCursor = d[0].prev_cursor;
        }
      },
      err => {
        this.error = err;
      });
  }

  search(state: number): void {
    let cursor = '';
    switch (state) {
      case -1:
        cursor = this.prevCursor;
        break;
      case 0:
        cursor = '';
        break;
      case 1:
        cursor = this.nextCursor;
        break;
    }

    const tombstones = this.f.filter_type.value && this.f.filter_type.value === 1;
    this.consoleService.listAccounts('', this.f.filter.value, tombstones, cursor).subscribe(d => {
      this.error = '';

      this.accounts.length = 0;
      this.accounts.push(...d.users);
      this.accountsCount = d.total_count;
      this.nextCursor = d.next_cursor;

      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          filter: this.f.filter.value,
          filter_type: this.f.filter_type.value,
          cursor
        },
        queryParamsHandling: 'merge',
      });
    }, err => {
      this.error = err;
    });
  }

  deleteAccount(event, i: number, o: ApiUser): void {
    event.target.disabled = true;
    event.preventDefault();
    this.error = '';
    this.consoleService.deleteAccount('', o.id, false).subscribe(() => {
      this.error = '';
      this.accounts.splice(i, 1);
      this.accountsCount--;
    }, err => {
      this.error = err;
    });
  }

  deleteAllowed(): boolean {
    // only admin and developers are allowed.
    return this.authService.sessionRole <= UserRole.USER_ROLE_DEVELOPER;
  }

  viewAccount(u: ApiUser): void {
    this.router.navigate(['/accounts', u.id], {relativeTo: this.route});
  }

  get f(): any {
    return this.searchForm.controls;
  }
}

@Injectable({providedIn: 'root'})
export class AccountSearchResolver implements Resolve<AccountList> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<AccountList> {
    const filter = route.queryParamMap.get('filter');
    const tombstones = route.queryParamMap.get('tombstones');

    return this.consoleService.listAccounts('', filter, tombstones === 'true', null);
  }
}
