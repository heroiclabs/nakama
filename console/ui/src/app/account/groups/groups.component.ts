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
import {
  ApiAccount, ApiUser, ApiUserGroupList,
  ConsoleService, UserGroupListUserGroup,
  UserRole
} from '../../console.service';
import {ActivatedRoute, ActivatedRouteSnapshot, Resolve, Router, RouterStateSnapshot} from '@angular/router';
import {AuthenticationService} from '../../authentication.service';
import {Observable} from 'rxjs';
import {DeleteConfirmService} from '../../shared/delete-confirm.service';

@Component({
  templateUrl: './groups.component.html',
  styleUrls: ['./groups.component.scss']
})
export class GroupsComponent implements OnInit {
  public error = '';
  public account: ApiAccount;
  public groups: Array<UserGroupListUserGroup> = [];

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
        this.groups.length = 0;
        this.groups.push(...d[0].user_groups);
      },
      err => {
        this.error = err;
      });

    this.route.parent.data.subscribe(
      d => {
        this.account = d[0].account;
      },
      err => {
        this.error = err;
      });
  }

  deleteAllowed(): boolean {
    return this.authService.sessionRole <= UserRole.USER_ROLE_MAINTAINER;
  }

  deleteGroupUser(event, i: number, f: UserGroupListUserGroup): void {
    this.deleteConfirmService.openDeleteConfirmModal(
      () => {
        event.target.disabled = true;
        event.preventDefault();
        this.error = '';
        this.consoleService.deleteGroupUser('', this.account.user.id, f.group.id).subscribe(() => {
          this.error = '';
          this.groups.splice(i, 1)
        }, err => {
          this.error = err;
        });
      }
    );
  }

  viewAccount(g: UserGroupListUserGroup): void {
    this.router.navigate(['/groups', g.group.id], {relativeTo: this.route});
  }
}

@Injectable({providedIn: 'root'})
export class GroupsResolver implements Resolve<ApiUserGroupList> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<ApiUserGroupList> {
    const userId = route.parent.paramMap.get('id');
    return this.consoleService.getGroups('', userId);
  }
}
