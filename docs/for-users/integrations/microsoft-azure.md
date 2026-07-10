---
title: "Microsoft Azure"
---

# Microsoft Azure

HivemindOS offers two separate Azure paths from the Microsoft Azure card in **Integrations**. Neither path creates an Azure subscription or deploys a resource.

## Hosted connection

Choose **Connect with Microsoft Azure** for a read-only connection using an organizational Entra identity or a personal Microsoft account with Azure access. Work or school accounts use the one-click path. For an Outlook, Hotmail, Skype, or Xbox account, expand **Personal Microsoft account** and enter the Entra tenant ID that owns the Azure subscription before connecting. Microsoft requires Azure Management authorization for personal accounts to run through that tenant rather than its generic consumer endpoint. HivemindOS can then let agents:

- list the Azure subscriptions the signed-in account can see;
- list resource groups and resources;
- read an individual Azure Resource Manager configuration when given its resource ID and API version.

The hosted OAuth broker is operated by HivemindOS. HivemindOS pays for that broker; the connection itself does not add an Azure charge. Your Azure billing account remains responsible for Azure resources that already exist or that you later choose to create elsewhere.

Microsoft organization tenants can restrict consent to new multitenant applications. Until the HivemindOS Entra app has a Microsoft-verified publisher, some users will need a tenant administrator to approve the app before sign-in succeeds.

The hosted path does not create, update, start, stop, or delete Azure resources. Its refresh token is stored in the user's shared hive environment so connected machines can use the same account without putting the token in an agent runtime config.

## Local-first Azure MCP

Choose **Install read-only MCP** to install Microsoft's official Azure MCP only on the current machine. HivemindOS pins the stable `@azure/mcp` version, verifies the npm package integrity, and registers it with installed agent runtimes.

Expect approximately 114 MB of local disk use. The small npm wrapper downloads a platform-specific binary, which accounts for nearly all of that size.

The initial configuration is deliberately conservative:

- read-only server mode;
- consolidated tool mode instead of exposing hundreds of individual tools;
- Microsoft MCP telemetry disabled;
- authentication through your own Azure identity and Azure RBAC;
- no Azure subscription, resource, or service is created during installation.

The local MCP uses Azure's supported credential chain. Signing in with Azure CLI, Azure PowerShell, Azure Developer CLI, or the interactive browser makes the same local MCP usable without copying a credential into HivemindOS.

## Management mode and billing safety

Management mode is opt-in. HivemindOS shows a second warning before removing the MCP's read-only flag because an agent with sufficient Azure RBAC may then create, modify, start, stop, or delete Azure resources.

Azure budgets and cost alerts are useful warnings, but a standard pay-as-you-go subscription does not provide a universal hard spending cap. For that reason:

- keep MCP read-only until a management task is necessary;
- grant the signed-in identity the narrowest Azure RBAC role and scope that can do the job;
- use a dedicated subscription or resource group for agent-managed work;
- configure a small budget with multiple alert thresholds;
- review existing resources, reservations, support plans, and marketplace products before enabling management;
- return the MCP to read-only after the task.

Credits reduce the amount charged to a payment method only while eligible credit remains. They do not, by themselves, prevent resources from continuing to accrue charges after the credit is exhausted.

## Remove access

Use **Disconnect** to remove the hosted Microsoft refresh token and account metadata from the shared hive environment.

Use **Remove** in the local MCP section to delete the dedicated Azure MCP installation and only the HivemindOS-managed `azure` entries in local runtime configuration files. Other MCP servers and runtime settings are preserved.

## Self-hosted builds

Self-hosters can supply a different public Entra client ID with `AZURE_OAUTH_CLIENT_ID` and point their build at their own confidential OAuth broker with `AZURE_OAUTH_BROKER_URL`. The client secret belongs only in that broker. Never place an Entra client secret in the desktop app, public repository, shared hive environment, or runtime MCP configuration.

Microsoft reference material:

- [OAuth 2.0 authorization code flow](https://learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow)
- [List Azure subscriptions](https://learn.microsoft.com/rest/api/resources/subscriptions/list)
- [Manage resources with the Azure Resource Manager REST API](https://learn.microsoft.com/azure/azure-resource-manager/management/manage-resources-rest)
