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
 * Currently a stub - logs the payload and returns success without calling any API.
 */
export async function publishToFedica(submission: SocialAuthSubmission): Promise<FedicaPublishResult> {
  const payload = buildFedicaPayload(submission);

  // TODO(fedica-integration): replace with a real Fedica API call once credentials exist.
  console.log(`[Fedica Stub] Would publish ${payload.postId} to [${payload.destinations.join(', ')}]:\n${payload.text}`);

  return {
    success: true,
    fedicaPostId: `stub-${payload.postId}`
  };
}
