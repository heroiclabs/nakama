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

import {Component, Injectable, OnDestroy, OnInit} from '@angular/core';
import {ActivatedRoute, ActivatedRouteSnapshot, Resolve, RouterStateSnapshot} from '@angular/router';
import {ConsoleService, RuntimeInfo} from '../console.service';
import {Observable} from 'rxjs';

@Component({
  templateUrl: './runtime.component.html',
  styleUrls: ['./runtime.component.scss']
})
export class RuntimeComponent implements OnInit, OnDestroy {
  public error = '';
  public runtimeInfo: RuntimeInfo;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly consoleService: ConsoleService,
  ) {}

  ngOnInit(): void {
    this.route.data.subscribe(
      d => {
        this.runtimeInfo = d[0];
      },
      err => {
        this.error = err;
      });
  }

  ngOnDestroy(): void {
  }
}

@Injectable({providedIn: 'root'})
export class RuntimeResolver implements Resolve<RuntimeInfo> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<RuntimeInfo> {
    return this.consoleService.getRuntime('');
  }
}
