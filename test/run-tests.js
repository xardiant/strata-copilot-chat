'use strict';

// Unit tests for the Strata provider. The 'vscode' module is stubbed so these run under plain Node.
const Module = require('module');
const assert = require('assert');
const path = require('path');

class TextPart { constructor(value) { this.value = value; } }
class ToolCallPart { constructor(callId, name, input) { this.callId = callId; this.name = name; this.input = input; } }
class ToolResultPart { constructor(callId, content) { this.callId = callId; this.content = content; } }

const fakeVscode = {
    LanguageModelTextPart: TextPart,
    LanguageModelToolCallPart: ToolCallPart,
    LanguageModelToolResultPart: ToolResultPart,
    LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
    LanguageModelChatToolMode: { Auto: 1, Required: 2 },
    EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); } fire() {} },
    workspace: { getConfiguration: () => ({ get: () => undefined }), onDidChangeConfiguration: () => ({ dispose() {} }) },
    lm: { registerLanguageModelChatProvider: () => ({ dispose() {} }) },
};

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'vscode')
        return fakeVscode;
    return originalLoad.call(this, request, ...rest);
};

const ext = require(path.join(__dirname, '..', 'extension.js'));

let passed = 0;
function test(name, fn) {
    return Promise.resolve().then(fn).then(() => { passed++; console.log('ok   ' + name); },
        (err) => { console.error('FAIL ' + name + '\n  ' + err.message); process.exitCode = 1; });
}

function sseBody(lines) {
    const enc = new TextEncoder();
    const chunks = lines.map(l => enc.encode(l + '\n'));
    let i = 0;
    return { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }) }) };
}

async function collect(lines) {
    const reports = [];
    await ext.__readStream(sseBody(lines), { report: p => reports.push(p) });
    return reports;
}

(async () => {
    await test('user and assistant text map to OpenAI roles', () => {
        const msgs = [
            { role: 1, content: [new TextPart('hello')] },
            { role: 2, content: [new TextPart('hi there')] },
        ];
        const out = ext.toOpenAIMessages(msgs);
        assert.deepStrictEqual(out, [
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'hi there' },
        ]);
    });

    await test('assistant tool call and tool result convert to OpenAI tool messages', () => {
        const msgs = [
            { role: 2, content: [new ToolCallPart('c1', 'read_file', { path: 'a.txt' })] },
            { role: 1, content: [new ToolResultPart('c1', [new TextPart('file body')])] },
        ];
        const out = ext.toOpenAIMessages(msgs);
        assert.strictEqual(out[0].role, 'assistant');
        assert.strictEqual(out[0].tool_calls[0].id, 'c1');
        assert.strictEqual(out[0].tool_calls[0].function.name, 'read_file');
        assert.strictEqual(out[0].tool_calls[0].function.arguments, '{"path":"a.txt"}');
        assert.deepStrictEqual(out[1], { role: 'tool', tool_call_id: 'c1', content: 'file body' });
    });

    await test('tools map to OpenAI function definitions', () => {
        const out = ext.toOpenAITools([{ name: 'f', description: 'd', inputSchema: { type: 'object' } }]);
        assert.deepStrictEqual(out, [{ type: 'function', function: { name: 'f', description: 'd', parameters: { type: 'object' } } }]);
        assert.strictEqual(ext.toOpenAITools([]), undefined);
    });

    await test('streamed text deltas are reported in order', async () => {
        const reports = await collect([
            'data: {"choices":[{"delta":{"content":"Hel"}}]}',
            'data: {"choices":[{"delta":{"content":"lo"}}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
            'data: [DONE]',
        ]);
        assert.deepStrictEqual(reports.map(r => r.value), ['Hel', 'lo']);
    });

    await test('streamed tool call arguments are assembled and reported once', async () => {
        const reports = await collect([
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"t1","function":{"name":"read_file","arguments":"{\\"pa"}}]}}]}',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\\":\\"a.txt\\"}"}}]}}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
            'data: [DONE]',
        ]);
        assert.strictEqual(reports.length, 1);
        assert.ok(reports[0] instanceof ToolCallPart);
        assert.strictEqual(reports[0].callId, 't1');
        assert.strictEqual(reports[0].name, 'read_file');
        assert.deepStrictEqual(reports[0].input, { path: 'a.txt' });
    });

    await test('malformed tool arguments are kept instead of crashing', async () => {
        const reports = await collect([
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"t2","function":{"name":"x","arguments":"{bad"}}]}}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
        ]);
        assert.deepStrictEqual(reports[0].input, { _raw: '{bad' });
    });

    console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ''}`);
})();
