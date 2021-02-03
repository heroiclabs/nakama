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
import {ActivatedRoute, ActivatedRouteSnapshot, Resolve, RouterStateSnapshot} from '@angular/router';
import {Observable} from 'rxjs';
import {ApiMatch, ApiMatchList, ConsoleService, MatchState, RealtimeUserPresence} from '../console.service';

@Component({
  templateUrl: './matches.component.html',
  styleUrls: ['./matches.component.scss']
})
export class MatchesComponent implements OnInit {
  public error = '';
  public matches: Array<ApiMatch> = [];
  public matchStates: Array<MatchState> = [];
  public matchStatesOpen: Array<boolean> = [];
  public updated = false;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly consoleService: ConsoleService,
  ) {}

  ngOnInit(): void {
    this.route.data.subscribe(
      d => {
        this.matches.length = 0;
        this.matches.push(...d[0].matches);
        this.matchStates.length = this.matches.length;
        this.matchStatesOpen.length = this.matches.length;
      },
      err => {
        this.error = err;
      });
  }

  getMatchState(i: number, match: ApiMatch): void {
    if (this.matchStatesOpen[i]) {
      // match state view was open already...
      return;
    }

    this.matchStates[i] = null;
    this.error = '';
    this.consoleService.getMatchState('', match.match_id).subscribe(d => {
      this.matchStatesOpen[i] = true;
      this.matchStates[i] = d;
    }, err => {
      this.matchStatesOpen[i] = false;
      this.matchStates[i] = null;
      this.error = err;
    });
  }

  getMatchPresencesString(ps: Array<RealtimeUserPresence>): string {
    return JSON.stringify(ps);
  }
}

@Injectable({providedIn: 'root'})
export class MatchesResolver implements Resolve<ApiMatchList> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<ApiMatchList> {
    return this.consoleService.listMatches('', null, null, null, null, null, null);
  }
}
