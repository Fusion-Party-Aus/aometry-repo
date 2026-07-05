/**
 * YouTube Announcements embed rendering — pure function, no Discord side-effects.
 */

import { EmbedBuilder } from 'discord.js';
import { YoutubeVideoEntry } from './types';

/** Build the #Announcements post for a newly-detected video upload. */
export function buildVideoAnnouncementEmbed(entry: YoutubeVideoEntry): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`📺 New video: ${entry.title}`)
    .setURL(entry.link)
    .setDescription(entry.link)
    .setColor(0xff0000)
    .setTimestamp(entry.publishedAt);
}
