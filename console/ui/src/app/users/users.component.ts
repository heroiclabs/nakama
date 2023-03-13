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
import {AddUserRequest, ConsoleService, UserList, UserListUser, UserRole} from '../console.service';
import {UntypedFormBuilder, UntypedFormGroup, Validators} from '@angular/forms';
import {mergeMap} from 'rxjs/operators';
import {Observable} from 'rxjs';

@Component({
  selector: 'app-users',
  templateUrl: './users.component.html',
  styleUrls: ['./users.component.scss']
})
export class UsersComponent implements OnInit {
  public error = '';
  public userCreateError = '';
  public users: Array<UserListUser> = [];
  public createUserForm: UntypedFormGroup;
  public adminRole = UserRole.USER_ROLE_ADMIN;
  public developerRole = UserRole.USER_ROLE_DEVELOPER;
  public maintainerRole = UserRole.USER_ROLE_MAINTAINER;
  public readonlyRole = UserRole.USER_ROLE_READONLY;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly consoleService: ConsoleService,
    private readonly formBuilder: UntypedFormBuilder,
  ) {}

  ngOnInit(): void {
    this.createUserForm = this.formBuilder.group({
      username: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.compose([Validators.required, Validators.minLength(8)])],
      role: [+this.readonlyRole, Validators.required],
      newsletter: [false],
    });

    this.route.data.subscribe(data => {
      const users = data[0] as UserList;
      this.users.length = 0;
      this.users.push(...users.users);
    }, err => {
      this.error = err;
    });
  }

  public deleteUser(username: string): void {
    this.error = '';

    this.consoleService.deleteUser('', username).pipe(mergeMap(() => {
      return this.consoleService.listUsers('');
    })).subscribe(userList => {
      this.error = '';
      this.users.length = 0;
      this.users.push(...userList.users);
    }, error => {
      this.error = error;
    });
  }

  public addUser(): void {
    this.userCreateError = '';
    this.createUserForm.disable();

    let role: UserRole = UserRole.USER_ROLE_READONLY;

    switch (this.f.role.value) {
      case 1:
        role = UserRole.USER_ROLE_ADMIN;
        break;
      case 2:
        role = UserRole.USER_ROLE_DEVELOPER;
        break;
      case 3:
        role = UserRole.USER_ROLE_MAINTAINER;
        break;
      case 4:
        role = UserRole.USER_ROLE_READONLY;
        break;
    }

    const req: AddUserRequest = {
      username: this.f.username.value,
      email: this.f.email.value,
      password: this.f.password.value,
      role,
      newsletter_subscription: this.f.newsletter.value,
    };

    this.consoleService.addUser('', req).pipe(mergeMap(() => {
        return this.consoleService.listUsers('');
    })).subscribe(userList => {
        this.userCreateError = '';
        this.createUserForm.reset({role: +role});
        this.createUserForm.enable();
        this.users.length = 0;
        this.users.push(...userList.users);
    }, error => {
      this.userCreateError = error;
      this.createUserForm.enable();
    });
  }

  get f(): any {
    return this.createUserForm.controls;
  }
}

@Injectable({providedIn: 'root'})
export class UsersResolver implements Resolve<UserList> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<UserList> {
    return this.consoleService.listUsers('');
  }
}
