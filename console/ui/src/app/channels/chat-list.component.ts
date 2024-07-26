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
import {ApiChannelMessage, ApiChannelMessageList, ConsoleService, UserRole} from '../console.service';
import {UntypedFormBuilder, UntypedFormGroup, Validators} from '@angular/forms';
import {AuthenticationService} from '../authentication.service';
import {Observable, of} from "rxjs";
import {NgbModal} from "@ng-bootstrap/ng-bootstrap";
import {catchError} from "rxjs/operators";
import {DeleteConfirmService} from '../shared/delete-confirm.service';

@Component({
  templateUrl: './chat-list.component.html',
  styleUrls: ['./chat-list.component.scss']
})
export class ChatListComponent implements OnInit {
  public readonly systemUserId = '00000000-0000-0000-0000-000000000000';
  public error = '';
  public messages: Array<ApiChannelMessage> = [];
  public nextCursor = '';
  public searchForm1: UntypedFormGroup;
  public searchForm2: UntypedFormGroup;
  public searchForm3: UntypedFormGroup;
  public type: number;
  public confirmDeleteForm: UntypedFormGroup;
  public deleteError = '';
  public deleteSuccess = false;
  public deleting = false;
  public totalDeleted = 0;
  public activeFilter = '';
  public readonly filters = ['Chat Room', 'Group Chat', 'Direct Chat'];
  public messageStatesOpen: Array<boolean> = [];

  constructor(
    public readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly consoleService: ConsoleService,
    private readonly authService: AuthenticationService,
    private readonly formBuilder: UntypedFormBuilder,
    private readonly modalService: NgbModal,
    private readonly deleteConfirmService: DeleteConfirmService,
  ) {
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
    this.confirmDeleteForm = this.formBuilder.group({
      delete: ['', Validators.compose([Validators.required, Validators.pattern('DELETE')])],
      numberValueControl: {
        title: 'Choose how many days to retain:',
        id: 'days'
      },
      days: 30
    });
  }

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParamMap;

    this.f1.label.setValue(qp.get('label'));
    this.f2.group_id.setValue(qp.get('group_id'));
    this.f3.user_id_one.setValue(qp.get('user_id_one'));
    this.f3.user_id_two.setValue(qp.get('user_id_two'));

    this.nextCursor = qp.get('cursor');
    const qType: string = qp.get('type');
    this.type = Number(qType);

    this.route.data.subscribe(
      d => {
        if (d) {
          if (d[0]) {
            this.error = '';
            this.messageStatesOpen = [];
            this.messages.length = 0;
            this.messages.push(...d[0].messages);
            this.nextCursor = d[0].next_cursor;
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
      this.type = 2;
      this.activeFilter = this.filters[0];
    } else {
      if (this.type === 2 || this.type === 3 || this.type === 4) {
        this.activeFilter = this.filters[this.type - 2];
      } else {
        this.error = 'Invalid type.';
      }
    }
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
    this.updateMessages(this.type, this.f1.label.value, this.f2.group_id.value,
      this.f3.user_id_one.value, this.f3.user_id_two.value, cursor);
  }

  // tslint:disable-next-line:variable-name
  updateMessages(type: number, label: string, group_id: string, user_id_one: string, user_id_two: string, cursor: string): void {
    switch (type) {
      case (2):
        this.consoleService.listChannelMessages('', type.toString(), label, null, null, null, encodeURIComponent(cursor))
          .subscribe(d => this.postData(d, cursor), err => { this.error = err; });
        break;
      case (3):
        this.consoleService.listChannelMessages('', type.toString(), null, group_id, null, null, encodeURIComponent(cursor))
          .subscribe(d => this.postData(d, cursor), err => { this.error = err; });
        break;
      case (4):
        this.consoleService.listChannelMessages('', type.toString(), null, null, user_id_one, user_id_two, encodeURIComponent(cursor))
          .subscribe(d => this.postData(d, cursor), err => { this.error = err; });
        break;
    }
  }

  postData(d, cursor): void {
    this.error = '';
    this.messageStatesOpen = [];

    this.messages.length = 0;
    this.messages.push(...d.messages);
    this.nextCursor = d.next_cursor;

    let params: Params;
    switch (this.type) {
      case (2):
        params = {type: this.type, label: this.f1.label.value, cursor};
        break;
      case (3):
        params = {type: this.type, group_id: this.f2.group_id.value, cursor};
        break;
      case (4):
        params = {
          type: this.type,
          user_id_one: this.f3.user_id_one.value,
          user_id_two: this.f3.user_id_two.value,
          cursor
        };
        break;
    }
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
    });
  }

