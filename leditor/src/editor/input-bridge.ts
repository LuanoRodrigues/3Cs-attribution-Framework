export type InputBridge = {
  capture: (event: Event) => void;
};

export const createInputBridge = (): InputBridge => ({
  capture: () => {
    // IME-safe input bridge stub
  }
});
