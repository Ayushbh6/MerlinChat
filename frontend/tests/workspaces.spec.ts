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

    if (pathname === '/api/conversations/conv-1/turns' && method === 'GET') {
      await route.fulfill({
        json: {
          turns: [
            {
              conversation_id: 'conv-1',
              workspace_id: 'ws-1',
              id: 'turn-1',
              user_message_id: 'msg-1',
              assistant_message_id: 'msg-2',
              run_id: 'run-1',
              trace_id: 'trace-1',
              status: 'completed',
              model: 'gpt-5',
              token_counts: { conversation: 240 },
              started_at: '2026-03-08T09:00:00.000Z',
              completed_at: '2026-03-08T09:00:40.000Z',
              created_at: '2026-03-08T09:00:00.000Z',
              updated_at: '2026-03-08T09:00:40.000Z',
              user_message: {
                _id: 'msg-1',
                role: 'user',
                content: 'Build the migration plan',
                created_at: '2026-03-08T09:00:00.000Z',
              },
              assistant_message: {
                _id: 'msg-2',
                role: 'assistant',
                content: 'I mapped the frontend migration and execution steps.',
                thinking: 'Checking the current UI structure before proposing changes.',
                created_at: '2026-03-08T09:00:30.000Z',
              },
              run: {
                id: 'run-1',
                workspace_id: 'ws-1',
                conversation_id: 'conv-1',
                turn_id: 'turn-1',
                trace_id: 'trace-1',
                user_prompt: 'Build the migration plan',
                model: 'gpt-5',
                status: 'completed',
                step_count: 1,
                final_answer: 'done',
                created_at: '2026-03-08T09:00:10.000Z',
                updated_at: '2026-03-08T09:00:40.000Z',
              },
              trace: {
                id: 'trace-1',
                turn_id: 'turn-1',
                conversation_id: 'conv-1',
                workspace_id: 'ws-1',
                run_id: 'run-1',
                status: 'completed',
                latest_seq: 8,
                raw_debug_enabled: true,
                summary: { trace_id: 'trace-1', step_count: 1, latest_event_type: 'turn.completed' },
                created_at: '2026-03-08T09:00:10.000Z',
                updated_at: '2026-03-08T09:00:40.000Z',
              },
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
  await expect(page.getByText('I mapped the frontend migration and execution steps.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Results' })).toHaveCount(0);

  await page.getByRole('button', { name: /1 step trace/i }).click();
  await expect(page.getByRole('button', { name: 'Code' }).first()).toBeVisible();
  await expect(page.getByText('print("hello")').first()).toBeVisible();
  await expect(page.getByText('audit.md').first()).toBeVisible();
});

test('streams a running workspace execution into the split panel', async ({ page }) => {
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
      await route.fulfill({ json: { files: [] } });
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

    if (pathname === '/api/conversations/conv-1/turns' && method === 'GET') {
      await route.fulfill({
        json: {
          turns: [
            {
              conversation_id: 'conv-1',
              workspace_id: 'ws-1',
              id: 'turn-live',
              user_message_id: 'msg-1',
              assistant_message_id: null,
              run_id: 'run-live',
              trace_id: 'trace-live',
              status: 'running',
              model: 'gpt-5',
              token_counts: {},
              started_at: '2026-03-08T09:00:00.000Z',
              completed_at: null,
              created_at: '2026-03-08T09:00:00.000Z',
              updated_at: '2026-03-08T09:00:12.000Z',
              user_message: {
                _id: 'msg-1',
                role: 'user',
                content: 'Build the migration plan',
                created_at: '2026-03-08T09:00:00.000Z',
              },
              assistant_message: null,
              run: {
                id: 'run-live',
                workspace_id: 'ws-1',
                conversation_id: 'conv-1',
                turn_id: 'turn-live',
                trace_id: 'trace-live',
                user_prompt: 'Build the migration plan',
                model: 'gpt-5',
                status: 'running',
                step_count: 0,
                final_answer: null,
                created_at: '2026-03-08T09:00:10.000Z',
                updated_at: '2026-03-08T09:00:12.000Z',
              },
              trace: {
                id: 'trace-live',
                turn_id: 'turn-live',
                conversation_id: 'conv-1',
                workspace_id: 'ws-1',
                run_id: 'run-live',
                status: 'running',
                latest_seq: 0,
                raw_debug_enabled: true,
                summary: { trace_id: 'trace-live', step_count: 0, latest_event_type: 'run.queued' },
                created_at: '2026-03-08T09:00:10.000Z',
                updated_at: '2026-03-08T09:00:12.000Z',
              },
            },
          ],
        },
      });
      return;
    }

    if (pathname === '/api/runs/run-live/steps' && method === 'GET') {
      await route.fulfill({ json: { steps: [] } });
      return;
    }

    if (pathname === '/api/runs/run-live/events' && method === 'GET') {
      const body = [
        'id: 1',
        'data: {"id":"evt-1","run_id":"run-live","trace_id":"trace-live","turn_id":"turn-live","seq":1,"type":"turn.started","scope":"run","payload":{"turn_id":"turn-live","conversation_id":"conv-1","workspace_id":"ws-1","user_prompt":"Build the migration plan"},"ui_payload":{"turn_id":"turn-live","conversation_id":"conv-1","workspace_id":"ws-1","user_prompt":"Build the migration plan"},"created_at":"2026-03-08T09:00:11.000Z"}',
        '',
        'id: 2',
        'data: {"id":"evt-2","run_id":"run-live","trace_id":"trace-live","turn_id":"turn-live","seq":2,"type":"thought.updated","scope":"run","payload":{"thought":"Inspecting the current frontend structure.","action":"code","step_index":1},"ui_payload":{"thought":"Inspecting the current frontend structure.","action":"code","step_index":1},"created_at":"2026-03-08T09:00:12.000Z"}',
        '',
        'id: 3',
        'data: {"id":"evt-3","run_id":"run-live","trace_id":"trace-live","turn_id":"turn-live","seq":3,"type":"step.started","scope":"run","payload":{"step_index":1,"thought":"Inspecting the current frontend structure.","status":"running"},"ui_payload":{"step_index":1,"thought":"Inspecting the current frontend structure.","status":"running"},"created_at":"2026-03-08T09:00:12.100Z"}',
        '',
        'id: 4',
        'data: {"id":"evt-4","run_id":"run-live","trace_id":"trace-live","turn_id":"turn-live","seq":4,"type":"step.code.delta","scope":"run","payload":{"step_index":1,"chunk":"print(\\"hello\\")"},"ui_payload":{"step_index":1,"chunk":"print(\\"hello\\")"},"created_at":"2026-03-08T09:00:12.200Z"}',
        '',
        'id: 5',
        'data: {"id":"evt-5","run_id":"run-live","trace_id":"trace-live","turn_id":"turn-live","seq":5,"type":"step.stdout.delta","scope":"run","payload":{"step_index":1,"chunk":"hello"},"ui_payload":{"step_index":1,"chunk":"hello"},"created_at":"2026-03-08T09:00:12.300Z"}',
        '',
        'id: 6',
        'data: {"id":"evt-6","run_id":"run-live","trace_id":"trace-live","turn_id":"turn-live","seq":6,"type":"step.completed","scope":"run","payload":{"step_index":1,"thought":"Inspecting the current frontend structure.","code":"print(\\"hello\\")","stdout":"hello","stderr":"","exit_code":0,"artifacts":[{"name":"audit.md"}],"duration_ms":10,"created_at":"2026-03-08T09:00:12.400Z","status":"completed"},"ui_payload":{"step_index":1,"thought":"Inspecting the current frontend structure.","code":"print(\\"hello\\")","stdout":"hello","stderr":"","exit_code":0,"artifacts":[{"name":"audit.md"}],"duration_ms":10,"created_at":"2026-03-08T09:00:12.400Z","status":"completed"},"created_at":"2026-03-08T09:00:12.400Z"}',
        '',
        'id: 7',
        'data: {"id":"evt-7","run_id":"run-live","trace_id":"trace-live","turn_id":"turn-live","seq":7,"type":"thought.updated","scope":"run","payload":{"thought":"Preparing a second verification step.","action":"code","step_index":2},"ui_payload":{"thought":"Preparing a second verification step.","action":"code","step_index":2},"created_at":"2026-03-08T09:00:12.450Z"}',
        '',
        'id: 8',
        'data: {"id":"evt-8","run_id":"run-live","trace_id":"trace-live","turn_id":"turn-live","seq":8,"type":"step.started","scope":"run","payload":{"step_index":2,"thought":"Preparing a second verification step.","status":"running"},"ui_payload":{"step_index":2,"thought":"Preparing a second verification step.","status":"running"},"created_at":"2026-03-08T09:00:12.500Z"}',
        '',
        'id: 9',
        'data: {"id":"evt-9","run_id":"run-live","trace_id":"trace-live","turn_id":"turn-live","seq":9,"type":"step.code.delta","scope":"run","payload":{"step_index":2,"chunk":"print(\\"world\\")"},"ui_payload":{"step_index":2,"chunk":"print(\\"world\\")"},"created_at":"2026-03-08T09:00:12.550Z"}',
        '',
        'id: 10',
        'data: {"id":"evt-10","run_id":"run-live","trace_id":"trace-live","turn_id":"turn-live","seq":10,"type":"step.stdout.delta","scope":"run","payload":{"step_index":2,"chunk":"world"},"ui_payload":{"step_index":2,"chunk":"world"},"created_at":"2026-03-08T09:00:12.600Z"}',
        '',
        'id: 11',
        'data: {"id":"evt-11","run_id":"run-live","trace_id":"trace-live","turn_id":"turn-live","seq":11,"type":"step.completed","scope":"run","payload":{"step_index":2,"thought":"Preparing a second verification step.","code":"print(\\"world\\")","stdout":"world","stderr":"","exit_code":0,"artifacts":[{"name":"summary.txt"}],"duration_ms":8,"created_at":"2026-03-08T09:00:12.650Z","status":"completed"},"ui_payload":{"step_index":2,"thought":"Preparing a second verification step.","code":"print(\\"world\\")","stdout":"world","stderr":"","exit_code":0,"artifacts":[{"name":"summary.txt"}],"duration_ms":8,"created_at":"2026-03-08T09:00:12.650Z","status":"completed"},"created_at":"2026-03-08T09:00:12.650Z"}',
        '',
        'id: 12',
        'data: {"id":"evt-12","run_id":"run-live","trace_id":"trace-live","turn_id":"turn-live","seq":12,"type":"answer.delta","scope":"run","payload":{"chunk":"I mapped the frontend "},"ui_payload":{"chunk":"I mapped the frontend "},"created_at":"2026-03-08T09:00:12.700Z"}',
        '',
        'id: 13',
        'data: {"id":"evt-13","run_id":"run-live","trace_id":"trace-live","turn_id":"turn-live","seq":13,"type":"answer.delta","scope":"run","payload":{"chunk":"migration and execution steps."},"ui_payload":{"chunk":"migration and execution steps."},"created_at":"2026-03-08T09:00:12.725Z"}',
        '',
        'id: 14',
        'data: {"id":"evt-14","run_id":"run-live","trace_id":"trace-live","turn_id":"turn-live","seq":14,"type":"turn.completed","scope":"run","payload":{"status":"completed","final_answer":"I mapped the frontend migration and execution steps."},"ui_payload":{"status":"completed","final_answer":"I mapped the frontend migration and execution steps."},"created_at":"2026-03-08T09:00:12.750Z"}',
        '',
      ].join('\n');
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
      return;
    }

    await route.fulfill({ status: 404, json: { detail: `Unhandled route ${method} ${pathname}` } });
  });

  await page.goto('/workspaces/ws-1/chats/conv-1');
  await expect(page.getByRole('heading', { name: 'Workspace companion' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Results' })).toHaveCount(0);
  await expect(page.getByText('Preparing a second verification step.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Step 1/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Step 2/i }).first()).toBeVisible();
  await expect(page.getByText('print("world")').first()).toBeVisible();
  await expect(page.getByText('summary.txt').first()).toBeVisible();
  await page.getByRole('button', { name: /Step 1/i }).first().click();
  await expect(page.getByText('print("hello")').first()).toBeVisible();
  await expect(page.getByText('audit.md').first()).toBeVisible();
  await expect(page.getByText('I mapped the frontend migration and execution steps.').first()).toBeVisible();
});

test('hands off the live response to the persisted assistant message after completion', async ({ page }) => {
  let turnsRequestCount = 0;

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
      await route.fulfill({ json: { files: [] } });
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

    if (pathname === '/api/conversations/conv-1/turns' && method === 'GET') {
      turnsRequestCount += 1;
      if (turnsRequestCount === 1) {
        await route.fulfill({
          json: {
            turns: [
              {
                conversation_id: 'conv-1',
                workspace_id: 'ws-1',
                id: 'turn-live',
                user_message_id: 'msg-1',
                assistant_message_id: null,
                run_id: 'run-handoff',
                trace_id: 'trace-handoff',
                status: 'running',
                model: 'gpt-5',
                token_counts: {},
                started_at: '2026-03-08T09:00:00.000Z',
                completed_at: null,
                created_at: '2026-03-08T09:00:00.000Z',
                updated_at: '2026-03-08T09:00:12.000Z',
                user_message: {
                  _id: 'msg-1',
                  role: 'user',
                  content: 'Summarize the migration work',
                  created_at: '2026-03-08T09:00:00.000Z',
                },
                assistant_message: null,
                run: {
                  id: 'run-handoff',
                  workspace_id: 'ws-1',
                  conversation_id: 'conv-1',
                  turn_id: 'turn-live',
                  trace_id: 'trace-handoff',
                  user_prompt: 'Summarize the migration work',
                  model: 'gpt-5',
                  status: 'running',
                  step_count: 0,
                  final_answer: null,
                  created_at: '2026-03-08T09:00:10.000Z',
                  updated_at: '2026-03-08T09:00:12.000Z',
                },
                trace: {
                  id: 'trace-handoff',
                  turn_id: 'turn-live',
                  conversation_id: 'conv-1',
                  workspace_id: 'ws-1',
                  run_id: 'run-handoff',
                  status: 'running',
                  latest_seq: 0,
                  raw_debug_enabled: true,
                  summary: { trace_id: 'trace-handoff', step_count: 0, latest_event_type: 'run.queued' },
                  created_at: '2026-03-08T09:00:10.000Z',
                  updated_at: '2026-03-08T09:00:12.000Z',
                },
              },
            ],
          },
        });
        return;
      }

      await route.fulfill({
        json: {
          turns: [
            {
              conversation_id: 'conv-1',
              workspace_id: 'ws-1',
              id: 'turn-live',
              user_message_id: 'msg-1',
              assistant_message_id: 'msg-2',
              run_id: 'run-handoff',
              trace_id: 'trace-handoff',
              status: 'completed',
              model: 'gpt-5',
              token_counts: { conversation: 240 },
              started_at: '2026-03-08T09:00:00.000Z',
              completed_at: '2026-03-08T09:00:12.750Z',
              created_at: '2026-03-08T09:00:00.000Z',
              updated_at: '2026-03-08T09:00:12.750Z',
              user_message: {
                _id: 'msg-1',
                role: 'user',
                content: 'Summarize the migration work',
                created_at: '2026-03-08T09:00:00.000Z',
              },
              assistant_message: {
                _id: 'msg-2',
                role: 'assistant',
                content: 'Recovered canonical answer.',
                created_at: '2026-03-08T09:00:12.800Z',
              },
              run: {
                id: 'run-handoff',
                workspace_id: 'ws-1',
                conversation_id: 'conv-1',
                turn_id: 'turn-live',
                trace_id: 'trace-handoff',
                user_prompt: 'Summarize the migration work',
                model: 'gpt-5',
                status: 'completed',
                step_count: 1,
                final_answer: 'Recovered canonical answer.',
                created_at: '2026-03-08T09:00:10.000Z',
                updated_at: '2026-03-08T09:00:12.750Z',
              },
              trace: {
                id: 'trace-handoff',
                turn_id: 'turn-live',
                conversation_id: 'conv-1',
                workspace_id: 'ws-1',
                run_id: 'run-handoff',
                status: 'completed',
                latest_seq: 3,
                raw_debug_enabled: true,
                summary: { trace_id: 'trace-handoff', step_count: 1, latest_event_type: 'turn.completed' },
                created_at: '2026-03-08T09:00:10.000Z',
                updated_at: '2026-03-08T09:00:12.750Z',
              },
            },
          ],
        },
      });
      return;
    }

    if (pathname === '/api/runs/run-handoff/steps' && method === 'GET') {
      await route.fulfill({
        json: {
          steps: [
            {
              id: 'step-1',
              run_id: 'run-handoff',
              step_index: 1,
              thought: 'Writing the final summary.',
              code: 'print("done")',
              stdout: 'done',
              stderr: '',
              exit_code: 0,
              artifacts: [],
              next_step_needed: false,
              duration_ms: 10,
              created_at: '2026-03-08T09:00:12.600Z',
            },
          ],
        },
      });
      return;
    }

    if (pathname === '/api/runs/run-handoff/events' && method === 'GET') {
      const body = [
        'id: 1',
        'data: {"id":"evt-1","run_id":"run-handoff","trace_id":"trace-handoff","turn_id":"turn-live","seq":1,"type":"turn.started","scope":"run","payload":{"turn_id":"turn-live"},"ui_payload":{"turn_id":"turn-live"},"created_at":"2026-03-08T09:00:11.000Z"}',
        '',
        'id: 2',
        'data: {"id":"evt-2","run_id":"run-handoff","trace_id":"trace-handoff","turn_id":"turn-live","seq":2,"type":"answer.delta","scope":"run","payload":{"chunk":"Draft answer"},"ui_payload":{"chunk":"Draft answer"},"created_at":"2026-03-08T09:00:12.700Z"}',
        '',
        'id: 3',
        'data: {"id":"evt-3","run_id":"run-handoff","trace_id":"trace-handoff","turn_id":"turn-live","seq":3,"type":"answer.reset","scope":"run","payload":{"reason":"fallback_replay"},"ui_payload":{"reason":"fallback_replay"},"created_at":"2026-03-08T09:00:12.710Z"}',
        '',
        'id: 4',
        'data: {"id":"evt-4","run_id":"run-handoff","trace_id":"trace-handoff","turn_id":"turn-live","seq":4,"type":"answer.delta","scope":"run","payload":{"chunk":"Recovered canonical answer."},"ui_payload":{"chunk":"Recovered canonical answer."},"created_at":"2026-03-08T09:00:12.720Z"}',
        '',
        'id: 5',
        'data: {"id":"evt-5","run_id":"run-handoff","trace_id":"trace-handoff","turn_id":"turn-live","seq":5,"type":"turn.completed","scope":"run","payload":{"status":"completed","final_answer":"Recovered canonical answer."},"ui_payload":{"status":"completed","final_answer":"Recovered canonical answer."},"created_at":"2026-03-08T09:00:12.750Z"}',
        '',
      ].join('\n');
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
      return;
    }

    await route.fulfill({ status: 404, json: { detail: `Unhandled route ${method} ${pathname}` } });
  });

  await page.goto('/workspaces/ws-1/chats/conv-1');
  await expect(page.getByText('Recovered canonical answer.').first()).toBeVisible();
  await expect(page.getByText('Draft answer')).toHaveCount(0);
  await expect(page.locator('[data-live-run-response]')).toHaveCount(0);
  await expect(page.getByText('Recovered canonical answer.')).toHaveCount(1);
});

test('does not auto-open activity on mobile during a live run', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });

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
      await route.fulfill({ json: { files: [] } });
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

    if (pathname === '/api/conversations/conv-1/turns' && method === 'GET') {
      await route.fulfill({
        json: {
          turns: [
            {
              conversation_id: 'conv-1',
              workspace_id: 'ws-1',
              id: 'turn-live',
              user_message_id: 'msg-1',
              assistant_message_id: null,
              run_id: 'run-live',
              trace_id: 'trace-live',
              status: 'running',
              model: 'gpt-5',
              token_counts: {},
              started_at: '2026-03-08T09:00:00.000Z',
              completed_at: null,
              created_at: '2026-03-08T09:00:00.000Z',
              updated_at: '2026-03-08T09:00:12.000Z',
              user_message: {
                _id: 'msg-1',
                role: 'user',
                content: 'Build the migration plan',
                created_at: '2026-03-08T09:00:00.000Z',
              },
              assistant_message: null,
              run: {
                id: 'run-live',
                workspace_id: 'ws-1',
                conversation_id: 'conv-1',
                turn_id: 'turn-live',
                trace_id: 'trace-live',
                user_prompt: 'Build the migration plan',
                model: 'gpt-5',
                status: 'running',
                step_count: 0,
                final_answer: null,
                created_at: '2026-03-08T09:00:10.000Z',
                updated_at: '2026-03-08T09:00:12.000Z',
              },
              trace: {
                id: 'trace-live',
                turn_id: 'turn-live',
                conversation_id: 'conv-1',
                workspace_id: 'ws-1',
                run_id: 'run-live',
                status: 'running',
                latest_seq: 0,
                raw_debug_enabled: true,
                summary: { trace_id: 'trace-live', step_count: 0, latest_event_type: 'run.queued' },
                created_at: '2026-03-08T09:00:10.000Z',
                updated_at: '2026-03-08T09:00:12.000Z',
              },
            },
          ],
        },
      });
      return;
    }

    if (pathname === '/api/runs/run-live/steps' && method === 'GET') {
      await route.fulfill({ json: { steps: [] } });
      return;
    }

    if (pathname === '/api/runs/run-live/events' && method === 'GET') {
      const body = [
        'id: 1',
        'data: {"id":"evt-1","run_id":"run-live","trace_id":"trace-live","turn_id":"turn-live","seq":1,"type":"turn.started","scope":"run","payload":{"turn_id":"turn-live","conversation_id":"conv-1","workspace_id":"ws-1","user_prompt":"Build the migration plan"},"ui_payload":{"turn_id":"turn-live","conversation_id":"conv-1","workspace_id":"ws-1","user_prompt":"Build the migration plan"},"created_at":"2026-03-08T09:00:11.000Z"}',
        '',
        'id: 2',
        'data: {"id":"evt-2","run_id":"run-live","trace_id":"trace-live","turn_id":"turn-live","seq":2,"type":"thought.updated","scope":"run","payload":{"thought":"Inspecting the current frontend structure.","action":"code","step_index":1},"ui_payload":{"thought":"Inspecting the current frontend structure.","action":"code","step_index":1},"created_at":"2026-03-08T09:00:12.000Z"}',
        '',
        'id: 3',
        'data: {"id":"evt-3","run_id":"run-live","trace_id":"trace-live","turn_id":"turn-live","seq":3,"type":"step.started","scope":"run","payload":{"step_index":1,"thought":"Inspecting the current frontend structure.","status":"running"},"ui_payload":{"step_index":1,"thought":"Inspecting the current frontend structure.","status":"running"},"created_at":"2026-03-08T09:00:12.100Z"}',
        '',
        'id: 4',
        'data: {"id":"evt-4","run_id":"run-live","trace_id":"trace-live","turn_id":"turn-live","seq":4,"type":"step.code.delta","scope":"run","payload":{"step_index":1,"chunk":"print(\\"hello\\")"},"ui_payload":{"step_index":1,"chunk":"print(\\"hello\\")"},"created_at":"2026-03-08T09:00:12.200Z"}',
        '',
      ].join('\n');
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
      return;
    }

    await route.fulfill({ status: 404, json: { detail: `Unhandled route ${method} ${pathname}` } });
  });

  await page.goto('/workspaces/ws-1/chats/conv-1');
  await expect(page.getByRole('heading', { name: 'Workspace companion' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Companion' }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Companion' }).first().click();
  await expect(page.getByRole('heading', { name: 'Workspace companion' }).first()).toBeVisible();
});

