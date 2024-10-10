import {Component, Input, OnInit} from '@angular/core';
import {FormBuilder, FormGroup, Validators} from '@angular/forms';
import {ConsoleService} from '../console.service';
import {AuthenticationService, MFAClaims} from '../authentication.service';
import {Router} from '@angular/router';

@Component({
  selector: 'mfa-setup',
  templateUrl: './mfa-setup.component.html',
  styleUrls: ['./mfa-setup.component.scss']
})
export class MfaSetupComponent implements OnInit {
  @Input() required: boolean;

  public codeForm: FormGroup;
  public mfaCode: MFAClaims;
  public submitted = false;
  public downloadClicked = false;
  public recoveryCodes: string[];
  public error = '';

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly consoleService: ConsoleService,
    private readonly authService: AuthenticationService,
    public readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.codeForm = this.formBuilder.group({
      code: ['', Validators.required],
    });

    this.mfaCode = this.authService.mfa;
  }

  onSubmit(): void {
    this.submitted = true;
    this.error = '';
    if (this.codeForm.invalid) {
      return;
    }
    this.authService.mfaSet(this.f.code.value).subscribe(response => {
      this.codeForm.reset();
      this.submitted = false;
      this.recoveryCodes = response.recovery_codes;
    }, err => {
      this.error = err;
      this.submitted = false;
    });
  }

  mfaUrl(): string {
    return decodeURIComponent(this.mfaCode.mfa_url);
  }

  get f(): any {
    return this.codeForm.controls;
  }

  downloadRecoveryCodes(): void {
    const codes = this.recoveryCodes.map(((v, i) => i % 2 === 0 ? '\n' + v : v));
    const link = document.createElement('a');

    link.href = window.URL.createObjectURL(new Blob([codes.join(' ').trim()], { type: 'text/plain' }));
    link.download = 'nakama_mfa_recovery_codes.txt';
    link.click();
    window.URL.revokeObjectURL(link.href);
    this.downloadClicked = true;
  }
}
