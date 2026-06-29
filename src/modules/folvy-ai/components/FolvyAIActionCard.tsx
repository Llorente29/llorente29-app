// src/modules/folvy-ai/components/FolvyAIActionCard.tsx
//
// Tarjeta de confirmación de una acción propuesta por el agente.
// Contrato de ejecución (B3): el agente PROPONE, el humano CONFIRMA, y solo
// entonces se ejecuta (commit_ai_action). La tarjeta refleja el ciclo:
//   pending → [Confirmar/Cancelar] → executing → done | failed | cancelled
//
// Autonomía graduada: el nivel de riesgo (L0/L1/L2) modula la fricción visual.
// Aquí cubrimos L1 (confirmación simple). L2 (reforzada) se añadirá después.

import { Check, X, Loader2, AlertTriangle } from 'lucide-react';
import type { PendingAction } from '../types/folvyAI';

interface FolvyAIActionCardProps {
  action: PendingAction;
  onConfirm: () => void;
  onCancel: () => void;
}

function formatEffect(effect: unknown): string | null {
  if (!effect || typeof effect !== 'object') return null;
  const e = effect as Record<string, unknown>;
  // Reprice: margen antes/después + upside mensual.
  if (typeof e.upside_month === 'number') {
    const parts: string[] = [];
    if (typeof e.margin_before === 'number' && typeof e.margin_after === 'number') {
      parts.push(`margen ${e.margin_before.toFixed(2)}€ → ${e.margin_after.toFixed(2)}€/ud`);
    }
    parts.push(`${e.upside_month >= 0 ? '+' : ''}${Math.round(e.upside_month)}€/mes`);
    return parts.join(' · ');
  }
  // Asignar coste: coste unitario.
  if (typeof e.unit_cost === 'number') {
    return `coste ${e.unit_cost.toFixed(2)}€/ud`;
  }
  return null;
}

export function FolvyAIActionCard({ action, onConfirm, onCancel }: FolvyAIActionCardProps) {
  const state = action.state ?? 'pending';
  const effectLine = formatEffect(action.effect);

  // Estado terminal: resultado compacto.
  if (state === 'done') {
    return (
      <div className="mt-2 rounded-lg border border-border-default bg-page px-3 py-2 flex items-center gap-2 text-xs text-text-secondary">
        <Check size={14} className="text-green-600 shrink-0" />
        <span>{action.resultMessage ?? 'Hecho.'} <span className="text-text-secondary">·</span> {action.summary}</span>
      </div>
    );
  }
  if (state === 'cancelled') {
    return (
      <div className="mt-2 rounded-lg border border-border-default bg-page px-3 py-2 flex items-center gap-2 text-xs text-text-secondary">
        <X size={14} className="shrink-0" />
        <span>Cancelado.</span>
      </div>
    );
  }
  if (state === 'failed') {
    return (
      <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 flex items-start gap-2 text-xs text-red-700">
        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
        <span>No se pudo aplicar{action.resultMessage ? `: ${action.resultMessage}` : '.'}</span>
      </div>
    );
  }

  // Estado pending / executing: tarjeta de acción.
  const busy = state === 'executing';
  return (
    <div className="mt-2 rounded-lg border border-terracota bg-terracota-bg px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-text-primary leading-snug">{action.summary}</div>
          {effectLine && (
            <div className="text-xs text-text-secondary mt-0.5">{effectLine}</div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-2.5">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md bg-terracota hover:bg-terracota-hover text-white px-3 py-1.5 text-xs font-medium transition-colors duration-fast disabled:opacity-60"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          {busy ? 'Aplicando...' : 'Confirmar'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md bg-card border border-border-default text-text-primary px-3 py-1.5 text-xs hover:bg-page transition-colors duration-fast disabled:opacity-60"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
