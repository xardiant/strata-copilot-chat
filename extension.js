'use strict';

const vscode = require('vscode');

const VENDOR = 'strata';

function getSettings() {
    const cfg = vscode.workspace.getConfiguration('strata');
    return {
        baseUrl: (cfg.get('baseUrl') || 'http://127.0.0.1:47831/v1').replace(/\/+$/, ''),
        apiKey: cfg.get('apiKey') || '',
        maxOutputTokens: cfg.get('maxOutputTokens') || 4096,
        contextWindow: cfg.get('contextWindow') || 131072,
    };
}

function headers(settings) {
    const h = { 'Content-Type': 'application/json' };
    if (settings.apiKey)
        h.Authorization = `Bearer ${settings.apiKey}`;
    return h;
}

function textOf(part) {
    return typeof part.value === 'string' ? part.value : null;
}

// Convert VS Code chat messages to OpenAI chat-completions messages.
function toOpenAIMessages(messages) {
    const out = [];
    for (const msg of messages) {
        const isAssistant = msg.role === vscode.LanguageModelChatMessageRole.Assistant;
        const texts = [];
        const toolCalls = [];
        const toolResults = [];
        for (const part of msg.content) {
            if (part instanceof vscode.LanguageModelToolCallPart) {
                toolCalls.push({
                    id: part.callId,
                    type: 'function',
                    function: { name: part.name, arguments: JSON.stringify(part.input ?? {}) },
                });
            } else if (part instanceof vscode.LanguageModelToolResultPart) {
                const text = (part.content || []).map(c => textOf(c) ?? '').join('');
                toolResults.push({ role: 'tool', tool_call_id: part.callId, content: text });
            } else {
                const t = textOf(part);
                if (t !== null && t.length > 0)
                    texts.push(t);
            }
        }
        // OpenAI expects tool results as their own messages, placed before the next turn.
        out.push(...toolResults);
        if (isAssistant) {
            if (texts.length === 0 && toolCalls.length === 0)
                continue;
            const m = { role: 'assistant', content: texts.join('\n') || null };
            if (toolCalls.length)
                m.tool_calls = toolCalls;
            out.push(m);
        } else if (texts.length) {
            out.push({ role: 'user', content: texts.join('\n') });
        }
    }
    return out;
}

function toOpenAITools(tools) {
    if (!tools || tools.length === 0)
        return undefined;
    return tools.map(t => ({
        type: 'function',
        function: {
            name: t.name,
            description: t.description || '',
            parameters: t.inputSchema || { type: 'object', properties: {} },
        },
    }));
}

async function fetchLoadedModels(settings) {
    const res = await fetch(`${settings.baseUrl}/models`, { headers: headers(settings) });
    if (!res.ok)
        throw new Error(`Strata /models returned HTTP ${res.status}`);
    const body = await res.json();
    // Strata reports each model's state as { value: 'loaded' | ... }; only offer models that are loaded.
    return (body.data || []).filter(m => {
        const state = m.status && typeof m.status === 'object' ? m.status.value : m.status;
        return !state || state === 'loaded';
    });
}

class StrataChatProvider {
    constructor() {
        this._onDidChange = new vscode.EventEmitter();
        this.onDidChangeLanguageModelChatInformation = this._onDidChange.event;
    }

    async provideLanguageModelChatInformation(_options, _token) {
        const settings = getSettings();
        let models;
        try {
            models = await fetchLoadedModels(settings);
        } catch (err) {
            // Strata is not running: show no models rather than failing the whole picker.
            console.warn(`Strata: cannot list models at ${settings.baseUrl}: ${err.message}`);
            return [];
        }
        return models.map(m => ({
            id: m.id,
            name: m.id,
            family: m.id,
            version: '1.0.0',
            detail: 'Strata (local)',
            tooltip: `Runs locally via Strata at ${settings.baseUrl}`,
            maxInputTokens: settings.contextWindow,
            maxOutputTokens: settings.maxOutputTokens,
            capabilities: {
                toolCalling: true,
                imageInput: false,
            },
        }));
    }

    async provideLanguageModelChatResponse(model, messages, options, progress, token) {
        const settings = getSettings();
        const controller = new AbortController();
        const sub = token.onCancellationRequested(() => controller.abort());
        try {
            const body = {
                model: model.id,
                messages: toOpenAIMessages(messages),
                stream: true,
                max_tokens: settings.maxOutputTokens,
            };
            const tools = toOpenAITools(options.tools);
            if (tools) {
                body.tools = tools;
                body.tool_choice = 'auto';
            }

            const res = await fetch(`${settings.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: headers(settings),
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`Strata returned HTTP ${res.status}: ${text.slice(0, 300)}`);
            }
            await readStream(res.body, progress);
        } catch (err) {
            if (token.isCancellationRequested)
                return;
            throw err;
        } finally {
            sub.dispose();
        }
    }

    async provideTokenCount(_model, text, _token) {
        const s = typeof text === 'string' ? text : (text.content || []).map(p => textOf(p) ?? '').join('');
        return Math.ceil(s.length / 4);
    }
}

// Parse OpenAI-style server-sent events and forward text and tool calls to Copilot.
async function readStream(body, progress) {
    const decoder = new TextDecoder();
    const pendingTools = new Map(); // tool index -> { id, name, args }
    let buffer = '';
    let finished = false;

    const flushTools = () => {
        for (const [, t] of [...pendingTools.entries()].sort((a, b) => a[0] - b[0])) {
            if (!t.name)
                continue;
            let input = {};
            try {
                input = t.args ? JSON.parse(t.args) : {};
            } catch {
                input = { _raw: t.args };
            }
            progress.report(new vscode.LanguageModelToolCallPart(t.id || `call_${Date.now()}`, t.name, input));
        }
        pendingTools.clear();
    };

    // Returns true when the stream has ended.
    const handleLine = (line) => {
        if (!line.startsWith('data:'))
            return false;
        const data = line.slice(5).trim();
        if (data === '[DONE]')
            return true;
        let chunk;
        try {
            chunk = JSON.parse(data);
        } catch {
            return false;
        }
        const choice = chunk.choices && chunk.choices[0];
        if (!choice)
            return false;
        const delta = choice.delta || {};
        if (typeof delta.content === 'string' && delta.content.length > 0)
            progress.report(new vscode.LanguageModelTextPart(delta.content));
        for (const tc of delta.tool_calls || []) {
            const idx = tc.index ?? 0;
            const entry = pendingTools.get(idx) || { id: '', name: '', args: '' };
            if (tc.id)
                entry.id = tc.id;
            if (tc.function && tc.function.name)
                entry.name = tc.function.name;
            if (tc.function && tc.function.arguments)
                entry.args += tc.function.arguments;
            pendingTools.set(idx, entry);
        }
        if (choice.finish_reason) {
            flushTools();
        }
        return false;
    };

    if (!body || typeof body.getReader !== 'function') {
        // Environments without a streaming body: parse the complete response at once.
        for (const line of (await new Response(body).text()).split('\n')) {
            if (handleLine(line.trim()))
                break;
        }
        flushTools();
        return;
    }

    const reader = body.getReader();
    while (!finished) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while (!finished && (nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            finished = handleLine(line);
        }
    }
    if (!finished && buffer.trim())
        handleLine(buffer.trim());
    flushTools();
}

function activate(context) {
    const provider = new StrataChatProvider();
    context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider(VENDOR, provider));
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('strata'))
                provider._onDidChange.fire();
        })
    );
}

function deactivate() {}

module.exports = { activate, deactivate, toOpenAIMessages, toOpenAITools, StrataChatProvider, __readStream: readStream };
