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
export class StatusService {
  private temp: any;

  constructor(
    private readonly console: DeveloperConsole,
    private readonly authenticationService: AuthenticationService,
  ) {}

  getStatus() {
    this.temp = this.console.getStatus(this.authenticationService.currentSessionValue.token)
    return this.console.getStatus(this.authenticationService.currentSessionValue.token);
  }
}
