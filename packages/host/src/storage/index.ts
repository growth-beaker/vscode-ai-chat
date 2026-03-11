import type { ThreadStorage } from "@growthbeaker/ai-chat-core";
import type { PersistenceConfig } from "../types.js";
import { GlobalStateStorage } from "./GlobalStateStorage.js";
import { FileSystemStorage } from "./FileSystemStorage.js";

export { GlobalStateStorage } from "./GlobalStateStorage.js";
export type { Memento } from "./GlobalStateStorage.js";
export { FileSystemStorage } from "./FileSystemStorage.js";

/** Create a ThreadStorage instance from a PersistenceConfig */
export function createStorage(config: PersistenceConfig): ThreadStorage {
  switch (config.type) {
    case "globalState":
      return new GlobalStateStorage(config.globalState);
    case "filesystem":
      return new FileSystemStorage(config.storagePath);
    case "custom":
      return config.storage;
  }
}
