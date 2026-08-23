export type EnrichmentRelationType = "mentions" | "documents" | "develops" | "inspired" | "uses" | "part-of" | "related";

export interface EnrichmentJob {
  id: string;
  textHash: string;
  promptVersion: string;
  language: "ru";
  sourceKind: "telegram-post" | "telegram-article" | "youtube-video";
  sourceText: string;
  existingTags: string[];
  candidateTargets: Array<{id:string;title:string;kind:string}>;
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
  entities: string[];
  relations: Array<{
    targetId: string;
    type: EnrichmentRelationType;
    explanation: string;
    confidence: number;
  }>;
  needsReview: boolean;
}

export interface EnrichmentBundle {
  version: 1;
  generatedAt: string;
  results: EnrichmentResult[];
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
