import { useEffect, useState } from "react";
import { registerImportTool } from "./webmcp";

export function App() {
  const [status, setStatus] = useState("Checking WebMCP availability...");

  useEffect(() => {
    const controller = new AbortController();
    void registerImportTool({ onResult: () => undefined }, controller.signal).then((registration) => {
      setStatus(registration.message);
    });
    return () => controller.abort();
  }, []);

  return <main><h1>AniMCP</h1><p>{status}</p></main>;
}
