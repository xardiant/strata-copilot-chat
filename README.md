# Strata for Copilot Chat

Use models served by [Strata](https://github.com/Niko1221/Strata) inside GitHub Copilot Chat, the same way the LM Studio integration works.

## Requirements

- Strata running with a model **loaded** (the app's Models page should show the model as loaded).
- VS Code 1.104 or newer with GitHub Copilot Chat.

## Setup

1. Install the extension.
2. Open Copilot Chat, open the model picker, and choose **Manage Models…**.
3. Pick **Strata** and enable the loaded model(s).
4. Select the Strata model in the Copilot Chat model picker.

The default endpoint is `http://127.0.0.1:47831/v1` (the "API base URL" shown in the Strata app). Change it, or set an API key, in VS Code settings under **Strata**.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `strata.baseUrl` | `http://127.0.0.1:47831/v1` | Strata OpenAI-compatible API base URL |
| `strata.apiKey` | empty | Optional key; leave empty when Strata has no key |
| `strata.maxOutputTokens` | `4096` | Maximum reply length |
| `strata.contextWindow` | `131072` | Context size reported to Copilot |

## Notes

- Only models Strata reports as `loaded` are offered.
- Tool calling is supported (OpenAI-style function calls).
- Image input is not enabled yet.

## Development

- `npm test` runs the unit tests (stubbed `vscode` module, no VS Code needed).
