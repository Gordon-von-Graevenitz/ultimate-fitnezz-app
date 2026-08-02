import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LocalDataStore } from '../../core/data/local-data.store';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly store = inject(LocalDataStore);

  protected readonly activeClientCount = computed(() => this.store.activeClients().length);
  protected readonly completedSessionCount = computed(
    () => this.store.workoutSessions().filter((session) => session.status === 'completed').length,
  );
  protected readonly plannedSessionCount = computed(
    () => this.store.workoutSessions().filter((session) => session.status === 'planned').length,
  );
  protected readonly adherence = computed(() => {
    const sessions = this.store.workoutSessions().filter((session) => session.status !== 'in-progress');
    if (sessions.length === 0) return 0;
    return Math.round((sessions.filter((session) => session.status === 'completed').length / sessions.length) * 100);
  });

  protected readonly upcoming = [
    { initials: 'MC', name: 'Maya Chen', time: '09:00', focus: 'Lower strength', tone: 'clay' },
    { initials: 'JL', name: 'Jonas Lee', time: '11:30', focus: 'Conditioning', tone: 'blue' },
    { initials: 'AP', name: 'Ana Petrova', time: '15:00', focus: 'Mobility', tone: 'green' },
  ];

  protected readonly attention = [
    { initials: 'JL', name: 'Jonas Lee', reason: 'No workout logged in 6 days', action: 'Review plan' },
    { initials: 'SM', name: 'Sofia Miller', reason: 'Goal check-in due today', action: 'Open profile' },
  ];
}
