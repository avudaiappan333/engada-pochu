// Minimal typings for the browser Web Speech API (not in lib.dom).
declare global {
  interface Window {
    webkitSpeechRecognition?: unknown;
    SpeechRecognition?: unknown;
  }
}
export {};
