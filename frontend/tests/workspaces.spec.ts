import { expect, test } from '@playwright/test';

test('creates a workspace with staged attachments and lands on the hub', async ({ page }) => {
  const state = {
    workspaces: [] as Array<{
      id: string;
      title: string;
      description?: string | null;
      subject_area?: string | null;
      semester?: string | null;
      created_at: string;
      updated_at: string;
    }>,
    files: [] as Array<{
      id: string;
      workspace_id: string;
      filename: string;
      stored_filename: string;
      content_type: string;
      size_bytes: number;
      storage_backend: string;
      storage_path: string;
      status: string;
      created_at: string;
    }>,
  };

  await page.route('http://localhost:8000/api/**', async route => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    const method = route.request().method();

    if (pathname === '/api/workspaces' && method === 'GET') {
      await route.fulfill({ json: state.workspaces });
      return;
    }

    if (pathname === '/api/conversations' && method === 'GET') {
      await route.fulfill({ json: [] });
      return;
    }

    if (pathname === '/api/workspaces' && method === 'POST') {
      const payload = JSON.parse(route.request().postData() || '{}');
      const workspace = {
        id: 'ws-1',
        title: payload.title,
        description: payload.description,
        subject_area: payload.subject_area,
        semester: payload.semester,
        created_at: '2026-03-08T09:00:00.000Z',
        updated_at: '2026-03-08T09:00:00.000Z',
      };
      state.workspaces = [workspace];
      await route.fulfill({ json: workspace });
      return;
    }

    if (pathname === '/api/workspaces/ws-1/files' && method === 'POST') {
      state.files = [
        {
          id: 'file-1',
          workspace_id: 'ws-1',
          filename: 'brief.pdf',
          stored_filename: 'brief.pdf',
          content_type: 'application/pdf',
          size_bytes: 1024,
          storage_backend: 'local',
          storage_path: '/tmp/brief.pdf',
          status: 'ready',
          created_at: '2026-03-08T09:00:00.000Z',
        },
      ];
      await route.fulfill({ json: { files: state.files } });
      return;
    }

    if (pathname === '/api/workspaces/ws-1/text-files' && method === 'POST') {
      state.files.push({
        id: 'file-2',
        workspace_id: 'ws-1',
        filename: 'project-brief.md',
        stored_filename: 'project-brief.md',
        content_type: 'text/markdown',
        size_bytes: 512,
        storage_backend: 'local',
        storage_path: '/tmp/project-brief.md',
        status: 'ready',
        created_at: '2026-03-08T09:00:00.000Z',
      });
      await route.fulfill({ json: state.files[1] });
      return;
    }

    if (pathname === '/api/workspaces/ws-1' && method === 'GET') {
      await route.fulfill({ json: state.workspaces[0] });
      return;
    }

    if (pathname === '/api/workspaces/ws-1/files' && method === 'GET') {
      await route.fulfill({ json: { files: state.files } });
      return;
    }

    if (pathname === '/api/workspaces/ws-1/conversations' && method === 'GET') {
      await route.fulfill({ json: [] });
      return;
    }

    await route.fulfill({ status: 404, json: { detail: `Unhandled route ${method} ${pathname}` } });
  });

  await page.goto('/workspaces/new');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Visual Data Science');
  await page.getByRole('textbox', { name: 'Subject area' }).fill('Data Science');
  await page.getByRole('textbox', { name: 'Semester' }).fill('SS 2026');
  await page.getByRole('textbox', { name: 'Description' }).fill('Shared source material for the migration.');
  await page.getByRole('textbox', { name: 'Note title' }).fill('project-brief.md');
  await page.getByRole('textbox', { name: 'Note body' }).fill('Keep all existing routes stable.');

  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles({
    name: 'brief.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('pdf'),
  });

  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText('brief.pdf')).toBeVisible();
  await expect(page.getByText('project-brief.md')).toBeVisible();

  await page.locator('form button[type="submit"]').last().click();

  await expect(page).toHaveURL(/\/workspaces\/ws-1$/);
  await expect(page.getByText('Workspace created successfully.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Visual Data Science' }).first()).toBeVisible();
  await expect(page.getByText('project-brief.md')).toBeVisible();
});

