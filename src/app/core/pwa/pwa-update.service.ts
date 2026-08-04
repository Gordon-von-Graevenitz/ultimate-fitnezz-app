import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwUpdate, VersionEvent } from '@angular/service-worker';
import { filter } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PwaUpdateService {
  private readonly updates = inject(SwUpdate);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private started = false;

  start(): void {
    if (this.started || !this.updates.isEnabled) return;
    this.started = true;

    this.updates.versionUpdates
      .pipe(
        filter((event: VersionEvent) => event.type === 'VERSION_READY'),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.reload());

    this.updates.unrecoverable
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.reload());

    void this.updates.checkForUpdate().catch((error: unknown) => {
      console.warn('Unable to check for a PWA update.', error);
    });
  }

  private reload(): void {
    this.document.defaultView?.location.reload();
  }
}
