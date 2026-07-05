/**
 * Shared post-content composition — kept separate from publish.ts so lower-level
 * consumers (e.g. llm-pipeline.ts) don't have to depend on the Fedica integration
 * layer just to build the text they need to analyse.
 */

import { PostContent } from './types';

/**
 * Compose the final post text from content fields (same order Fedica receives it).
 */
export function composePostText(content: PostContent): string {
  let text = content.commentary;
  if (content.articleLink) text += `\n${content.articleLink}`;
  content.policyLinks.forEach(url => { text += `\nSee our policy here: ${url}`; });
  if (content.hashtags.length) text += `\n${content.hashtags.map(t => `#${t}`).join(' ')}`;
  return text;
}
