/**
 * AI writing-style advisory check for #auth-socmed submissions.
 * Wraps the vendored avoid-ai-writing detector (vendor/ai-writing-detector.js) — a free,
 * deterministic, local pattern scorer — and folds its result into a single RiskFlag so it
 * can ride along with assessRisk()'s output without adding a separate embed section.
 *
 * Deliberately advisory-only: style flags are always severity 'info' and never influence
 * resolveEffectiveSensitivity — sounding AI-generated is not a policy/compliance risk.
 */

import AIDetector from './vendor/ai-writing-detector';
import { RiskFlag } from './llm-pipeline';

// Below "Moderate AI signals" (getLabel band in the vendored detector) is treated as noise —
// most short, on-brand party commentary will land here and should not generate a flag.
const SCORE_THRESHOLD = 35;

/** Score composed post text and return a single info-severity RiskFlag if it reads as AI-generated, else []. */
export function checkAiWritingStyle(text: string): RiskFlag[] {
  if (!text || text.trim().length === 0) return [];

  const result = AIDetector.analyzeText(text);
  if (result.tooShort || result.tooLong) return [];
  if (result.score <= SCORE_THRESHOLD) return [];

  const topPatterns = [...new Set(result.issues.map(i => i.type))].slice(0, 3).join(', ');

  return [{
    severity: 'info',
    reason: `AI-writing-style detector scored this post ${result.score}/100 (${result.label}) — patterns: ${topPatterns || 'stylometric'}. Advisory only.`,
  }];
}
