export type EnrichmentRelationType = "mentions" | "references" | "documents" | "develops" | "inspired" | "uses" | "part-of" | "related";

/** Segment provenance of a job that is a deterministic part of a longer original source.
 * Segment jobs share the source identity through their id: the original source id is the id
 * without the trailing `::<index>` suffix, and concatenating segment `sourceText` values in
 * `index` order reproduces the original source text exactly (segments partition it). */
export interface EnrichmentJobSegment {
  /** 1-based ordinal of this segment within the original source. */
  index: number;
  /** Total number of segment jobs emitted for the original source. */
  total: number;
  /** Character offset of this segment inside the original source text. */
  offset: number;
}

export interface EnrichmentJob {
  id: string;
  textHash: string;
  promptVersion: string;
  language: "ru";
  sourceKind: "telegram-post" | "telegram-article" | "youtube-video" | "project";
  sourceTitle?: string;
  sourceUrl?: string;
  /** Present only when this job is one segment of a longer original source. */
  segment?: EnrichmentJobSegment;
  sourceText: string;
  existingTags: string[];
  candidateTargets: Array<{id:string;title:string;kind:string;summaryExcerpt:string}>;
  allowedTopicIds: string[];
  topicDefinitions: Array<{id:string;label:string;family:string;definition:string}>;
}

export interface EnrichmentResult {
  id: string;
  textHash: string;
  promptVersion: string;
  provider: string;
  model: string;
  createdAt: string;
  summary: string;
  topics: string[];
  topicEvidence?: Array<{topicId:string;quote:string}>;
  entities: string[];
  relations: Array<{
    targetId: string;
    type: EnrichmentRelationType;
    explanation: string;
    confidence: number;
    evidenceQuote?: string;
  }>;
  needsReview: boolean;
}

export interface EnrichmentBundle {
  version: 1;
  generatedAt: string;
  results: EnrichmentResult[];
  errors?: Array<{ id: string; stage: string; error: string }>;
}

export interface ReviewedEvidence {
  quote: string;
  explanation: string;
  confidence: number;
}

export interface AcceptedEntity extends ReviewedEvidence {
  entity: string;
}

export interface AcceptedTopicEvidence extends ReviewedEvidence {
  topicId: string;
}

export interface AcceptedStageProvenance {
  stage: "topic-proposal" | "relation-proposal";
  promptVersion: string;
  provider: string;
  model: string;
  resultHashes: string[];
}

export interface AcceptedEnrichmentResult {
  id: string;
  sourceHash: string;
  /** Hash of the verbatim body region (everything after frontmatter) of the content file at accept time. */
  fileBodyHash: string;
  resultHash: string;
  summary: string;
  topics: string[];
  topicEvidence: AcceptedTopicEvidence[];
  entities: AcceptedEntity[];
  relations: Array<{
    targetId: string;
    type: EnrichmentRelationType;
    evidenceQuote: string;
    explanation: string;
    confidence: number;
  }>;
  stages: AcceptedStageProvenance[];
}

export interface AcceptedEnrichmentBundle {
  version: 2;
  lifecycle: "accepted";
  generatedAt: string;
  manifest: { path: string; sha256: string };
  review: {
    path: string;
    sha256: string;
    correctionsPath: string;
    correctionsSha256: string;
    reviewer: string;
    verdict: "accept_with_changes";
  };
  results: AcceptedEnrichmentResult[];
}

export interface EnrichmentProvider {
  readonly name: string;
  readonly model: string;
  enrich(job: EnrichmentJob): Promise<EnrichmentResult>;
}

export interface ReviewDecision {
  key: string;
  status: "accepted" | "rejected";
  reviewedAt: string;
  note?: string;
}

export interface ReviewBundle {
  version: 1;
  decisions: ReviewDecision[];
}
