import {Injectable} from '@angular/core';
import {NgbModal, NgbModalOptions} from '@ng-bootstrap/ng-bootstrap';
import {DeleteConfirmDialogComponent} from './delete-confirm-dialog/delete-confirm-dialog.component';

@Injectable({
  providedIn: 'root'
})
export class DeleteConfirmService {

  constructor(private modalService: NgbModal) {
  }

  openDeleteConfirmModal(confirmedCallback: () => void, title: string = '', message: string = ''): void {
    const modalOptions: NgbModalOptions = {
      backdrop: false,
    };
    const modalRef = this.modalService.open(DeleteConfirmDialogComponent, modalOptions);
    if (title) {
      modalRef.componentInstance.title = title;
    }
    if (message) {
      modalRef.componentInstance.message = message;
    }
    modalRef.componentInstance.confirmed.subscribe(() => {
      confirmedCallback();
      modalRef.close();
    });
    modalRef.componentInstance.canceled.subscribe(() => {
      modalRef.close();
    });
  }
}
