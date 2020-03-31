
// Copyright 2019 Heroic Labs.
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

import {UsersService} from '../users.service';
import {ApiUser, DeveloperConsole} from '../console';

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
    private readonly usersService: UsersService,
    private readonly formBuilder: FormBuilder,
  ) {}

  ngOnInit(): void {
    this.filterUsersForm = this.formBuilder.group({
      filter: [''],
      banned: [''],
      tombstones: [''],
    });

    this.usersSub = this.usersService.listUsers(this.filter, this.banned, this.tombstones).subscribe(data => {
      this.users = data.users;
      this.users_num = data.total_count;
    }, err => {
      this.error = err;
    })
  }

  filterUsers() {
    if (this.filterUsersForm.invalid) {
      return;
    }
    this.filter = this.filterUsersForm.controls.filter.value;
    this.banned = this.filterUsersForm.controls.banned.value;
    this.tombstones = this.filterUsersForm.controls.tombstones.value;
    console.log("filtering users!")

    this.usersSub = this.usersService.listUsers(this.filter, this.banned, this.tombstones).subscribe(data => {
      this.users = data.users;
      this.users_num = data.total_count;
    }, err => {
      this.error = err;
    })
  }

	deleteAllUsers() {
		this.deleteAllUsersSub = this.usersService.deleteAllUsers().subscribe(data => {
      this.users = data.users;
      this.users_num = data.total_count;
		}, err => {
			this.error = err;
		})
	}

  ngOnDestroy() {
  }
}
