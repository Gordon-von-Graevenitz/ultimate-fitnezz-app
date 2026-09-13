# AI workout assistant setup

The workout assistant runs entirely through the existing Cloudflare Worker:

- `POST /api/ai/workout-recommendation` uses the Workers AI text binding.
- `POST /api/ai/transcribe` uses Cloudflare-hosted Whisper.
- The Angular application never receives an AI API key.
- Accepted plans and newly approved exercises remain in browser local storage.

## Deploy the Worker and Angular assets

Cloudflare Git builds should use:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

For a local production-style preview, authenticate Wrangler first with `npx wrangler login`, then run `npm run preview:cloudflare` and open the URL shown by Wrangler. Use `npm run preview:cloudflare:ai` only when you intentionally want the remote Workers AI binding. `ng serve` only serves the Angular browser bundle and does not run the `/api` routes.

Workers AI includes a daily free allocation. When a free-plan account reaches its allocation, AI requests fail until the daily reset rather than switching to paid usage.

## Require email sign-in with Cloudflare Access

Complete this before sharing the AI-enabled deployment:

1. Open the Cloudflare dashboard and go to **Zero Trust**.
2. Choose the **Free** plan and create the Zero Trust organization if it does not exist yet.
3. Go to **Settings → Authentication → Login methods** and enable **One-time PIN**.
4. Go to **Access controls → Applications → Add an application**.
5. Choose **Self-hosted** and enter the deployed BarBelle's Worker hostname.
6. Create an **Allow** policy using **Emails** and add only the approved trainer and owner email addresses.
7. Set a session duration appropriate for the trainer's device, such as one week.
8. Save the policy and verify the site shows Cloudflare's email-code login before Angular loads.

Cloudflare Access protects the entire application, including both `/api/ai/*` endpoints. The round trainer avatar links to `/cdn-cgi/access/logout` so the trainer can end the session.

## Privacy and abuse controls

- The browser sends only the selected customer's goal titles and recent workout summaries. Names, contact details, measurements and photos are omitted.
- Audio recordings are sent for transcription and are not written to application storage.
- The Worker caps prompt, catalog, audio, output and request sizes and applies a small burst limit.
- AI output is normalized against the exercise catalog. Unknown IDs are discarded and become trainer-approved new exercises.
- Do not log raw prompts, audio or AI output when enabling Cloudflare observability.

## Verification

1. Sign in using an allowed email address.
2. Open **Plans → Ask plan assistant**.
3. Generate one text-based draft.
4. Record and transcribe a short push-to-talk request.
5. Confirm a newly suggested exercise is highlighted and editable.
6. Accept the draft and verify it appears under **Plans**.
7. Sign out from the trainer avatar and confirm the next visit requires authentication.
