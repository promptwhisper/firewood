"use client";

import { useEffect, useRef, useState } from "react";

import type { GameplayState, SimHandle } from "@/lib/firewood/main";

const INITIAL_GAMEPLAY: GameplayState = {
  score: 0,
  streak: 0,
  totalSplits: 0,
  fireLevel: 0,
  woodName: "橡木",
  lastHit: null,
  season: "lateAutumn",
  winterAmount: 0,
};

const HIT_LABELS: Record<NonNullable<GameplayState["lastHit"]>, string> = {
  clean: "精准",
  good: "不错",
  off: "偏离",
};

const SEASON_LABELS: Record<GameplayState["season"], string> = {
  lateAutumn: "深秋",
  transition: "入冬",
  winter: "冬季",
};

export function FirewoodSimulator() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [ready, setReady] = useState(false);
  const [hintFading, setHintFading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gameplay, setGameplay] = useState(INITIAL_GAMEPLAY);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let handle: SimHandle | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const mod = await import("@/lib/firewood/main");
        if (cancelled) return;
        handle = await mod.startSimulator(canvas, {
          onProgress: (loaded, totalCount) => {
            setProgress(loaded);
            setTotal(totalCount);
          },
          onReady: () => setReady(true),
          onFirstInteraction: () => setHintFading(true),
          onGameplayUpdate: setGameplay,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      }
    })();

    return () => {
      cancelled = true;
      handle?.dispose();
      handle = null;
    };
  }, []);

  const ratio = total > 0 ? Math.min(1, progress / total) : 0;

  return (
    <>
      <canvas ref={canvasRef} />

      <div
        id="loading"
        className={ready ? "hidden" : ""}
        aria-hidden={ready ? "true" : "false"}
      >
        <div className="loading-inner">
          <div className="loading-text">资源加载中...</div>
          <div className="loading-count">
            {progress} / {total || "…"}
          </div>
          <div className="loading-bar-track">
            <div
              className="loading-bar-fill"
              style={{ width: `${(ratio * 100).toFixed(1)}%` }}
            />
          </div>
          {error ? (
            <div
              className="loading-count"
              style={{ color: "#e8a08a", maxWidth: 280, textAlign: "center" }}
            >
              {error}
            </div>
          ) : null}
        </div>
      </div>

      <div
        id="hint-overlay"
        className={`hint-overlay ${hintFading ? "fade-out" : ""}`}
      >
        <div className="hint-inner">
          <div className="hint-line">← 拖动旋转 →</div>
          <span className="hint-separator">✦</span>
          <div className="hint-line hint-action">点击劈柴</div>
        </div>
      </div>

      <div className="gameplay-hud" aria-live="polite">
        <div className={`gameplay-season ${gameplay.season}`}>
          {SEASON_LABELS[gameplay.season]}
        </div>
        <div className="gameplay-primary">
          <span className="gameplay-wood">{gameplay.woodName}</span>
          <span className="gameplay-score">
            {gameplay.score.toLocaleString()}
          </span>
        </div>
        {gameplay.season !== "lateAutumn" ? (
          <div className="fire-meter" aria-label="篝火强度">
            <span
              className="fire-meter-fill"
              style={{ width: `${Math.round(gameplay.fireLevel * 100)}%` }}
            />
          </div>
        ) : null}
        <div className="gameplay-secondary">
          <span>{gameplay.totalSplits} 次劈砍</span>
          <span className={gameplay.streak > 1 ? "streak active" : "streak"}>
            连击 x{gameplay.streak}
          </span>
          {gameplay.lastHit ? (
            <span className={`hit-quality ${gameplay.lastHit}`}>
              {HIT_LABELS[gameplay.lastHit]}
            </span>
          ) : null}
        </div>
      </div>
    </>
  );
}
