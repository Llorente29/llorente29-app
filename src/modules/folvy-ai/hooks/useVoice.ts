// src/modules/folvy-ai/hooks/useVoice.ts
//
// Voz para Folvy AI — ida y vuelta, sobre la Web Speech API del navegador.
//   - IDA  (STT): SpeechRecognition → el usuario habla, transcribimos a texto.
//   - VUELTA (TTS): SpeechSynthesis → el agente lee su respuesta en voz alta.
//
// Gratis, sin coste de API, en español. Funciona muy bien en Chrome/Edge
// (escritorio y Android). En Safari/iOS el reconocimiento puede no existir:
// `sttSupported` lo refleja para esconder el botón donde no aplica.
//
// Pensado para cocina: el cocinero tiene las manos ocupadas → habla y escucha.

import { useCallback, useEffect, useRef, useState } from 'react';

const LANG = 'es-ES';

// Tipos mínimos de la Web Speech API (no están en lib.dom estándar de TS).
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseVoiceReturn {
  // Reconocimiento (hablar)
  sttSupported: boolean;
  isListening: boolean;
  startListening: () => void;
  stopListening: () => void;
  // Síntesis (que lea)
  ttsSupported: boolean;
  ttsEnabled: boolean;
  toggleTts: () => void;
  speak: (text: string) => void;
  stopSpeaking: () => void;
  isSpeaking: boolean;
}

interface UseVoiceOptions {
  // Se llama con el texto transcrito cuando el usuario termina de hablar.
  onTranscript: (text: string) => void;
}

export function useVoice(opts: UseVoiceOptions): UseVoiceReturn {
  const recognitionCtor = getRecognitionCtor();
  const sttSupported = recognitionCtor !== null;
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onTranscriptRef = useRef(opts.onTranscript);
  onTranscriptRef.current = opts.onTranscript;

  // ── Reconocimiento (STT) ───────────────────────────────────────────────────
  const startListening = useCallback(() => {
    if (!recognitionCtor || isListening) return;
    // Detener cualquier lectura en curso para no captar la propia voz del agente.
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
    const rec = new recognitionCtor();
    rec.lang = LANG;
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      const transcript = e.results?.[0]?.[0]?.transcript ?? '';
      if (transcript.trim()) onTranscriptRef.current(transcript.trim());
    };
    rec.onerror = () => { setIsListening(false); };
    rec.onend = () => { setIsListening(false); };
    recognitionRef.current = rec;
    try {
      rec.start();
      setIsListening(true);
    } catch {
      setIsListening(false);
    }
  }, [recognitionCtor, isListening]);

  const stopListening = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch { /* noop */ }
    setIsListening(false);
  }, []);

  // ── Síntesis (TTS) ─────────────────────────────────────────────────────────
  const stopSpeaking = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, []);

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const clean = text.trim();
    if (!clean) return;
    // Cortar lo anterior y leer lo nuevo.
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(clean);
    utt.lang = LANG;
    utt.rate = 1.05;
    utt.onstart = () => setIsSpeaking(true);
    utt.onend = () => setIsSpeaking(false);
    utt.onerror = () => setIsSpeaking(false);
    // Preferir una voz en español si el sistema la tiene.
    const voices = window.speechSynthesis.getVoices();
    const esVoice = voices.find(v => v.lang?.toLowerCase().startsWith('es'));
    if (esVoice) utt.voice = esVoice;
    window.speechSynthesis.speak(utt);
  }, []);

  const toggleTts = useCallback(() => {
    setTtsEnabled(prev => {
      const next = !prev;
      if (!next) stopSpeaking(); // al apagar, callar de inmediato
      return next;
    });
  }, [stopSpeaking]);

  // Limpieza al desmontar.
  useEffect(() => {
    return () => {
      try { recognitionRef.current?.abort(); } catch { /* noop */ }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return {
    sttSupported, isListening, startListening, stopListening,
    ttsSupported, ttsEnabled, toggleTts, speak, stopSpeaking, isSpeaking,
  };
}
