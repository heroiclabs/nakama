import { transition, trigger, query, style, animate, group, animateChild } from '@angular/animations';

export const routeTransitionAnimation =
  trigger('routeAnimations', [
    transition('* => *', [
      query(':enter', [
          style({
            opacity: 0.2
          }),
          animate('1s ease',
            style({
              opacity: 1
            })
          )
      ], { optional: true }),
    ]),
  ]);
