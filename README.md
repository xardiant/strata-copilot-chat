# Strata for Copilot Chat

Use models served by Strata directly inside GitHub Copilot Chat.

![Strata for Copilot Chat](icon.png)

## Requirements

- VS Code 1.104 or newer
- GitHub Copilot Chat
- Strata running with at least one loaded model
- A vision-capable model if you want image input

## Setup

1. Install the extension.
2. Start Strata and load a model.
3. Open Copilot Chat.
4. Open the model picker and enable **Strata**.
5. Select a Strata model and start chatting.

The default endpoint is `http://127.0.0.1:47831/v1`.

## Features

- Text chat through Strata
- Tool calling
- Image input support
- Automatic model discovery
- Automatic context window detection
- Automatic output token budgeting
- Automatic reconnect: models reappear when Strata restarts or a model finishes loading
- Manual model refresh with **Strata: Refresh Models**

## Settings

| Setting | Default |
| --- | --- |
| `strata.baseUrl` | `http://127.0.0.1:47831/v1` |
| `strata.apiKey` | empty |
| `strata.maxOutputTokens` | `0` (auto) |
| `strata.contextWindow` | `0` (auto) |
| `strata.reasoningEffort` | `default` |
| `strata.reasoningBudgetTokens` | `0` |
| `strata.fitMaxTokens` | `false` |
| `strata.temperature` | Strata default |
| `strata.topP` | Strata default |
| `strata.presencePenalty` | Strata default |
| `strata.frequencyPenalty` | Strata default |
| `strata.seed` | Strata default |
| `strata.stop` | `[]` |

## Support

- GitHub: https://github.com/xardiant/strata-copilot-chat
- Buy me a BUG for my Lizard: https://buymeacoffee.com/xardiant
- Buy me a BUG for my Lizard (Paypal): https://paypal.com/paypalme/Xardiant