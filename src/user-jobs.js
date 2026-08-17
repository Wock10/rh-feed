import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { UserBook } from "../docs/users.js";

export class UserJobs {
  constructor({ dataDir }) {
    this.path = path.join(dataDir, "users.json");
    this.book = new UserBook();
    this.dirty = false;
  }

  async load() {
    try {
      this.book = UserBook.fromJSON(JSON.parse(await readFile(this.path, "utf8")));
      console.log(`User book  ${this.book.users.size} wallets`);
    } catch {
      this.book = new UserBook();
    }
  }

  ingest(event) {
    this.book.ingest(event);
    this.dirty = true;
  }

  setAccount(address, profile) {
    this.book.setAccount(address, profile);
    this.dirty = true;
  }

  card(address) {
    return this.book.card(address);
  }

  start() {
    setInterval(() => {
      this.book.prune();
      if (this.dirty) this.save().catch((err) => console.warn("user save", err.message));
    }, 30_000);
  }

  async save() {
    this.dirty = false;
    await writeFile(this.path, JSON.stringify(this.book.toJSON()));
  }
}
