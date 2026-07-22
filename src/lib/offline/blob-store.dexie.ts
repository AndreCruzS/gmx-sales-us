// Dexie import site #2 of 2 (D55). Raw audio/card blobs await upload here;
// signed URLs are minted at sync time and the blob is purged after confirmed
// upload (D59).

import Dexie, { type Table } from "dexie";
import type { BlobStore } from "./types";

class BlobDb extends Dexie {
  blobs!: Table<{ ref: string; blob: Blob }, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ blobs: "ref" });
  }
}

export class DexieBlobStore implements BlobStore {
  private db: BlobDb;

  constructor(dbName = "cos-blobs") {
    this.db = new BlobDb(dbName);
  }

  async put(ref: string, blob: Blob): Promise<void> {
    await this.db.blobs.put({ ref, blob });
  }

  async get(ref: string): Promise<Blob | null> {
    const row = await this.db.blobs.get(ref);
    return row?.blob ?? null;
  }

  async delete(ref: string): Promise<void> {
    await this.db.blobs.delete(ref);
  }

  async wipe(): Promise<void> {
    await this.db.delete();
    await this.db.open();
  }
}
