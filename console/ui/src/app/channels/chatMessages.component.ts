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
import {ApiChannelMessage, ApiChannelMessageList, ApiUser, ConsoleService, UserRole} from '../console.service';
import {FormBuilder, FormGroup} from '@angular/forms';
import {AuthenticationService} from '../authentication.service';
import {Observable} from "rxjs";

@Component({
  templateUrl: './chatMessages.component.html',
  styleUrls: ['./chatMessages.component.scss']
})
export class ChatListComponent implements OnInit {
  public readonly systemUserId = '00000000-0000-0000-0000-000000000000';
  public error = '';
  public messages: Array<ApiChannelMessage> = [];
  public nextCursor = '';
  public prevCursor = '';
  public searchForm1: FormGroup;
  public searchForm2: FormGroup;
  public searchForm3: FormGroup;
  public type: string

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly consoleService: ConsoleService,
    private readonly authService: AuthenticationService,
    private readonly formBuilder: FormBuilder,
  ) {}

  ngOnInit(): void {
    this.searchForm1 = this.formBuilder.group({
      label: '',
    });
    this.searchForm2 = this.formBuilder.group({
      group_id: '',
    });
    this.searchForm3 = this.formBuilder.group({
      user_id_one: '',
      user_id_two: '',
    });

    const qp = this.route.snapshot.queryParamMap;
    this.f1.label.setValue(qp.get('label'));
    this.f2.group_id.setValue(qp.get('group_id'));
    this.f3.user_id_one.setValue(qp.get('user_id_one'));
    this.f3.user_id_two.setValue(qp.get('user_id_two'));

    this.nextCursor = qp.get('cursor');
    this.type = qp.get("type")

    if (this.nextCursor && this.nextCursor !== '') {
      this.search(1);
    }

    this.route.data.subscribe(
      d => {
        this.messages.length = 0;
        if (d) {
          this.messages.push(...d[0].messages);
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

    // this.consoleService.listChannelMessages('', type, ).subscribe(d => {
    //   this.error = '';
    //
    //   this.accounts.length = 0;
    //   this.accounts.push(...d.users);
    //   this.accountsCount = d.total_count;
    //   this.nextCursor = d.next_cursor;
    //
    //   this.router.navigate([], {
    //     relativeTo: this.route,
    //     queryParams: {
    //       filter: this.f.filter.value,
    //       filter_type: this.f.filter_type.value,
    //       cursor
    //     },
    //     queryParamsHandling: 'merge',
    //   });
    // }, err => {
    //   this.error = err;
    // });
  }

  deleteMessage(event, i: number, o: ApiUser): void {
    // event.target.disabled = true;
    // event.preventDefault();
    // this.error = '';
    // this.consoleService.deleteAccount('', o.id, false).subscribe(() => {
    //   this.error = '';
    //   this.accounts.splice(i, 1);
    //   this.accountsCount--;
    // }, err => {
    //   this.error = err;
    // });
  }

  deleteAllowed(): boolean {
    // only admin and developers are allowed.
    return this.authService.sessionRole <= UserRole.USER_ROLE_DEVELOPER;
  }

  viewAccount(u: ApiUser): void {
    this.router.navigate(['/accounts', u.id], {relativeTo: this.route});
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

// @Injectable({providedIn: 'root'})
// export class ChatSearchResolver implements Resolve<ApiChannelMessageList> {
//   constructor(private readonly consoleService: ConsoleService) {}
//
//   resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<ApiChannelMessageList> {
//     return new Observable();
//   }
// }

