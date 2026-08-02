import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { LocalDataStore } from '../../../core/data/local-data.store';
import { ClientStatus, GoalCategory } from '../../../core/models/fitness.models';

type StatusFilter = 'all' | ClientStatus;

@Component({
  selector: 'app-client-list',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './client-list.html',
  styleUrl: './client-list.scss',
})
export class ClientList {
  readonly store = inject(LocalDataStore);
  readonly searchQuery = signal('');
  readonly statusFilter = signal<StatusFilter>('all');
  readonly isAddOpen = signal(false);
  readonly formError = signal('');

  readonly filteredClients = computed(() => {
    const query = this.searchQuery().trim().toLocaleLowerCase();
    const status = this.statusFilter();

    return [...this.store.clients()]
      .filter((client) => status === 'all' || client.status === status)
      .filter((client) => {
        if (!query) return true;
        return `${client.firstName} ${client.lastName} ${client.email}`
          .toLocaleLowerCase()
          .includes(query);
      })
      .sort((a, b) => a.firstName.localeCompare(b.firstName));
  });

  readonly activeCount = computed(
    () => this.store.clients().filter((client) => client.status === 'active').length,
  );

  readonly clientForm = new FormGroup({
    firstName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    lastName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    phone: new FormControl('', { nonNullable: true }),
    dateOfBirth: new FormControl('', { nonNullable: true }),
    notes: new FormControl('', { nonNullable: true }),
    goalTitle: new FormControl('', { nonNullable: true }),
    goalCategory: new FormControl<GoalCategory>('strength', { nonNullable: true }),
    targetDate: new FormControl('', { nonNullable: true }),
  });

  setSearch(value: string): void {
    this.searchQuery.set(value);
  }

  setStatus(value: string): void {
    this.statusFilter.set(value as StatusFilter);
  }

  openAddClient(): void {
    this.formError.set('');
    this.isAddOpen.set(true);
  }

  closeAddClient(): void {
    this.isAddOpen.set(false);
    this.clientForm.reset({ goalCategory: 'strength' });
  }

  addClient(): void {
    if (this.clientForm.invalid) {
      this.clientForm.markAllAsTouched();
      this.formError.set('Please complete the required fields before saving.');
      return;
    }

    const value = this.clientForm.getRawValue();
    const now = new Date().toISOString();
    const client = this.store.createClient({
      firstName: value.firstName.trim(),
      lastName: value.lastName.trim(),
      email: value.email.trim(),
      phone: value.phone.trim() || undefined,
      dateOfBirth: value.dateOfBirth || undefined,
      joinedAt: now.slice(0, 10),
      status: 'active',
      avatarColor: this.avatarColor(`${value.firstName}${value.lastName}`),
      notes: value.notes.trim() || undefined,
    });

    if (value.goalTitle.trim()) {
      this.store.createGoal({
        clientId: client.id,
        title: value.goalTitle.trim(),
        category: value.goalCategory,
        status: 'active',
        targetDate: value.targetDate || undefined,
      });
    }

    this.closeAddClient();
  }

  initials(firstName: string, lastName: string): string {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  }

  clientGoalCount(clientId: string): number {
    return this.store.goals().filter((goal) => goal.clientId === clientId && goal.status === 'active')
      .length;
  }

  lastSessionLabel(clientId: string): string {
    const session = this.store
      .workoutSessions()
      .filter((item) => item.clientId === clientId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    return session ? this.formatDate(session.startedAt) : 'No sessions yet';
  }

  formatDate(value: string): string {
    return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(
      new Date(value),
    );
  }

  private avatarColor(seed: string): string {
    const colors = ['#c86b49', '#718b76', '#597b8f', '#96705b', '#7f729a', '#b17c5f'];
    const total = [...seed].reduce((sum, character) => sum + character.charCodeAt(0), 0);
    return colors[total % colors.length];
  }
}
