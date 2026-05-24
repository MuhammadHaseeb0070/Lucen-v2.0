import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { recordUsage } from '../_shared/usage.ts';

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startedAt = Date.now();

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing auth' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { user_message, assistant_message, conversation_id, mode, text_to_summarize } = body;

    if (mode !== 'summary' && !user_message && !assistant_message) {
      return new Response(JSON.stringify({ title: null }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let prompt = '';
    if (mode === 'summary') {
      prompt = [
        'Write a concise summary (1-2 paragraphs) capturing the key points, decisions, and context of the following conversation segment.',
        'Ensure you retain important technical details, file names, or code paths mentioned.',
        '',
        text_to_summarize || '',
      ].filter(Boolean).join('\n');
    } else {
      prompt = [
        'Generate a short, descriptive title (3-6 words) for a chat conversation. Return ONLY the title text, nothing else.',
        '',
        `User: ${(user_message || '').slice(0, 500)}`,
        assistant_message ? `Assistant: ${assistant_message.slice(0, 500)}` : '',
      ].filter(Boolean).join('\n');
    }

    const titleModel = Deno.env.get('SIDE_CHAT_MODEL') || 'openai/gpt-4o-mini';

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: titleModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: mode === 'summary' ? 300 : 30,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[generate-title] upstream error:', res.status, errText);
      return new Response(JSON.stringify({ title: null, summary: null }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await res.json();
    const usage = data?.usage;
    let title = data?.choices?.[0]?.message?.content?.trim() ?? null;

    await recordUsage({
      userId: user.id,
      conversationId: conversation_id || null,
      requestId: body.request_id || null,
      callKind: mode === 'summary' ? 'summary_gen' as any : 'title_gen',
      modelId: titleModel,
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      status: title ? 'completed' : 'upstream_error',
      durationMs: Date.now() - startedAt,
    });

    if (mode === 'summary') {
      return new Response(JSON.stringify({ summary: title }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (title) {
      title = title.replace(/^["']|["']$/g, '').trim();
      if (title.length > 60) title = title.slice(0, 60);
    }

    if (title && conversation_id) {
      await supabase
        .from('conversations')
        .update({ title, title_auto: true })
        .eq('id', conversation_id)
        .eq('user_id', user.id)
        .eq('title_auto', true)
        .then(() => {});
    }

    return new Response(JSON.stringify({ title }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[generate-title] error:', err);
    return new Response(JSON.stringify({ title: null }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
