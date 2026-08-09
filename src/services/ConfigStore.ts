import * as fs from "fs";
import * as path from "path";
import { ProviderConfig } from "../types/provider";

/**
 * ConfigStore persists the provider configuration to a JSON file so it can be
 * read back reliably (and re-read before every AI call) regardless of VS Code
 * settings timing. The file is the source of truth; VS Code settings remain a
 * secondary store for documentation/compatibility.
 */
export class ConfigStore {
  private readonly filePath: string;

  constructor(storagePath: string) {
    this.filePath = path.join(storagePath, "provider-config.json");
    // Ensure the storage directory exists.
    fs.mkdirSync(storagePath, { recursive: true });
  }

  /**
   * Read the persisted provider config from the file, or null if none exists.
   */
  public read(): ProviderConfig | null {
    try {
      if (!fs.existsSync(this.filePath)) {
        return null;
      }
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as ProviderConfig;
      if (!parsed || !parsed.provider || !parsed.model) {
        return null;
      }
      return parsed;
    } catch {
      // Corrupt or unreadable file — treat as no config.
      return null;
    }
  }

  /**
   * Atomically write the provider config to the file.
   */
  public async write(config: ProviderConfig): Promise<void> {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });

    // Write to a temp file then rename for atomicity.
    const tmpPath = `${this.filePath}.tmp`;
    await fs.promises.writeFile(tmpPath, JSON.stringify(config, null, 2), "utf8");
    await fs.promises.rename(tmpPath, this.filePath);
  }
}