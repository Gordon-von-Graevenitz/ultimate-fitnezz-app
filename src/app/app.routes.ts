import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Home · Kinship',
    loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    path: 'clients',
    title: 'People · Kinship',
    loadComponent: () => import('./features/clients/client-list/client-list').then((m) => m.ClientList),
  },
  {
    path: 'clients/:clientId',
    title: 'Customer · Kinship',
    loadComponent: () => import('./features/clients/client-detail/client-detail').then((m) => m.ClientDetail),
  },
  {
    path: 'workouts',
    title: 'Workout plans · Kinship',
    loadComponent: () => import('./features/workouts/workout-plans').then((m) => m.WorkoutPlans),
  },
  {
    path: 'progress',
    title: 'Progress insights · Kinship',
    loadComponent: () => import('./features/progress/progress-overview').then((m) => m.ProgressOverview),
  },
  {
    path: 'session/new',
    title: 'Record workout · Kinship',
    loadComponent: () =>
      import('./features/workout-session/workout-session').then((m) => m.WorkoutSession),
  },
  { path: '**', redirectTo: '' },
];
