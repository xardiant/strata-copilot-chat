# Strata for Copilot Chat

Use models served by [Strata](https://github.com/Niko1221/Strata) inside GitHub Copilot Chat, the same way the LM Studio integration works.

![Strata for Copilot Chat](icon.png)

## Requirements

- Strata running with a model **loaded** (the app's Models page should show the model as loaded).
- VS Code 1.104 or newer with GitHub Copilot Chat.
- A Strata model with image support for picture input.

## Setup

1. Install the extension.
2. Open Copilot Chat, open the model picker, and choose **Manage Models**.
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

## Features

- **Text chat** — streams Strata replies into Copilot Chat.
- **Tool calling** — OpenAI-style function calls and tool results.
- **Image input** — pictures attached to the chat are converted to OpenAI `image_url` parts, and images returned by tools are passed back to Strata. The Strata model needs image support for this to work.
- **Model refresh** — the `Strata: Refresh Models` command re-reads the model list from Strata.

## Known issue: models disappear after Strata is closed

When Strata is closed, Copilot Chat may not rediscover the **Strata for Copilot Chat** provider. The Strata models then disappear from the model picker until the "Strata (local)" integration is disabled and enabled again, or the **Strata: Refresh Models** command is run. The extension also reports models again once the extension host finishes starting and on any Strata setting change, which fixes the startup race in VS Code 1.104+.

## Notes

- Only models Strata reports as `loaded` are offered.
- The extension sets `imageInput: true`; if the selected Strata model has no vision support, requests with images fail at the model level.

## Development

- `npm test` runs the unit tests (stubbed `vscode` module, no VS Code needed).
