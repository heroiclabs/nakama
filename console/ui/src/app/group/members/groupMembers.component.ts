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
  ApiGroup,
  ApiGroupUserList,
  ConsoleService,
  GroupUserListGroupUser,
  UserGroupListUserGroup,
  UserRole
} from '../../console.service';
import {ActivatedRoute, ActivatedRouteSnapshot, Resolve, Router, RouterStateSnapshot} from '@angular/router';
import {AuthenticationService} from '../../authentication.service';
import {Observable} from 'rxjs';

@Component({
  templateUrl: './groupMembers.component.html',
  styleUrls: ['./groupMembers.component.scss']
})
export class GroupMembersComponent implements OnInit {
  public error = '';
  public group: ApiGroup;
  public members: Array<GroupUserListGroupUser> = [];

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly consoleService: ConsoleService,
    private readonly authService: AuthenticationService,
  ) {}

  ngOnInit(): void {
    this.route.data.subscribe(
      d => {
        this.members.length = 0;
        this.members.push(...d[0].group_users);
      },
      err => {
        this.error = err;
      });
    this.route.parent.data.subscribe(
      d => {
        this.group = d[0];
      },
      err => {
        this.error = err;
      });
  }

  editionAllowed() {
    return this.authService.sessionRole <= UserRole.USER_ROLE_MAINTAINER;
  }

  deleteGroupUser(event, i: number, f: GroupUserListGroupUser) {
    event.target.disabled = true;
    event.preventDefault();
    this.error = '';
    this.consoleService.deleteGroupUser('', f.user.id, this.group.id).subscribe(() => {
      this.members.splice(i, 1)
    }, err => {
      this.error = err;
    })
  }

  demoteGroupUser(event, i: number, f: GroupUserListGroupUser) {
    this.error = '';
    this.consoleService.demoteGroupMember('', this.group.id, f.user.id).subscribe(() => {
      this.members[i].state++;
    }, err => {
      this.error = err;
    })
  }

  promoteGroupUser(event, i: number, f: GroupUserListGroupUser) {
    this.error = '';
    this.consoleService.promoteGroupMember('', this.group.id, f.user.id).subscribe(() => {
      this.members[i].state--;
    }, err => {
      this.error = err;
    })
  }

  viewAccount(g: GroupUserListGroupUser): void {
    this.router.navigate(['/accounts', g.user.id], {relativeTo: this.route});
  }
}

@Injectable({providedIn: 'root'})
export class GroupMembersResolver implements Resolve<ApiGroupUserList> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<ApiGroupUserList> {
    const groupId = route.parent.paramMap.get('id');
    return this.consoleService.getMembers('', groupId);
  }
}
