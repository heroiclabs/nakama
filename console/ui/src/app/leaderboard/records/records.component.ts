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
  ApiAccount, ApiFriend, ApiFriendList, ApiLeaderboardRecord, ApiLeaderboardRecordList,
  ConsoleService, Leaderboard,
  UserRole,
} from '../../console.service';
import {ActivatedRoute, ActivatedRouteSnapshot, Resolve, Router, RouterStateSnapshot} from '@angular/router';
import {AuthenticationService} from '../../authentication.service';
import {Observable} from 'rxjs';

@Component({
  templateUrl: './records.component.html',
  styleUrls: ['./records.component.scss']
})
export class LeaderboardRecordsComponent implements OnInit {
  public error = '';

  public leaderboard: Leaderboard;
  public records: Array<ApiLeaderboardRecord> = [];
  public recordsMetadataOpen: Array<boolean> = [];
  public next_cursor = '';
  public prev_cursor = '';

  constructor(
    private readonly route: ActivatedRoute,
    private readonly consoleService: ConsoleService
  ) {}

  ngOnInit(): void {
    this.route.data.subscribe(
      d => {
        this.records.length = 0;
        this.records.push(...d[0].records);
        this.next_cursor = d[0].next_cursor;
        this.prev_cursor = d[0].prev_cursor;
        this.recordsMetadataOpen.length = this.records.length;
      },
      err => {
        this.error = err;
      });

    this.route.parent.data.subscribe(
      d => {
        this.leaderboard = d[0];
      },
      err => {
        this.error = err;
      });
  }

  loadRecords(state: number) {
    let cursor = '';
    switch (state) {
      case -1:
        cursor = this.prev_cursor;
        break;
      case 0:
        cursor = '';
        break;
      case 1:
        cursor = this.next_cursor;
        break;
    }

    this.consoleService.listLeaderboardRecords('', this.leaderboard.id, null, null, cursor, null).subscribe(d => {
      this.error = '';

      this.next_cursor = d.next_cursor;
      this.prev_cursor = d.prev_cursor;

      this.records.length = 0;
      this.records.push(...d.records);
      this.recordsMetadataOpen.length = 0; // wipe old records
      this.recordsMetadataOpen.length = this.records.length;
    }, err => {
      this.error = err;
    });
  }
}

@Injectable({providedIn: 'root'})
export class LeaderboardRecordsResolver implements Resolve<ApiLeaderboardRecordList> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<ApiLeaderboardRecordList> {
    const leaderboardId = route.parent.paramMap.get('id');
    return this.consoleService.listLeaderboardRecords('', leaderboardId, null, null, null, null);
  }
}
