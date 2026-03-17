/**
 * T-102: Plan 与调度理由可视化
 *
 * Shows:
 * - Plan raw text / structured steps
 * - Selected agent reasons
 * - Rejected candidate reasons
 * - Why parallel/sequential
 *
 * Only displays real upstream data. Missing fields show "暂无数据/上游未提供".
 */
import { useEffect, useState } from 'react';
import api from '../../lib/api';

interface PlanData {
  summary: string;
  executionMode: string;
  rawPlan: string;
  selectedReasons: Record<string, string>;
  rejectedReasons: Record<string, string>;
}

export default function TownRunPlanView({ runId }: { runId: string }) {
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    api.getTownRunDetails(runId, 'plan').then((resp: any) => {
      if (resp?.ok && resp.details?.plan) {
        setPlan(resp.details.plan);
      } else {
        setPlan(null);
      }
    }).finally(() => setLoading(false));
  }, [runId]);

  if (loading) return <div style={{ padding: 16, color: '#94a3b8' }}>加载计划数据...</div>;

  if (!plan) {
    return (
      <div style={{ padding: 16, color: '#94a3b8', fontSize: 13 }}>
        暂无数据 / 上游未提供调度计划
      </div>
    );
  }

  const modeLabel = plan.executionMode === 'parallel' ? '并行' :
    plan.executionMode === 'sequential' ? '串行' :
    plan.executionMode === 'mixed' ? '混合' : plan.executionMode || '暂无数据/上游未提供';

  const selectedEntries = Object.entries(plan.selectedReasons || {});
  const rejectedEntries = Object.entries(plan.rejectedReasons || {});

  return (
    <div style={{ padding: 12, fontSize: 13 }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ color: '#94a3b8', marginBottom: 4 }}>执行模式</div>
        <div style={{ color: '#e2e8f0' }}>{modeLabel}</div>
      </div>

      {plan.summary ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ color: '#94a3b8', marginBottom: 4 }}>计划摘要</div>
          <div style={{ color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>{plan.summary}</div>
        </div>
      ) : (
        <div style={{ marginBottom: 12, color: '#64748b' }}>计划摘要: 暂无数据/上游未提供</div>
      )}

      {plan.rawPlan ? (
        <details style={{ marginBottom: 12 }}>
          <summary style={{ color: '#94a3b8', cursor: 'pointer' }}>原始计划</summary>
          <pre style={{
            color: '#cbd5e1',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            background: '#0f172a',
            padding: 8,
            borderRadius: 4,
            marginTop: 4,
            maxHeight: 300,
            overflow: 'auto',
          }}>
            {plan.rawPlan}
          </pre>
        </details>
      ) : null}

      {selectedEntries.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ color: '#94a3b8', marginBottom: 4 }}>选中 Agent 理由</div>
          {selectedEntries.map(([agentId, reason]) => (
            <div key={agentId} style={{ color: '#cbd5e1', padding: '2px 0' }}>
              <span style={{ color: '#22c55e' }}>{agentId}</span>: {reason}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ marginBottom: 12, color: '#64748b' }}>选中理由: 暂无数据/上游未提供</div>
      )}

      {rejectedEntries.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ color: '#94a3b8', marginBottom: 4 }}>未选中候选原因</div>
          {rejectedEntries.map(([agentId, reason]) => (
            <div key={agentId} style={{ color: '#cbd5e1', padding: '2px 0' }}>
              <span style={{ color: '#ef4444' }}>{agentId}</span>: {reason}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
