import {Injectable} from '@angular/core';
import {NgbModal, NgbModalOptions} from '@ng-bootstrap/ng-bootstrap';
import {DeleteConfirmDialogComponent} from './delete-confirm-dialog/delete-confirm-dialog.component';
import {FormGroup} from "@angular/forms";

@Injectable({
  providedIn: 'root'
})
export class DeleteConfirmService {

  constructor(private modalService: NgbModal) {
  }

  openDeleteConfirmModal(
    confirmedCallback: (formValue: any) => void,
    formGroup: FormGroup = null,
    title: string = '',
    message: string = ''): void {
    const modalOptions: NgbModalOptions = {
      backdrop: false,
      centered: true,
    };
    const modalRef = this.modalService.open(DeleteConfirmDialogComponent, modalOptions);
    if (formGroup) {
      modalRef.componentInstance.confirmDeleteForm = formGroup;
    }
    if (title) {
      modalRef.componentInstance.title = title;
    }
    if (message) {
      modalRef.componentInstance.message = message;
    }
    modalRef.componentInstance.confirmed.subscribe(() => {
      confirmedCallback(formGroup?.value);
      modalRef.close();
    });
    modalRef.componentInstance.canceled.subscribe(() => {
      modalRef.close();
    });
  }
}
