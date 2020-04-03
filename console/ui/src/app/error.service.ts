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
import {Subject} from 'rxjs';

@Injectable()
export class ErrorService {
  private reportErrorSource = new Subject<string>();

  reportedError$ = this.reportErrorSource.asObservable();

  reportError(error: string) {
    this.reportErrorSource.next(error);
  }
}
