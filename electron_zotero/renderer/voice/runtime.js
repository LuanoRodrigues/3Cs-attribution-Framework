(function initZoteroVoiceRuntime() {
  function createNoopRuntime() {
    return {
      supported: false,
      startVoice() {},
      stopVoice() {},
      startDictation() {},
      stopDictation() {},
      stopAll() {},
      isVoiceListening() {
        return false;
      },
      isDictationListening() {
        return false;
      }
    };
  }

  function createRuntime(options = {}) {
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    if (!SpeechRecognitionCtor) return createNoopRuntime();

    const onVoiceFinal = typeof options.onVoiceFinal === "function" ? options.onVoiceFinal : () => {};
    const onDictationFinal = typeof options.onDictationFinal === "function" ? options.onDictationFinal : () => {};
    const onState = typeof options.onState === "function" ? options.onState : () => {};
    const onError = typeof options.onError === "function" ? options.onError : () => {};
    const lang = typeof options.lang === "string" && options.lang.trim() ? options.lang : "en-US";

    let voiceWanted = false;
    let dictationWanted = false;
    let voiceListening = false;
    let dictationListening = false;
    let voiceRecognition = null;
    let dictationRecognition = null;

    const emitState = () => {
      onState({ voiceListening, dictationListening, voiceWanted, dictationWanted });
    };

    const createRecognition = (kind) => {
      const recognition = new SpeechRecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = lang;

      recognition.onstart = () => {
        if (kind === "voice") voiceListening = true;
        else dictationListening = true;
        emitState();
      };

      recognition.onresult = (event) => {
        const idx = event.resultIndex;
        const result = event.results[idx];
        if (!result || !result[0]) return;
        const transcript = String(result[0].transcript || "").trim();
        if (!transcript || !result.isFinal) return;
        if (kind === "voice") onVoiceFinal(transcript);
        else onDictationFinal(transcript);
      };

      recognition.onerror = (event) => {
        const message = String(event?.error || "speech_error");
        onError({ kind, message });
      };

      recognition.onend = () => {
        if (kind === "voice") {
          voiceListening = false;
          emitState();
          if (voiceWanted) {
            window.setTimeout(() => {
              if (voiceWanted) {
                try {
                  recognition.start();
                } catch {
                  // no-op
                }
              }
            }, 250);
          }
          return;
        }
        dictationListening = false;
        emitState();
        if (dictationWanted) {
          window.setTimeout(() => {
            if (dictationWanted) {
              try {
                recognition.start();
              } catch {
                // no-op
              }
            }
          }, 250);
        }
      };

      return recognition;
    };

    const ensureVoice = () => {
      if (!voiceRecognition) voiceRecognition = createRecognition("voice");
      return voiceRecognition;
    };
    const ensureDictation = () => {
      if (!dictationRecognition) dictationRecognition = createRecognition("dictation");
      return dictationRecognition;
    };

    const safeStart = (instance) => {
      try {
        instance.start();
      } catch {
        // no-op
      }
    };

    const safeStop = (instance) => {
      if (!instance) return;
      try {
        instance.stop();
      } catch {
        // no-op
      }
    };

    return {
      supported: true,
      startVoice() {
        voiceWanted = true;
        safeStart(ensureVoice());
        emitState();
      },
      stopVoice() {
        voiceWanted = false;
        safeStop(voiceRecognition);
        emitState();
      },
      startDictation() {
        dictationWanted = true;
        safeStart(ensureDictation());
        emitState();
      },
      stopDictation() {
        dictationWanted = false;
        safeStop(dictationRecognition);
        emitState();
      },
      stopAll() {
        voiceWanted = false;
        dictationWanted = false;
        safeStop(voiceRecognition);
        safeStop(dictationRecognition);
        emitState();
      },
      isVoiceListening() {
        return voiceListening;
      },
      isDictationListening() {
        return dictationListening;
      }
    };
  }

  window.ZoteroVoiceRuntime = {
    create: createRuntime
  };
})();
