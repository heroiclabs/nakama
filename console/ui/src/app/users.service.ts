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

import {Injectable} from '@angular/core';

import {DeveloperConsole} from './console';
import {AuthenticationService} from './authentication.service';

@Injectable({
  providedIn: 'root'
})
export class UsersService {
  constructor(
    private readonly console: DeveloperConsole,
    private readonly authenticationService: AuthenticationService,
  ) {}

  listUsers(filter: string, banned: boolean, tombstones: boolean) {
    return this.console.listUsers(this.authenticationService.currentSessionValue.token, filter, banned, tombstones);
  }

	deleteAllUsers() {
		return this.console.deleteUsers(this.authenticationService.currentSessionValue.token);
	}
}