  deleteMessage(event, i: number, o: ApiChannelMessage): void {
    this.deleteConfirmService.openDeleteConfirmModal(
      () => {
        event.target.disabled = true;
        event.preventDefault();
        this.error = '';
        this.consoleService.deleteChannelMessages('', null, [o.message_id]).subscribe(() => {
          this.error = '';
          this.messageStatesOpen.splice(i, 1);
          this.messages.splice(i, 1);
        }, err => {
          this.error = err;
        });
      }
    );
  }

  deleteAllowed(): boolean {
    // Maintainers, admin and developers are allowed.
    return this.authService.sessionRole <= UserRole.USER_ROLE_MAINTAINER;
  }

  deleteMessagesAllowed(): boolean {
    // Maintainers, admin and developers are allowed.
    return this.authService.sessionRole <= UserRole.USER_ROLE_MAINTAINER;
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

  public deleteData(): void {
    this.deleteConfirmService.openDeleteConfirmModal((formValue) => {
        this.deleteError = '';
        this.deleting = true;
        const threshold = new Date();
        const retainDays = Number(formValue.days);
        threshold.setDate(threshold.getDate() - retainDays);
        this.consoleService.deleteChannelMessages('', threshold.toISOString(), null).subscribe(
          (total) => {
            this.totalDeleted = Number(total.total);
            this.deleting = false;
            this.deleteError = '';
            this.deleteSuccess = true;
            const qp = this.route.snapshot.queryParamMap;
            const type = qp.get('type');
            let label = qp.get('label');
            if (!label) {
              label = '0';
            }
            const groupId = qp.get('group_id');
            const userIdOne = qp.get('user_id_one');
            const userIdTwo = qp.get('user_id_two');
            let cursor = qp.get('cursor');
            if (!cursor) {
              cursor = '';
            }
            if (type) {
              this.updateMessages(Number(type), label, groupId,
                userIdOne, userIdTwo, cursor);
            }
          }, err => {
            this.deleting = false;
            this.deleteError = err;
          },
        );
      },
      this.confirmDeleteForm,
      'Delete messages',
      'Are you sure you want to delete all messages before retain days?'
    );
  }

  viewAccount(msg: ApiChannelMessage): void {
    this.router.navigate(['/accounts', msg.sender_id], {relativeTo: this.route});
  }
}

@Injectable({providedIn: 'root'})
export class ChatSearchResolver implements Resolve<ApiChannelMessageList> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<ApiChannelMessageList> {
    const type: number = Number(route.queryParamMap.get('type'));
    switch (type) {
      case (2):
        // tslint:disable-next-line:max-line-length
        return this.consoleService.listChannelMessages('', type.toString(), route.queryParamMap.get('label'), null, null, null, encodeURIComponent(route.queryParamMap.get('cursor')))
          .pipe(catchError(error => {
            route.data = {...route.data, error};
            return of(null);
          }));
      case (3):
        // tslint:disable-next-line:max-line-length
        return this.consoleService.listChannelMessages('', type.toString(), null, route.queryParamMap.get('group_id'), null, null, encodeURIComponent(route.queryParamMap.get('cursor')))
          .pipe(catchError(error => {
            route.data = {...route.data, error};
            return of(null);
          }));
      case (4):
        // tslint:disable-next-line:max-line-length
        return this.consoleService.listChannelMessages('', type.toString(), null, null, route.queryParamMap.get('user_id_one'), route.queryParamMap.get('user_id_two'), encodeURIComponent(route.queryParamMap.get('cursor')))
          .pipe(catchError(error => {
            route.data = {...route.data, error};
            return of(null);
          }));
      default:
        return of(null);
    }
  }
}

