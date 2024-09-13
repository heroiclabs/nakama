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
import {UntypedFormBuilder, UntypedFormGroup, Validators} from '@angular/forms';
import {
  ActivatedRoute,
  ActivatedRouteSnapshot,
  CanActivate,
  Router,
  RouterStateSnapshot, UrlTree
} from '@angular/router';
import {AuthenticationService} from '../authentication.service';
import {SegmentService} from 'ngx-segment-analytics';
import {environment} from '../../environments/environment';

@Component({
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit {
  public error = '';
  public loginForm!: UntypedFormGroup;
  public submitted!: boolean;
  public mfaEnabled = false;
  private returnUrl!: string;

  constructor(
    public readonly router: Router,
    private segment: SegmentService,
    private readonly formBuilder: UntypedFormBuilder,
    private readonly route: ActivatedRoute,
    private readonly authService: AuthenticationService
  ) {}

  ngOnInit(): void {
    if (!environment.nt) {
      this.segment.page('/login');
    }
    this.loginForm = this.formBuilder.group({
      username: ['', Validators.compose([Validators.required])],
      password: ['', Validators.compose([Validators.required, Validators.minLength(8)])],
      code: [{ value: '', disabled: true }, Validators.compose([Validators.required, Validators.minLength(6), Validators.maxLength(8)])],
    });
    this.returnUrl = this.route.snapshot.queryParams.next || '/';
  }

  onSubmit(): void {
    this.submitted = true;
    this.error = '';
    if (this.loginForm.invalid) {
      return;
    }
    this.authService.login(this.f.username.value, this.f.password.value, this.f.code.value)
      .subscribe(response => {
        this.loginForm.reset();
        this.submitted = false;
        if (response.body.mfa_code && this.authService.mfaRequired) {
          this.router.navigate(['mfa'], {relativeTo: this.route});
        } else {
          this.router.navigate([this.returnUrl]);
        }
      }, err => {
        if (err.status === 403) {
          // MFA is enabled for this account, require code.
          this.mfaEnabled = true;
          this.f.username.disable();
          this.f.password.disable();
          this.f.code.enable();
        } else {
          this.error = err;
          this.submitted = false;
        }
      });
  }

  get f(): any {
    return this.loginForm.controls;
  }
}

@Injectable({providedIn: 'root'})
export class LoginGuard implements CanActivate {
  constructor(private readonly authService: AuthenticationService, private readonly router: Router) {}

  canActivate(next: ActivatedRouteSnapshot, state: RouterStateSnapshot): boolean {
    if (this.authService.session && !this.authService.session.mfa_code && !this.authService.mfaRequired) {
      const _ = this.router.navigate(['/']);
      return false;
    }
    return true;
  }
}
