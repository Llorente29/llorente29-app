// src/modules/folvy-ai/components/FolvyAIComposer.tsx
//
// Input + botón dinámico Send/Stop.
// - Enter envía, Shift+Enter salto de línea.
// - Auto-resize del textarea (hasta 140px máx).
// - Cuando isStreaming: el botón Send se transforma en Stop (cuadrado).
//   Pulsar Stop llama a onStop para abortar el stream en curso.

import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { Send, Square } from 'lucide-react';

interface Props {
  onSend: (text: string) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  placeholder?: string;
}

export function FolvyAIComposer({ onSend, onStop, isStreaming, placeholder }: Props) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }, [value]);

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
