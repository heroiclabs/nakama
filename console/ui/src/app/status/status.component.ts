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

import {Component, OnInit, OnDestroy, Injectable} from '@angular/core';
import {ConsoleService, StatusList} from '../console.service';
import {Observable, of, Subscription, timer} from 'rxjs';
import {FormBuilder, FormGroup} from '@angular/forms';
import {ActivatedRoute, ActivatedRouteSnapshot, Resolve, RouterStateSnapshot} from '@angular/router';
import {catchError, mergeMap} from 'rxjs/operators';

@Component({
  selector: 'app-status',
  templateUrl: './status.component.html',
  styleUrls: ['./status.component.scss']
})
export class StatusComponent implements OnInit, OnDestroy {
  public error = '';
  public statusData: StatusList;
  public rateGraphData = [];
  public latencyGraphData = [];
  public inputGraphData = [];
  public outputGraphData = [];
  public rangeForm: FormGroup;
  public readonly ranges = {
    1: 'last 1 minute',
    10: 'last 10 minutes',
    30: 'last 30 minutes',
    60: 'last 1 hour',
    1440: 'last 24 hours',
  };
  public readonly colorScheme = {
    domain: ['#5AA454', '#E44D25', '#1e59cf', '#7aa3e5', '#a8385d', '#d0bd00']
  };
  private readonly samples = 60; // Number of samples in the series
  private refreshTimer: Observable<number>;
  private $refreshTimer: Subscription;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly consoleService: ConsoleService,
    private readonly formBuilder: FormBuilder,
  ) {}

  ngOnInit(): void {
    this.rangeForm = this.formBuilder.group({
      rangeMinutes: [10], // Default range to 10 min window
    });

    this.route.data.subscribe(data => {
      const nodeNames = data[0];
      this.initData(nodeNames);
      this.refresh();
      this.refreshTimer = timer(0, this.calculateRateSeconds() * 1000);
      this.$refreshTimer = this.refreshTimer.subscribe(_ => this.refresh());
    }, err => {
      this.error = err;
    });
  }

  private refresh(): void {
    this.consoleService.getStatus('').subscribe(data => {
      this.statusData = data;
      this.rateGraphData = this.updateData(this.rateGraphData, 'avg_rate_sec', data);
      this.latencyGraphData = this.updateData(this.latencyGraphData, 'avg_latency_ms', data);
      this.inputGraphData = this.updateData(this.inputGraphData, 'avg_input_kbs', data);
      this.outputGraphData = this.updateData(this.outputGraphData, 'avg_output_kbs', data);
      // TODO: handle error
    });
  }

  private generateSeries(): any {
    let pointTs = new Date();
    pointTs.setMilliseconds(0);
    const timestamps = [];
    for (let i = 0; i < this.samples; i++) {
      pointTs = new Date(pointTs.getTime() - this.calculateRateSeconds() * 1000);
      timestamps.push(pointTs);
    }

    return timestamps.reverse().map(p => {
      return {
        name: p,
        value: 0,
      };
    });
  }

  private initData(names: string[]): void {
    const series = this.generateSeries();
    this.latencyGraphData = names.map(n => ({ name: n, series }));
    this.rateGraphData = names.map(n => ({ name: n, series }));
    this.inputGraphData = names.map(n => ({ name: n, series }));
    this.outputGraphData = names.map(n => ({ name: n, series }));
  }

  private updateData(currentData: any, key: string, data: StatusList): any {
    const statusList = data.nodes;
    const updatedData = [];
    const ts = data.timestamp;

    // If a node is not present in the results anymore, append a new point with 0 value.
    const currentNodes = currentData.map(d => d.name);
    const dataNodes = statusList.map(d => d.name);
    const missingNodes = this.setDifference(currentNodes, dataNodes);
    for (const node of currentData) {
      if (missingNodes.includes(node.name)) {
        updatedData.push({
          name: node.name,
          series: this.shiftData(node.series, 0, ts),
        });
      }
    }

    // Update new and already existing nodes
    for (const node of statusList) {
      let newSeries = [];
      let newData = {};
      const currentSeries = currentData.find(d => d.name === node.name)?.series;
      if (currentSeries) {
        // A series for this node already exists, append new data point
        newSeries = this.shiftData(currentSeries, node[key], ts);
      } else {
        // A series for this node does not exists yet, generate it and append data point
        newSeries = this.shiftData(this.generateSeries(), node[key], ts);
      }
      newData = {
        name: node.name,
        series: newSeries,
      };
      updatedData.push(newData);
    }

    return updatedData;
  }

  private shiftData(data, value, ts): any {
    const newData = data.slice(1);
    newData.push({
      name: new Date(ts),
      value,
    });

    return newData;
  }

  private calculateRateSeconds(): number {
    return Math.floor((this.f.rangeMinutes.value * 60) / this.samples);
  }

  public setRange(event): void {
    this.rangeForm.reset({rangeMinutes: +event.target.value});
    this.reset();
  }

  private reset(): void {
    this.consoleService.getStatus('').subscribe(data => {
      this.initData(data.nodes.map(n => n.name));
      this.$refreshTimer?.unsubscribe();
      this.refreshTimer = timer(0, this.calculateRateSeconds() * 1000);
      this.$refreshTimer = this.refreshTimer.subscribe(_ => this.refresh());
    }, err => {
      this.error = err;
    });
  }

  private setDifference(setA, setB): string[] {
    const difference = new Set<string>(setA);
    for (const elem of setB) {
      difference.delete(elem);
    }
    return Array.from(difference);
  }

  get f(): any {
    return this.rangeForm.controls;
  }

  ngOnDestroy(): void {
    this.$refreshTimer.unsubscribe();
  }
}

@Injectable({providedIn: 'root'})
export class GraphInitNodesResolver implements Resolve<string[]> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<string[]> {
    return this.consoleService.getStatus('').pipe(mergeMap(r => of(r.nodes.map(n => n.name))))
      .pipe(catchError(error => {
        route.data = {...route.data, error};
        return of([]);
      }));
  }
}
