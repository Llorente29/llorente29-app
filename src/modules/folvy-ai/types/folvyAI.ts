// src/modules/folvy-ai/types/folvyAI.ts
//
// Tipos del módulo Folvy AI (chat flotante + AICards futuras).
// Genéricos: sirven al chat y a cualquier consumidor de la Edge Function folvy-ai.

/** Acción propuesta por el agente, pendiente de confirmación del usuario. */
export interface PendingAction {
  actionId: string;
  tool: string;
  risk: string;                     // 'L0' | 'L1' | 'L2'
  summary: string;
  effect?: unknown;
  // Estado local de la tarjeta tras interacción del usuario:
  state?: 'pending' | 'executing' | 'done' | 'cancelled' | 'failed';
  resultMessage?: string;
}

/** Mensaje individual de la conversación. Local al cliente y al historial enviado. */
export interface ChatMessage {
  id: string;                       // uuid generado en cliente para keys de React
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;                // ISO timestamp
  // Solo para mensajes 'assistant', si la IA invocó tools en ese turno:
  toolsUsed?: Array<{ name: string }>;
  // Solo para mensajes 'assistant', si la IA propuso una acción confirmable:
  pendingAction?: PendingAction;
  // Solo para mensajes 'assistant', estado del turno:
  status?: 'ok' | 'error';
  errorMessage?: string;
}

/** Surface desde donde se invoca la IA (espejo del enum del backend). */
export type FolvyAISurface = 'chat' | 'aicard' | 'background' | 'opening';

/** Body que el service envía a la Edge Function folvy-ai. */
export interface FolvyAIRequest {
  account_id: string;
  message: string;
  surface: FolvyAISurface;
  module?: string;
  context?: unknown;
  session_id?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/** Respuesta de la Edge Function folvy-ai. */
export interface FolvyAIResponse {
  response: string;
  session_id: string;
  tools_used: Array<{ name: string }>;
  usage: {
    tokens_in: number;
    tokens_out: number;
    duration_ms: number;
  };
}
