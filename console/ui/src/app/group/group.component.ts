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
import {ApiAccount, ApiGroup, ConsoleService, UserRole} from '../console.service';
import {ActivatedRoute, ActivatedRouteSnapshot, Resolve, Router, RouterStateSnapshot} from '@angular/router';
import {AuthenticationService} from '../authentication.service';
import {saveAs} from 'file-saver';
import {Observable} from 'rxjs';
import {DeleteConfirmService} from '../shared/delete-confirm.service';

@Component({
  templateUrl: './group.component.html',
  styleUrls: ['./group.component.scss']
})
export class GroupComponent implements OnInit {
  public group: ApiGroup;
  public error = '';

  public views = [
    {label: 'Details', path: 'details'},
    {label: 'Members', path: 'members'},
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
        this.group = d[0];
      },
      err => {
        this.error = err;
      });
  }

  deleteGroup(event, recorded: boolean): void {
    this.deleteConfirmService.openDeleteConfirmModal(
      () => {
        event.target.disabled = true;
        this.error = '';
        this.consoleService.deleteGroup('', this.group.id).subscribe(() => {
          this.error = '';
          this.router.navigate(['/groups']);
        }, err => {
          this.error = err;
        });
      }
    );
  }


  exportGroup(event): void {
    event.target.disabled = true;
    this.error = '';
    this.consoleService.exportGroup('', this.group.id).subscribe(groupExport => {
      this.error = '';
      const fileName = this.group.id + '-export.json';
      const json = JSON.stringify(groupExport, null, 2);
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
export class GroupResolver implements Resolve<ApiGroup> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<ApiGroup> {
    const groupId = route.paramMap.get('id');
    return this.consoleService.getGroup('', groupId);
  }
}
