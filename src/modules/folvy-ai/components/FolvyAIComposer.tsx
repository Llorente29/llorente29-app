// src/modules/folvy-ai/components/FolvyAIComposer.tsx
//
// Input + botón dinámico Send/Stop.
// - Enter envía, Shift+Enter salto de línea.
// - Auto-resize del textarea (hasta 140px máx).
// - Cuando isStreaming: el botón Send se transforma en Stop (cuadrado).
//   Pulsar Stop llama a onStop para abortar el stream en curso.

import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { Send, Square, Mic } from 'lucide-react';

interface Props {
  onSend: (text: string) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  placeholder?: string;
  // Voz (opcional): si se pasan, aparece el botón de micrófono.
  sttSupported?: boolean;
  isListening?: boolean;
  onStartListening?: () => void;
  onStopListening?: () => void;
  // Texto dictado a inyectar en el input (se concatena a lo escrito).
  dictatedText?: string | null;
  onDictatedConsumed?: () => void;
}

export function FolvyAIComposer({
  onSend, onStop, isStreaming, placeholder,
  sttSupported, isListening, onStartListening, onStopListening,
  dictatedText, onDictatedConsumed,
}: Props) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }, [value]);

  // Cuando llega texto dictado por voz, lo añadimos al input (concatenando).
  useEffect(() => {
    if (dictatedText && dictatedText.trim()) {
      setValue(prev => (prev ? prev + ' ' : '') + dictatedText.trim());
      onDictatedConsumed?.();
      textareaRef.current?.focus();
    }
  }, [dictatedText, onDictatedConsumed]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setValue('');
  };

  const handleStop = () => {
    if (!isStreaming || !onStop) return;
    onStop();
  };

  const handleButtonClick = () => {
    if (isStreaming) {
      handleStop();
    } else {
      handleSend();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const buttonDisabled = isStreaming
    ? !onStop
    : !value.trim();

  return (
    <div className="border-t border-border-default bg-card p-3 flex items-end gap-2">
      {sttSupported && onStartListening && (
        <button
          type="button"
          onClick={isListening ? onStopListening : onStartListening}
          disabled={isStreaming}
          aria-label={isListening ? 'Dejar de escuchar' : 'Hablar'}
          title={isListening ? 'Escuchando... (pulsa para parar)' : 'Hablar a Folvy AI'}
          className={
            'shrink-0 rounded-md min-h-touch px-3 py-2 transition-colors duration-fast disabled:opacity-40 disabled:cursor-not-allowed ' +
            (isListening
              ? 'bg-terracota text-text-on-accent animate-pulse'
              : 'bg-card border border-border-default text-text-secondary hover:text-text-primary hover:bg-page')
          }
        >
          <Mic size={16} />
        </button>
      )}
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isStreaming}
        placeholder={placeholder ?? 'Escribe a Folvy AI...'}
        className="flex-1 resize-none rounded-md border border-border-default bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors duration-fast disabled:opacity-50"
      />
      <button
        type="button"
        onClick={handleButtonClick}
        disabled={buttonDisabled}
        className={
          'shrink-0 rounded-md min-h-touch px-3 py-2 transition-colors duration-fast disabled:opacity-40 disabled:cursor-not-allowed ' +
          (isStreaming
            ? 'bg-text-primary hover:bg-text-secondary text-text-on-accent'
            : 'bg-terracota hover:bg-terracota-hover text-text-on-accent')
        }
        aria-label={isStreaming ? 'Parar generación' : 'Enviar mensaje'}
      >
        {isStreaming ? <Square size={14} fill="currentColor" /> : <Send size={16} />}
      </button>
    </div>
  );
}
