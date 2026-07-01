/**
 * LLM Content Pipeline — Stub
 *
 * Future integration point for AI-assisted social media content generation and risk assessment.
 * Pipeline stages:
 *   0. Risk assessment — evaluate submitted content against policy/brand, annotate or escalate sensitivity
 *   1. Topic research  — surface relevant news/issues for the party to comment on
 *   2. RAG grounding   — retrieve relevant policy excerpts and brand guidelines
 *   3. Commentary draft — generate candidate commentary grounded in policy/brand voice
 *
 * Configuration (environment variables, not yet wired up):
 *   LLM_API_KEY       — Anthropic API key for content generation
 *   LLM_MODEL         — Model to use (default: claude-sonnet-5)
 *   POLICY_INDEX_URL  — URL of the policy/brand vector store for RAG retrieval
 *
 * None of these stages are called from interaction.ts yet. Wire them in once
 * the API key and policy index are available. The `DraftResult` type aligns with
 * `SocialAuthSubmissionRequest` so the output can be passed directly to
 * `db.createSubmission(...)`.
 *
 * Usage (future):
 *   // On every submission — annotate risk before posting to #auth-socmed:
 *   const risk = await assessRisk({ content, submitterSensitivity: 'low', destinations });
 *   // risk.finalSensitivity may be higher than what the submitter chose
 *
 *   // Optional full draft pipeline:
 *   const draft = await generateDraft({ topic: 'climate policy', destinations: ['Twitter/X'] });
 *   // Present to submitter for review/edit before posting to #auth-socmed
 */

import { Destination, PostContent, Sensitivity } from './types';
import { composePostText } from './content';
import { checkAiWritingStyle } from './ai-writing-style';

export interface LlmPipelineConfig {
  apiKey: string;
  model: string;
  policyIndexUrl?: string;
}

// ---------------------------------------------------------------------------
// Stage 0: Risk assessment
// ---------------------------------------------------------------------------

export interface RiskAssessmentRequest {
  content: PostContent;
  destinations: Destination[];
  submitterSensitivity: Sensitivity;   // What the submitter declared
}

export type RiskVerdict = 'agree' | 'escalate' | 'downgrade';

export interface RiskFlag {
  severity: 'info' | 'warning' | 'critical';
  reason: string;                        // Human-readable explanation
  policyReference?: string;             // e.g. "EthicalGovernance policy"
  policyUrl?: string;
}

export interface RiskAssessmentResult {
  verdict: RiskVerdict;
  suggestedSensitivity: Sensitivity;    // May match or differ from submitterSensitivity
  confidence: number;                   // 0–1
  flags: RiskFlag[];
  summary: string;                      // One-line annotation shown on the Discord embed
  generatedBy: string;                  // Model ID or 'stub'
  promptTokens: number;
  outputTokens: number;
}

/**
 * Assess the risk of a submitted post against party policy and brand guidelines.
 *
 * Advisory only — humans retain final say. The result is shown as an annotation
 * on the #auth-socmed embed. If `suggestedSensitivity` is higher than
 * `submitterSensitivity`, `SENSITIVITY_CONFIG[suggestedSensitivity]` should be
 * used to determine requiredApprovals and publish behaviour.
 *
 * STUB: returns a neutral assessment. Replace with a real Claude API call that:
 *   - Receives the post content + policy excerpts from retrievePolicyGrounding()
 *   - Is prompted to evaluate against the three sensitivity tiers
 *   - Returns structured JSON matching RiskAssessmentResult
 *
 * TODO(llm-integration): wire up with LLM_API_KEY + policy RAG once available.
 */
