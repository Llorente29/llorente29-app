// src/modules/folvy-ai/hooks/useFolvyAI.ts
//
// Hook de estado para el chat de Folvy AI con streaming SSE.
//
// API pública:
//   - messages: ChatMessage[]      historial completo
//   - isStreaming: boolean         hay una respuesta en curso
//   - currentTool: string|null     tool ejecutándose ahora mismo
//   - error: string|null           último error retryable (banner)
//   - send(text): mensaje del usuario, arranca stream
//   - greet(): saludo proactivo (surface 'opening'), idempotente
//   - retry(): reintenta el último envío (en caso de error retryable)
//   - regenerate(): rehace la última respuesta de Folvy AI sin duplicar mensaje del usuario
//   - abort(): cancela el stream en curso
//   - clear(): borra la conversación

import { useCallback, useRef, useState } from 'react';
import { streamMessage, type FolvyAIStreamEvent } from '../services/folvyAIService';
import type { ChatMessage, FolvyAISurface } from '../types/folvyAI';

export interface UseFolvyAIOptions {
  accountId: string | null;
  module?: string;
}

export interface UseFolvyAIReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  currentTool: string | null;
  error: string | null;
  send: (text: string) => Promise<void>;
  greet: () => Promise<void>;
  retry: () => Promise<void>;
  regenerate: () => Promise<void>;
  abort: () => void;
  clear: () => void;
}

interface ExecuteOptions {
  surface?: FolvyAISurface;
  trackAsUserMessage?: boolean;
  userMessageVisible?: boolean;
  historyOverride?: ChatMessage[];
}

function newId(): string {
  return crypto.randomUUID();
}

export function useFolvyAI(opts: UseFolvyAIOptions): UseFolvyAIReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const lastUserMessageRef = useRef<string | null>(null);

  const executeStream = useCallback(async (
    text: string,
    options: ExecuteOptions = {},
  ) => {
    if (!opts.accountId) {
      setError('No hay una cuenta activa.');
      return;
    }

    const surface = options.surface ?? 'chat';
    const trackAsUserMessage = options.trackAsUserMessage !== false;
    const userMessageVisible = options.userMessageVisible !== false;

    setError(null);
    setCurrentTool(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const historyForApi = options.historyOverride ?? messages;

    const userMsg: ChatMessage = {
      id: newId(),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
      status: 'ok',
    };
    const assistantMsgId = newId();
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
      status: 'ok',
    };

    setMessages(prev => userMessageVisible
      ? [...prev, userMsg, assistantMsg]
      : [...prev, assistantMsg],
    );
    setIsStreaming(true);
    if (trackAsUserMessage) {
      lastUserMessageRef.current = text;
    }

    const toolsThisTurn: Array<{ name: string }> = [];

    const onEvent = (evt: FolvyAIStreamEvent) => {
      if (evt.type === 'text') {
        setMessages(prev => prev.map(m =>
          m.id === assistantMsgId ? { ...m, content: m.content + evt.content } : m,
        ));
      } else if (evt.type === 'tool_start') {
        setCurrentTool(evt.name);
        toolsThisTurn.push({ name: evt.name });
      } else if (evt.type === 'tool_end') {
        setCurrentTool(null);
      } else if (evt.type === 'done') {
        setMessages(prev => prev.map(m =>
          m.id === assistantMsgId ? { ...m, toolsUsed: toolsThisTurn } : m,
        ));
        setSessionId(evt.sessionId);
      } else if (evt.type === 'partial_end') {
        setMessages(prev => prev.map(m => {
          if (m.id !== assistantMsgId) return m;
          const reasonLabel =
            evt.reason === 'timeout' ? 'tardé demasiado' :
            evt.reason === 'aborted' ? 'cancelado' :
            'conexión perdida';
          return {
            ...m,
            toolsUsed: toolsThisTurn,
            content: m.content || `(${reasonLabel})`,
            errorMessage: `Stream interrumpido: ${evt.reason}`,
          };
        }));
        if (evt.reason === 'network') {
          setError('La conexión se perdió. Pulsa "Reintentar" cuando quieras.');
        }
      } else if (evt.type === 'error') {
        setMessages(prev => prev.map(m =>
          m.id === assistantMsgId
            ? { ...m, content: 'No he podido responder.', status: 'error', errorMessage: evt.message }
            : m,
        ));
        if (evt.retryable) {
          setError(`Algo falló en la conexión. Pulsa "Reintentar" cuando quieras.`);
        } else {
          setError(`Algo no fue bien: ${evt.message}`);
        }
      }
    };

    try {
      await streamMessage(
        {
          accountId: opts.accountId,
          message: text,
          history: historyForApi,
          surface,
          module: opts.module,
          sessionId: sessionId ?? undefined,
          signal: controller.signal,
        },
        onEvent,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido';
      setMessages(prev => prev.map(m =>
        m.id === assistantMsgId
          ? { ...m, content: 'No he podido responder.', status: 'error', errorMessage: msg }
          : m,
      ));
      setError(msg);
    } finally {
      setIsStreaming(false);
      setCurrentTool(null);
      abortRef.current = null;
    }
  }, [opts.accountId, opts.module, messages, sessionId]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    await executeStream(trimmed);
  }, [executeStream, isStreaming]);

  const greet = useCallback(async () => {
    if (isStreaming || messages.length > 0) return;
    await executeStream('', {
      surface: 'opening',
      trackAsUserMessage: false,
      userMessageVisible: false,
    });
  }, [executeStream, isStreaming, messages.length]);

  const retry = useCallback(async () => {
    const last = lastUserMessageRef.current;
    if (!last || isStreaming) return;
    setMessages(prev => {
      const idx = prev.length - 2;
      if (idx < 0) return prev;
      return prev.slice(0, idx);
    });
    await executeStream(last);
  }, [executeStream, isStreaming]);

  const regenerate = useCallback(async () => {
    const last = lastUserMessageRef.current;
    if (!last || isStreaming) return;

    // Encontramos el índice del último user message en el historial actual.
    // El historial que mandamos al backend es lo que había ANTES de ese user message
    // (porque el message nuevo de la llamada va a ser ese mismo user message).
    const lastUserIdx = messages.findLastIndex(m => m.role === 'user');
    if (lastUserIdx < 0) return;

    const historyBeforeLastUser = messages.slice(0, lastUserIdx);

    // Quitamos el último assistant del estado visible (manteniendo el user).
    setMessages(prev => {
      const lastIdx = prev.length - 1;
      if (lastIdx < 0 || prev[lastIdx]?.role !== 'assistant') return prev;
      return prev.slice(0, lastIdx);
    });

    await executeStream(last, {
      trackAsUserMessage: false,
      userMessageVisible: false,
      historyOverride: historyBeforeLastUser,
    });
  }, [executeStream, isStreaming, messages]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setSessionId(null);
    setError(null);
    setCurrentTool(null);
    lastUserMessageRef.current = null;
  }, []);

  return { messages, isStreaming, currentTool, error, send, greet, retry, regenerate, abort, clear };
}
