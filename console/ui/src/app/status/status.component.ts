
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
import {forkJoin, Observable, of, Subscription} from 'rxjs';

import {AuthenticationService} from '../authentication.service';
import {StatusService} from '../status.service';
import {StatusListStatus, StatusList, DeveloperConsole} from '../console';

@Component({
  templateUrl: './status.component.html',
  styleUrls: ['./status.component.scss']
})
export class StatusComponent implements OnInit, OnDestroy {
  public nodeStats: StatusListStatus[];
  private nodeStatsSub: Subscription;
  public error: any; 

  private temp: any;

  constructor (
    private readonly statusService: StatusService,
    private readonly authenticationService: AuthenticationService,
  ) {}

  ngOnInit(): void {
    this.nodeStatsSub = this.statusService.getStatus().subscribe(data => {
      this.temp = data.nodes
      this.nodeStats = data.nodes
    }, err => {
      this.error = err;
    })
  }

  ngOnDestroy() {
  }
}
