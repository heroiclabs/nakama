import {Injectable} from '@angular/core';
import {UserRole} from './console.service';

@Injectable({providedIn: 'root'})
export class Globals {
  restrictedPages = new Map([
    ['users', UserRole.USER_ROLE_ADMIN],
    ['config', UserRole.USER_ROLE_DEVELOPER],
    ['modules', UserRole.USER_ROLE_DEVELOPER],
    ['apiexplorer', UserRole.USER_ROLE_DEVELOPER],
  ]);
}
