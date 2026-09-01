import type { PlanExport } from './planExport.js';
import type { EcoMode, ModuleSlot } from './types.js';

/**
 * A calling surface on `window` for agents driving the real page.
 *
 * The app builds to `adapter-static` with `ssr: false`, so there is no server
 * route to ask for a plan; without this, the DOM is the only interface and every
 * question costs a full render and a text scrape. `getPlan()` returns the same
 * document `./edm --json` writes, so an answer read here and an answer computed
 * offline are comparable.
 */
export interface AgentState {
  product: string;
  amount: number;
  ecoMode: EcoMode;
  moduleSlots: ModuleSlot[] | null;
  globalUpgrade: number | null;
  /** The `ov` string that reproduces the current per-node choices. */
  overrides: string;
  /** Which price set produced the EDM figures — see priceSet.ts. */
  priceSetId: string;
  planning: boolean;
  nodeCounts: { total: number; tables: number; raw: number; byproducts: number; unresolvedTags: number };
}

export interface AgentApiHandles {
  getState(): AgentState;
  getPlan(): PlanExport | null;
  setProduct(name: string, amount?: number): Promise<void>;
  setOverrides(ov: string): Promise<void>;
  replan(): Promise<void>;
  listProducts(): string[];
}

export interface AgentApi extends AgentApiHandles {
  readonly version: number;
  /** Resolves after the first plan finishes — the completion signal to await
   *  instead of polling the DOM for node count to stop changing. */
  readonly ready: Promise<void>;
}

export interface AgentApiInstall {
  /** Call when the first plan has rendered. Further calls are ignored. */
  markReady(): void;
  uninstall(): void;
}

const API_VERSION = 1;

export function installAgentApi(handles: AgentApiHandles): AgentApiInstall {
  let resolveReady: () => void = () => {};
  let readyDone = false;
  const ready = new Promise<void>(resolve => { resolveReady = resolve; });

  const api: AgentApi = {
    version: API_VERSION,
    ready,
    getState: () => handles.getState(),
    getPlan: () => handles.getPlan(),
    setProduct: (name, amount) => handles.setProduct(name, amount),
    setOverrides: (ov) => handles.setOverrides(ov),
    replan: () => handles.replan(),
    listProducts: () => handles.listProducts(),
  };

  (globalThis as unknown as { ecoPlanner?: AgentApi }).ecoPlanner = api;

  return {
    markReady() {
      if (readyDone) return;
      readyDone = true;
      resolveReady();
    },
    uninstall() {
      delete (globalThis as unknown as { ecoPlanner?: AgentApi }).ecoPlanner;
    },
  };
}
