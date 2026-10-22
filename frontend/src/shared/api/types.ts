import type { components } from "./schema";
export type Schema = components["schemas"];
export type Workspace = Schema["Workspace"];
export type User = Schema["User"];
export type Account = Schema["Account"];
export type CommandName =
  | "CreateAccount"
  | "StartTimer"
  | "Precheck"
  | "ResumeTimer"
  | "CloseAccount"
  | "AddLine"
  | "RemoveLine"
  | "AcceptPayment"
  | "OpenShift"
  | "CloseShift"
  | "AddExpense"
  | "SaveProduct"
  | "ReceiveBatch"
  | "AdjustStock"
  | "SaveTariff"
  | "SaveBooth"
  | "SaveMethod"
  | "SaveReview"
  | "SaveUser";
export type Command = {
  [K in CommandName]: {
    name: K;
    data: Schema[K];
    entityId?: string;
    key: string;
  };
}[CommandName];
export interface ClubApi {
  login(username: string, password: string): Promise<User>;
  logout(): Promise<void>;
  load(): Promise<Workspace>;
  getReport(from: string, to: string): Promise<Schema["Report"]>;
  execute(command: Command): Promise<Workspace>;
}
