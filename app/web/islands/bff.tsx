import { useEffect, useState } from "react";

import { rpc } from "../rpc.js";

type Health = {
  status: string;
  version: string;
  uptimeSeconds: number;
};

type Metrics = {
  renderer: { renders: number; recycles: number };
  cache: { hits: number; misses: number };
};

export default function Bff() {
  const [health, setHealth] = useState<Health | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [greeting, setGreeting] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [healthResponse, metricsResponse, greetResult] = await Promise.all([
          fetch("/api/health"),
          fetch("/api/metrics"),
          rpc.bff.greet({ name: "browser" }),
        ]);

        if (!healthResponse.ok || !metricsResponse.ok) {
          throw new Error(`HTTP ${healthResponse.status}/${metricsResponse.status}`);
        }

        const [nextHealth, nextMetrics] = await Promise.all([
          healthResponse.json(),
          metricsResponse.json(),
        ]);

        if (!active) {
          return;
        }

        setHealth(nextHealth as Health);
        setMetrics(nextMetrics as Metrics);

        if (greetResult.ok) {
          setGreeting(greetResult.data.message);
        }
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return <p>Native API unavailable ({error}).</p>;
  }

  if (!health || !metrics) {
    return <p>Checking the native API…</p>;
  }

  return (
    <p data-vrt-mask="">
      <code>/api/health</code> {health.status} · v{health.version} · up{" "}
      {health.uptimeSeconds}s · {metrics.renderer.renders} renders · cache{" "}
      {metrics.cache.hits} hits / {metrics.cache.misses} misses
      {greeting ? <> · {greeting}</> : null}
    </p>
  );
}
