import { createDemoApi } from "./storage";
export const api = createDemoApi(() => localStorage);
