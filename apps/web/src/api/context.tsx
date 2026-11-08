import { createContext, useContext, type ReactNode } from "react";
import { api, type Api } from "./client";

/** The API client, swappable in tests. */
const ApiContext = createContext<Api>(api);

export function ApiProvider({ client, children }: { client: Api; children: ReactNode }) {
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi(): Api {
  return useContext(ApiContext);
}
