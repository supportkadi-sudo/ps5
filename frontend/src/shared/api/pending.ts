import type { Command, CommandName, Schema } from "./types";
import { commandNames } from "./types";
import { assertSchema } from "./validation";
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PendingCommand = { actorId: string; command: Command };
// Only command DTO + UUID; never credentials, cookies, CSRF tokens or responses.
export class PendingCommands {
  private key: string;
  constructor(
    private storage: () => StoragePort,
    private actorId: string,
  ) {
    this.key = "club-command-v1:" + actorId;
  }
  read(): PendingCommand | null {
    const raw = this.storage().getItem(this.key);
    if (raw === null) return null;
    try {
      const p = JSON.parse(raw) as PendingCommand;
      if (
        p.actorId !== this.actorId ||
        !p.command ||
        !commandNames.includes(p.command.name) ||
        !/^[0-9a-f-]{36}$/i.test(p.command.key)
      )
        throw Error();
      assertSchema(p.command.name, p.command.data);
      if (
        Object.keys(p).some((k) => !["actorId", "command"].includes(k)) ||
        Object.keys(p.command).some(
          (k) => !["name", "key", "data", "entityId"].includes(k),
        )
      )
        throw Error();
      if (
        p.command.entityId !== undefined &&
        typeof p.command.entityId !== "string"
      )
        throw Error();
      return p;
    } catch {
      throw Error(
        "Неразрешённая запись команды повреждена. Не отправляйте новую операцию; требуется проверка результата.",
      );
    }
  }
  prepare<K extends CommandName>(
    name: K,
    data: Schema[K],
    entityId?: string,
  ): Command {
    if (this.read())
      throw Error(
        "Есть неразрешённая команда. Сначала повторите исходный запрос или проверьте конфликт; новая операция заблокирована.",
      );
    assertSchema(name, data);
    const command = structuredClone({
      name,
      data,
      entityId,
      key: crypto.randomUUID(),
    }) as Command;
    try {
      this.storage().setItem(
        this.key,
        JSON.stringify({ actorId: this.actorId, command }),
      );
    } catch {
      throw Error(
        "Не удалось сохранить команду. Запрос не отправлен; проверьте хранилище браузера.",
      );
    }
    return command;
  }
  complete(key: string) {
    const pending = this.read();
    if (pending?.command.key !== key)
      throw Error(
        "Сохранённая команда изменилась. Требуется проверка результата.",
      );
    this.storage().removeItem(this.key);
  }
}
