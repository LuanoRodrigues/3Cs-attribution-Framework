export type FootnoteState = {
  counter: number;
  ids: string[];
};

const state: FootnoteState = {
  counter: 0,
  ids: []
};

export const resetFootnoteState = () => {
  state.counter = 0;
  state.ids.length = 0;
};

export const allocateFootnoteId = () => {
  state.counter += 1;
  const id = `footnote-${state.counter}`;
  state.ids.push(id);
  return id;
};

export const getFootnoteIds = () => state.ids.slice();
