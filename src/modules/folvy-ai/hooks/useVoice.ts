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

// Pistas de calidad en los nombres de voces del sistema. Las voces "neuronales"
// modernas suelen incluir estas palabras; las robóticas antiguas (eSpeak, la
// voz GPS por defecto) no. Priorizamos las primeras.
const PREMIUM_HINTS = ['natural', 'neural', 'online', 'enhanced', 'premium', 'wavenet', 'studio'];
// Nombres conocidos de voces españolas buenas por plataforma (Edge/Windows, macOS).
const GOOD_VOICE_NAMES = ['helena', 'pablo', 'elvira', 'alvaro', 'dario', 'laura', 'mónica', 'monica', 'jorge'];

/** Elige la mejor voz en español de las disponibles en el sistema. */
function pickBestSpanishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const spanish = voices.filter(v => v.lang?.toLowerCase().startsWith('es'));
  if (spanish.length === 0) return null;

  const score = (v: SpeechSynthesisVoice): number => {
    const name = (v.name ?? '').toLowerCase();
    let s = 0;
    if (PREMIUM_HINTS.some(h => name.includes(h))) s += 100;       // neuronal/premium
    if (GOOD_VOICE_NAMES.some(n => name.includes(n))) s += 40;     // voz buena conocida
    if (v.lang?.toLowerCase() === 'es-es') s += 10;                // castellano exacto
    if (!v.localService) s += 5;                                   // voces "online" suelen ser mejores
    return s;
  };

  return spanish.slice().sort((a, b) => score(b) - score(a))[0];
}

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

  // La mejor voz española disponible (se resuelve cuando el sistema carga voces).
  const bestVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const load = () => {
      const v = pickBestSpanishVoice(window.speechSynthesis.getVoices());
      if (v) bestVoiceRef.current = v;
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

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
    utt.pitch = 1.0;
    utt.onstart = () => setIsSpeaking(true);
    utt.onend = () => setIsSpeaking(false);
    utt.onerror = () => setIsSpeaking(false);
    // Mejor voz española disponible (cacheada). Si aún no cargó, resolver ahora.
    const voice = bestVoiceRef.current ?? pickBestSpanishVoice(window.speechSynthesis.getVoices());
    if (voice) utt.voice = voice;
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
