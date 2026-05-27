// src/modules/mapping/types/mapping.ts
//
// Tipos del módulo de mapeo (motor de mapeo IA).
// Convención del repo:
//   RowX / RowXInsert / RowXUpdate = tipo bruto generado (snake_case, BBDD).
//   X / XInsert = tipo de dominio (camelCase, front).
// Los mappers (rowToX, xInsertToRow) viven en mappingService.ts.

import type { Database } from '../../../types/database';

export type RowMappingProposal =
  Database['public']['Tables']['mapping_proposal']['Row'];
export type RowMappingProposalInsert =
  Database['public']['Tables']['mapping_proposal']['Insert'];
export type RowMappingProposalUpdate =
  Database['public']['Tables']['mapping_proposal']['Update'];

export type RowMappingCandidate =
  Database['public']['Tables']['mapping_candidate']['Row'];

export type RowMappingDecision =
  Database['public']['Tables']['mapping_decision']['Row'];
export type RowMappingDecisionInsert =
  Database['public']['Tables']['mapping_decision']['Insert'];

export type MappingStatus =
  | 'pending'
  | 'auto_confirmed'
  | 'needs_review'
  | 'human_confirmed'
  | 'rejected'
  | 'no_candidate';

export type MappingMethod = 'exact' | 'fuzzy' | 'ai' | 'human';

export type MappingDecisionAction = 'confirm' | 'correct' | 'reject';

export interface MappingCandidate {
  id: string;
  proposalId: string;
  targetId: string;
  targetLabel: string;
  score: number;
  rank: number;
  reason: string | null;
  createdAt: string;
}

export interface MappingProposal {
  id: string;
  accountId: string;
  sourceKind: string;
  sourceText: string;
  sourceNormalized: string;
  sourceRef: string | null;
  contextBrandId: string | null;
  targetKind: string;
  status: MappingStatus;
  chosenTargetId: string | null;
  confidence: number | null;
  method: MappingMethod;
  rationale: string | null;
  engineVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MappingProposalWithCandidates extends MappingProposal {
  candidates: MappingCandidate[];
}

export interface MappingDecision {
  id: string;
  proposalId: string;
  accountId: string;
  action: MappingDecisionAction;
  chosenTargetId: string | null;
  note: string | null;
  decidedBy: string | null;
  decidedByName: string | null;
  createdAt: string;
}

export interface MappingDecisionInput {
  proposalId: string;
  action: MappingDecisionAction;
  chosenTargetId?: string | null;
  note?: string | null;
  actorName: string;
}
