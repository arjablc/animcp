import { useEffect, useRef, useState } from "react";
import {
  createFixture,
  fixtures,
  invalidFixtures,
  payloadFixtures,
  type Fixture,
  type InvalidFixture
} from "./fixtures";
import {
  clearAssets,
  importAsset,
  listAssets,
  type ImportProgress,
  type ImportResult,
  type KnownFixtureSource,
  type StoredAsset
} from "./importer";
import { registerImportTool } from "./webmcp";

interface ToolState {
  available: boolean;
  registered: boolean;
  message: string;
}

interface Attempt {
  id: string;
  source: "Fixture" | "WebMCP";
  result: ImportResult;
}

function AssetPreview({ asset }: { asset: StoredAsset }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    const nextUrl = URL.createObjectURL(asset.blob);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [asset.blob]);

  return <img src={url} alt={asset.name} />;
}

function ResultBadge({ result }: { result: ImportResult }) {
  if (result.ok) {
    const integrityLabel = result.integrity === "fixture-verified"
      ? "fixture verified"
      : result.integrity === "self-checked"
        ? "self-checked"
        : "unverified";
    const label = `${result.alreadyImported ? "Idempotent" : "Imported"} / ${integrityLabel}`;
    return <span className="badge success">{label}</span>;
  }
  return <span className="badge failure">{result.error.category}</span>;
}

function fixtureSource(input: { expectedBytes?: number; sha256?: string }): KnownFixtureSource {
  if (input.expectedBytes === undefined || !input.sha256) {
    throw new Error("Fixture integrity metadata is missing.");
  }
  return { expectedBytes: input.expectedBytes, sha256: input.sha256 };
}

