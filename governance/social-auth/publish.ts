/**
 * Fedica Publish Integration
 *
 * STUB: no Fedica API credentials are wired up yet. This builds the final post payload
 * once a submission crosses its approval threshold, and logs it instead of calling out.
 * Swap publishToFedica's body for a real API call once credentials/API shape are confirmed -
 * the call site (interaction.ts) and the FedicaPublishResult contract are already in place.
 */

import { SocialAuthSubmission, FedicaPublishPayload, FedicaPublishResult } from './types';

export function buildFedicaPayload(submission: SocialAuthSubmission): FedicaPublishPayload {
  const { content, destinations } = submission;

  let text = content.commentary;
  if (content.articleLink) text += `\n${content.articleLink}`;
  content.policyLinks.forEach(url => { text += `\nSee our policy here: ${url}`; });
  if (content.hashtags.length) text += `\n${content.hashtags.map(t => `#${t}`).join(' ')}`;

  const imageRequired = destinations.includes('Facebook') || destinations.includes('Instagram');

  return {
    postId: submission.id,
    destinations,
    text,
    articleLink: content.articleLink,
    imageRequired
  };
}

/**
 * Publish an approved submission to Fedica.
 *
 * Set FEDICA_API_KEY (and optionally FEDICA_API_URL) to enable real publishing.
 * Without them the payload is written to fedica-test-output.json for local inspection.
 *
 * TODO(fedica-integration): confirm real endpoint + request shape once credentials/docs arrive.
 */
export async function publishToFedica(submission: SocialAuthSubmission): Promise<FedicaPublishResult> {
  const payload = buildFedicaPayload(submission);
  const apiKey = process.env.FEDICA_API_KEY;

  if (apiKey) {
    const baseUrl = process.env.FEDICA_API_URL ?? 'https://api.fedica.com';
    // TODO(fedica-integration): replace with real endpoint + request shape once confirmed.
    const res = await fetch(`${baseUrl}/posts`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '(no body)');
      return { success: false, error: `Fedica ${res.status}: ${body}` };
    }
    const data = await res.json() as { id?: string };
    return { success: true, fedicaPostId: data.id };
  }

  // Stub path: dump payload to file so local test runs can inspect what would be sent.
  const fs = await import('fs/promises');
  const outPath = 'fedica-test-output.json';
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`[Fedica Stub] No FEDICA_API_KEY — payload written to ${outPath}`);

  return { success: true, fedicaPostId: `stub-${payload.postId}` };
}
