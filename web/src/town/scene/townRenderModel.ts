/**
 * T-106: Pixi 渲染层预研与增量接入
 *
 * This module defines the render model abstraction layer.
 * The render model decouples scene data from rendering implementation,
 * allowing incremental migration from CSS to Pixi/WebGL.
 *
 * Current: React + CSS renders from this model
 * Future: Pixi/Phaser can consume the same model
 *
 * React continues to manage HUD/input/modals.
 * Only background, characters, zone heatmaps, and state animations
 * are candidates for Pixi migration.
 */

export interface RenderAgent {
  id: string;
  name: string;
  emoji: string;
  avatarHue: string;
  x: number;
  y: number;
  facing: 'up' | 'down' | 'left' | 'right';
  state: 'idle' | 'busy' | 'completed' | 'error';
  speech?: string;
  opacity: number;
}

export interface RenderZone {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  brightness: number;
  state: 'running' | 'fading';
}

export interface RenderBubble {
  id: string;
  agentId: string;
  text: string;
  type: string;
  opacity: number;
}

export interface RenderSceneModel {
  sceneId: string;
  width: number;
  height: number;
  cellSize: number;
  agents: RenderAgent[];
  zones: RenderZone[];
  bubbles: RenderBubble[];
  clock: string;
  weather: string;
}

/**
 * Build a render model from TownState for the active scene.
 * This is the single source of truth for any renderer (CSS or Pixi).
 */
export function buildRenderSceneModel(
  sceneId: string,
  agents: Array<{ id: string; name: string; position: { x: number; y: number }; executionState: string }>,
  cellSize: number = 48,
): RenderSceneModel {
  const renderAgents: RenderAgent[] = agents.map(agent => ({
    id: agent.id,
    name: agent.name,
    emoji: '',
    avatarHue: '',
    x: agent.position.x,
    y: agent.position.y,
    facing: 'down' as const,
    state: (agent.executionState === 'busy' ? 'busy' :
            agent.executionState === 'completed' ? 'completed' :
            agent.executionState === 'error' ? 'error' : 'idle') as RenderAgent['state'],
    opacity: 1,
  }));

  return {
    sceneId,
    width: 0,
    height: 0,
    cellSize,
    agents: renderAgents,
    zones: [],
    bubbles: [],
    clock: '',
    weather: '',
  };
}
