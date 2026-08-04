import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: "Home · BarBelle's Fitness Studio",
    loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    path: 'clients',
    title: "People · BarBelle's Fitness Studio",
    loadComponent: () => import('./features/clients/client-list/client-list').then((m) => m.ClientList),
  },
  {
    path: 'clients/:clientId',
    title: "Customer · BarBelle's Fitness Studio",
    loadComponent: () => import('./features/clients/client-detail/client-detail').then((m) => m.ClientDetail),
  },
  {
    path: 'workouts',
    title: "Workout plans · BarBelle's Fitness Studio",
    loadComponent: () => import('./features/workouts/workout-plans').then((m) => m.WorkoutPlans),
  },
  {
    path: 'workouts/recommend',
    title: "Plan assistant · BarBelle's Fitness Studio",
    loadComponent: () =>
      import('./features/workout-recommendation/workout-recommendation').then(
        (m) => m.WorkoutRecommendation,
      ),
  },
  {
    path: 'progress',
    title: "Progress insights · BarBelle's Fitness Studio",
    loadComponent: () => import('./features/progress/progress-overview').then((m) => m.ProgressOverview),
  },
  {
    path: 'session/new',
    title: "Record workout · BarBelle's Fitness Studio",
    loadComponent: () =>
      import('./features/workout-session/workout-session').then((m) => m.WorkoutSession),
  },
  { path: '**', redirectTo: '' },
];
