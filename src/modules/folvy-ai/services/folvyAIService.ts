// src/modules/folvy-ai/services/folvyAIService.ts
//
// Service de Folvy AI con streaming SSE robusto.
// Diseñado a nivel producción: timeout, retry con backoff exponencial,
// manejo elegante de stream interrumpido, parser SSE tolerante.
//
// No usamos supabase.functions.invoke (no soporta SSE). Hacemos fetch
// directo al endpoint con JWT del usuario actual.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase';
import type { ChatMessage, FolvyAISurface } from '../types/folvyAI';

// ── Constantes de robustez ──────────────────────────────────────────
const DEFAULT_TIMEOUT_MS = 60_000;             // 60s: tope duro por llamada
const MAX_RETRIES = 2;                         // 2 reintentos = 3 intentos totales
const RETRY_BASE_DELAY_MS = 500;               // backoff: 500ms, 1000ms
const RETRY_ON_STATUS = new Set([502, 503, 504]); // Bad Gateway, Service Unavailable, Gateway Timeout

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está habilitado en este entorno');
  }
}

function historyForBackend(messages: ChatMessage[]) {
  return messages
    .filter(m => m.status !== 'error')
    .map(m => ({ role: m.role, content: m.content }));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }
  });
}

// ── Eventos que el service emite al consumidor ─────────────────────
export type FolvyAIStreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string }
  | { type: 'action_proposed'; actionId: string; tool: string; risk: string; summary: string; effect: unknown }
  | { type: 'done'; sessionId: string; usage: { tokens_in: number; tokens_out: number; duration_ms: number } }
  | { type: 'partial_end'; reason: 'timeout' | 'network' | 'aborted'; receivedText: string }
  | { type: 'error'; message: string; retryable: boolean };

