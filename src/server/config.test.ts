import { describe, expect, it } from "vitest";
import { loadConfig, normalizeBase } from "./config.js";

describe("loadConfig", () => {
  it("only PORT and BASE_PATH are configurable; sane defaults", () => {
    const cfg = loadConfig({});
    expect(cfg.port).toBe(3000);
    expect(cfg.basePath).toBe("/frp"); // the fixed nginx prefix
    expect(cfg.botDelay).toEqual({ min: 700, max: 1300 });
    expect(cfg.staticRoot).toBeTruthy(); // derived from the compiled location
  });

  it("reads PORT and BASE_PATH", () => {
    const cfg = loadConfig({ PORT: "8080", BASE_PATH: "frp/" });
    expect(cfg.port).toBe(8080);
    expect(cfg.basePath).toBe("/frp");
  });

  it("BASE_PATH=\"\" opts back to no prefix (root serving)", () => {
    expect(loadConfig({ BASE_PATH: "" }).basePath).toBe("");
  });

  it("normalizeBase accepts sloppy values", () => {
    expect(normalizeBase("frp")).toBe("/frp");
    expect(normalizeBase("/frp/")).toBe("/frp");
    expect(normalizeBase("/frp//")).toBe("/frp");
    expect(normalizeBase("/")).toBe("");
    expect(normalizeBase("")).toBe("");
  });

  it("ignores removed vars (HOST / STATIC_ROOT / CHEAT_*)", () => {
    const cfg = loadConfig({ HOST: "127.0.0.1", STATIC_ROOT: "/tmp/x", CHEAT_ENABLED: "false" });
    expect(cfg.port).toBe(3000);
    expect(cfg.basePath).toBe("/frp"); // unaffected default
  });
});
