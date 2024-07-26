import {Component, Output, EventEmitter, Input} from '@angular/core';
import {FormGroup} from '@angular/forms';
@Component({
  selector: 'app-delete-confirm-dialog',
  templateUrl: './delete-confirm-dialog.component.html',
  styleUrls: ['./delete-confirm-dialog.component.scss']
})
export class DeleteConfirmDialogComponent {
  @Output() confirmed: EventEmitter<void> = new EventEmitter<void>();
  @Output() canceled: EventEmitter<void> = new EventEmitter<void>();
  title = 'Delete Confirmation';
  message = 'Are you sure you want to delete this item?';
  /*
This parameter is optional
we support two type of control
1. numberValueControl  -> { title: "", id: "", defaultValue: number }. e.g Chat Message delete retain setting
2. delete  -> control input for confirmation
  * */
  @Input() confirmDeleteForm: FormGroup;

  closeModal(): void {
    this.canceled.emit();
  }

  cancel(): void {
    this.canceled.emit();
  }

  confirm(): void {
    // if there is no form data pass or the form valid, confirmed can be emitted
    if (!this.confirmDeleteForm || this.confirmDeleteForm.valid) {
      this.confirmed.emit();
    }
  }

  get f(): any {
    return this.confirmDeleteForm.controls;
  }
}
