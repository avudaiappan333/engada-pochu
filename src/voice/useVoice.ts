// Mic state machine hook:
//   idle → listening → processing → confirming → saved | error
// Live transcript is surfaced while listening; parsing happens on final
// transcript; output goes to the confirmation card (never saved directly).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getVoiceAdapter, type VoiceAdapter } from './adapter';
import { haptic } from './feedback';
import { parseVoiceText } from '../domain/parser';
import type { Category, ParsedCandidate, Person, ParseResult, QueryFilter } from '../domain/types';

export type MicState = 'idle' | 'listening' | 'processing' | 'confirming' | 'saved' | 'error';

export interface VoiceCallbacks {
  onCandidates: (candidates: ParsedCandidate[], raw: string) => void;
  onQuery: (filter: QueryFilter) => void;
  onSaved: (summary: string) => void;
  onDone: () => void; // back to idle after saved
}

export function useVoice(ctx: { people: Person[]; categories: Category[] }, cb: VoiceCallbacks) {
  const [state, setState] = useState<MicState>('idle');
  const [partial, setPartial] = useState('');
  const [error, setError] = useState<string | null>(null);
  const adapter: VoiceAdapter = useMemo(() => getVoiceAdapter(), []);
  const ctxRef = useRef(ctx);
  const cbRef = useRef(cb);
  const stateRef = useRef<MicState>('idle');
  ctxRef.current = ctx;
  cbRef.current = cb;

  const set = useCallback((s: MicState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  const start = useCallback(() => {
    setError(null);
    setPartial('');
    set('listening');
    haptic('doubleTick');
    void adapter.start({
      onPartial: (t) => setPartial(t),
      onFinal: (text) => {
        if (stateRef.current !== 'listening') return;
        haptic('tick');
        set('processing');
        const result: ParseResult = parseVoiceText(text, {
          people: ctxRef.current.people,
          categories: ctxRef.current.categories,
        });
        if (result.type === 'error') {
          setError(result.message);
          set('error');
        } else if (result.type === 'query') {
          cbRef.current.onQuery(result.filter);
          set('idle');
        } else {
          cbRef.current.onCandidates(result.candidates, text);
          set('confirming');
        }
      },
      onError: (msg) => {
        setError(msg);
        set('error');
      },
      onEndEmpty: () => {
        if (stateRef.current === 'listening') {
          setError('No speech detected. Tap the mic and try again.');
          set('error');
        }
      },
    });
  }, [adapter, set]);

  const stopListening = useCallback(() => {
    adapter.stop();
  }, [adapter]);

  const cancel = useCallback(() => {
    adapter.stop();
    setError(null);
    setPartial('');
    set('idle');
  }, [adapter, set]);

  const retry = useCallback(() => {
    start();
  }, [start]);

  const markSaved = useCallback(
    (summary: string) => {
      set('saved');
      cbRef.current.onSaved(summary);
      window.setTimeout(() => {
        cbRef.current.onDone();
        set('idle');
        setPartial('');
      }, 2000);
    },
    [set],
  );

  // Stop listening if the component unmounts mid-listen.
  useEffect(() => () => adapter.stop(), [adapter]);

  return { state, partial, error, start, stopListening, cancel, retry, markSaved, supported: adapter.supported };
}
