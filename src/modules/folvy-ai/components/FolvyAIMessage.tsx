// src/modules/folvy-ai/components/FolvyAIMessage.tsx
//
// Burbuja de un mensaje. Usuario (derecha, accent-bg) o IA (izquierda, terracota-bg).
//
// Para mensajes del assistant completos (no streamando ese mensaje):
//   - Renderiza markdown ligero con allowedElements restringido.
//   - Muestra una barra de acciones discreta: Copy / Regenerate / 👍 / 👎.
//
// Para el mensaje del assistant que SE ESTÁ streamando ahora mismo: sin barra.
//
// Las acciones (regenerate / feedback) son opcionales; si no se pasan, no se muestran.
// El feedback (thumbs) es estado local — no persiste (v1). Lo veremos en v1.1.

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Copy, RefreshCw, ThumbsUp, ThumbsDown, Check } from 'lucide-react';
import type { ChatMessage } from '../types/folvyAI';
import { FolvyAIIsotype } from './FolvyAIIsotype';

interface Props {
  message: ChatMessage;
  isStreamingThisMessage?: boolean;
  onRegenerate?: () => void;
}

const ALLOWED_ELEMENTS = ['p', 'strong', 'em', 'ol', 'ul', 'li', 'br'];

function describeTools(tools: Array<{ name: string }>): string {
  const map: Record<string, string> = {
    catalog_health: 'salud de la carta',
  };
  if (tools.length === 0) return '';
  const labels = tools.map(t => map[t.name] ?? t.name);
  return `Folvy AI consultó: ${labels.join(', ')}`;
}

const MD_WRAPPER_CLASSES = [
  '[&>*]:my-0',
  '[&>p+p]:mt-2',
  '[&_strong]:font-semibold',
  '[&_strong]:text-text-primary',
  '[&_em]:italic',
  '[&_ol]:list-decimal',
  '[&_ol]:pl-5',
  '[&_ol]:mt-2',
  '[&_ol]:space-y-0.5',
  '[&_ul]:list-disc',
  '[&_ul]:pl-5',
  '[&_ul]:mt-2',
  '[&_ul]:space-y-0.5',
].join(' ');

export function FolvyAIMessage({ message, isStreamingThisMessage, onRegenerate }: Props) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);

  const isUser = message.role === 'user';
  const isError = message.status === 'error';

  if (isUser) {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[85%] rounded-lg bg-accent-bg px-3 py-2 text-sm text-text-primary whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // si falla el clipboard (permisos), no rompemos
    }
  };

  const handleFeedback = (value: 'up' | 'down') => {
    setFeedback(prev => (prev === value ? null : value));
  };

  const showActions = !isError
    && !isStreamingThisMessage
    && message.content.length > 0;

  return (
    <div className="flex items-start gap-2 mb-3">
      <div className="shrink-0 mt-0.5">
        <FolvyAIIsotype size={24} />
      </div>
      <div className="max-w-[85%] flex flex-col gap-1 min-w-0">
        <div
          className={
            'rounded-lg px-3 py-2 text-sm ' +
            (isError
              ? 'bg-danger-bg text-text-primary border border-danger'
              : 'bg-terracota-bg text-text-primary')
          }
        >
          {message.content ? (
            <div className={MD_WRAPPER_CLASSES}>
              <ReactMarkdown allowedElements={ALLOWED_ELEMENTS} unwrapDisallowed>
                {message.content}
              </ReactMarkdown>
            </div>
          ) : (
            <span className="text-text-secondary italic text-xs">Pensando...</span>
          )}
        </div>

        {message.toolsUsed && message.toolsUsed.length > 0 && (
          <div className="text-xs text-text-secondary px-1">
            {describeTools(message.toolsUsed)}
          </div>
        )}

        {showActions && (
          <div className="flex items-center gap-1 px-1 mt-0.5">
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copiar mensaje"
              title="Copiar"
              className="rounded p-1 text-text-secondary hover:text-text-primary hover:bg-card transition-colors duration-fast"
            >
              {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
            </button>

            {onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                aria-label="Regenerar respuesta"
                title="Regenerar"
                className="rounded p-1 text-text-secondary hover:text-text-primary hover:bg-card transition-colors duration-fast"
              >
                <RefreshCw size={14} />
              </button>
            )}

            <button
              type="button"
              onClick={() => handleFeedback('up')}
              aria-label="Respuesta útil"
              title="Útil"
              className={
                'rounded p-1 transition-colors duration-fast ' +
                (feedback === 'up'
                  ? 'text-success bg-success-bg'
                  : 'text-text-secondary hover:text-text-primary hover:bg-card')
              }
            >
              <ThumbsUp size={14} />
            </button>

            <button
              type="button"
              onClick={() => handleFeedback('down')}
              aria-label="Respuesta no útil"
              title="No útil"
              className={
                'rounded p-1 transition-colors duration-fast ' +
                (feedback === 'down'
                  ? 'text-danger bg-danger-bg'
                  : 'text-text-secondary hover:text-text-primary hover:bg-card')
              }
            >
              <ThumbsDown size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
