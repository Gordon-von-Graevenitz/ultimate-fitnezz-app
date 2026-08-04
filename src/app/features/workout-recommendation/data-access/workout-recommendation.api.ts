import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  TranscriptionResponse,
  WorkoutRecommendationDraft,
  WorkoutRecommendationRequest,
} from '../../../core/models/workout-recommendation.models';

@Injectable({ providedIn: 'root' })
export class WorkoutRecommendationApi {
  private readonly http = inject(HttpClient);

  transcribe(audio: Blob): Promise<TranscriptionResponse> {
    const formData = new FormData();
    const extension = audio.type.includes('mp4') ? 'm4a' : 'webm';
    formData.append('audio', audio, `workout-request.${extension}`);
    return firstValueFrom(this.http.post<TranscriptionResponse>('/api/ai/transcribe', formData));
  }

  recommend(request: WorkoutRecommendationRequest): Promise<WorkoutRecommendationDraft> {
    return firstValueFrom(
      this.http.post<WorkoutRecommendationDraft>('/api/ai/workout-recommendation', request),
    );
  }
}
