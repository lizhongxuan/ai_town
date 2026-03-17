/**
 * T-104: 小人实时聊天水泡层
 *
 * Overlays speech bubbles on the scene, driven by WS town.actor.bubble events.
 * Supports 5 bubble types: plan, dispatch, command, skill, summary.
 * Auto-cleans on scene switch, replay, and run end.
 * Bubble text is raw event text — only line-break/fold/truncate for layout.
 */
import { useEffect, useRef, useState, useCallback } from 'react';

export interface SpeechBubble {
  id: string;
  agentId: string;
  runId?: string;
  bubbleType: 'plan' | 'dispatch' | 'command' | 'skill' | 'summary';
  text: string;
  timestamp: number;
}

interface Props {
  bubbles: SpeechBubble[];
  agentPositions: Record<string, { x: number; y: number }>;
  cellSize?: number;
  maxBubbleAge?: number;
}

const BUBBLE_TYPE_COLORS: Record<string, string> = {
  plan: '#3b82f6',
  dispatch: '#8b5cf6',
  command: '#f59e0b',
  skill: '#22c55e',
  summary: '#94a3b8',
};

const MAX_TEXT_LENGTH = 120;
const DEFAULT_MAX_AGE = 8000;

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '…';
}

export default function TownLiveSpeechBubbleLayer({
  bubbles,
  agentPositions,
  cellSize = 48,
  maxBubbleAge = DEFAULT_MAX_AGE,
}: Props) {
  const [visibleBubbles, setVisibleBubbles] = useState<SpeechBubble[]>([]);
  const timerRef = useRef<number | undefined>(undefined);

  // Filter out expired bubbles
  const pruneExpired = useCallback(() => {
    const now = Date.now();
    setVisibleBubbles(prev => prev.filter(b => now - b.timestamp < maxBubbleAge));
  }, [maxBubbleAge]);

  // Sync incoming bubbles
  useEffect(() => {
    setVisibleBubbles(prev => {
      const existingIds = new Set(prev.map(b => b.id));
      const newBubbles = bubbles.filter(b => !existingIds.has(b.id));
      if (newBubbles.length === 0) return prev;
      return [...prev, ...newBubbles];
    });
  }, [bubbles]);

  // Periodic cleanup
  useEffect(() => {
    timerRef.current = window.setInterval(pruneExpired, 1000);
    return () => {
      if (timerRef.current !== undefined) window.clearInterval(timerRef.current);
    };
  }, [pruneExpired]);

  if (visibleBubbles.length === 0) return null;

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 50 }}>
      {visibleBubbles.map(bubble => {
        const pos = agentPositions[bubble.agentId];
        if (!pos) return null;

        const color = BUBBLE_TYPE_COLORS[bubble.bubbleType] || '#94a3b8';
        const age = Date.now() - bubble.timestamp;
        const opacity = Math.max(0.3, 1 - age / maxBubbleAge);

        return (
          <div
            key={bubble.id}
            style={{
              position: 'absolute',
              left: pos.x * cellSize + cellSize / 2,
              top: pos.y * cellSize - 8,
              transform: 'translate(-50%, -100%)',
              background: '#1e293b',
              border: `1px solid ${color}`,
              borderRadius: 8,
              padding: '4px 8px',
              maxWidth: 200,
              fontSize: 11,
              color: '#e2e8f0',
              opacity,
              transition: 'opacity 0.3s',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            <div style={{ color, fontSize: 10, marginBottom: 2 }}>
              {bubble.bubbleType}
            </div>
            {truncateText(bubble.text, MAX_TEXT_LENGTH)}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Hook to manage speech bubbles from WS events.
 * Call clearBubbles() on scene switch, replay start, or run end.
 */
export function useSpeechBubbles() {
  const [bubbles, setBubbles] = useState<SpeechBubble[]>([]);

  const addBubble = useCallback((bubble: SpeechBubble) => {
    setBubbles(prev => [...prev, bubble]);
  }, []);

  const clearBubbles = useCallback(() => {
    setBubbles([]);
  }, []);

  return { bubbles, addBubble, clearBubbles };
}
