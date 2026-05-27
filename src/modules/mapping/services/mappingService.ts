// src/modules/mapping/services/mappingService.ts
//
// Service del módulo de mapeo. Patrón calcado de brandsService:
//   - requireSupabase() al inicio de cada operación.
//   - Mappers row<->dominio (snake_case <-> camelCase).
//   - Errores con throw new Error(...).
//   - El caller pasa la identidad legible (actorName); la identidad
//     técnica (uuid) la captura la RPC vía auth.uid().
//
// API pública:
//   - listProposals(accountId, filters?)
//   - getProposalWithCandidates(proposalId)
//   - decideMapping(input)            // llama a la RPC atómica confirm_mapping
//
// NO crea propuestas ni candidatos: eso es la Edge Function map-products.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase';
import type {
  MappingProposal,
  MappingProposalWithCandidates,
  MappingCandidate,
  MappingDecisionInput,
  MappingStatus,
  MappingMethod,
  RowMappingProposal,
  RowMappingCandidate,
} from '../types/mapping';

// ── Helpers ───────────────────────────────────────────────────────────

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está habilitado en este entorno');
  }
}

// ── Mappers ───────────────────────────────────────────────────────────

export function rowToProposal(row: RowMappingProposal): MappingProposal {
  return {
    id: row.id,
    accountId: row.account_id,
    sourceKind: row.source_kind,
    sourceText: row.source_text,
    sourceNormalized: row.source_normalized,
    sourceRef: row.source_ref,
    contextBrandId: row.context_brand_id,
    targetKind: row.target_kind,
    status: row.status as MappingStatus,
    chosenTargetId: row.chosen_target_id,
    confidence: row.confidence,
    method: row.method as MappingMethod,
    rationale: row.rationale,
    engineVersion: row.engine_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToCandidate(row: RowMappingCandidate): MappingCandidate {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    targetId: row.target_id,
    targetLabel: row.target_label,
    score: row.score,
    rank: row.rank,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

// ── Filtros de listado ────────────────────────────────────────────────

export interface ListProposalsFilters {
  status?: MappingStatus | MappingStatus[];
  brandId?: string;
  sourceKind?: string;
}

// ── API pública ───────────────────────────────────────────────────────

/**
 * Lista propuestas de mapeo de una cuenta, con filtros opcionales.
 * Orden: por fecha desc (las más recientes primero).
 */
export async function listProposals(
  accountId: string,
  filters: ListProposalsFilters = {},
): Promise<MappingProposal[]> {
  requireSupabase();
  let q = supabase!
    .from('mapping_proposal')
    .select('*')
    .eq('account_id', accountId);

  if (filters.status) {
    if (Array.isArray(filters.status)) q = q.in('status', filters.status);
    else q = q.eq('status', filters.status);
  }
  if (filters.brandId) q = q.eq('context_brand_id', filters.brandId);
  if (filters.sourceKind) q = q.eq('source_kind', filters.sourceKind);

  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw new Error(`Error listando propuestas: ${error.message}`);
  return (data ?? []).map(rowToProposal);
}

/**
 * Trae una propuesta concreta con sus candidatos top-K.
 * Es lo que consume la pantalla de revisión para pintar un caso.
 */
export async function getProposalWithCandidates(
  proposalId: string,
): Promise<MappingProposalWithCandidates> {
  requireSupabase();

  const { data: prop, error: propErr } = await supabase!
    .from('mapping_proposal')
    .select('*')
    .eq('id', proposalId)
    .single();
  if (propErr) throw new Error(`Error obteniendo propuesta: ${propErr.message}`);
  if (!prop) throw new Error(`Propuesta ${proposalId} no encontrada`);

  const { data: cands, error: candErr } = await supabase!
    .from('mapping_candidate')
    .select('*')
    .eq('proposal_id', proposalId)
    .order('rank', { ascending: true });
  if (candErr) throw new Error(`Error obteniendo candidatos: ${candErr.message}`);

  return {
    ...rowToProposal(prop),
    candidates: (cands ?? []).map(rowToCandidate),
  };
}

/**
 * Confirma / corrige / rechaza una propuesta.
 * Invoca la RPC atómica confirm_mapping: registra la decisión,
 * actualiza la proposal y propaga el menu_item_id a todas las
 * sale_line del mismo texto+marca. La identidad técnica la captura
 * la RPC vía auth.uid(); aquí pasamos el nombre legible para auditoría.
 *
 * Devuelve el número de líneas de venta propagadas.
 */
export async function decideMapping(
  input: MappingDecisionInput,
): Promise<number> {
  requireSupabase();

  // Validación de invariante: confirm/correct requieren destino
  if (
    (input.action === 'confirm' || input.action === 'correct') &&
    !input.chosenTargetId
  ) {
    throw new Error(`La acción '${input.action}' requiere chosenTargetId`);
  }

  const { data, error } = await supabase!.rpc('confirm_mapping', {
    p_proposal_id: input.proposalId,
    p_action: input.action,
    p_chosen_target: input.chosenTargetId ?? undefined,
    p_note: input.note ?? undefined,
    p_actor_name: input.actorName,
  });
  if (error) throw new Error(`Error confirmando mapeo: ${error.message}`);

  // La RPC devuelve TABLE(propagated_lines integer) → data es un array de filas.
  const first = Array.isArray(data) ? data[0] : data;
  return (first?.propagated_lines as number) ?? 0;
}
