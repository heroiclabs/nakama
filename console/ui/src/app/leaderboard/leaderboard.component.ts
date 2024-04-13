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
import {ConsoleService, Leaderboard, UserRole} from '../console.service';
import {ActivatedRoute, ActivatedRouteSnapshot, Resolve, Router, RouterStateSnapshot} from '@angular/router';
import {Observable} from 'rxjs';
import {AuthenticationService} from '../authentication.service';
import {DeleteConfirmService} from '../shared/delete-confirm.service';

@Component({
  templateUrl: './leaderboard.component.html',
  styleUrls: ['./leaderboard.component.scss']
})
export class LeaderboardComponent implements OnInit {
  public leaderboard: Leaderboard;
  public error = '';

  public views = [
    {label: 'Details', path: 'details'},
    {label: 'Records', path: 'records'},
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
        this.leaderboard = d[0];
      },
      err => {
        this.error = err;
      });
  }

  deleteLeaderboard(event): void {
    this.deleteConfirmService.openDeleteConfirmModal(
      () => {
        event.target.disabled = true;
        this.error = '';
        this.consoleService.deleteLeaderboard('', this.leaderboard.id).subscribe(() => {
          this.error = '';
          this.router.navigate(['/leaderboards']);
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
}

@Injectable({providedIn: 'root'})
export class LeaderboardResolver implements Resolve<Leaderboard> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<Leaderboard> {
    const leaderboardId = route.paramMap.get('id');
    return this.consoleService.getLeaderboard('', leaderboardId);
  }
}
