/**
 * T-101: 调度拓扑时间线与并/串行视图
 *
 * Renders a topology timeline for a run, showing:
 * - Parallel vs sequential execution
 * - Dependency edges between subtasks
 * - Agent start/end/duration for each subtask
 */
import { useEffect, useState } from 'react';
import api from '../../lib/api';

interface Subtask {
  id: string;
  runId: string;
  agentId: string;
  title: string;
  status: string;
  executionMode: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  seq: number;
}

interface Edge {
  fromSubtaskId: string;
  toSubtaskId: string;
  edgeType: string;
}

interface RunPlan {
  summary: string;
  executionMode: string;
  rawPlan: string;
}

interface TopologyData {
  plan: RunPlan | null;
  subtasks: Subtask[];
  edges: Edge[];
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function executionModeLabel(mode: string): string {
  switch (mode) {
    case 'parallel': return '并行';
    case 'sequential': return '串行';
    case 'mixed': return '混合';
    default: return mode || '未知';
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed': return '#22c55e';
    case 'running': return '#3b82f6';
    case 'error': return '#ef4444';
    default: return '#94a3b8';
  }
}

export default function TownRunTopologyView({ runId }: { runId: string }) {
  const [data, setData] = useState<TopologyData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    api.getTownRunDetails(runId, 'all').then((resp: any) => {
      if (resp?.ok && resp.details) {
        setData({
          plan: resp.details.plan || null,
          subtasks: resp.details.subtasks || [],
          edges: resp.details.edges || [],
        });
      }
    }).finally(() => setLoading(false));
  }, [runId]);

  if (loading) {
    return <div style={{ padding: 16, color: '#94a3b8' }}>加载拓扑数据...</div>;
  }

  if (!data || data.subtasks.length === 0) {
    return (
      <div style={{ padding: 16, color: '#94a3b8', fontSize: 13 }}>
        暂无数据 / 上游未提供调度拓扑
      </div>
    );
  }

  const sorted = [...data.subtasks].sort((a, b) => a.seq - b.seq || a.startedAt - b.startedAt);
  const edgeMap = new Map<string, string[]>();
  for (const edge of data.edges) {
    const list = edgeMap.get(edge.fromSubtaskId) || [];
    list.push(edge.toSubtaskId);
    edgeMap.set(edge.fromSubtaskId, list);
  }

  return (
    <div style={{ padding: 12 }}>
      {data.plan && (
        <div style={{ marginBottom: 12, padding: 8, background: '#1e293b', borderRadius: 6, fontSize: 13 }}>
          <div style={{ color: '#94a3b8', marginBottom: 4 }}>
            执行模式: <span style={{ color: '#e2e8f0' }}>{executionModeLabel(data.plan.executionMode)}</span>
          </div>
          {data.plan.summary && (
            <div style={{ color: '#cbd5e1' }}>{data.plan.summary}</div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {sorted.map(subtask => (
          <div
            key={subtask.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              background: '#0f172a',
              borderRadius: 4,
              borderLeft: `3px solid ${statusColor(subtask.status)}`,
              fontSize: 13,
            }}
          >
            <span style={{ color: '#94a3b8', minWidth: 60 }}>{subtask.agentId}</span>
            <span style={{ color: '#e2e8f0', flex: 1 }}>{subtask.title || '子任务'}</span>
            <span style={{ color: '#64748b', fontSize: 12 }}>
              {executionModeLabel(subtask.executionMode)}
            </span>
            <span style={{ color: '#94a3b8', fontSize: 12, minWidth: 50, textAlign: 'right' }}>
              {subtask.durationMs > 0 ? formatDuration(subtask.durationMs) : '—'}
            </span>
            {edgeMap.has(subtask.id) && (
              <span style={{ color: '#475569', fontSize: 11 }}>
                → {edgeMap.get(subtask.id)!.length}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
