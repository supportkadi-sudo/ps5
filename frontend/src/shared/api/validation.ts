import Ajv2020 from "ajv/dist/2020.js";
import contract from "../../../../contracts/openapi.json";
import type { Schema } from "./types";
const ajv = new Ajv2020({ strict: false, validateFormats: false });
ajv.addSchema({ $id: "club-contract", components: contract.components });
export function assertSchema<K extends keyof Schema>(
  name: K,
  value: unknown,
): asserts value is Schema[K] {
  const validator = ajv.getSchema(`club-contract#/components/schemas/${name}`);
  if (!validator || !validator(value))
    throw Error("Некорректные данные: " + name);
}
export function assertPeriod(from: string, to: string) {
  const valid = (v: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v + "T00:00:00Z")) &&
    new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;
  if (!valid(from) || !valid(to))
    throw Error("Укажите корректные даты периода");
  if (from > to) throw Error("Начало периода позже окончания");
}
