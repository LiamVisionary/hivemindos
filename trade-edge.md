# Trade edge — a trading server you can move

Trading speed is mostly distance. A request to a venue's servers takes a few milliseconds from the same
city and hundreds from the other side of the world, and no amount of faster code makes up for that.
`scripts/trade-edge.mjs` puts a small server next to whichever venue matters and moves it when that
changes. It is developer tooling and runs on a Mac signed in to the Azure CLI.

## Find where to be

```sh
node scripts/trade-edge.mjs probe --regions london,frankfurt,virginia,tokyo
```

Short-lived servers in each region time every known venue (fresh connection and reused connection),
report the best region per venue, and are deleted before the command returns. `regions` lists the
friendly names.

## Run something there

```sh
node scripts/trade-edge.mjs up london
node scripts/trade-edge.mjs deploy polymarket-book-recorder
node scripts/trade-edge.mjs status
node scripts/trade-edge.mjs move frankfurt
node scripts/trade-edge.mjs down
```

- `up` creates one node in its own resource group, allows SSH from this machine's current address only,
  and installs Node from nodejs.org after checking its published checksum.
- `deploy` ships a workload from the committed tree (uncommitted edits are not shipped and are listed)
  and runs it under systemd as an unprivileged user that can write only its data directory.
- `move` is make-before-break: the new node comes up and every workload is checked healthy (running,
  output growing) before the old node's workloads stop, its data is copied back and it is deleted. If the
  new node is not healthy, the old one is left running.
- `pull` copies the node's data back; `down` pulls, deletes the resource group and confirms it is gone.
- `prune --days N` deletes workload output on the node that has not been written for N days. `pull` never
  deletes, so a file removed only on this machine comes back on the next pull; pull first, then prune.
- `allow-me` re-allows SSH after this machine's address changes.

## Workloads

A workload is a JSON file in `scripts/trade-edge/workloads/`: the repository files to ship, the working
directory, the `node` arguments (`{data}` is the workload's data directory), the output directory whose
growth means it is working, the venues it talks to, and optionally `healthWindowSeconds`: how long a
health check watches the output grow (default 20 s; a workload that writes once a minute needs more).
Adding one needs no change to the tool.

`polymarket-book-recorder` records Polymarket's BTC Up/Down books, Chainlink and Binance;
`exchange-price-feeds` records Kraken, Coinbase and Bitstamp trades and top-of-book changes beside it, so
a replay can merge the two by receive time. `venue-probe-loop` times every venue once a minute.

## Limits

- A node holds no shared credentials and does not join the private network; workloads that read public
  data only. Giving a node credentials is a separate decision.
- Nothing deletes a node automatically. `status` shows its running time, rough cost and monthly rate;
  `down` is the only teardown.
- Azure is the working provider. Vultr is in the region table, but its API key answers only from
  allowlisted addresses.
- Moving the server shortens the trip to the venue, not delays inside a venue's own feeds.
