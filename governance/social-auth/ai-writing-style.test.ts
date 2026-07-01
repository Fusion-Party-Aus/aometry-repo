import { describe, it, expect } from 'vitest';
import { checkAiWritingStyle } from './ai-writing-style';

describe('checkAiWritingStyle', () => {
  it('returns no flags for short, plain human-sounding text', () => {
    const flags = checkAiWritingStyle('Voted yes on the housing bill today. More to come.');
    expect(flags).toHaveLength(0);
  });

  it('returns no flags for empty text', () => {
    expect(checkAiWritingStyle('')).toHaveLength(0);
  });

  it('flags text saturated with AI-sounding phrasing above the noise threshold', () => {
    const aiSounding =
      "In today's rapidly evolving landscape, it's important to delve into the intricate " +
      "tapestry of policy considerations. Let's dive in and explore the multifaceted paradigm " +
      "shift this represents. It is worth noting that this underscores the significance of " +
      "our unwavering commitment to innovative, cutting-edge solutions. In conclusion, this " +
      "represents a testament to our dedication, and it's important to note that we must " +
      "navigate this complex landscape together, delving deeper into the nuanced tapestry " +
      "of considerations that shape our paradigm.";
    const flags = checkAiWritingStyle(aiSounding);
    expect(flags.length).toBeGreaterThan(0);
  });

  it('never returns a critical-severity flag — style is advisory only, never blocking', () => {
    const aiSounding =
      "In today's rapidly evolving landscape, it's important to delve into the intricate " +
      "tapestry of policy considerations. Let's dive in and explore the multifaceted paradigm " +
      "shift this represents. It is worth noting that this underscores the significance of " +
      "our unwavering commitment to innovative, cutting-edge solutions. In conclusion, this " +
      "represents a testament to our dedication, and it's important to note that we must " +
      "navigate this complex landscape together, delving deeper into the nuanced tapestry " +
      "of considerations that shape our paradigm.";
    const flags = checkAiWritingStyle(aiSounding);
    expect(flags.every(f => f.severity === 'info')).toBe(true);
  });

  it('flag reason mentions the AI-writing style origin so it reads distinctly from policy flags', () => {
    const aiSounding =
      "In today's rapidly evolving landscape, it's important to delve into the intricate " +
      "tapestry of policy considerations. Let's dive in and explore the multifaceted paradigm " +
      "shift this represents. It is worth noting that this underscores the significance of " +
      "our unwavering commitment to innovative, cutting-edge solutions. In conclusion, this " +
      "represents a testament to our dedication, and it's important to note that we must " +
      "navigate this complex landscape together, delving deeper into the nuanced tapestry " +
      "of considerations that shape our paradigm.";
    const flags = checkAiWritingStyle(aiSounding);
    expect(flags.some(f => /ai.writing|ai.sounding|ai.pattern/i.test(f.reason))).toBe(true);
  });

  it('returns at most one flag — a single summary, not one per pattern hit', () => {
    const aiSounding =
      "In today's rapidly evolving landscape, it's important to delve into the intricate " +
      "tapestry of policy considerations. Let's dive in and explore the multifaceted paradigm " +
      "shift this represents. It is worth noting that this underscores the significance of " +
      "our unwavering commitment to innovative, cutting-edge solutions. In conclusion, this " +
      "represents a testament to our dedication, and it's important to note that we must " +
      "navigate this complex landscape together, delving deeper into the nuanced tapestry " +
      "of considerations that shape our paradigm.";
    const flags = checkAiWritingStyle(aiSounding);
    expect(flags.length).toBeLessThanOrEqual(1);
  });

  it('does not throw on very short or whitespace-only input', () => {
    expect(() => checkAiWritingStyle('   ')).not.toThrow();
    expect(() => checkAiWritingStyle('hi')).not.toThrow();
  });
});