export interface StreamMessageInput {
  accountId: string;
  message: string;
  history: ChatMessage[];
  surface?: FolvyAISurface;
  module?: string;
  context?: unknown;
  sessionId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Streaming de un mensaje a Folvy AI con resiliencia.
 *
 * Comportamiento:
 * - Reintenta automáticamente errores transitorios (red caída, 502/503/504).
 * - Timeout duro: si no se completa en `timeoutMs`, emite 'partial_end' con
 *   el texto recibido hasta ese momento y cierra limpio.
 * - Si el consumidor cancela vía AbortSignal, emite 'partial_end' con reason='aborted'.
 * - Errores semánticos (4xx) NO se reintentan: emiten 'error' con retryable=false.
 *
 * NUNCA lanza para errores recuperables — siempre los entrega como evento.
 * Solo lanza si Supabase no está configurado o no hay sesión activa
 * (ambos son errores de programación, no de runtime).
 */
export async function streamMessage(
  input: StreamMessageInput,
  onEvent: (evt: FolvyAIStreamEvent) => void,
): Promise<void> {
  requireSupabase();

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const { data: sessionData, error: sessionErr } = await supabase!.auth.getSession();
  if (sessionErr) throw new Error(`Error obteniendo sesión: ${sessionErr.message}`);
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('No hay sesión activa');

  const endpoint = `${supabaseUrl}/functions/v1/folvy-ai`;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const bodyObj: Record<string, unknown> = {
    account_id: input.accountId,
    message: input.message,
    surface: input.surface ?? 'chat',
    history: historyForBackend(input.history),
    stream: true,
  };
  if (input.module !== undefined) bodyObj.module = input.module;
  if (input.context !== undefined) bodyObj.context = input.context;
  if (input.sessionId !== undefined) bodyObj.session_id = input.sessionId;

  let attempt = 0;
  let receivedText = '';

  while (attempt <= MAX_RETRIES) {
    attempt++;
    const attemptResult = await tryOnce(
      endpoint, accessToken, bodyObj, timeoutMs, input.signal, onEvent,
      (chunk) => { receivedText += chunk; },
    );

    if (attemptResult.kind === 'done') {
      return;
    }
    if (attemptResult.kind === 'partial_aborted') {
      onEvent({ type: 'partial_end', reason: 'aborted', receivedText });
      return;
    }
    if (attemptResult.kind === 'partial_timeout') {
      onEvent({ type: 'partial_end', reason: 'timeout', receivedText });
      return;
    }
    if (attemptResult.kind === 'fatal') {
      onEvent({ type: 'error', message: attemptResult.message, retryable: false });
      return;
    }
    // attemptResult.kind === 'retryable'
    if (attempt > MAX_RETRIES) {
      if (receivedText) {
        onEvent({ type: 'partial_end', reason: 'network', receivedText });
      } else {
        onEvent({ type: 'error', message: attemptResult.message, retryable: true });
      }
      return;
    }
    const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
    try {
      await sleep(delay, input.signal);
    } catch {
      onEvent({ type: 'partial_end', reason: 'aborted', receivedText });
      return;
    }
    receivedText = '';
  }
}

// ── Resultado de un solo intento de fetch+stream ───────────────────
type AttemptResult =
  | { kind: 'done' }
  | { kind: 'partial_aborted' }
  | { kind: 'partial_timeout' }
  | { kind: 'fatal'; message: string }
  | { kind: 'retryable'; message: string };

async function tryOnce(
  endpoint: string,
  accessToken: string,
  bodyObj: Record<string, unknown>,
  timeoutMs: number,
  externalSignal: AbortSignal | undefined,
  onEvent: (evt: FolvyAIStreamEvent) => void,
  onText: (chunk: string) => void,
): Promise<AttemptResult> {
  const internalController = new AbortController();
  const timeoutId = setTimeout(() => internalController.abort('timeout'), timeoutMs);
  const onExternalAbort = () => internalController.abort('aborted');
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyObj),
      signal: internalController.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      if (RETRY_ON_STATUS.has(resp.status)) {
        return { kind: 'retryable', message: `HTTP ${resp.status}: ${text || resp.statusText}` };
      }
      return { kind: 'fatal', message: `HTTP ${resp.status}: ${text || resp.statusText}` };
    }
    if (!resp.body) {
      return { kind: 'fatal', message: 'Respuesta sin cuerpo' };
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (!trimmed.startsWith('data:')) continue;
          const json = trimmed.slice(5).trim();
          if (!json) continue;
          let raw: any;
          try { raw = JSON.parse(json); } catch { continue; }

          if (raw.type === 'text' && typeof raw.content === 'string') {
            onText(raw.content);
            onEvent({ type: 'text', content: raw.content });
          } else if (raw.type === 'tool_start' && typeof raw.name === 'string') {
            onEvent({ type: 'tool_start', name: raw.name });
          } else if (raw.type === 'tool_end' && typeof raw.name === 'string') {
            onEvent({ type: 'tool_end', name: raw.name });
          } else if (raw.type === 'action_proposed' && typeof raw.action_id === 'string') {
            onEvent({
              type: 'action_proposed',
              actionId: raw.action_id,
              tool: typeof raw.tool === 'string' ? raw.tool : '',
              risk: typeof raw.risk === 'string' ? raw.risk : 'L1',
              summary: typeof raw.summary === 'string' ? raw.summary : '',
              effect: raw.effect ?? null,
            });
          } else if (raw.type === 'done') {
            onEvent({ type: 'done', sessionId: raw.session_id, usage: raw.usage });
          } else if (raw.type === 'error' && typeof raw.message === 'string') {
            onEvent({ type: 'error', message: raw.message, retryable: false });
          }
        }
      }
      return { kind: 'done' };
    } finally {
      try { reader.releaseLock(); } catch { /* noop */ }
    }
  } catch (e) {
    if (internalController.signal.aborted) {
      const reason = internalController.signal.reason;
      if (reason === 'timeout') return { kind: 'partial_timeout' };
      return { kind: 'partial_aborted' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { kind: 'retryable', message: msg };
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}
