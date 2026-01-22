import { registerPlugin } from "../api/plugin_registry.ts";
import { runRegressionRoutine } from "../ui/regression.ts";

declare global {
  interface Window {
    codexLog?: {
      write: (line: string) => void;
    };
  }
}

registerPlugin({
  id: "debug",
  commands: {
    debugDumpJson(editorHandle) {
      window.codexLog?.write("[PLUGIN_DEBUG_CALLED]");
      console.log("LEditor JSON:", editorHandle.getJSON());

      window.codexLog?.write("[PHASE2_OK]");

      if (window.leditorHost?.writePhaseMarker) {
      window.leditorHost.writePhaseMarker("phase2_plugin_debug_ok.txt", "PHASE2_OK");
    }
    },
    RunRegression(editorHandle) {
      const doc = runRegressionRoutine(editorHandle);
      window.codexLog?.write("[REGRESSION_DOC_STATE]");
      console.log("Regression document length:", JSON.stringify(doc).length);
      window.codexLog?.write("[REGRESSION_OK]");
    }
  }
});
