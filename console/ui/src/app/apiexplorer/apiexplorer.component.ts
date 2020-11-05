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

import {AfterViewInit, Component, ElementRef, Injectable, OnInit, ViewChild} from '@angular/core';
import {ActivatedRoute, ActivatedRouteSnapshot, Resolve, Router, RouterStateSnapshot} from '@angular/router';
import {
  AddUserRequest,
  ApiEndpointDescriptor,
  ApiEndpointList,
  CallApiEndpointRequest, CallApiEndpointResponse,
  ConsoleService,
  UserList,
  UserListUser,
  UserRole
} from '../console.service';
import {FormBuilder, FormGroup, Validators} from '@angular/forms';
import {mergeMap} from 'rxjs/operators';
import {Observable} from 'rxjs';
import * as ace from 'ace-builds';

@Component({
  templateUrl: './apiexplorer.component.html',
  styleUrls: ['./apiexplorer.component.scss']
})
export class ApiExplorerComponent implements OnInit, AfterViewInit {
  @ViewChild("editor") private editor: ElementRef<HTMLElement>;
  @ViewChild("editorResponse") private editorResponse: ElementRef<HTMLElement>;

  private aceEditor: ace.Ace.Editor;
  private aceEditorResponse: ace.Ace.Editor;
  public error = '';
  public rpcEndpoints: Array<ApiEndpointDescriptor> = [];
  public endpoints: Array<ApiEndpointDescriptor> = [];
  public endpointCallForm: FormGroup;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly consoleService: ConsoleService,
    private readonly formBuilder: FormBuilder,
  ) {}

  ngOnInit(): void {
    this.endpointCallForm = this.formBuilder.group({
      method: ['', Validators.required],
      user_id: [''],
      custom_rpc: [false],
    });

    this.route.data.subscribe(data => {
      const endpoints = data[0] as ApiEndpointList;
      this.endpoints.length = 0;
      this.endpoints.push(...endpoints.endpoints);
      this.rpcEndpoints.length = 0;
      this.rpcEndpoints.push(...endpoints.rpc_endpoints);
    }, err => {
      this.error = err;
    });

    this.route.queryParamMap.subscribe(qp => {
      const endpoint = this.rpcEndpoints.find((e) => {
        return e.method === qp.get('endpoint') ? e : null;
      })
      if (endpoint != null) {
        this.f.method.setValue(endpoint.method);
      }
    });
  }

  ngAfterViewInit(): void {
    ace.config.set('fontSize', '14px');
    ace.config.set('printMarginColumn', 0);
    ace.config.set('useWorker', true);
    ace.config.set('highlightSelectedWord', true);
    ace.config.set('fontFamily', '"Courier New", Courier, monospace');
    this.aceEditor = ace.edit(this.editor.nativeElement);
    this.aceEditor.setReadOnly(true);
    this.aceEditorResponse = ace.edit(this.editorResponse.nativeElement);
    this.aceEditorResponse.setReadOnly(true);
  }

  public sendRequest(): void {
    this.error = "";

    let value = this.aceEditor.session.getValue();
    if (value !== '') {
      try {
        value = JSON.stringify(JSON.parse(value));
      } catch (e) {
        this.error = e;
        return
      }
    }

    const req : CallApiEndpointRequest = {
      user_id: this.f.user_id.value,
      body: value,
    }

    const endpointCall = this.f.custom_rpc.value ? this.consoleService.callRpcEndpoint('', this.f.method.value, req) : this.consoleService.callApiEndpoint('', this.f.method.value, req);
    endpointCall.subscribe(resp => {
      if (resp.error_message && resp.error_message !== '') {
        this.aceEditorResponse.session.setValue(resp.error_message);
      } else {
        let value = '';
        try {
          value = JSON.stringify(JSON.parse(resp.body), null, 2);
        } catch (e) {
          this.error = e;
          return
        }
        this.aceEditorResponse.session.setValue(value);
      }
    }, error => {
      this.aceEditorResponse.session.setValue('');
      this.error = error;
    })
  }

  setupRequestBody(body) {
    if (!body || body === '') {
      this.aceEditor.session.setValue('');
      this.aceEditor.setReadOnly(true);
      return;
    }

    try {
      const value = JSON.stringify(JSON.parse(body), null, 2);
      this.aceEditor.session.setValue(value);
      this.aceEditor.setReadOnly(false);
    } catch (e) {
      this.error = e;
      return;
    }
  }

  updateQueryParam(endpoint) {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        endpoint: endpoint,
      },
      queryParamsHandling: 'merge',
    });
  }

  get f() {
    return this.endpointCallForm.controls;
  }
}


@Injectable({providedIn: 'root'})
export class ApiExplorerEndpointsResolver implements Resolve<ApiEndpointList> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<ApiEndpointList> {
    return this.consoleService.listApiEndpoints('');
  }
}
