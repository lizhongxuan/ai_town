/**
 * T-103: Commands / Tools / Skills 原文观察台
 *
 * Shows command/skill/tool calls with:
 * - Caller, type, raw input/output, duration, status
 * - Long content uses fold/expand only (no summarization)
 * - Raw text displayed as-is per DG-004
 */
import { useEffect, useState } from 'react';
import api from '../../lib/api';

interface ActionCall {
  id: string;
  runId: string;
  subtaskId: string;
  agentId: string;
  callType: string;
  name: string;
  rawInput: string;
  rawOutput: string;
  status: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    completed: '#22c55e',
    running: '#3b82f6',
    error: '#ef4444',
    pending: '#94a3b8',
  };
  return (
    <span style={{
      color: colors[status] || '#94a3b8',
      fontSize: 11,
      padding: '1px 6px',
      borderRadius: 3,
      border: `1px solid ${colors[status] || '#475569'}`,
    }}>
      {status}
    </span>
  );
}

export default function TownRunActionsView({ runId }: { runId: string }) {
  const [actions, setActions] = useState<ActionCall[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    api.getTownRunDetails(runId, 'actions').then((resp: any) => {
      if (resp?.ok && resp.details?.actions) {
        setActions(resp.details.actions);
      }
    }).finally(() => setLoading(false));
  }, [runId]);

  if (loading) return <div style={{ padding: 16, color: '#94a3b8' }}>加载调用链...</div>;

  if (actions.length === 0) {
    return (
      <div style={{ padding: 16, color: '#94a3b8', fontSize: 13 }}>
        暂无数据 / 上游未提供命令调用记录
      </div>
    );
  }

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {actions.map(action => (
        <div
          key={action.id}
          style={{
            background: '#0f172a',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 13,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ color: '#94a3b8' }}>{action.agentId}</span>
            <span style={{ color: '#64748b' }}>·</span>
            <span style={{ color: '#e2e8f0' }}>{action.callType}/{action.name}</span>
            <span style={{ flex: 1 }} />
            {statusBadge(action.status)}
            <span style={{ color: '#64748b', fontSize: 12 }}>
              {action.durationMs > 0 ? formatDuration(action.durationMs) : '—'}
            </span>
          </div>
          {action.rawInput && (
            <details>
              <summary style={{ color: '#64748b', cursor: 'pointer', fontSize: 12 }}>输入原文</summary>
              <pre style={{
                color: '#cbd5e1',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                background: '#1e293b',
                padding: 6,
                borderRadius: 4,
                marginTop: 4,
                maxHeight: 200,
                overflow: 'auto',
                fontSize: 12,
              }}>
                {action.rawInput}
              </pre>
            </details>
          )}
          {action.rawOutput && (
            <details>
              <summary style={{ color: '#64748b', cursor: 'pointer', fontSize: 12 }}>输出原文</summary>
              <pre style={{
                color: '#cbd5e1',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                background: '#1e293b',
                padding: 6,
                borderRadius: 4,
                marginTop: 4,
                maxHeight: 200,
                overflow: 'auto',
                fontSize: 12,
              }}>
                {action.rawOutput}
              </pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}
