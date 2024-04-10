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
import {ConsoleService, Leaderboard, LeaderboardList, UserRole} from '../console.service';
import {Observable} from 'rxjs';
import {AuthenticationService} from '../authentication.service';
import {DeleteConfirmService} from '../shared/delete-confirm.service';

@Component({
  templateUrl: './leaderboards.component.html',
  styleUrls: ['./leaderboards.component.scss']
})
export class LeaderboardsComponent implements OnInit {
  public error = '';
  public leaderboards: Array<Leaderboard> = [];

  public nextCursor: string = "";
  public leaderboardsCount: number = 0;
  public orderString = {
    0: 'Ascending',
    1: 'Descending',
  };
  public operatorString = {
    0: 'Best',
    1: 'Set',
    2: 'Increment',
    3: 'Decrement',
  };

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly authService: AuthenticationService,
    private readonly consoleService: ConsoleService,
    private readonly deleteConfirmService: DeleteConfirmService,
  ) {}

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParamMap;
    this.nextCursor = qp.get('cursor');

    if (this.nextCursor && this.nextCursor !== '') {
      this.search(1);
    } else {
      this.search(0);
    }
  }

  deleteAllowed(): boolean {
    // only admin and developers are allowed.
    return this.authService.sessionRole <= UserRole.USER_ROLE_DEVELOPER;
  }

  deleteLeaderboard(event, i: number, l: Leaderboard): void {
    this.deleteConfirmService.openDeleteConfirmModal(
      () => {
        event.target.disabled = true;
        event.preventDefault();
        this.error = '';
        this.consoleService.deleteLeaderboard('', l.id).subscribe(() => {
          this.error = '';
          this.leaderboards.splice(i, 1);
          this.leaderboardsCount--;
        }, err => {
          this.error = err;
        });
      }
    );
  }

  viewLeaderboardEntries(l: Leaderboard): void {
    this.router.navigate(['/leaderboards', l.id], {relativeTo: this.route});
  }

  search(state: number): void {
    let cursor = '';
    switch (state) {
      case 0:
        cursor = '';
        break;
      case 1:
        cursor = this.nextCursor;
        break;
    }

    this.consoleService.listLeaderboards('', cursor).subscribe(d => {
      this.error = '';

      this.leaderboards.length = 0;
      this.leaderboards.push(...d.leaderboards);
      this.leaderboardsCount = d.total;
      this.nextCursor = d.cursor;

      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          cursor
        },
        queryParamsHandling: 'merge',
      });
    }, err => {
      this.error = err;
    });
  }
}

@Injectable({providedIn: 'root'})
export class LeaderboardListResolver implements Resolve<LeaderboardList> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<LeaderboardList> {
    return this.consoleService.listLeaderboards('');
  }
}
