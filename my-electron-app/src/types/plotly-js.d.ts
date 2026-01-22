declare module "plotly.js-dist-min" {
  const Plotly: {
    newPlot: (gd: HTMLElement | string, data: unknown[], layout?: unknown, config?: unknown) => Promise<unknown>;
    purge: (gd: HTMLElement | string) => void;
  };
  export default Plotly;
}
