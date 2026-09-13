import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthSessionService } from './core/auth/auth-session.service';
import { LocalDataStore } from './core/data/local-data.store';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly auth = inject(AuthSessionService);
  protected readonly data = inject(LocalDataStore);
  protected readonly menuOpen = signal(false);

  protected closeMenu(): void {
    this.menuOpen.set(false);
  }

  protected signIn(): void {
    this.auth.redirectToSignIn(true);
  }

  protected importDeviceData(): void {
    void this.data.importDeviceData();
  }

  protected retryCloudSync(): void {
    this.data.retryCloudSync();
  }
}
