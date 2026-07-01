import { describe, it, expect } from 'vitest';
import { composePostText } from './content';
import { PostContent } from './types';

function makeContent(overrides: Partial<PostContent> = {}): PostContent {
  return {
    commentary: 'Test post',
    articleLink: null,
    policyLinks: [],
    hashtags: [],
    ...overrides,
  };
}

describe('composePostText', () => {
  it('returns just the commentary when no other fields are set', () => {
    expect(composePostText(makeContent({ commentary: 'Hello world' }))).toBe('Hello world');
  });

  it('returns an empty string for empty commentary and no other fields', () => {
    expect(composePostText(makeContent({ commentary: '' }))).toBe('');
  });

  it('does not append anything when articleLink is null', () => {
    const text = composePostText(makeContent({ commentary: 'Hi', articleLink: null }));
    expect(text).toBe('Hi');
  });

  it('appends the article link on its own line when present', () => {
    const text = composePostText(makeContent({ commentary: 'Hi', articleLink: 'https://example.com' }));
    expect(text).toBe('Hi\nhttps://example.com');
  });

  it('does not append anything when policyLinks is empty', () => {
    const text = composePostText(makeContent({ commentary: 'Hi', policyLinks: [] }));
    expect(text).toBe('Hi');
  });

  it('appends each policy link with the "See our policy here:" prefix, one per line, in order', () => {
    const text = composePostText(makeContent({
      commentary: 'Hi',
      policyLinks: ['https://a.example.com', 'https://b.example.com'],
    }));
    expect(text).toBe('Hi\nSee our policy here: https://a.example.com\nSee our policy here: https://b.example.com');
  });

  it('does not append anything when hashtags is empty', () => {
    const text = composePostText(makeContent({ commentary: 'Hi', hashtags: [] }));
    expect(text).toBe('Hi');
  });

  it('appends hashtags space-separated and prefixed with # on their own line', () => {
    const text = composePostText(makeContent({ commentary: 'Hi', hashtags: ['auspol', 'fusionparty'] }));
    expect(text).toBe('Hi\n#auspol #fusionparty');
  });

  it('composes commentary, article link, policy links, and hashtags in that fixed order', () => {
    const text = composePostText({
      commentary: 'Test post',
      articleLink: 'https://example.com',
      policyLinks: ['https://policy.example.com'],
      hashtags: ['auspol'],
    });
    expect(text).toBe(
      'Test post\nhttps://example.com\nSee our policy here: https://policy.example.com\n#auspol'
    );
  });
});
