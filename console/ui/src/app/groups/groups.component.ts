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
import {GroupList, ApiGroup, ConsoleService, UserRole} from '../console.service';
import {Observable} from 'rxjs';
import {UntypedFormBuilder, UntypedFormGroup} from '@angular/forms';
import {AuthenticationService} from '../authentication.service';
import {DeleteConfirmService} from '../shared/delete-confirm.service';

@Component({
  templateUrl: './groups.component.html',
  styleUrls: ['./groups.component.scss']
})
export class GroupListComponent implements OnInit {
  public readonly systemUserId = '00000000-0000-0000-0000-000000000000';
  public error = '';
  public groupsCount = 0;
  public groups: Array<ApiGroup> = [];
  public nextCursor = '';
  public prevCursor = '';
  public searchForm: UntypedFormGroup;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly consoleService: ConsoleService,
    private readonly authService: AuthenticationService,
    private readonly formBuilder: UntypedFormBuilder,
    private readonly deleteConfirmService: DeleteConfirmService,
  ) {}

  ngOnInit(): void {
    this.searchForm = this.formBuilder.group({
      filter: [''],
    });

    const qp = this.route.snapshot.queryParamMap;
    this.f.filter.setValue(qp.get('filter'));
    this.nextCursor = qp.get('cursor');

    if (this.nextCursor && this.nextCursor !== '') {
      this.search(1);
    } else if (this.f.filter.value) {
      this.search(0);
    }

    this.route.data.subscribe(
      d => {
        this.groups.length = 0;
        if (d) {
          this.groups.push(...d[0].groups);
          this.groupsCount = d[0].total_count;
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

    this.consoleService.listGroups('', this.f.filter.value, cursor).subscribe(d => {
      this.error = '';

      this.groups.length = 0;
      this.groups.push(...d.groups);
      this.groupsCount = d.total_count;
      this.nextCursor = d.next_cursor;

      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          filter: this.f.filter.value,
          cursor
        },
        queryParamsHandling: 'merge',
      });
    }, err => {
      this.error = err;
    });
  }

  deleteGroup(event, i: number, o: ApiGroup): void {
    this.deleteConfirmService.openDeleteConfirmModal(
      () => {
        event.target.disabled = true;
        event.preventDefault();
        this.error = '';
        this.consoleService.deleteGroup('', o.id).subscribe(() => {
          this.error = '';
          this.groups.splice(i, 1);
          this.groupsCount--;
        }, err => {
          this.error = err;
        });
      }
    );
  }

  deleteAllowed(): boolean {
    // only admin and developers are allowed.
    return this.authService.sessionRole <= UserRole.USER_ROLE_DEVELOPER;
  }

  viewGroup(g: ApiGroup): void {
    this.router.navigate(['/groups', g.id], {relativeTo: this.route});
  }

  get f(): any {
    return this.searchForm.controls;
  }
}

@Injectable({providedIn: 'root'})
export class GroupSearchResolver implements Resolve<GroupList> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<GroupList> {
    const filter = route.queryParamMap.get('filter');

    return this.consoleService.listGroups('', filter, null);
  }
}
