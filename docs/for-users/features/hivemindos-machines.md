---
title: "HivemindOS Machines"
---

# HivemindOS Machines

HivemindOS Machines are pre-initialized Linux virtual machines sold through
Microsoft Azure Marketplace. They appear beside bring-your-own Hetzner in the
Fleet **New Machine** flow.

## Who owns and pays for the machine

The Azure customer owns the subscription, resource group, virtual machine,
network, disk, and access policy. Microsoft bills that Azure subscription for
two separate parts:

- Azure infrastructure, including the VM, disk, public IP, bandwidth, regional
  premiums, and applicable tax;
- the HivemindOS Marketplace software fee for the selected plan.

The HivemindOS software fee is not a hidden markup inside the Azure compute
price. It is a separate Microsoft Marketplace line item. Microsoft deducts its
Marketplace store fee before paying the publisher.

No local Azure MCP installation is required. HivemindOS uses the connected
Microsoft identity and Azure Resource Manager directly, subject to the user's
Azure RBAC permissions.

## Before deployment

HivemindOS shows the hourly software fee before the final action. The customer
then chooses an Azure subscription, region, machine name, and resource group.
The final confirmation explains that Azure infrastructure is additional and
accepts the Marketplace terms for that plan.

Azure pay-as-you-go subscriptions do not provide a universal hard spending cap.
Budgets and alerts are warnings, not automatic shutdown controls. A stopped VM
can still incur disk and public-IP charges, so delete resources that are no
longer needed and review the live Microsoft estimate before confirming.

## Initialization and access

The Marketplace image includes the HivemindOS collector-only agent bridge and
its service definition. First boot applies the machine name, starts the bridge,
and creates a local SSH key for the operator. The Azure resource stays visible
and manageable in Azure Portal.

The initial network permits SSH and does not expose the HivemindOS collector
port publicly. Connect the machine to Hivemind Link or a private Tailnet before
using it as a normal private Fleet peer.

## Marketplace availability

If Microsoft publisher enrollment, tax and payout validation, image preview, or
certification is still pending, the card shows the proposed plans but disables
deployment. Proposed pricing cannot bill anyone. Once Microsoft publishes the
offer, the HivemindOS-controlled catalog supplies the official publisher, offer,
plan, and software-fee policy and the deploy action becomes available.

Self-hosted builds can implement a different machine provider, but they cannot
redirect the official HivemindOS Marketplace payout or change the official
software fee from local app settings.
