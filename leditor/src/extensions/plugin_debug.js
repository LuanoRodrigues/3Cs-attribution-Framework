"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const plugin_registry_js_1 = require("../api/plugin_registry.js");
const regression_js_1 = require("../ui/regression.js");
(0, plugin_registry_js_1.registerPlugin)({
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
            const doc = (0, regression_js_1.runRegressionRoutine)(editorHandle);
            window.codexLog?.write("[REGRESSION_DOC_STATE]");
            console.log("Regression document length:", JSON.stringify(doc).length);
            window.codexLog?.write("[REGRESSION_OK]");
        }
    }
});
