#!/usr/bin/env node

const baseUrl = (process.env.TOWN_QA_URL || 'http://127.0.0.1:19527').replace(/\/$/, '');
const adminToken = process.env.TOWN_ADMIN_TOKEN || process.env.ADMIN_TOKEN || 'clawpanel';
const preferredAgentId = (process.env.TOWN_TEST_AGENT || '').trim();

function headers() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminToken}`,
  };
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`接口返回不是合法 JSON：${text}`);
  }
}

async function getSnapshot() {
  const response = await fetch(`${baseUrl}/api/town/snapshot`, { headers: headers() });
  const data = await readJson(response);
  if (!response.ok && data?.code !== 'town.disabled') {
    throw new Error(data?.error || `snapshot 请求失败: HTTP ${response.status}`);
  }
  return data;
}

async function updateOfficeMembers(body) {
  const response = await fetch(`${baseUrl}/api/town/office-members`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await readJson(response),
  };
}

function pickAgent(snapshot) {
  const candidates = Array.isArray(snapshot?.agents) ? snapshot.agents : [];
  if (preferredAgentId) {
    const exact = candidates.find(agent => agent?.id === preferredAgentId);
    if (!exact) {
      throw new Error(`找不到指定测试 Agent: ${preferredAgentId}`);
    }
    return exact;
  }

  const unselected = candidates.find(agent => (snapshot?.officeMembers?.[agent?.id] || 'unselected') === 'unselected');
  if (unselected) return unselected;
  if (candidates[0]) return candidates[0];
  throw new Error('Town snapshot 里没有可用于一致性测试的 Agent');
}

async function main() {
  const initial = await getSnapshot();
  if (initial?.code === 'town.disabled') {
    throw new Error(initial?.error || 'Town 未启用，无法执行共享状态一致性检查');
  }
  if (!initial?.ok || !initial?.snapshot) {
    throw new Error(initial?.error || 'Town snapshot 不可用');
  }

  const snapshot = initial.snapshot;
  const agent = pickAgent(snapshot);
  const originalMembership = snapshot.officeMembers?.[agent.id] || 'unselected';
  const nextMembership = originalMembership === 'unselected' ? 'selected' : 'unselected';
  const staleMembership = nextMembership === 'selected' ? 'unselected' : 'selected';
  const beforeVersion = Number(snapshot.version || 0);

  const firstUpdate = await updateOfficeMembers({
    agentId: agent.id,
    membership: nextMembership,
    expectedVersion: beforeVersion,
  });
  if (!firstUpdate.body?.ok) {
    throw new Error(firstUpdate.body?.error || '第一次 office-members 更新失败');
  }

  const afterUpdate = await getSnapshot();
  if (!afterUpdate?.ok || !afterUpdate?.snapshot) {
    throw new Error(afterUpdate?.error || '更新后读取 snapshot 失败');
  }

  const currentVersion = Number(afterUpdate.snapshot.version || 0);
  if (currentVersion <= beforeVersion) {
    throw new Error(`版本号没有增加：before=${beforeVersion}, after=${currentVersion}`);
  }

  const currentMembership = afterUpdate.snapshot.officeMembers?.[agent.id] || 'unselected';
  if (currentMembership !== nextMembership) {
    throw new Error(`成员池状态不一致：预期 ${nextMembership}，实际 ${currentMembership}`);
  }

  const staleWrite = await updateOfficeMembers({
    agentId: agent.id,
    membership: staleMembership,
    expectedVersion: beforeVersion,
  });
  if (staleWrite.body?.ok || staleWrite.body?.code !== 'town.office_members.version_conflict') {
    throw new Error(`没有拿到 version_conflict，实际返回：${JSON.stringify(staleWrite.body)}`);
  }

  const restore = await updateOfficeMembers({
    agentId: agent.id,
    membership: originalMembership,
    expectedVersion: currentVersion,
  });
  if (!restore.body?.ok) {
    throw new Error(restore.body?.error || '恢复原始成员池状态失败');
  }

  const finalSnapshot = await getSnapshot();
  if (!finalSnapshot?.ok || !finalSnapshot?.snapshot) {
    throw new Error(finalSnapshot?.error || '恢复后读取 snapshot 失败');
  }

  const finalMembership = finalSnapshot.snapshot.officeMembers?.[agent.id] || 'unselected';
  if (finalMembership !== originalMembership) {
    throw new Error(`恢复后的成员池状态错误：预期 ${originalMembership}，实际 ${finalMembership}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        agentId: agent.id,
        beforeVersion,
        currentVersion,
        finalVersion: Number(finalSnapshot.snapshot.version || 0),
        originalMembership,
      },
      null,
      2
    )
  );
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
