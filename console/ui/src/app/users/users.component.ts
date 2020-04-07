
// Copyright 2020 Heroic Labs.
// All rights reserved.
//
// NOTICE: All information contained herein is, and remains the property of Heroic
// Labs. and its suppliers, if any. The intellectual and technical concepts
// contained herein are proprietary to Heroic Labs. and its suppliers and may be
// covered by U.S. and Foreign Patents, patents in process, and are protected by
// trade secret or copyright law. Dissemination of this information or reproduction
// of this material is strictly forbidden unless prior written permission is
// obtained from Heroic Labs.

import {Component, Injectable, OnDestroy, OnInit, Pipe, PipeTransform} from '@angular/core';
import {FormBuilder, FormControl, FormGroup, Validators} from '@angular/forms';
import {forkJoin, Observable, of, Subscription} from 'rxjs';

import {ErrorService} from '../error.service';
import {ApiUser, DeveloperConsoleService} from '../console.service';

@Component({
  templateUrl: './users.component.html',
  styleUrls: ['./users.component.scss']
})
export class UsersComponent implements OnInit, OnDestroy {
  private usersSub: Subscription;
  private deleteAllUsersSub: Subscription;

  public error: any;
  public users: Array<ApiUser>;
  public users_num: number;

  public filterUsersForm: FormGroup;
  public filteredUsersFormError: any;
  public filteredUsersForm: boolean;

  private filter: string;
  private banned: boolean;
  private tombstones: boolean;

  constructor (
    private readonly consoleService: DeveloperConsoleService,
    private readonly errorService: ErrorService,
    private readonly formBuilder: FormBuilder,
  ) {}

  ngOnInit(): void {
    this.filterUsersForm = this.formBuilder.group({
      filter: [''],
      banned: [''],
      tombstones: [''],
    });

    this.usersSub = this.consoleService.listUsers("", this.filter, this.banned, this.tombstones).subscribe(data => {
      this.users = data.users;
      this.users_num = data.total_count;
    }, err => {
      this.error = err;
      this.errorService.reportError(err);
    })
  }

  filterUsers() {
    if (this.filterUsersForm.invalid) {
      return;
    }
    this.filter = this.filterUsersForm.controls.filter.value;
    this.banned = this.filterUsersForm.controls.banned.value;
    this.tombstones = this.filterUsersForm.controls.tombstones.value;

    this.usersSub = this.consoleService.listUsers("", this.filter, this.banned, this.tombstones).subscribe(data => {
      this.users = data.users;
      this.users_num = data.total_count;
    }, err => {
      this.error = err;
      this.errorService.reportError(err);
    })
  }

  deleteAllUsers() {
    this.deleteAllUsersSub = this.consoleService.deleteUsers("").subscribe(data => {
      this.users = data.users;
      this.users_num = data.total_count;
    }, err => {
      this.error = err;
      this.errorService.reportError(err);
    })
  }

  ngOnDestroy() {
  }
}