test('opens the mobile companion sheet from the companion trigger', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });

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
      await route.fulfill({ json: { files: [] } });
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

    if (pathname === '/api/conversations/conv-1/turns' && method === 'GET') {
      await route.fulfill({
        json: {
          turns: [
            {
              conversation_id: 'conv-1',
              workspace_id: 'ws-1',
              id: 'turn-1',
              user_message_id: 'msg-1',
              assistant_message_id: 'msg-2',
              run_id: 'run-1',
              trace_id: 'trace-1',
              status: 'completed',
              model: 'gpt-5',
              token_counts: { conversation: 240 },
              started_at: '2026-03-08T09:00:00.000Z',
              completed_at: '2026-03-08T09:00:40.000Z',
              created_at: '2026-03-08T09:00:00.000Z',
              updated_at: '2026-03-08T09:00:40.000Z',
              user_message: {
                _id: 'msg-1',
                role: 'user',
                content: 'Build the migration plan',
                created_at: '2026-03-08T09:00:00.000Z',
              },
              assistant_message: {
                _id: 'msg-2',
                role: 'assistant',
                content: 'I mapped the frontend migration and execution steps.',
                created_at: '2026-03-08T09:00:30.000Z',
              },
              run: {
                id: 'run-1',
                workspace_id: 'ws-1',
                conversation_id: 'conv-1',
                turn_id: 'turn-1',
                trace_id: 'trace-1',
                user_prompt: 'Build the migration plan',
                model: 'gpt-5',
                status: 'completed',
                step_count: 1,
                final_answer: 'I mapped the frontend migration and execution steps.',
                created_at: '2026-03-08T09:00:10.000Z',
                updated_at: '2026-03-08T09:00:40.000Z',
              },
              trace: {
                id: 'trace-1',
                turn_id: 'turn-1',
                conversation_id: 'conv-1',
                workspace_id: 'ws-1',
                run_id: 'run-1',
                status: 'completed',
                latest_seq: 6,
                raw_debug_enabled: true,
                summary: { trace_id: 'trace-1', step_count: 1, latest_event_type: 'turn.completed' },
                created_at: '2026-03-08T09:00:10.000Z',
                updated_at: '2026-03-08T09:00:40.000Z',
              },
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
              artifacts: [{ name: 'audit.md', content_type: 'text/markdown', size_bytes: 1024 }],
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
  await expect(page.getByRole('button', { name: 'Results' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Companion' }).first().click();
  await expect(page.getByRole('heading', { name: 'Workspace companion' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Code' }).first()).toBeVisible();
  await expect(page.getByText('print("hello")').first()).toBeVisible();
  await expect(page.getByText('audit.md').first()).toBeVisible();
});

test('silently reconnects between steps without duplicating replayed events', async ({ page }) => {
  let eventStreamAttempts = 0;

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
      await route.fulfill({ json: { files: [] } });
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

    if (pathname === '/api/conversations/conv-1/turns' && method === 'GET') {
      await route.fulfill({
        json: {
          turns: [
            {
              conversation_id: 'conv-1',
              workspace_id: 'ws-1',
              id: 'turn-live',
              user_message_id: 'msg-1',
              assistant_message_id: null,
              run_id: 'run-reconnect',
              trace_id: 'trace-reconnect',
              status: 'running',
              model: 'gpt-5',
              token_counts: {},
              started_at: '2026-03-08T09:00:00.000Z',
              completed_at: null,
              created_at: '2026-03-08T09:00:00.000Z',
              updated_at: '2026-03-08T09:00:12.000Z',
              user_message: {
                _id: 'msg-1',
                role: 'user',
                content: 'Build the migration plan',
                created_at: '2026-03-08T09:00:00.000Z',
              },
              assistant_message: null,
              run: {
                id: 'run-reconnect',
                workspace_id: 'ws-1',
                conversation_id: 'conv-1',
                turn_id: 'turn-live',
                trace_id: 'trace-reconnect',
                user_prompt: 'Build the migration plan',
                model: 'gpt-5',
                status: 'running',
                step_count: 0,
                final_answer: null,
                created_at: '2026-03-08T09:00:10.000Z',
                updated_at: '2026-03-08T09:00:12.000Z',
              },
              trace: {
                id: 'trace-reconnect',
                turn_id: 'turn-live',
                conversation_id: 'conv-1',
                workspace_id: 'ws-1',
                run_id: 'run-reconnect',
                status: 'running',
                latest_seq: 0,
                raw_debug_enabled: true,
                summary: { trace_id: 'trace-reconnect', step_count: 0, latest_event_type: 'run.queued' },
                created_at: '2026-03-08T09:00:10.000Z',
                updated_at: '2026-03-08T09:00:12.000Z',
              },
            },
          ],
        },
      });
      return;
    }

    if (pathname === '/api/runs/run-reconnect/steps' && method === 'GET') {
      await route.fulfill({ json: { steps: [] } });
      return;
    }

    if (pathname === '/api/runs/run-reconnect/events' && method === 'GET') {
      eventStreamAttempts += 1;
      if (eventStreamAttempts === 1) {
        const body = [
          'id: 1',
          'data: {"id":"evt-1","run_id":"run-reconnect","trace_id":"trace-reconnect","turn_id":"turn-live","seq":1,"type":"turn.started","scope":"run","payload":{"turn_id":"turn-live","conversation_id":"conv-1","workspace_id":"ws-1","user_prompt":"Build the migration plan"},"ui_payload":{"turn_id":"turn-live","conversation_id":"conv-1","workspace_id":"ws-1","user_prompt":"Build the migration plan"},"created_at":"2026-03-08T09:00:11.000Z"}',
          '',
          'id: 2',
          'data: {"id":"evt-2","run_id":"run-reconnect","trace_id":"trace-reconnect","turn_id":"turn-live","seq":2,"type":"thought.updated","scope":"run","payload":{"thought":"Inspecting the current frontend structure.","action":"code","step_index":1},"ui_payload":{"thought":"Inspecting the current frontend structure.","action":"code","step_index":1},"created_at":"2026-03-08T09:00:12.000Z"}',
          '',
          'id: 3',
          'data: {"id":"evt-3","run_id":"run-reconnect","trace_id":"trace-reconnect","turn_id":"turn-live","seq":3,"type":"step.started","scope":"run","payload":{"step_index":1,"thought":"Inspecting the current frontend structure.","status":"running"},"ui_payload":{"step_index":1,"thought":"Inspecting the current frontend structure.","status":"running"},"created_at":"2026-03-08T09:00:12.100Z"}',
          '',
          'id: 4',
          'data: {"id":"evt-4","run_id":"run-reconnect","trace_id":"trace-reconnect","turn_id":"turn-live","seq":4,"type":"step.code.delta","scope":"run","payload":{"step_index":1,"chunk":"print(\\"hello\\")"},"ui_payload":{"step_index":1,"chunk":"print(\\"hello\\")"},"created_at":"2026-03-08T09:00:12.200Z"}',
          '',
          'id: 5',
          'data: {"id":"evt-5","run_id":"run-reconnect","trace_id":"trace-reconnect","turn_id":"turn-live","seq":5,"type":"step.stdout.delta","scope":"run","payload":{"step_index":1,"chunk":"hello"},"ui_payload":{"step_index":1,"chunk":"hello"},"created_at":"2026-03-08T09:00:12.300Z"}',
          '',
          'id: 6',
          'data: {"id":"evt-6","run_id":"run-reconnect","trace_id":"trace-reconnect","turn_id":"turn-live","seq":6,"type":"step.completed","scope":"run","payload":{"step_index":1,"thought":"Inspecting the current frontend structure.","code":"print(\\"hello\\")","stdout":"hello","stderr":"","exit_code":0,"artifacts":[{"name":"audit.md"}],"duration_ms":10,"created_at":"2026-03-08T09:00:12.400Z","status":"completed"},"ui_payload":{"step_index":1,"thought":"Inspecting the current frontend structure.","code":"print(\\"hello\\")","stdout":"hello","stderr":"","exit_code":0,"artifacts":[{"name":"audit.md"}],"duration_ms":10,"created_at":"2026-03-08T09:00:12.400Z","status":"completed"},"created_at":"2026-03-08T09:00:12.400Z"}',
          '',
          'id: 7',
          'data: {"id":"evt-7","run_id":"run-reconnect","trace_id":"trace-reconnect","turn_id":"turn-live","seq":7,"type":"thought.updated","scope":"run","payload":{"thought":"Preparing a second verification step.","action":"code","step_index":2},"ui_payload":{"thought":"Preparing a second verification step.","action":"code","step_index":2},"created_at":"2026-03-08T09:00:12.450Z"}',
          '',
        ].join('\n');
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
        return;
      }

      const body = [
        'id: 6',
        'data: {"id":"evt-6-dup","run_id":"run-reconnect","trace_id":"trace-reconnect","turn_id":"turn-live","seq":6,"type":"step.completed","scope":"run","payload":{"step_index":1,"thought":"Inspecting the current frontend structure.","code":"print(\\"hello\\")","stdout":"hello","stderr":"","exit_code":0,"artifacts":[{"name":"audit.md"}],"duration_ms":10,"created_at":"2026-03-08T09:00:12.400Z","status":"completed"},"ui_payload":{"step_index":1,"thought":"Inspecting the current frontend structure.","code":"print(\\"hello\\")","stdout":"hello","stderr":"","exit_code":0,"artifacts":[{"name":"audit.md"}],"duration_ms":10,"created_at":"2026-03-08T09:00:12.400Z","status":"completed"},"created_at":"2026-03-08T09:00:12.400Z"}',
        '',
        'id: 7',
        'data: {"id":"evt-7-dup","run_id":"run-reconnect","trace_id":"trace-reconnect","turn_id":"turn-live","seq":7,"type":"thought.updated","scope":"run","payload":{"thought":"Preparing a second verification step.","action":"code","step_index":2},"ui_payload":{"thought":"Preparing a second verification step.","action":"code","step_index":2},"created_at":"2026-03-08T09:00:12.450Z"}',
        '',
        'id: 8',
        'data: {"id":"evt-8","run_id":"run-reconnect","trace_id":"trace-reconnect","turn_id":"turn-live","seq":8,"type":"step.started","scope":"run","payload":{"step_index":2,"thought":"Preparing a second verification step.","status":"running"},"ui_payload":{"step_index":2,"thought":"Preparing a second verification step.","status":"running"},"created_at":"2026-03-08T09:00:12.500Z"}',
        '',
        'id: 9',
        'data: {"id":"evt-9","run_id":"run-reconnect","trace_id":"trace-reconnect","turn_id":"turn-live","seq":9,"type":"step.code.delta","scope":"run","payload":{"step_index":2,"chunk":"print(\\"world\\")"},"ui_payload":{"step_index":2,"chunk":"print(\\"world\\")"},"created_at":"2026-03-08T09:00:12.550Z"}',
        '',
        'id: 10',
        'data: {"id":"evt-10","run_id":"run-reconnect","trace_id":"trace-reconnect","turn_id":"turn-live","seq":10,"type":"step.stdout.delta","scope":"run","payload":{"step_index":2,"chunk":"world"},"ui_payload":{"step_index":2,"chunk":"world"},"created_at":"2026-03-08T09:00:12.600Z"}',
        '',
        'id: 11',
        'data: {"id":"evt-11","run_id":"run-reconnect","trace_id":"trace-reconnect","turn_id":"turn-live","seq":11,"type":"step.completed","scope":"run","payload":{"step_index":2,"thought":"Preparing a second verification step.","code":"print(\\"world\\")","stdout":"world","stderr":"","exit_code":0,"artifacts":[{"name":"summary.txt"}],"duration_ms":8,"created_at":"2026-03-08T09:00:12.650Z","status":"completed"},"ui_payload":{"step_index":2,"thought":"Preparing a second verification step.","code":"print(\\"world\\")","stdout":"world","stderr":"","exit_code":0,"artifacts":[{"name":"summary.txt"}],"duration_ms":8,"created_at":"2026-03-08T09:00:12.650Z","status":"completed"},"created_at":"2026-03-08T09:00:12.650Z"}',
        '',
        'id: 12',
        'data: {"id":"evt-12","run_id":"run-reconnect","trace_id":"trace-reconnect","turn_id":"turn-live","seq":12,"type":"answer.delta","scope":"run","payload":{"chunk":"Recovered answer."},"ui_payload":{"chunk":"Recovered answer."},"created_at":"2026-03-08T09:00:12.700Z"}',
        '',
        'id: 12',
        'data: {"id":"evt-12-dup","run_id":"run-reconnect","trace_id":"trace-reconnect","turn_id":"turn-live","seq":12,"type":"answer.delta","scope":"run","payload":{"chunk":"Recovered answer."},"ui_payload":{"chunk":"Recovered answer."},"created_at":"2026-03-08T09:00:12.700Z"}',
        '',
        'id: 13',
        'data: {"id":"evt-13","run_id":"run-reconnect","trace_id":"trace-reconnect","turn_id":"turn-live","seq":13,"type":"turn.completed","scope":"run","payload":{"status":"completed","final_answer":"Recovered answer."},"ui_payload":{"status":"completed","final_answer":"Recovered answer."},"created_at":"2026-03-08T09:00:12.750Z"}',
        '',
      ].join('\n');
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
      return;
    }

    await route.fulfill({ status: 404, json: { detail: `Unhandled route ${method} ${pathname}` } });
  });

  await page.goto('/workspaces/ws-1/chats/conv-1');
  await expect(page.getByRole('button', { name: /Step 1/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Step 2/i }).first()).toBeVisible();
  await expect(page.getByText('summary.txt').first()).toBeVisible();
  await page.getByRole('button', { name: /Step 1/i }).first().click();
  await expect(page.getByText('audit.md').first()).toBeVisible();
  await expect(page.locator('[data-live-run-response]')).toHaveCount(1);
  await expect(page.getByText('Recovered answer.').first()).toBeVisible();
  await expect(page.getByText('Inspecting the current frontend structure.').first()).toBeVisible();
});

test('surfaces reconnect failure without wiping prior streamed progress', async ({ page }) => {
  let eventStreamAttempts = 0;

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
      await route.fulfill({ json: { files: [] } });
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

    if (pathname === '/api/conversations/conv-1/turns' && method === 'GET') {
      await route.fulfill({
        json: {
          turns: [
            {
              conversation_id: 'conv-1',
              workspace_id: 'ws-1',
              id: 'turn-live',
              user_message_id: 'msg-1',
              assistant_message_id: null,
              run_id: 'run-fail-reconnect',
              trace_id: 'trace-fail-reconnect',
              status: 'running',
              model: 'gpt-5',
              token_counts: {},
              started_at: '2026-03-08T09:00:00.000Z',
              completed_at: null,
              created_at: '2026-03-08T09:00:00.000Z',
              updated_at: '2026-03-08T09:00:12.000Z',
              user_message: {
                _id: 'msg-1',
                role: 'user',
                content: 'Build the migration plan',
                created_at: '2026-03-08T09:00:00.000Z',
              },
              assistant_message: null,
              run: {
                id: 'run-fail-reconnect',
                workspace_id: 'ws-1',
                conversation_id: 'conv-1',
                turn_id: 'turn-live',
                trace_id: 'trace-fail-reconnect',
                user_prompt: 'Build the migration plan',
                model: 'gpt-5',
                status: 'running',
                step_count: 0,
                final_answer: null,
                created_at: '2026-03-08T09:00:10.000Z',
                updated_at: '2026-03-08T09:00:12.000Z',
              },
              trace: {
                id: 'trace-fail-reconnect',
                turn_id: 'turn-live',
                conversation_id: 'conv-1',
                workspace_id: 'ws-1',
                run_id: 'run-fail-reconnect',
                status: 'running',
                latest_seq: 0,
                raw_debug_enabled: true,
                summary: { trace_id: 'trace-fail-reconnect', step_count: 0, latest_event_type: 'run.queued' },
                created_at: '2026-03-08T09:00:10.000Z',
                updated_at: '2026-03-08T09:00:12.000Z',
              },
            },
          ],
        },
      });
      return;
    }

    if (pathname === '/api/runs/run-fail-reconnect/steps' && method === 'GET') {
      await route.fulfill({ json: { steps: [] } });
      return;
    }

    if (pathname === '/api/runs/run-fail-reconnect/events' && method === 'GET') {
      eventStreamAttempts += 1;

      if (eventStreamAttempts === 1) {
        const body = [
          'id: 1',
          'data: {"id":"evt-1","run_id":"run-fail-reconnect","trace_id":"trace-fail-reconnect","turn_id":"turn-live","seq":1,"type":"turn.started","scope":"run","payload":{"turn_id":"turn-live","conversation_id":"conv-1","workspace_id":"ws-1","user_prompt":"Build the migration plan"},"ui_payload":{"turn_id":"turn-live","conversation_id":"conv-1","workspace_id":"ws-1","user_prompt":"Build the migration plan"},"created_at":"2026-03-08T09:00:11.000Z"}',
          '',
          'id: 2',
          'data: {"id":"evt-2","run_id":"run-fail-reconnect","trace_id":"trace-fail-reconnect","turn_id":"turn-live","seq":2,"type":"thought.updated","scope":"run","payload":{"thought":"Inspecting the current frontend structure.","action":"code","step_index":1},"ui_payload":{"thought":"Inspecting the current frontend structure.","action":"code","step_index":1},"created_at":"2026-03-08T09:00:12.000Z"}',
          '',
          'id: 3',
          'data: {"id":"evt-3","run_id":"run-fail-reconnect","trace_id":"trace-fail-reconnect","turn_id":"turn-live","seq":3,"type":"step.started","scope":"run","payload":{"step_index":1,"thought":"Inspecting the current frontend structure.","status":"running"},"ui_payload":{"step_index":1,"thought":"Inspecting the current frontend structure.","status":"running"},"created_at":"2026-03-08T09:00:12.100Z"}',
          '',
          'id: 4',
          'data: {"id":"evt-4","run_id":"run-fail-reconnect","trace_id":"trace-fail-reconnect","turn_id":"turn-live","seq":4,"type":"step.code.delta","scope":"run","payload":{"step_index":1,"chunk":"print(\\"hello\\")"},"ui_payload":{"step_index":1,"chunk":"print(\\"hello\\")"},"created_at":"2026-03-08T09:00:12.200Z"}',
          '',
        ].join('\n');
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
        return;
      }

      await route.fulfill({ status: 503, json: { detail: 'stream temporarily unavailable' } });
      return;
    }

    await route.fulfill({ status: 404, json: { detail: `Unhandled route ${method} ${pathname}` } });
  });

  await page.goto('/workspaces/ws-1/chats/conv-1');
  await expect(page.getByRole('button', { name: /Step 1/i }).first()).toBeVisible();
  await expect(page.getByText('stream temporarily unavailable').first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Inspecting the current frontend structure.').first()).toBeVisible();
});
