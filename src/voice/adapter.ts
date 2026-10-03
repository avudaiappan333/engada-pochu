// Corrected voice adapter for browser Web Speech API and Capacitor Android speech recognition.

import { Capacitor } from '@capacitor/core';

export interface VoiceHandlers {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  onEndEmpty: () => void;
}

export interface VoiceAdapter {
  readonly supported: boolean;
  readonly platform: 'web' | 'native';
  start(h: VoiceHandlers): Promise<void>;
  stop(): void;
}

class WebVoiceAdapter implements VoiceAdapter {
  readonly platform = 'web' as const;
  readonly supported =
    typeof window !== 'undefined' &&
    (Boolean((window as { SpeechRecognition?: unknown }).SpeechRecognition) ||
      Boolean((window as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition));
  private rec: SpeechRecognitionLike | null = null;

  async start(h: VoiceHandlers): Promise<void> {
    if (!this.supported) {
      h.onError('This browser does not support speech recognition. Use manual entry, or the Android app.');
      return;
    }
    try {
      const Ctor =
        (window as { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ||
        (window as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
      if (!Ctor) {
        h.onError('Speech recognition is not available in this browser.');
        return;
      }
      const r = new Ctor();
      let finalText = '';
      r.lang = 'en-IN';
      r.interimResults = true;
      r.continuous = false;
      r.maxAlternatives = 1;
      r.onresult = (e: SpeechRecognitionEventLike) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i];
          if (result.isFinal) finalText += result[0].transcript + ' ';
          else interim += result[0].transcript;
        }
        h.onPartial((finalText + interim).trim());
      };
      r.onerror = (e: { error?: string }) => {
        const code = e?.error ?? 'unknown';
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          h.onError('Microphone permission was denied. Allow microphone permission and try again.');
        } else if (code === 'no-speech') {
          h.onEndEmpty();
        } else if (code === 'network') {
          h.onError('Speech service unreachable. Internet is required for browser voice recognition.');
        } else {
          h.onError('Speech error: ' + code);
        }
      };
      r.onend = () => {
        this.rec = null;
        const text = finalText.trim();
        if (text) h.onFinal(text);
        else h.onEndEmpty();
      };
      this.rec = r;
      r.start();
    } catch {
      this.rec = null;
      h.onError('Could not start the microphone.');
    }
  }

  stop(): void {
    try {
      this.rec?.stop();
    } catch {
      // Ignore repeated stop calls.
    }
  }
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    [index: number]: { transcript: string };
    0: { transcript: string };
  }>;
}

class NativeVoiceAdapter implements VoiceAdapter {
  readonly platform = 'native' as const;
  readonly supported = Capacitor.isNativePlatform();
  private sr: any = null;
  private lastPartial = '';
  private finished = false;
  private handlePartial: { remove(): Promise<void> } | null = null;
  private handleState: { remove(): Promise<void> } | null = null;
  private handleError: { remove(): Promise<void> } | null = null;

  async start(h: VoiceHandlers): Promise<void> {
    if (!this.supported) {
      h.onError('Voice is only available inside the Android app or a supporting browser.');
      return;
    }
    try {
      const mod: any = await import('@capacitor-community/speech-recognition');
      const SR = mod.SpeechRecognition ?? mod.default?.SpeechRecognition;
      if (!SR) throw new Error('Speech recognition plugin is missing');

      this.sr = SR;
      this.lastPartial = '';
      this.finished = false;

      const cleanup = async () => {
        try { await this.handlePartial?.remove(); } catch { /* ignore */ }
        try { await this.handleState?.remove(); } catch { /* ignore */ }
        try { await this.handleError?.remove(); } catch { /* ignore */ }
        this.handlePartial = null;
        this.handleState = null;
        this.handleError = null;
      };

      const finish = async (text = '') => {
        if (this.finished) return;
        this.finished = true;
        await cleanup();
        const finalText = text.trim() || this.lastPartial.trim();
        if (finalText) h.onFinal(finalText);
        else h.onEndEmpty();
      };

      const permissions = await SR.requestPermissions();
      if (permissions?.speechRecognition === 'denied' || permissions?.audioRecording === 'denied') {
        h.onError('Microphone permission was denied. Enable Microphone permission in Android Settings.');
        return;
      }

      const availability = await SR.available?.();
      if (availability && availability.available === false) {
        h.onError('Speech recognition is unavailable. Enable Google voice services on this phone.');
        return;
      }

      this.handlePartial = await SR.addListener('partialResults', (event: { matches?: string[] }) => {
        const matches = event?.matches ?? [];
        const text = matches[matches.length - 1] ?? '';
        if (text.trim()) {
          this.lastPartial = text.trim();
          h.onPartial(this.lastPartial);
        }
      });

      this.handleState = await SR.addListener('listeningState', (event: { status?: string }) => {
        if (event?.status === 'stopped') void finish();
      });

      this.handleError = await SR.addListener('error', (event: { error?: string }) => {
        const message = event?.error?.trim();
        void finish();
        h.onError(message || 'Android speech recognition failed.');
      });

      // With partialResults enabled, start() may resolve when listening begins.
      // The stopped event above finishes the session after the user speaks.
      await SR.start({
        language: 'en-IN',
        maxResults: 1,
        partialResults: true,
        popup: false,
      });
    } catch (err) {
      this.finished = true;
      await Promise.allSettled([
        this.handlePartial?.remove(),
        this.handleState?.remove(),
        this.handleError?.remove(),
      ]);
      this.handlePartial = null;
      this.handleState = null;
      this.handleError = null;
      h.onError('Could not start speech: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  stop(): void {
    try {
      void this.sr?.stop?.();
    } catch {
      // Ignore repeated stop calls.
    }
  }
}

let instance: VoiceAdapter | null = null;

export function getVoiceAdapter(): VoiceAdapter {
  if (instance) return instance;
  instance = Capacitor.isNativePlatform() ? new NativeVoiceAdapter() : new WebVoiceAdapter();
  return instance;
}