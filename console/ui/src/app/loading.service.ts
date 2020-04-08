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

import {Injectable} from '@angular/core';
import {Subject, merge, timer, combineLatest} from 'rxjs';
import {mapTo, takeUntil, filter} from 'rxjs/operators';

@Injectable()
export class LoadingService {
  private loaderSource = new Subject<boolean>();
  private cancelSource = new Subject<boolean>();

  backendLoading$ = this.loaderSource.asObservable();
  backendNotLoading$ = this.cancelSource.asObservable();

  show() {
    let decision$ = merge(
      timer(1000).pipe(
        mapTo(true),
        takeUntil(this.backendNotLoading$)
      ),

      combineLatest(
        this.backendNotLoading$,
        timer(2000)
      ).pipe(
        mapTo(false)
      )
    );
    
    decision$.subscribe(
      ret => {
        this.loaderSource.next(ret);
      }
    );
  }

  hide() {
    this.cancelSource.next(false);
  }  
}
