'use strict';

const vscode = require('vscode');

const VENDOR = 'strata';

function getSettings() {
    const cfg = vscode.workspace.getConfiguration('strata');
    return {
        baseUrl: (cfg.get('baseUrl') || 'http://127.0.0.1:47831/v1').replace(/\/+$/, ''),
        apiKey: cfg.get('apiKey') || '',
        // 0 means "detect from Strata"; a positive value is an explicit override.
        maxOutputTokens: cfg.get('maxOutputTokens') || 0,
        contextWindow: cfg.get('contextWindow') || 0,
    };
}

function apiRoot(baseUrl) {
    return baseUrl.replace(/\/v1\/?$/, '');
}

// Strata's local output budget: 30% of the window, at least 4096 and at most 32768.
function localOutputBudget(context) {
    const c = Number.isFinite(context) && context > 0 ? Math.floor(context) : 32768;
    return Math.max(4096, Math.min(32768, Math.floor(c * 0.3)));
}

async function fetchStrataNative(settings) {
    const res = await fetch(`${apiRoot(settings.baseUrl)}/api/native`, { headers: headers(settings) });
    if (!res.ok)
        throw new Error(`Strata /api/native returned HTTP ${res.status}`);
    return res.json();
}

function detectModelLimits(native, modelId, settings) {
    const instances = Array.isArray(native.instances) ? native.instances : [];
    const installed = native.installed && Array.isArray(native.installed.models) ? native.installed.models : [];
    const instance = instances.find(i =>
        i.apiModelId === modelId || (Array.isArray(i.aliases) && i.aliases.includes(modelId)));
    const model = installed.find(m => m.model === modelId || m.model_name === modelId);
    const detectedContext = instance && Number.isFinite(instance.context) && instance.context > 0
        ? instance.context
        : model && Number.isFinite(model.context) && model.context > 0
            ? model.context
            : model && Number.isFinite(model.contextMax) && model.contextMax > 0
                ? model.contextMax
                : 0;
    const context = settings.contextWindow > 0 ? settings.contextWindow : detectedContext || 32768;
    const vision = model
        ? model.visionEnabled === true && model.picturesMissing === false
        : instance && instance.metrics && instance.metrics.engine
            ? instance.metrics.engine.images === true
            : true;
    const output = settings.maxOutputTokens > 0 ? settings.maxOutputTokens : localOutputBudget(context);
    return { context: Math.floor(context), output: Math.floor(output), vision };
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

// VS Code image parts: LanguageModelDataPart (proposed API) wraps { mimeType, data } bytes.
function imageOf(part) {
    if (part instanceof vscode.LanguageModelDataPart)
        return { mimeType: part.mimeType, data: part.data };
    if (typeof part === 'object' && part !== null && typeof part.mimeType === 'string' && part.data)
        return { mimeType: part.mimeType, data: part.data };
    return null;
}

function toBase64(bytes) {
    let view = null;
    if (bytes instanceof Uint8Array) {
        view = bytes;
    } else if (ArrayBuffer.isView(bytes)) {
        view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    } else if (typeof bytes === 'string') {
        view = Buffer.from(bytes, 'base64');
    } else if (bytes && typeof bytes.buffer === 'object' && bytes.offset !== undefined && bytes.size !== undefined) {
        view = new Uint8Array(bytes.buffer, bytes.offset, bytes.size);
    } else {
        return null;
    }
    return Buffer.from(view).toString('base64');
}

function imagePartToOpenAI(part) {
    const img = imageOf(part);
    if (!img)
        return null;
    if (!img.mimeType.startsWith('image/'))
        return null;
    const b64 = toBase64(img.data);
    if (b64 === null)
        return null;
    return { type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${b64}` } };
}

// Convert VS Code chat messages to OpenAI chat-completions messages.
function toOpenAIMessages(messages) {
    const out = [];
    for (const msg of messages) {
        const isAssistant = msg.role === vscode.LanguageModelChatMessageRole.Assistant;
        const texts = [];
        const images = [];
        const toolCalls = [];
        const toolResults = [];
        const parts = typeof msg.content === 'string' ? [msg.content] : msg.content;
        for (const part of parts) {
            if (part instanceof vscode.LanguageModelToolCallPart) {
                toolCalls.push({
                    id: part.callId,
                    type: 'function',
                    function: { name: part.name, arguments: JSON.stringify(part.input ?? {}) },
                });
            } else if (part instanceof vscode.LanguageModelToolResultPart) {
                const content = [];
                for (const c of part.content || []) {
                    const img = imagePartToOpenAI(c);
                    if (img) {
                        content.push(img);
                        continue;
                    }
                    const t = textOf(c) ?? (typeof c === 'string' ? c : '');
                    if (t.length > 0)
                        content.push(t);
                }
                toolResults.push({
                    role: 'tool',
                    tool_call_id: part.callId,
                    content: content.length === 1 && typeof content[0] === 'string' ? content[0] : content,
                });
            } else {
                const img = imagePartToOpenAI(part);
                if (img) {
                    images.push(img);
                    continue;
                }
                const t = textOf(part);
                if (t !== null && t.length > 0)
                    texts.push(t);
                else if (typeof part === 'string' && part.length > 0)
                    texts.push(part);
            }
        }
        // OpenAI expects tool results as their own messages, placed before the next turn.
        out.push(...toolResults);
        if (isAssistant) {
            if (texts.length === 0 && toolCalls.length === 0 && images.length === 0)
                continue;
            const m = { role: 'assistant' };
            if (texts.length || images.length)
                m.content = images.length ? [...texts, ...images] : texts.join('');
            if (toolCalls.length)
                m.tool_calls = toolCalls;
            out.push(m);
        } else if (texts.length || images.length) {
            out.push({ role: 'user', content: images.length ? [...texts, ...images] : texts.join('') });
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

        let native = null;
        if (!settings.contextWindow || !settings.maxOutputTokens) {
            try {
                native = await fetchStrataNative(settings);
            } catch (err) {
                console.warn(`Strata: cannot read model limits at ${apiRoot(settings.baseUrl)}/api/native: ${err.message}`);
            }
        }

        return models.map(m => {
            const limits = detectModelLimits(native || {}, m.id, settings);
            return {
                id: m.id,
                name: m.id,
                family: m.id,
                version: '1.0.0',
                detail: 'Strata (local)',
                tooltip: `Runs locally via Strata at ${settings.baseUrl}`,
                maxInputTokens: limits.context,
                maxOutputTokens: limits.output,
                capabilities: {
                    toolCalling: true,
                    imageInput: limits.vision,
                },
            };
        });
    }

    async provideLanguageModelChatResponse(model, messages, options, progress, token) {
        const settings = getSettings();
        const controller = new AbortController();
        const sub = token.onCancellationRequested(() => controller.abort());
        try {
            const maxTokens = Number.isFinite(model.maxOutputTokens) && model.maxOutputTokens > 0
                ? model.maxOutputTokens
                : settings.maxOutputTokens > 0
                    ? settings.maxOutputTokens
                    : localOutputBudget(Number.isFinite(model.maxInputTokens) ? model.maxInputTokens : 32768);
            const body = {
                model: model.id,
                messages: toOpenAIMessages(messages),
                stream: true,
                max_tokens: Math.floor(maxTokens),
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
        let parts;
        if (typeof text === 'string') {
            parts = [text];
        } else if (typeof text.content === 'string') {
            parts = [text.content];
        } else {
            parts = text.content || [];
        }
        const s = parts.map(p => textOf(p) ?? (typeof p === 'string' ? p : '')).join('');
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
    // Copilot Chat can keep a stale model list until the provider reports a change.
    // Re-resolve models once the extension host has finished starting, and expose a manual refresh.
    const refresh = () => provider._onDidChange.fire();
    setTimeout(refresh, 0);
    context.subscriptions.push(vscode.commands.registerCommand('strata.refreshModels', refresh));
}

function deactivate() {}

module.exports = {
    activate,
    deactivate,
    toOpenAIMessages,
    toOpenAITools,
    StrataChatProvider,
    __readStream: readStream,
    apiRoot,
    localOutputBudget,
    detectModelLimits,
};
