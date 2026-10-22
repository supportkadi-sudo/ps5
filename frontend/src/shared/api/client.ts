import { createDemoApi } from "./storage";
import { HttpApi } from "./http";
const mode = import.meta.env.VITE_API_MODE ?? "http";
if (!["http", "mock"].includes(mode)) throw Error("Unknown VITE_API_MODE");
export const isDemo = mode === "mock";
export const api = isDemo ? createDemoApi(() => localStorage) : new HttpApi();
