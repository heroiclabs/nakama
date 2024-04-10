import { Component, Output, EventEmitter } from '@angular/core';
import {NgbModalRef} from "@ng-bootstrap/ng-bootstrap";
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

  closeModal(): void {
    this.canceled.emit();
  }

  cancel(): void {
    this.canceled.emit();
  }

  confirm(): void {
    this.confirmed.emit();
  }
}
