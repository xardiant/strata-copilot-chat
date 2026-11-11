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
| `strata.maxOutputTokens` | `0` (detected) | Maximum reply length; a positive value overrides the detected limit |
| `strata.contextWindow` | `0` (detected) | Context size reported to Copilot; a positive value overrides the detected window |

## Features

- **Text chat** — streams Strata replies into Copilot Chat.
- **Tool calling** — OpenAI-style function calls and tool results.
- **Image input** — pictures attached to the chat are converted to OpenAI `image_url` parts, and images returned by tools are passed back to Strata. The Strata model needs image support for this to work.
- **Model refresh** — the `Strata: Refresh Models` command re-reads the model list from Strata.

## Known issue: models disappear after Strata is closed

When Strata is closed, Copilot Chat may not rediscover the **Strata for Copilot Chat** provider. The Strata models then disappear from the model picker until the "Strata (local)" integration is disabled and enabled again, or the **Strata: Refresh Models** command is run. The extension also reports models again once the extension host finishes starting and on any Strata setting change, which fixes the startup race in VS Code 1.104+.

## Notes

- Only models Strata reports as `loaded` are offered.
- The context window and output budget are detected from Strata's `/api/native` model metadata; 30% of the window is used for replies, at most 32K tokens.
- `imageInput` is set from the model's own Strata metadata. If the selected Strata model has no vision support, requests with images fail at the model level.

## Publishing

The GitHub repository and release are public:

- Repository: <https://github.com/xardiant/strata-copilot-chat>
- Release: <https://github.com/xardiant/strata-copilot-chat/releases/tag/strata-copilot-chat-0.2.0>
- VSIX: `strata-copilot-chat-0.2.0.vsix`

The public VS Code registries require credentials that are not stored in this repository:

### Open VSX (`xardiant.strata-copilot-chat`)

Version `0.2.0` is published and verified at <https://open-vsx.org/extension/xardiant/strata-copilot-chat>.

Re-publishing requires an Eclipse Foundation account linked to the publisher account, a signed **Eclipse Foundation Open VSX Publisher Agreement**, and a short-lived access token from `/user-settings/tokens`. Without that token, the registry rejects uploads. Tokens are per-user credentials and are not stored in this repository.

Once a token is available:

```bash
ovsx publish strata-copilot-chat-0.2.0.vsix -p <token>
```

The `xardiant` namespace is currently unverified in the registry.

### Visual Studio Marketplace

Marketplace publishing requires a `VSCE_PAT`:

```bash
vsce publish --packagePath strata-copilot-chat-0.2.0.vsix --pat <VSCE_PAT>
```

Then verify <https://marketplace.visualstudio.com/items?itemName=xardiant.strata-copilot-chat>.

## Development

- This extension was built using the LM Studio Copilot Chat provider extension ([github.com/yoy123/lmstudio-copilot-provider](https://github.com/yoy123/lmstudio-copilot-provider), published as [DanLambiase/lmstudio-copilot-provider](https://open-vsx.org/extension/DanLambiase/lmstudio-copilot-provider)) as the reference for image input, model refresh, provider registration and VSIX packaging.
- `npm test` runs the unit tests (stubbed `vscode` module, no VS Code needed).
