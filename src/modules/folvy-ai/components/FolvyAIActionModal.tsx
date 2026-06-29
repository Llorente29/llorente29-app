// src/modules/folvy-ai/components/FolvyAIActionModal.tsx
//
// Modal de confirmación de una acción del agente, A PANTALLA COMPLETA.
//
// Una acción que cambia datos de negocio (un coste, un precio) es una decisión
// relevante: merece tomar el control de la pantalla, no un cartelito lateral que
// pase desapercibido. Backdrop oscuro + tarjeta centrada + botones grandes.
//
// Autonomía graduada (B3): la fricción visual escala con el riesgo.
//   L1 → este modal (confirmación deliberada).
//   L2 → este modal + confirmación reforzada (se añadirá: teclear el alcance).
// Solo se muestra para estados 'pending' / 'executing'. El resultado terminal
// (done/cancelled/failed) lo pinta la tarjeta discreta en el hilo.

import { Check, Loader2 } from 'lucide-react';
import { FolvyAIIsotype } from './FolvyAIIsotype';
import type { PendingAction } from '../types/folvyAI';

interface FolvyAIActionModalProps {
  action: PendingAction;
  onConfirm: () => void;
  onCancel: () => void;
}

const RISK_LABEL: Record<string, string> = {
  L0: 'Cambio menor',
  L1: 'Confirmación necesaria',
  L2: 'Acción de alto impacto',
};

function effectRows(effect: unknown): Array<{ label: string; value: string }> {
  if (!effect || typeof effect !== 'object') return [];
  const e = effect as Record<string, unknown>;
  const rows: Array<{ label: string; value: string }> = [];
  // Reprice: margen antes/después + upside mensual.
  if (typeof e.margin_before === 'number' && typeof e.margin_after === 'number') {
    rows.push({ label: 'Margen', value: `${e.margin_before.toFixed(2)}€ → ${e.margin_after.toFixed(2)}€/ud` });
  }
  if (typeof e.upside_month === 'number') {
    rows.push({ label: 'Impacto mensual', value: `${e.upside_month >= 0 ? '+' : ''}${Math.round(e.upside_month)}€/mes` });
  }
  // Asignar coste.
  if (typeof e.unit_cost === 'number') {
    rows.push({ label: 'Coste unitario', value: `${e.unit_cost.toFixed(2)}€/ud` });
  }
  if (typeof e.product_name === 'string') {
    rows.push({ label: 'Producto', value: e.product_name });
  }
  return rows;
}

export function FolvyAIActionModal({ action, onConfirm, onCancel }: FolvyAIActionModalProps) {
  const state = action.state ?? 'pending';
  // El modal gobierna pending/executing (decisión) y done (éxito visible un
  // momento). Estados terminales no-éxito (cancelled/failed) → fuera del modal.
  if (state !== 'pending' && state !== 'executing' && state !== 'done') return null;

  // ── Estado de ÉXITO: palomita grande en el centro, se cierra solo ──────────
  if (state === 'done') {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'rgba(15, 15, 15, 0.55)', backdropFilter: 'blur(2px)' }}
        role="dialog"
        aria-modal="true"
      >
        <div className="bg-card border border-border-default rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
          <div className="flex flex-col items-center text-center px-6 py-8">
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-green-100 mb-4">
              <Check size={30} className="text-green-600" />
            </div>
            <p className="text-base font-display text-text-primary leading-snug">Hecho</p>
            <p className="text-sm text-text-secondary mt-1">{action.summary}</p>
          </div>
        </div>
      </div>
    );
  }

  const busy = state === 'executing';
  const rows = effectRows(action.effect);
  const riskLabel = RISK_LABEL[action.risk] ?? 'Confirmación necesaria';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15, 15, 15, 0.55)', backdropFilter: 'blur(2px)' }}
      role="dialog"
      aria-modal="true"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="bg-card border border-border-default rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-3">
          <div className="shrink-0">
            <FolvyAIIsotype size={32} accentBg />
          </div>
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-terracota font-medium">{riskLabel}</div>
            <div className="text-sm text-text-secondary">Folvy AI quiere aplicar un cambio</div>
          </div>
        </div>

        {/* Resumen de la acción */}
        <div className="px-5 pb-1">
          <p className="text-base font-display text-text-primary leading-snug">{action.summary}</p>
        </div>

        {/* Efecto (qué cambia exactamente) */}
        {rows.length > 0 && (
          <div className="mx-5 my-3 rounded-lg border border-border-default bg-page divide-y divide-border-default">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2">
                <span className="text-xs text-text-secondary">{r.label}</span>
                <span className="text-sm text-text-primary font-medium text-right ml-3">{r.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Nota de seguridad */}
        <div className="px-5 pb-3">
          <p className="text-xs text-text-secondary">
            Este cambio se aplicará a tus datos en cuanto confirmes. Es reversible.
          </p>
        </div>

        {/* Botones */}
        <div className="flex items-center gap-2 px-5 pb-5 pt-1">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-terracota hover:bg-terracota-hover text-white px-4 py-2.5 text-sm font-medium transition-colors duration-fast disabled:opacity-70"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {busy ? 'Aplicando...' : 'Confirmar'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg bg-card border border-border-default text-text-primary px-4 py-2.5 text-sm hover:bg-page transition-colors duration-fast disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
