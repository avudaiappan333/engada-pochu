// Spoken feedback (native SpeechSynthesis — free, on-device, no API)
// and haptic feedback (navigator.vibrate — works in Android WebView).

export function speak(text: string): void {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-IN';
    u.rate = 1.05;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    // never let feedback break the flow
  }
}

export type Haptic = 'tick' | 'doubleTick' | 'strong' | 'buzz';

const PATTERNS: Record<Haptic, number[]> = {
  tick: [12],
  doubleTick: [10, 40, 10],
  strong: [24],
  buzz: [60, 40, 60],
};

export function haptic(kind: Haptic): void {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(PATTERNS[kind]);
    }
  } catch {
    // ignore
  }
}
