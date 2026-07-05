import { describe, it, expect } from 'vitest';
import { buildVideoAnnouncementEmbed } from './embed';
import { YoutubeVideoEntry } from './types';

const ENTRY: YoutubeVideoEntry = {
  videoId: 'AAA111',
  title: 'New Policy Explainer',
  publishedAt: new Date('2026-06-02T10:00:00Z'),
  link: 'https://www.youtube.com/watch?v=AAA111',
};

describe('buildVideoAnnouncementEmbed', () => {
  it('returns an object with a data property (EmbedBuilder shape)', () => {
    expect(buildVideoAnnouncementEmbed(ENTRY)).toHaveProperty('data');
  });

  it('includes the video title', () => {
    const embed = buildVideoAnnouncementEmbed(ENTRY);
    expect(JSON.stringify(embed.data)).toContain('New Policy Explainer');
  });

  it('includes the video link', () => {
    const embed = buildVideoAnnouncementEmbed(ENTRY);
    expect(JSON.stringify(embed.data)).toContain('https://www.youtube.com/watch?v=AAA111');
  });
});