export async function assessRisk(
  request: RiskAssessmentRequest,
  _config?: LlmPipelineConfig
): Promise<RiskAssessmentResult> {
  console.log(`[LLM Pipeline] assessRisk() called — stub, returning neutral assessment`);

  // The AI-writing-style check is free, deterministic, and local (no LLM_API_KEY needed),
  // so it runs unconditionally — including in stub mode — unlike the rest of this pipeline.
  const styleFlags = checkAiWritingStyle(composePostText(request.content));

  return {
    verdict: 'agree',
    suggestedSensitivity: request.submitterSensitivity,
    confidence: 0,
    flags: styleFlags,
    summary: `[AI assessment unavailable — LLM_API_KEY not configured]`,
    generatedBy: 'stub',
    promptTokens: 0,
    outputTokens: 0,
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TopicResearchRequest {
  keywords?: string[];          // Optional seed keywords; omit to surface trending topics
  maxResults?: number;          // Default 5
}

export interface TopicResult {
  headline: string;
  summary: string;
  sourceUrl?: string;
  relevanceScore: number;       // 0–1, higher = more relevant to party mission
}

export interface PolicyExcerpt {
  policyTitle: string;
  excerpt: string;
  sourceUrl?: string;
  relevanceScore: number;
}

export interface DraftRequest {
  topic: string;                // The issue or news event to comment on
  destinations: Destination[];
  hashtags?: string[];          // Suggested hashtags; the model may add more
  tone?: 'informative' | 'urgent' | 'celebratory' | 'critical'; // Default 'informative'
  maxLength?: number;           // Max character count for commentary; default 280
}

export interface DraftResult {
  content: PostContent;         // Ready to pass to SocialAuthSubmissionRequest.content
  policyGrounding: PolicyExcerpt[];
  generatedBy: string;          // Model ID used
  promptTokens: number;
  outputTokens: number;
}

// ---------------------------------------------------------------------------
// Stage 1: Topic research
// ---------------------------------------------------------------------------

/**
 * Surface topics the party could comment on.
 *
 * STUB: returns a static placeholder. Replace with a real news-search call
 * (e.g. Brave Search API, NewsAPI) filtered for Australian politics relevance.
 */
export async function researchTopics(
  _request: TopicResearchRequest,
  _config?: LlmPipelineConfig
): Promise<TopicResult[]> {
  // TODO: call a news/search API, score results against party mission keywords,
  // return ranked list.
  console.log('[LLM Pipeline] researchTopics() called — stub, returning empty list');
  return [];
}

// ---------------------------------------------------------------------------
// Stage 2: RAG policy retrieval
// ---------------------------------------------------------------------------

/**
 * Retrieve policy excerpts and brand-voice guidelines relevant to a topic.
 *
 * STUB: returns empty array. Replace with a vector-store similarity search
 * (e.g. Pinecone, pgvector, or a local FAISS index of fusionparty.org.au policy docs).
 */
export async function retrievePolicyGrounding(
  topic: string,
  _config?: LlmPipelineConfig
): Promise<PolicyExcerpt[]> {
  // TODO: embed `topic`, query the policy vector store, return top-k excerpts.
  console.log(`[LLM Pipeline] retrievePolicyGrounding("${topic}") called — stub, returning empty list`);
  return [];
}

// ---------------------------------------------------------------------------
// Stage 3: Commentary generation
// ---------------------------------------------------------------------------

/**
 * Generate a draft social media post grounded in retrieved policy excerpts.
 *
 * STUB: returns a placeholder draft. Replace with a real Claude API call.
 * The system prompt should include:
 *   - Fusion Party brand-voice guidelines (concise, inclusive, evidence-based)
 *   - Retrieved policy excerpts as RAG context
 *   - Platform-specific length constraints
 *   - Instruction to cite sources inline
 */
export async function generateDraft(
  request: DraftRequest,
  _config?: LlmPipelineConfig
): Promise<DraftResult> {
  // TODO: build system prompt from brand voice + policy excerpts,
  // call Anthropic SDK claude-sonnet-5 (or configured model),
  // parse structured output into PostContent.
  console.log(`[LLM Pipeline] generateDraft("${request.topic}") called — stub, returning placeholder`);

  const stubContent: PostContent = {
    commentary: `[DRAFT — replace with generated commentary about: ${request.topic}]`,
    articleLink: null,
    policyLinks: [],
    hashtags: request.hashtags ?? [],
  };

  return {
    content: stubContent,
    policyGrounding: [],
    generatedBy: 'stub',
    promptTokens: 0,
    outputTokens: 0,
  };
}

// ---------------------------------------------------------------------------
// Combined pipeline entry point
// ---------------------------------------------------------------------------

/**
 * Run the full research → retrieve → generate pipeline for a given topic.
 *
 * STUB: calls each stage in sequence; all stages currently return placeholders.
 * Once the stages are wired up, this function provides the complete automated
 * draft pathway: topic → policy-grounded commentary → ready for human review.
 */
export async function runContentPipeline(
  topic: string,
  destinations: Destination[],
  config?: LlmPipelineConfig
): Promise<DraftResult> {
  const [groundingExcerpts] = await Promise.all([
    retrievePolicyGrounding(topic, config),
  ]);

  const draft = await generateDraft({ topic, destinations }, config);

  return { ...draft, policyGrounding: groundingExcerpts };
}
