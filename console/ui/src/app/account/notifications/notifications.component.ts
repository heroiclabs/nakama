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

import {Component, Injectable, Input, OnChanges, OnInit, SimpleChanges} from '@angular/core';
import {ActivatedRoute, ActivatedRouteSnapshot, Resolve, RouterStateSnapshot} from '@angular/router';
import {
  ApiPurchaseList,
  ApiValidatedPurchase,
  ConsoleService,
  ApiStoreProvider,
  ApiNotification, Notification, NotificationList, UserRole
} from '../../console.service';
import {Observable} from 'rxjs';
import {DeleteConfirmService} from "../../shared/delete-confirm.service";
import {AuthenticationService} from "../../authentication.service";

@Component({
  selector: 'app-notifications',
  templateUrl: './notifications.component.html',
  styleUrls: ['./notifications.component.scss'],
})
export class NotificationsComponent implements OnInit, OnChanges {
  public notifications: Notification[] = [];
  public notificationsRowsOpen: boolean[] = [];
  public error = '';
  public nextCursor = '';
  public prevCursor = '';
  public userId: string;
  public readonly limit = 100;

  @Input('notification_id') notificationId: string;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly consoleService: ConsoleService,
    private readonly authService: AuthenticationService,
    private readonly deleteConfirmService: DeleteConfirmService,
  ) {}

  ngOnInit(): void {
    const paramUserId = this.route?.parent?.snapshot?.paramMap?.get('id') ?? '';
    if (paramUserId) {
      this.userId = paramUserId;
    }
    this.route.data.subscribe(data => {
      this.notifications = data[0].notifications;
      this.nextCursor = data[0].next_cursor;
      this.prevCursor = data[0].prev_cursor;
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes.notificationId.firstChange) {
      if (this.notificationId) {
        this.notificationId = this.notificationId.trim();
        this.consoleService.getNotification('', this.notificationId).subscribe(res => {
          this.notifications = [res];
        }, error => {
          this.error = error;
        });
      } else if (this.notificationId === '') {
        this.loadData('');
      }
    }
  }

  loadData(cursor: string): void {
    this.error = '';
    this.consoleService.listNotifications(
      '',
      this.userId,
      this.limit,
      cursor,
    ).subscribe(res => {
      this.notifications = res.notifications;
      this.notificationsRowsOpen = [];
      this.nextCursor = res.next_cursor;
      this.prevCursor = res.prev_cursor;
    }, error => {
      this.error = error;
    });
  }

  deleteNotification(event, idx: number, n: Notification): void {
    this.deleteConfirmService.openDeleteConfirmModal(
      () => {
        event.target.disabled = true;
        this.error = '';
        this.consoleService.deleteNotification('', n.id).subscribe(() => {
          this.error = '';
          this.notifications.splice(idx, 1);
        }, err => {
          this.error = err;
        });
      }
    );
  }

  deleteAllowed(): boolean {
    return this.authService.sessionRole <= UserRole.USER_ROLE_MAINTAINER;
  }
}

@Injectable({providedIn: 'root'})
export class NotificationsResolver implements Resolve<NotificationList> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<ApiPurchaseList> {
    const userId = route.parent?.paramMap?.get('id') ?? '';

    return this.consoleService.listNotifications('', userId, 100);
  }
}