export default function App() {
  const [tool, setTool] = useState<ToolState>({
    available: false,
    registered: false,
    message: "Checking WebMCP..."
  });
  const [assets, setAssets] = useState<StoredAsset[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [progress, setProgress] = useState<ImportProgress | "Generating fixture" | "Idle">("Idle");
  const [busyFixture, setBusyFixture] = useState<string>();
  const [localError, setLocalError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const copiedFixtures = useRef(new Map<string, KnownFixtureSource>());

  const refreshAssets = async () => {
    try {
      setAssets(await listAssets());
    } catch {
      setLocalError("Could not load locally stored assets.");
    }
  };

  const recordAttempt = (source: Attempt["source"], result: ImportResult) => {
    setAttempts((current) => [{ id: crypto.randomUUID(), source, result }, ...current].slice(0, 12));
    if (result.ok) {
      void refreshAssets();
    }
  };

  useEffect(() => {
    void refreshAssets();
    let disposed = false;
    let dispose: () => void = () => {};
    const lifecycle = new AbortController();

    void registerImportTool({
      onProgress: (nextProgress) => {
        if (!disposed) {
          setProgress(nextProgress);
        }
      },
      onResult: (result) => {
        if (!disposed) {
          recordAttempt("WebMCP", result);
          setProgress("Idle");
        }
      },
      knownFixtureForInput: (input) => {
        if (
          typeof input !== "object" ||
          input === null ||
          !("transferId" in input) ||
          typeof input.transferId !== "string"
        ) {
          return undefined;
        }
        return copiedFixtures.current.get(input.transferId);
      }
    }, lifecycle.signal).then((registration) => {
      dispose = registration.dispose;
      if (disposed) {
        dispose();
      } else {
        setTool(registration);
      }
    });

    return () => {
      disposed = true;
      lifecycle.abort();
      dispose();
    };
  }, []);

  const runFixture = async (fixture: Fixture) => {
    setBusyFixture(fixture.id);
    setLocalError(undefined);
    setNotice(undefined);
    setProgress("Generating fixture");
    try {
      const input = await createFixture(fixture);
      const result = await importAsset(input, {
        onProgress: setProgress,
        knownFixtureSource: fixtureSource(input)
      });
      recordAttempt("Fixture", result);
    } catch {
      setLocalError("The browser could not generate this fixture.");
    } finally {
      setProgress("Idle");
      setBusyFixture(undefined);
    }
  };

  const copyFixtureInput = async (fixture: Fixture) => {
    setBusyFixture(fixture.id);
    setLocalError(undefined);
    setNotice(undefined);
    try {
      const input = await createFixture(fixture);
      await navigator.clipboard.writeText(JSON.stringify(input));
      copiedFixtures.current.set(input.transferId, fixtureSource(input));
      setNotice(`${fixture.label} tool input copied. Paste it into the target agent without editing it.`);
    } catch {
      setLocalError("Could not copy the fixture tool input. Clipboard access may be unavailable.");
    } finally {
      setBusyFixture(undefined);
    }
  };

  const runInvalidFixture = async (fixture: InvalidFixture) => {
    setBusyFixture(fixture.id);
    setLocalError(undefined);
    try {
      const result = await importAsset({
        transferId: `invalid-${fixture.id}-${crypto.randomUUID()}`,
        name: `${fixture.id}.png`,
        mimeType: "image/png",
        encoding: "base64",
        data: fixture.data
      }, { onProgress: setProgress });
      recordAttempt("Fixture", result);
    } finally {
      setProgress("Idle");
      setBusyFixture(undefined);
    }
  };

  const removeAssets = async () => {
    try {
      await clearAssets();
      setAssets([]);
      setAttempts([]);
      setLocalError(undefined);
    } catch {
      setLocalError("Could not clear local test assets.");
    }
  };

  return (
    <main>
      <section className="hero">
        <p className="eyebrow">Phase 0 / Browser-local experiment</p>
        <h1>Image Transport Lab</h1>
        <p className="lede">
          Prove whether a complete generated PNG can survive an agent WebMCP call before the animation
          editor depends on it.
        </p>
      </section>

      <section className="status-grid" aria-label="Experiment status">
        <article>
          <p>WebMCP surface</p>
          <strong className={tool.available ? "ready" : "blocked"}>{tool.available ? "Available" : "Unavailable"}</strong>
        </article>
        <article>
          <p>import_asset</p>
          <strong className={tool.registered ? "ready" : "blocked"}>{tool.registered ? "Registered" : "Not registered"}</strong>
        </article>
        <article>
          <p>Current import</p>
          <strong>{progress}</strong>
        </article>
      </section>

      <p className="status-note" role="status">{tool.message}</p>
      {notice && <p className="status-note" role="status">{notice}</p>}
      {localError && <p className="error-note" role="alert">{localError}</p>}

      <section className="panel" aria-labelledby="agent-test-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Real transport test</p>
            <h2 id="agent-test-title">Ask the agent to call the registered tool</h2>
          </div>
          <code>import_asset</code>
        </div>
        <p>
          In the target browser-agent environment, generate a 512 x 512 transparent PNG and tell the agent
          to invoke <code>import_asset</code> with the complete base64 bytes, a stable transfer ID,
          <code>image/png</code>, <code>base64</code>, <code>expectedBytes</code>, and <code>sha256</code>.
          Those values make generated-image imports self-checked; only a copied fixture with its original
          transfer ID is fixture-verified exact transport.
        </p>
      </section>

      <section className="panel" aria-labelledby="fixture-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Known-data fixtures</p>
            <h2 id="fixture-title">Local importer fixtures</h2>
          </div>
          <span>Copy exact input for an agent transport test</span>
        </div>
        <div className="fixture-grid">
          {[...fixtures, ...payloadFixtures].map((fixture) => (
            <article className="fixture" key={fixture.id}>
              <h3>{fixture.label}</h3>
              <p>{fixture.description}</p>
              <div className="fixture-actions">
                <button disabled={busyFixture !== undefined} onClick={() => void runFixture(fixture)}>
                  {busyFixture === fixture.id ? "Working..." : "Run locally"}
                </button>
                <button className="quiet" disabled={busyFixture !== undefined} onClick={() => void copyFixtureInput(fixture)}>
                  Copy tool input
                </button>
              </div>
            </article>
          ))}
          {invalidFixtures.map((fixture) => (
            <article className="fixture invalid" key={fixture.id}>
              <h3>{fixture.label}</h3>
              <p>{fixture.description}</p>
              <button disabled={busyFixture !== undefined} onClick={() => void runInvalidFixture(fixture)}>
                {busyFixture === fixture.id ? "Working..." : "Verify rejection"}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="split">
        <section className="panel" aria-labelledby="results-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Metadata only</p>
              <h2 id="results-title">Recent results</h2>
            </div>
            <span>{attempts.length} recorded</span>
          </div>
          {attempts.length === 0 ? (
            <p className="empty">No imports yet.</p>
          ) : (
            <div className="attempt-list">
              {attempts.map((attempt) => (
                <article className="attempt" key={attempt.id}>
                  <div>
                    <strong>{attempt.source}</strong>
                    <p>
                      {attempt.result.ok
                        ? `${attempt.result.asset.width} x ${attempt.result.asset.height}, ${formatBytes(attempt.result.asset.decodedBytes)} decoded / ${formatBytes(attempt.result.asset.encodedBytes)} encoded`
                        : attempt.result.error.message}
                    </p>
                  </div>
                  <div className="attempt-result">
                    <ResultBadge result={attempt.result} />
                    <small>{attempt.result.durationMs} ms</small>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="panel" aria-labelledby="assets-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">IndexedDB</p>
              <h2 id="assets-title">Imported assets</h2>
            </div>
            <button className="quiet" disabled={assets.length === 0} onClick={() => void removeAssets()}>
              Clear test data
            </button>
          </div>
          {assets.length === 0 ? (
            <p className="empty">Valid imports appear here.</p>
          ) : (
            <div className="asset-grid">
              {assets.map((asset) => (
                <article className="asset" key={asset.id}>
                  <AssetPreview asset={asset} />
                  <p>{asset.name}</p>
                  <small>{asset.width} x {asset.height} / {formatBytes(asset.decodedBytes)}</small>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
