import type { RetrieveRecord } from "../shared/types/retrieve";

type Observer = (record?: RetrieveRecord) => void;

let activeRecord: RetrieveRecord | undefined;
const observers = new Set<Observer>();

const notify = (): void => {
  observers.forEach((observer) => observer(activeRecord));
};

export const retrieveContext = {
  getActiveRecord: (): RetrieveRecord | undefined => activeRecord,
  setActiveRecord: (record?: RetrieveRecord): void => {
    activeRecord = record;
    notify();
  },
  subscribe: (observer: Observer): (() => void) => {
    observers.add(observer);
    return () => observers.delete(observer);
  }
};
