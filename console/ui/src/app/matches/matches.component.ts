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
import {ActivatedRoute, ActivatedRouteSnapshot, Params, Resolve, Router, RouterStateSnapshot} from '@angular/router';
import {Observable, of} from 'rxjs';
import {
  ConsoleService,
  MatchList,
  MatchListMatch,
  MatchState,
  RealtimeUserPresence
} from '../console.service';
import {UntypedFormBuilder, UntypedFormGroup} from '@angular/forms';
import {catchError, mergeMap} from 'rxjs/operators';

@Component({
  templateUrl: './matches.component.html',
  styleUrls: ['./matches.component.scss']
})
export class MatchesComponent implements OnInit {
  public error = '';
  public matches: Array<MatchListMatch> = [];
  public matchStates: Array<MatchState> = [];
  public matchStatesOpen: Array<boolean> = [];
  public updated = false;
  public searchForm1: UntypedFormGroup;
  public searchForm2: UntypedFormGroup;
  public searchForm3: UntypedFormGroup; // Authoritative
  public type: number;
  public activeType = 'All';
  public readonly types = ['All', 'Authoritative', 'Relayed'];
  public activeNode = 'All Nodes';
  public nodes: Array<string> = ['All Nodes'];

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly formBuilder: UntypedFormBuilder,
    private readonly consoleService: ConsoleService,
  ) {
    this.searchForm1 = this.formBuilder.group({
      match_id: '',
    });
    this.searchForm2 = this.formBuilder.group({
      match_id: '',
    });
    this.searchForm3 = this.formBuilder.group({
      query: '',
    });
  }

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParamMap;

    this.f1.match_id.setValue(qp.get('match_id'));
    this.f2.match_id.setValue(qp.get('match_id'));
    this.f3.query.setValue(qp.get('query'));

    const qType = qp.get('type');
    this.type = Number(qType);
    const qNode = qp.get('node');

    this.route.data.subscribe(
      d => {
        if (d) {
          if (d[0]) {
            this.error = '';
            this.matches.length = 0;
            this.matches.push(...d[0].matches);
            this.matchStates.length = this.matches.length;
            this.matchStatesOpen.length = this.matches.length;
          }
          if (d[1]) {
            this.nodes.push(...d[1]);
          }
          if (d.error) {
            this.error = d.error;
          }
        }
      },
      err => {
        this.error = err;
      });

    if (qType === null) {
      this.type = 0;
      this.activeType = this.types[0];
    } else {
      if (this.type == 0 || this.type === 1 || this.type === 2) {
        this.activeType = this.types[this.type];
      } else {
        this.error = 'Invalid type';
      }
    }
    if (qNode !== null) {
      let found = false;
      this.nodes.forEach((node) => {
        if (qNode === node) {
          this.activeNode = qNode;
          found = true;
        }
      });
      if (!found) {
        this.error = 'Invalid node.';
      }
    }
  }

  search(): void {
    const type = this.getType();
    this.type = type;
    list(this.consoleService, type, type === 0 ? this.f1.match_id.value : this.f2.match_id.value, this.f3.query.value, this.activeNode === this.nodes[0] ? '' : this.activeNode)
      .subscribe(d => this.postData(d), err => { this.error = err; });
  }

  postData(d): void {
    this.error = '';
    this.matches.length = 0;
    this.matches.push(...d.matches);
    this.matchStates.length = this.matches.length;
    this.matchStatesOpen.length = this.matches.length;

    let params: Params;
    switch (this.type) {
      case (0):
        params = {type: this.type, match_id: this.f1.match_id.value};
        break;
      case (1):
        params = {
          type: this.type,
          query: this.f3.query.value,
        };
        if (this.activeNode !== this.nodes[0]) {
          params.node = this.activeNode;
        }
        break;
      case (2):
        params = {type: this.type, match_id: this.f2.match_id.value};
        break;
    }
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
    });
  }

  getType(): number {
    let tp = 0;
    this.types.forEach((t, ix) => {
        if (this.activeType === t) {
          tp = ix;
        }
      });
    return tp;
  }

  getMatchState(i: number, match: MatchListMatch): void {
    if (this.matchStatesOpen[i]) {
      // match state view was open already...
      return;
    }

    this.matchStates[i] = null;
    this.error = '';
    this.consoleService.getMatchState('', match.api_match.match_id).subscribe(d => {
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

  get f1(): any {
    return this.searchForm1.controls;
  }
  get f2(): any {
    return this.searchForm2.controls;
  }
  get f3(): any {
    return this.searchForm3.controls;
  }
}

@Injectable({providedIn: 'root'})
export class MatchesResolver implements Resolve<MatchList> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<MatchList> {
    const type = Number(route.queryParamMap.get('type'));
    return list(this.consoleService, type, route.queryParamMap.get('match_id'), route.queryParamMap.get('query'), route.queryParamMap.get('node')).pipe(catchError(error => {
      route.data = {...route.data, error};
      return of(null);
    }));
  }
}

function list(service: ConsoleService, type: number, matchId: string, query: string, node: string): Observable<MatchList> {
  switch (type) {
  case (0):
    return service.listMatches('', null, null, null, null, null, matchId);
  case (1):
    return service.listMatches('', null, true, null, null, null, null, query, node);
  case (2):
    return service.listMatches('', null, false, null, null, null, matchId);
  }
  return of(null);
}

@Injectable({providedIn: 'root'})
export class NodesResolver implements Resolve<string[]> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<string[]> {
    return this.consoleService.getStatus('').pipe(mergeMap(r => of(r.nodes.map(n => n.name))))
      .pipe(catchError(error => {
        route.data = {...route.data, error};
        return of([]);
      }));
  }
}
