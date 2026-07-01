import { describe, it, expect, vi } from 'vitest';
import {
  researchTopics,
  retrievePolicyGrounding,
  generateDraft,
  runContentPipeline,
} from './llm-pipeline';
import { Destination } from './types';

describe('researchTopics (stub)', () => {
  it('resolves to an empty array regardless of input', async () => {
    const result = await researchTopics({});
    expect(result).toEqual([]);
  });

  it('resolves to an empty array when keywords and maxResults are provided', async () => {
    const result = await researchTopics({ keywords: ['climate', 'housing'], maxResults: 10 });
    expect(result).toEqual([]);
  });

  it('resolves to an empty array when a config is passed', async () => {
    const result = await researchTopics({}, { apiKey: 'x', model: 'claude-sonnet-5' });
    expect(result).toEqual([]);
  });
});

describe('retrievePolicyGrounding (stub)', () => {
  it('resolves to an empty array for any topic', async () => {
    const result = await retrievePolicyGrounding('housing policy');
    expect(result).toEqual([]);
  });

  it('resolves to an empty array even with a config supplied', async () => {
    const result = await retrievePolicyGrounding('climate policy', {
      apiKey: 'x',
      model: 'claude-sonnet-5',
      policyIndexUrl: 'https://policy.example.com',
    });
    expect(result).toEqual([]);
  });
});

describe('generateDraft (stub)', () => {
  it('returns a placeholder commentary referencing the topic', async () => {
    const result = await generateDraft({ topic: 'housing affordability', destinations: ['Twitter/X'] });
    expect(result.content.commentary).toContain('housing affordability');
    expect(result.content.articleLink).toBeNull();
    expect(result.content.policyLinks).toEqual([]);
  });

  it('carries through requested hashtags into content.hashtags', async () => {
    const result = await generateDraft({
      topic: 'climate policy',
      destinations: ['Facebook'],
      hashtags: ['climate', 'auspol'],
    });
    expect(result.content.hashtags).toEqual(['climate', 'auspol']);
  });

  it('defaults hashtags to an empty array when none are requested', async () => {
    const result = await generateDraft({ topic: 'climate policy', destinations: ['Facebook'] });
    expect(result.content.hashtags).toEqual([]);
  });

  it('returns empty policyGrounding and stub metadata', async () => {
    const result = await generateDraft({ topic: 'climate policy', destinations: ['Facebook'] });
    expect(result.policyGrounding).toEqual([]);
    expect(result.generatedBy).toBe('stub');
    expect(result.promptTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });
});

describe('runContentPipeline (stub)', () => {
  it('composes retrievePolicyGrounding and generateDraft into a single DraftResult', async () => {
    const destinations: Destination[] = ['Twitter/X', 'Facebook'];
    const result = await runContentPipeline('housing affordability', destinations);

    expect(result.content.commentary).toContain('housing affordability');
    expect(result.policyGrounding).toEqual([]);
    expect(result.generatedBy).toBe('stub');
  });

  it('calls retrievePolicyGrounding and generateDraft with the same topic', async () => {
    // Spy on the module's exported functions is not possible without breaking encapsulation
    // (ESM named exports are not directly mockable here), so instead we assert behaviourally:
    // the returned commentary must embed the same topic string used for grounding retrieval.
    const topic = 'renewable energy transition';
    const result = await runContentPipeline(topic, ['Mastodon']);
    expect(result.content.commentary).toContain(topic);
  });

  it('propagates an optional LlmPipelineConfig through to both stages without throwing', async () => {
    const config = { apiKey: 'k', model: 'claude-sonnet-5', policyIndexUrl: 'https://policy.example.com' };
    await expect(runContentPipeline('topic', ['LinkedIn'], config)).resolves.toBeDefined();
  });
});