import { expect, test } from '@playwright/test';

test('creates a chat, streams the response, and updates the token counter', async ({ page }) => {
  const state = {
    maxContextTokens: 120000,
    conversations: [] as Array<{
      _id: string;
      title: string;
      created_at: string;
      updated_at: string;
      token_count?: number;
      workspace_id?: string | null;
    }>,
    messages: new Map<string, Array<{ _id: string; role: 'user' | 'assistant'; content: string; thinking?: string; created_at: string }>>(),
  };

  await page.route('http://localhost:8000/api/**', async route => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    const method = route.request().method();

    if (pathname === '/api/config' && method === 'GET') {
      await route.fulfill({ json: { max_context_tokens: state.maxContextTokens, default_model: 'gpt-5' } });
      return;
    }

    if (pathname === '/api/workspaces' && method === 'GET') {
      await route.fulfill({ json: [] });
      return;
    }

    if (pathname === '/api/conversations' && method === 'GET') {
      await route.fulfill({ json: state.conversations });
      return;
    }

    if (pathname === '/api/conversations' && method === 'POST') {
      const payload = JSON.parse(route.request().postData() || '{}');
      const conversation = {
        _id: 'conv-1',
        title: payload.title,
        created_at: '2026-03-08T09:00:00.000Z',
        updated_at: '2026-03-08T09:00:00.000Z',
        token_count: 0,
        workspace_id: null,
      };
      state.conversations = [conversation];
      state.messages.set(conversation._id, []);
      await route.fulfill({ json: conversation });
      return;
    }

    if (pathname === '/api/conversations/conv-1' && method === 'GET') {
      await route.fulfill({ json: state.conversations[0] });
      return;
    }

    if (pathname === '/api/conversations/conv-1/messages' && method === 'GET') {
      await route.fulfill({ json: state.messages.get('conv-1') ?? [] });
      return;
    }

    if (pathname === '/api/chat' && method === 'POST') {
      const payload = JSON.parse(route.request().postData() || '{}');
      const now = '2026-03-08T09:01:00.000Z';
      state.messages.set('conv-1', [
        { _id: 'user-1', role: 'user', content: payload.message, created_at: now },
        {
          _id: 'assistant-1',
          role: 'assistant',
          content: 'Atlas is ready.',
          thinking: 'Inspecting the problem before responding.',
          created_at: now,
        },
      ]);
      state.conversations = state.conversations.map(conversation =>
        conversation._id === 'conv-1'
          ? { ...conversation, updated_at: now, token_count: 42 }
          : conversation
      );
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: [
          'data: {"type":"content","content":"Atlas is ready."}',
          '',
          'data: {"type":"thinking","content":"Inspecting the problem before responding."}',
          '',
          'data: {"type":"token_count","count":42}',
          '',
          'data: [DONE]',
          '',
        ].join('\n'),
      });
      return;
    }

    await route.fulfill({ status: 404, json: { detail: `Unhandled route ${method} ${pathname}` } });
  });

  await page.goto('/chat');
  await page.getByPlaceholder('Ask anything...').fill('Plan the migration');
  await page.getByRole('button', { name: /send/i }).click();

  await expect(page).toHaveURL(/\/chat\/conv-1$/);
  await expect(page.getByRole('heading', { name: 'Plan the migration' })).toBeVisible();
  await expect(page.getByText('Atlas is ready.')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Thought Process' }).first()).toBeVisible();
  await expect(page.getByText('42 / 120,000')).toBeVisible();
});
