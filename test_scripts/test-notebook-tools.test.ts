import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock nlm-runner before importing tools
vi.mock('../notebooklm_agent/tools/nlm-runner.js', () => ({
  runNlm: vi.fn(),
  TIMEOUT_FAST: 30_000,
  TIMEOUT_MEDIUM: 60_000,
  TIMEOUT_LONG: 120_000,
  TIMEOUT_EXTRA_LONG: 360_000,
}));

import { runNlm } from '../notebooklm_agent/tools/nlm-runner.ts';
import {
  listNotebooksTool,
  getNotebookTool,
  createNotebookTool,
  deleteNotebookTool,
} from '../notebooklm_agent/tools/notebook-tools.ts';

const mockRunNlm = vi.mocked(runNlm);

// Helper to call the private execute method
async function callTool(tool: any, args: any, ctx?: any) {
  return tool.execute(args, ctx);
}

function createMockContext() {
  const store = new Map<string, unknown>();
  return {
    state: {
      get: vi.fn((key: string) => store.get(key)),
      set: vi.fn((key: string, value: unknown) => store.set(key, value)),
    },
  };
}

describe('listNotebooksTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls runNlm with correct args', async () => {
    mockRunNlm.mockReturnValue({
      status: 'success',
      data: { notebooks: [{ id: 'nb-1', title: 'Test', source_count: 2 }] },
    });

    const result = await callTool(listNotebooksTool, {});

    expect(mockRunNlm).toHaveBeenCalledWith(
      ['notebook', 'list', '--json'],
      60_000,
    );
    expect(result).toHaveProperty('status', 'success');
    expect((result as any).notebooks).toHaveLength(1);
    expect((result as any).notebooks[0].id).toBe('nb-1');
  });

  it('passes through errors from runNlm', async () => {
    mockRunNlm.mockReturnValue({
      status: 'auth_error',
      error: 'Not authenticated',
    });

    const result = await callTool(listNotebooksTool, {});

    expect(result).toHaveProperty('status', 'auth_error');
  });
});

describe('getNotebookTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls runNlm and updates context state', async () => {
    mockRunNlm.mockReturnValue({
      status: 'success',
      data: { id: 'nb-123', title: 'My NB', source_count: 3 } as Record<string, unknown>,
    });

    const ctx = createMockContext();
    const result = await callTool(
      getNotebookTool,
      { notebook_id: 'nb-123' },
      ctx,
    );

    expect(mockRunNlm).toHaveBeenCalledWith(
      ['notebook', 'get', 'nb-123', '--json'],
      30_000,
    );
    expect(result).toHaveProperty('status', 'success');
    expect(ctx.state.set).toHaveBeenCalledWith('current_notebook_id', 'nb-123');
    expect(ctx.state.set).toHaveBeenCalledWith('current_notebook_title', 'My NB');
  });

  it('passes through errors from runNlm', async () => {
    mockRunNlm.mockReturnValue({
      status: 'not_found',
      error: 'Notebook not found',
    });

    const result = await callTool(getNotebookTool, { notebook_id: 'bad-id' });

    expect(result).toHaveProperty('status', 'not_found');
  });
});

describe('createNotebookTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls runNlm and updates context state on success', async () => {
    mockRunNlm.mockReturnValue({
      status: 'success',
      data: { id: 'nb-new', title: 'New Notebook' } as Record<string, unknown>,
    });

    const ctx = createMockContext();
    const result = await callTool(
      createNotebookTool,
      { title: 'New Notebook' },
      ctx,
    );

    expect(mockRunNlm).toHaveBeenCalledWith(
      ['notebook', 'create', 'New Notebook'],
      60_000,
    );
    expect(result).toHaveProperty('status', 'success');
    expect(ctx.state.set).toHaveBeenCalledWith('current_notebook_id', 'nb-new');
    expect(ctx.state.set).toHaveBeenCalledWith('current_notebook_title', 'New Notebook');
  });

  it('returns message when response has no data object', async () => {
    mockRunNlm.mockReturnValue({
      status: 'success',
      output: 'Notebook created.',
    });

    const result = await callTool(createNotebookTool, { title: 'Test' });

    expect(result).toHaveProperty('status', 'success');
    expect((result as any).message).toBe('Notebook created.');
  });
});

describe('deleteNotebookTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes --confirm flag in args', async () => {
    mockRunNlm.mockReturnValue({
      status: 'success',
      output: 'Notebook deleted.',
    });

    const result = await callTool(deleteNotebookTool, { notebook_id: 'nb-del' });

    expect(mockRunNlm).toHaveBeenCalledWith(
      ['notebook', 'delete', 'nb-del', '--confirm'],
      60_000,
    );
    expect(result).toHaveProperty('status', 'success');
  });

  it('passes through errors from runNlm', async () => {
    mockRunNlm.mockReturnValue({
      status: 'not_found',
      error: 'Notebook not found',
    });

    const result = await callTool(deleteNotebookTool, { notebook_id: 'bad-id' });

    expect(result).toHaveProperty('status', 'not_found');
  });
});
