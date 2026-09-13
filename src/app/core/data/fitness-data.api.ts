import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FitnessDataSnapshot } from '../models/fitness.models';

export interface FitnessDataEnvelope {
  readonly snapshot: FitnessDataSnapshot;
  readonly hasData: boolean;
  readonly updatedAt: string | null;
}

@Injectable({ providedIn: 'root' })
export class FitnessDataApi {
  private readonly http = inject(HttpClient);

  load(): Promise<FitnessDataEnvelope> {
    return firstValueFrom(
      this.http.get<FitnessDataEnvelope>('/api/data', {
        params: { 'ngsw-bypass': 'fitness-data' },
      }),
    );
  }

  save(snapshot: FitnessDataSnapshot): Promise<FitnessDataEnvelope> {
    return firstValueFrom(
      this.http.put<FitnessDataEnvelope>('/api/data', snapshot, {
        params: { 'ngsw-bypass': 'fitness-data' },
      }),
    );
  }
}
