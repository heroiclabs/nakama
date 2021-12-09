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
import {FormBuilder, FormGroup, Validators} from '@angular/forms';
import {AuthenticationService} from '../authentication.service';
import {Observable} from "rxjs";
import {NgbModal} from "@ng-bootstrap/ng-bootstrap";
import {delay} from "rxjs/operators";

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
  public type: number
  public confirmDeleteForm: FormGroup;
  public deleteError = '';
  public deleteSuccess = false;
  public deleting = false;
  public total_deleted = 0;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly consoleService: ConsoleService,
    private readonly authService: AuthenticationService,
    private readonly formBuilder: FormBuilder,
    private readonly modalService: NgbModal,
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
    this.type = Number(qp.get("type"))

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

    this.confirmDeleteForm = this.formBuilder.group({
      delete: ['', Validators.compose([Validators.required, Validators.pattern('DELETE')])],
      days: 30,
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

    this.updateMessages(this.type, this.f1.label.value, this.f2.group_id.value,
      this.f3.user_id_one.value, this.f3.user_id_two.value, cursor)
  }

  updateMessages(type: number, label: string, group_id: string, user_id_one: string, user_id_two: string, cursor: string): void {
    this.consoleService.listChannelMessages('', type, label, group_id, user_id_one, user_id_two, encodeURIComponent(cursor)).subscribe(d => {
      this.error = '';

      this.messages.length = 0;
      this.messages.push(...d.messages);
      this.nextCursor = d.next_cursor;

      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          type: this.type,
          label: this.f1.label.value,
          group_id: this.f2.group_id.value,
          user_id_one: this.f3.user_id_one.value,
          user_id_two: this.f3.user_id_two.value,
          cursor
        },
      });
    }, err => {
      this.error = err;
    });
  }

  deleteMessage(event, i: number, o: ApiChannelMessage): void {
    event.target.disabled = true;
    event.preventDefault();
    this.error = '';
    this.consoleService.deleteChannelMessage('', o.message_id).subscribe(() => {
      this.error = '';
      this.messages.splice(i, 1);
    }, err => {
      this.error = err;
    });
  }

  deleteAllowed(): boolean {
    // only admin and developers are allowed.
    return this.authService.sessionRole <= UserRole.USER_ROLE_DEVELOPER;
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

  get f(): any {
    return this.confirmDeleteForm.controls;
  }

  viewMessage(i: number) {
    $("#msg_"+i).slideToggle("fast", function() {
      if ($("#msg_"+i).is(':visible')) {
        $("#item_"+i).html($("#item_"+i).html().replace("▶", "▼"))
      } else {
        $("#item_"+i).html($("#item_"+i).html().replace("▼", "▶"))
      }
    });
  }

  public openDeleteDataModal(modal): void {
    this.modalService.open(modal, {centered: true}).result.then(() => {
      this.deleteData();
    }, () => {});
  }

  public deleteData(): void {
    this.deleteError = '';
    this.deleting = true;
    let threshold = new Date()
    threshold.setDate(threshold.getDate()-this.f.days.value)
    this.consoleService.deleteOldChannelMessages('', threshold.toISOString()).subscribe(
      (total) => {
        this.total_deleted = Number(total.total);
        this.deleting = false;
        this.deleteError = '';
        this.deleteSuccess = true;
        const qp = this.route.snapshot.queryParamMap;
        let type = Number(qp.get('type'));
        if (!type) {
          type = 2;
        }
        let label = qp.get('label');
        if (!label) {
          label = "0";
        }
        let groupId = qp.get('group_id');
        let userIdOne = qp.get('user_id_one');
        let userIdTwo = qp.get('user_id_two');

        this.updateMessages(type, label, groupId,
          userIdOne, userIdTwo, qp.get('cursor'))
      }, err => {
        this.deleting = false;
        this.deleteError = err;
      },
    );
  }

  viewAccount(msg: ApiChannelMessage) {
    this.router.navigate(['/accounts', msg.sender_id], {relativeTo: this.route});
  }
}

@Injectable({providedIn: 'root'})
export class ChatSearchResolver implements Resolve<ApiChannelMessageList> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<ApiChannelMessageList> {
    let type = Number(route.queryParamMap.get('type'));
    if (!type) {
      type = 2;
    }
    let label = route.queryParamMap.get('label');
    if (!label) {
      label = "0";
    }
    let groupId = route.queryParamMap.get('group_id');
    let userIdOne = route.queryParamMap.get('user_id_one');
    let userIdTwo = route.queryParamMap.get('user_id_two');

    return this.consoleService.listChannelMessages('', type, label, groupId, userIdOne, userIdTwo, null);
  }
}