test('renders a workspace conversation timeline and expandable trace card', async ({ page }) => {
  await page.route('http://localhost:8000/api/**', async route => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    const method = route.request().method();

    if (pathname === '/api/config' && method === 'GET') {
      await route.fulfill({ json: { max_context_tokens: 120000, default_model: 'gpt-5' } });
      return;
    }

    if (pathname === '/api/conversations' && method === 'GET') {
      await route.fulfill({ json: [] });
      return;
    }

    if (pathname === '/api/workspaces' && method === 'GET') {
      await route.fulfill({
        json: [
          {
            id: 'ws-1',
            title: 'Visual Data Science',
            description: 'Shared source material for the migration.',
            subject_area: 'Data Science',
            semester: 'SS 2026',
            created_at: '2026-03-08T09:00:00.000Z',
            updated_at: '2026-03-08T09:00:00.000Z',
          },
        ],
      });
      return;
    }

    if (pathname === '/api/workspaces/ws-1' && method === 'GET') {
      await route.fulfill({
        json: {
          id: 'ws-1',
          title: 'Visual Data Science',
          description: 'Shared source material for the migration.',
          subject_area: 'Data Science',
          semester: 'SS 2026',
          created_at: '2026-03-08T09:00:00.000Z',
          updated_at: '2026-03-08T09:00:00.000Z',
        },
      });
      return;
    }

    if (pathname === '/api/workspaces/ws-1/files' && method === 'GET') {
      await route.fulfill({
        json: {
          files: [
            {
              id: 'file-1',
              workspace_id: 'ws-1',
              filename: 'brief.pdf',
              stored_filename: 'brief.pdf',
              content_type: 'application/pdf',
              size_bytes: 1024,
              storage_backend: 'local',
              storage_path: '/tmp/brief.pdf',
              status: 'ready',
              created_at: '2026-03-08T09:00:00.000Z',
            },
          ],
        },
      });
      return;
    }

    if (pathname === '/api/workspaces/ws-1/conversations' && method === 'GET') {
      await route.fulfill({
        json: [
          {
            _id: 'conv-1',
            title: 'Trace conversation',
            workspace_id: 'ws-1',
            created_at: '2026-03-08T09:00:00.000Z',
            updated_at: '2026-03-08T09:01:00.000Z',
            token_count: 240,
          },
        ],
      });
      return;
    }

    if (pathname === '/api/conversations/conv-1/messages' && method === 'GET') {
      await route.fulfill({
        json: [
          {
            _id: 'msg-1',
            role: 'user',
            content: 'Build the migration plan',
            created_at: '2026-03-08T09:00:00.000Z',
          },
          {
            _id: 'msg-2',
            role: 'assistant',
            content: 'I mapped the frontend migration and execution steps.',
            thinking: 'Checking the current UI structure before proposing changes.',
            created_at: '2026-03-08T09:00:30.000Z',
          },
        ],
      });
      return;
    }

    if (pathname === '/api/conversations/conv-1/runs' && method === 'GET') {
      await route.fulfill({
        json: {
          runs: [
            {
              id: 'run-1',
              workspace_id: 'ws-1',
              conversation_id: 'conv-1',
              user_prompt: 'Build the migration plan',
              model: 'gpt-5',
              status: 'completed',
              step_count: 1,
              final_answer: 'done',
              created_at: '2026-03-08T09:00:10.000Z',
              updated_at: '2026-03-08T09:00:40.000Z',
            },
          ],
        },
      });
      return;
    }

    if (pathname === '/api/runs/run-1/steps' && method === 'GET') {
      await route.fulfill({
        json: {
          steps: [
            {
              id: 'step-1',
              run_id: 'run-1',
              step_index: 1,
              thought: 'Inspect the current frontend structure.',
              code: 'print("hello")',
              stdout: 'hello',
              stderr: '',
              exit_code: 0,
              artifacts: [{ name: 'audit.md' }],
              next_step_needed: false,
              duration_ms: 10,
              created_at: '2026-03-08T09:00:20.000Z',
            },
          ],
        },
      });
      return;
    }

    await route.fulfill({ status: 404, json: { detail: `Unhandled route ${method} ${pathname}` } });
  });

  await page.goto('/workspaces/ws-1/chats/conv-1');
  await expect(page.getByRole('heading', { name: 'Trace conversation' })).toBeVisible();
  await expect(page.getByText('240 / 120,000')).toBeVisible();
  await expect(page.getByText('I mapped the frontend migration and execution steps.')).toBeVisible();

  await page.getByRole('button', { name: /1 step trace/i }).click();
  await expect(page.getByText('Generated code')).toBeVisible();
  await expect(page.getByText('print("hello")')).toBeVisible();
  await expect(page.getByText('audit.md')).toBeVisible();
});
